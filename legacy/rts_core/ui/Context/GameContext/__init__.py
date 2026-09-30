import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.ui.Context.InputContext import InputContext
from rts_core.ui.Context.RadialMenuContext import RadialMenuContext
from rts_core.ui.Context.EscapeContext import EscapeContext

import pygame

from rts_core.classes.core_classes import Province
from rts_core.classes.core_classes import UnitGroup

from rts_core.data.radialmenu_data import MENU_DATA
from rts_core.game_logic import find_path
from rts_core.engine import Renderer

from .GameRender import GameRender

# Widgit
from rts_core.ui.Widget.Game import (
    LeaderboardWidget, 
    ProvinceHUDWidget,
    ResourceListWidget, 
    TroopSlider,
)

from rts_core.ui.Widget.Containers import (
    ArmyManagerWindow
)


class GameContext(InputContext):
    def __init__(self, game: "Game") -> None:
        super().__init__(game)
        self.is_transparent = False

        self.render = GameRender(self.game)
    
    @staticmethod
    def indificator() -> str:
        return "game"

    def _get_hovered_province(self, pos: "tuple[int, int]") -> Province | None:
        return next((p for p in self.game.provinces
                            if (p.pos_x - pos[0])**2 + (p.pos_y - pos[1])**2 < 900), None)
    
    def _get_unit_at(self, pos: "tuple[int, int]") -> UnitGroup | None:
        if self.game.me is None: return
        for unitgrupe in self.game.me.unit_groups.values(): 
            dist = pygame.Vector2(unitgrupe.current_pos).distance_to(pos)
            if dist < 15: return unitgrupe
        return None

    def on_hover(self, cordinats: "tuple[int, int]", rel):

        world_pos = self.game.camera.screen_to_world(*cordinats)

        if pygame.mouse.get_pressed()[1]: 
            self.game.camera.x -= rel[0] / self.game.camera.zoom
            self.game.camera.y -= rel[1] / self.game.camera.zoom
            return

        province = self._get_hovered_province(world_pos)
        if self.game.ui.selected_group is None or self.game.ui.selected_group != self.game.ui.hovered_province:
            self.game.ui.hovered_province = province

        mods = pygame.key.get_mods()
        if (mods & pygame.KMOD_SHIFT) and self.game.ui.selected_group and province:

            start_node = self.game.ui.selected_group.current_province
            path = find_path(start_node, province) 
            self.game.ui.preview_path = path
        else:
            self.game.ui.preview_path = None

    def on_click(self, button, cordinats: "tuple[int, int]"):
        world_pos = self.game.camera.screen_to_world(*cordinats)

        province = self._get_hovered_province(world_pos)
        unit = self._get_unit_at(world_pos)

        army_window: "ArmyManagerWindow | None" = self.get_widget("army_manager")

        if button == 1:
            if unit:
                self.game.sound_manager.play_spatial("ui.click")
                
                self.game.ui.selected_group = unit if unit.owner == self.game.me else None
                self.game.ui.selected_province = None
                if army_window: army_window.visible = False
            elif province:
                self.game.sound_manager.play_spatial("ui.click")

                self.game.ui.selected_province = province if province.owner == self.game.me else None
                self.game.ui.selected_group = None

        elif button == 3 and self.game.ui.selected_group and province:
            self.game.sound_manager.play_spatial("ui.click")

            self.game.ui.selected_group.move_group_to(self.game, province)
            self.game.ui.selected_province = None
            self.game.ui.selected_group = None
            if army_window: army_window.visible = False


    def on_double_click(self, cordinats: "tuple[int, int]"):
        army_window: "ArmyManagerWindow | None" = self.get_widget("army_manager")
        world_pos = self.game.camera.screen_to_world(*cordinats)

        province = self._get_hovered_province(world_pos)
        if self.game.ui.radial_menu and province and (province.owner == self.game.me):
            self.game.sound_manager.play_spatial("ui.click")

            RadialMenuContext.activate_for_province(province, self.game, MENU_DATA)

        if province and self.game.ui.selected_group and province.units:
            self.game.sound_manager.play_spatial("ui.click")

            if army_window: 
                army_window.visible = True if province.owner == self.game.me else False
                army_window.refresh(province)

    def on_key(self, key):
        prov = self.game.ui.selected_province
        me = self.game.me
        # self.game.sound_manager.play_spatial("ui.click")
        if key == pygame.K_ESCAPE:
            self.game.ui.push_context(EscapeContext(self.game))
            return

        if prov and me: 
            if key == pygame.K_m:
                self.game.action_manager.request_construction("Metal Mine", prov)
            elif key == pygame.K_b:
                self.game.action_manager.request_construction("Barracks", prov)
            elif key == pygame.K_t:
                self.game.action_manager.request_train_unit("Infantry", prov)
        
        if key == pygame.K_s:
            if self.game.ui.selected_group:
                unit = self.game.ui.selected_group
                if unit.move_progress != 0:
                    self.game.movement_manager.stop_unit(unit)
                    print(f"Unit {unit.group_id} stopped at {unit.move_progress}")


    def on_scroll(self, scroll: int):
        cam = self.game.camera
        mouse_screen_pos = self.game.ui.mouse_position
        
        old_world_pos = cam.screen_to_world(*mouse_screen_pos)

        zoom_factor = 1.1
        if scroll > 0:
            cam.zoom *= zoom_factor
        else:
            cam.zoom /= zoom_factor

        cam.zoom = max(0.2, min(cam.zoom, 3.0))

        new_world_pos = cam.screen_to_world(*mouse_screen_pos)
        cam.x -= (new_world_pos[0] - old_world_pos[0])
        cam.y -= (new_world_pos[1] - old_world_pos[1])


    def draw(self, renderer: Renderer, dt: float):
        self.render.draw(renderer, dt)

    def update(self, dt: float):
        self.render.update(dt)


    def on_setup_ui(self):
        # "Applying global attribute routing for UI layer priority"

        self.add_widget("leaderboard", LeaderboardWidget, "hud", self.game, (1.0,0), offset=(-170,10))
        self.add_widget("recurselist", ResourceListWidget, "hud", self.game, offset=(10,10))
        self.add_widget("province_hud", ProvinceHUDWidget, "hud", self.game, (250, 80), anchor=(0.5, 1), pivot=(0.5, 1), offset=(0, -20))

        self.add_widget("slider", TroopSlider, "hud", self.game, (100, 20), (0.5,0.5), offset=(-100,-20), visible=False)

        self.army_window: ArmyManagerWindow = self.add_widget("army_manager", ArmyManagerWindow, "hud", self.game)
        self.army_window.visible = False


    def on_exit(self):
        super().on_exit()
        self.game.network_manager.disconnect()
        if self.game.chunk_manager:
            self.game.chunk_manager.clear()
            self.game.chunk_manager = None