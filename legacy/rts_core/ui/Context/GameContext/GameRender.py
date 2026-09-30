import typing
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.ui.Context.BaseHandler import BaseHandler
    from rts_core.engine import Renderer
    from rts_core.classes import UnitGroup


import math
import pygame

from rts_core.data.buildings_data import BUILDING_DEFINITIONS
from rts_core.data.units_data import UNIT_DEFINITIONS

from .handlers.ArtilleryStrike import ArtilleryStrike
from .handlers.TankStrike import TankStrike

from rts_core.engine.Renderer.LAYERS import LAYER_UNITS, LAYER_DECALS, LAYER_VFX

from rts_core.game_logic.World.MapGenerator import MapGenerator

class GameRender:
    def __init__(self, game: "Game") -> None:
        self.game = game
        self.cam = game.camera

        self.unit_states: dict[int, dict[str, str | float]] = {}

        self.player_colors = {
            1: (220, 80, 80), 
            2: (80, 80, 220), 
            3: (80, 200, 80), 
            4: (230, 210, 70),        
        }

        self.handlers: list["BaseHandler"] = [
            ArtilleryStrike(self.game),
            TankStrike(self.game)
        ]

        self.CELL_SIZE = 1
        self.territories_surface = None
        self.road_borders = {}

        # Debug TODO: delete it 
        self.debug_data = 0

    def _smooth_line_points(self, points: list[tuple[float, float]], iterations: int = 2) -> list[tuple[float, float]]:
        """Smooths the polyline of internal boundaries using the corner-cutting method."""
        if len(points) < 3: 
            return points
        current = list(points)
        for _ in range(iterations):
            next_pts = [current[0]]
            for i in range(len(current) - 1):
                p0, p1 = current[i], current[i+1]
                q = (0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1])
                r = (0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1])
                next_pts.append(q)
                next_pts.append(r)
            next_pts.append(current[-1])
            current = next_pts
        return current

    def update(self, dt: float):
        for handler in self.handlers:
            handler.update(dt)

    def draw(self, render: "Renderer", dt: float):
        render.fill((0, 105, 148))

        self.road_borders = {}
        visible_edges = []

        if self.game.chunk_manager:
            self.game.chunk_manager.draw_visible_chunks(render)
            # for chunk in visible_chunks:
            #     self.road_borders.update(chunk.road_borders)
            #     visible_edges.extend(chunk.edges)

        self.draw_provinces_connection(render, 0)
        self.draw_boundaries(render, visible_edges, 1)

        self.draw_provinces(render, 1)
        self.draw_hovered_province(render, 2)

        self.draw_unit_path(render, 3)
        self.draw_constructions_time(render, 4)
        
        render.vfx_manager.draw(render, layer=0)

        for handler in self.handlers:
            handler.draw(render, 5)

        self.draw_unit_attack_area(render, 6)
        self.draw_units(render, dt, 7)

        render.vfx_manager.draw(render, layer=1)

    def draw_boundaries(self, render: "Renderer", edges: list, z_index: int) -> None:
        """Отрисовывает сетку границ между провинциями"""
        if not edges: 
            return
            
        color = (30, 30, 30, 120) 
        thickness = max(1, int(2 * self.cam.zoom))

        for p1, p2 in edges:
            render.line(color, p1, p2, thickness, z_index=LAYER_UNITS + z_index)

    def draw_provinces_connection(self, render: "Renderer", z_index: int) -> None:
        """
        Draw all connections provinces on the map.
        """
        for prov in self.game.provinces:
            for neighbor in prov.neighbors:
                edge = tuple(sorted([(prov.pos_x, prov.pos_y), (neighbor.pos_x, neighbor.pos_y)]))

                start_pos = (prov.pos_x, prov.pos_y)
                end_pos = (neighbor.pos_x, neighbor.pos_y)
                
                if edge in self.road_borders:
                    mid_pos = self.road_borders[edge]
                    smooth_road = self._smooth_line_points([start_pos, mid_pos, end_pos], iterations=1)
                    render.poly_line((128, 128, 128, 80), smooth_road, 2, z_index=LAYER_UNITS+z_index)
                else:
                    render.line((128, 128, 128, 80), start_pos, end_pos, 2, z_index=LAYER_UNITS+z_index)

    
    def draw_provinces(self, render: "Renderer", z_index: int) -> None:
        zoom = self.cam.zoom

        for prov in self.game.provinces:
            screen_pos = (prov.pos_x, prov.pos_y)

            color = self.player_colors.get(prov.owner.player_id, (255, 0, 255)) if prov.owner else (255, 0, 255)

            if prov.owner:
                render.circle(color, screen_pos, 20, z_index=LAYER_UNITS+z_index)

            if prov.buildings:
                for i, (b_id, b_data) in enumerate(prov.buildings.items()):
                    b_def = BUILDING_DEFINITIONS.get(b_data.building_type, {})
                    path = b_def.get("textures-path", "template.none")

                    render.draw_sprite(path, screen_pos, zoom, z_index=LAYER_UNITS+z_index )
                    
            # Province selection
            if self.game.ui.selected_province == prov:
                render.circle((255, 255, 255), screen_pos, 25, max(1, int(2 * zoom)), z_index=LAYER_UNITS+z_index)

    def draw_hovered_province(self, render: "Renderer", z_index: int) -> None:
        if self.game.ui.hovered_province:
            prov = self.game.ui.hovered_province
            render.circle((16, 181, 240), (prov.pos_x, prov.pos_y), 25, max(1, int(6 * self.cam.zoom)), z_index=LAYER_UNITS+z_index)


    def draw_unit_path(self, render: "Renderer", z_index: int) -> None:
        ui = self.game.ui
        
        if ui.selected_group and ui.preview_path:
            start_pos = ui.selected_group.current_pos 
            full_path = [start_pos] + [(p.pos_x, p.pos_y) for p in ui.preview_path]

            if len(full_path) > 1:
                render.poly_line((6, 181, 240), full_path, 5, z_index=LAYER_UNITS+z_index)

        for player in self.game.players:
            for group in player.unit_groups.values():
                if not group.target_province and not group.path:
                    continue
                
                pts = [group.current_pos]
                
                if group.target_province:
                    pts.append((group.target_province.pos_x, group.target_province.pos_y))
                
                pts.extend([(p.pos_x, p.pos_y) for p in group.path])
                
                if len(pts) > 1:
                    render.poly_line((255, 255, 0), pts, 3, z_index=LAYER_UNITS+z_index)

    def draw_unit_attack_area(self, render: "Renderer", z_index: int) -> None:
        ui = self.game.ui
        unit = ui.selected_group

        if not unit or unit.attack_range <= 0:
            return
        att_range = unit.attack_range
        pos = unit.current_pos

        render.circle((62, 0, 0, 80), pos, att_range, z_index=LAYER_DECALS+z_index)
        render.circle((186, 0, 0, 150), pos, att_range, width=5, z_index=LAYER_DECALS+z_index)

    def draw_units(self, render: "Renderer", dt: float, z_index: int):
        zoom = self.cam.zoom
        cell_size = 20.0
        grid: dict[tuple[int, int], list["UnitGroup"]] = {} 

        all_groups = [g for p in self.game.players for g in p.unit_groups.values()]
        
        # Debug TODO: delete it 
        self.debug_data = len(all_groups)
        
        for group in all_groups:
            gx, gy = group.current_pos
            cell = (int(gx // cell_size), int(gy // cell_size))
            grid.setdefault(cell, []).append(group)

        skipped_ids = set()
        combat_clouds = []

        for group in all_groups:
            gid = id(group)
            if gid in skipped_ids: continue

            gx, gy = group.current_pos
            cx, cy = int(gx // cell_size), int(gy // cell_size)
            
            found_combat = False
            for dx in range(-1, 2):
                for dy in range(-1, 2):
                    neighbor = (cx + dx, cy + dy)
                    if neighbor in grid:
                        for other in grid[neighbor]:
                            if id(other) == gid or id(other) in skipped_ids: continue
                            
                            dist_sq = (other.current_pos[0]-gx)**2 + (other.current_pos[1]-gy)**2
                            if dist_sq < cell_size**2:
                                if other.owner != group.owner: 
                                    skipped_ids.add(id(other))
                                    skipped_ids.add(gid)
                                    combat_clouds.append(((gx + other.current_pos[0])/2, (gy + other.current_pos[1])/2))
                                    found_combat = True
                                    break
                if found_combat: break


        for group in all_groups:
            gname = group.unit_type.lower()
            gid = id(group)
            if gid in skipped_ids: continue

            state = self.unit_states.setdefault(gid, {"time": 0.0, "status": group.state.lower()})
            if state["status"] != group.state.lower():
                state.update({"time": 0.0, "status": group.state.lower()})

            old_time = float(state["time"])
            state["time"] += dt # pyright: ignore[reportOperatorIssue]
            
            anim = render.draw_sprite(
                UNIT_DEFINITIONS[group.unit_type]["textures-path"],
                group.current_pos, zoom, str(state["status"]),
                palette=f"player_{group.owner.player_id}",
                z_index=LAYER_UNITS+z_index,
                time=state["time"]
            )
            if anim:
                triggers = anim.get_triggered_events(old_time, float(state["time"]))
                if gname in self.handlers and triggers:
                    n = self.handlers.index(gname) # type: ignore
                    self.handlers[n].trigger(group, triggers)

        for cloud_pos in combat_clouds:
            render.draw_sprite("vfx.combat-smock", cloud_pos, zoom, "combat", time=self.game.game_time, z_index=LAYER_VFX+z_index)

        if self.game.ui.selected_group:
            pos = self.game.ui.selected_group.current_pos
            render.circle((255, 255, 255), pos, 16, 3, z_index=LAYER_UNITS+z_index)

    def draw_constructions_time(self, render: "Renderer", z_index: int) -> None:
        if not self.game.me: return
        me = self.game.me

        for (color, radius), queue in (
                (((169, 200, 244), 30), me.building_queue),
                (((255, 140, 145), 27), me.training_queue)
            ):
            for construction in queue:
                prov = construction["province"]

                c_def = construction["definition"]
                construction_time = c_def.get("construction_time") or c_def.get("training_time")
                
                elapsed = construction_time - construction["time_left"]
                progress = max(0.0, min(elapsed / construction_time, 1.0))

                start_angle = -math.pi / 2
                end_angle = start_angle + progress * 2 * math.pi

                render.arc(color, (prov.pos_x, prov.pos_y), radius, start_angle, end_angle, 2)