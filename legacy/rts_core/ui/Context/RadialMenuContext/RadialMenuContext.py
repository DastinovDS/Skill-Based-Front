import typing

# from rts_core.ui.Screen import Screen
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.ui.UIState import UIState
    from rts_core.engine import Renderer

from rts_core.engine.Renderer.LAYERS import *

    
from rts_core.classes import Province

from rts_core.ui.Menus.RadialMenu import RadialMenuItem, RadialMenu
from rts_core.ui.Context.InputContext import InputContext  

from .ActionRegistry import ActionRegistry

import pygame
import math
import time


class RadialMenuContext(InputContext):
    def __init__(self, radial_menu: "RadialMenu", game: "Game", province: Province, initial_data):
        self.menu = radial_menu
        self.game = game
        self.is_transparent = True
        self.ui: UIState = game.ui
        self.province = province

        self.action_registry = ActionRegistry(self.game)

        # history stack
        self.history = [] 
        self.current_data = initial_data

        self.hover_item_id: int | None = None
        self.hover_start_time: float = 0.0
        self.tooltip_delay: float = 0.5
        self.last_hover_index: int | None = None

        # self.previous_context = game.ui.context
    @staticmethod
    def indificator() -> str:
        return "radialmenu"

    @staticmethod
    def activate_for_province(province: Province, game: "Game", data: dict):
        if game.ui.radial_menu is None:
            return
        ctx = RadialMenuContext(game.ui.radial_menu, game, province, data)
        items = ctx.create_items(data)
        
        game.ui.radial_menu.open((province.pos_x, province.pos_y), items)
        game.ui.push_context(ctx)

    def open_submenu(self, new_data):
        self.history.append(self.current_data)
        self.current_data = new_data
        items = self.create_items(new_data)
        self.menu.open(self.menu.center, items)

    def go_back(self):
        if self.history:
            self.current_data = self.history.pop()
            items = self.create_items(self.current_data)
            self.menu.open(self.menu.center, items)
        else:
            self.ui.pop_context()

    def create_items(self, data_level):
        items = []
        registry = self.action_registry

        for _label, config in sorted(data_level.items(), key=lambda x: x[1].get("key", 99)):
            if "children" in config:
                action = lambda c=config["children"]: self.open_submenu(c) # type: ignore
                is_enabled = True
            else:
                action_type = config.get("type", config.get("action"))
                obj_id = config.get("id")
                
                is_enabled = registry.is_available(action_type, self.province, obj_id)
                
                def action(t=action_type, o=obj_id):
                    registry.execute(t, self.province, o)
                    self.ui.pop_context()

            item = RadialMenuItem(
                label=config.get("name", _label),
                action=action,
                color=config.get("color", (200, 200, 200)),
                enabled=is_enabled
            )
            item.hotkey = config.get("key", 0)
            item.description = config.get("description", "")
            item.icon_name = config.get("textures-path", None)
            items.append(item)

        if self.history:
            back_item = RadialMenuItem("radial-menu.back-button", self.go_back, color=(255, 50, 50))
            back_item.hotkey = 0 
            items.append(back_item)
    
        return items
    
    def refresh(self):
        """
        Updates the enabled state of the current menu items 
        without changing the menu structure.
        """
        registry = self.action_registry
        
        for i, (_, config) in enumerate(sorted(self.current_data.items(), key=lambda x: x[1].get("key", 99))):
            if i >= len(self.menu.items): break
            
            if "children" not in config:
                action_type = config.get("type", config.get("action"))
                obj_id = config.get("id")
                
                self.menu.items[i].enabled = registry.is_available(action_type, self.province, obj_id)

    def on_click(self, button, cordinats: tuple[int, int]):
        screen_center = self.game.camera.world_to_screen(*self.menu.center)
        
        item = self.menu.pick_radial_item_screen(cordinats, screen_center)
        
        if item and item.enabled:
            self.game.sound_manager.play_spatial("ui.click_radial")
            item.action()
        elif item and not item.enabled:
            pass 
        else:
            self.ui.pop_context()

    def on_key(self, key):
        # Backspace
        if key == pygame.K_BACKSPACE:
            self.go_back()
            return

        # Escape
        if key == pygame.K_ESCAPE:
            self.ui.pop_context()
            return

        key_name = pygame.key.name(key)
        if key_name.isdigit():
            target_key = int(key_name)
            for item in self.menu.items:
                if item.hotkey == target_key and item.enabled:
                    item.action()
                    return
                
    def on_exit(self):
        self.menu.close()


    def draw(self, renderer: "Renderer", dt: float):
        if not self.menu.active or not self.menu.items:
            return
        
        n = len(self.menu.items)
        cx, cy = self.game.camera.world_to_screen(*self.menu.center)
        
        screen_mouse = self.game.ui.mouse_position
        hover_index = self.menu.get_hover_index_screen(self.menu, screen_mouse, (cx, cy))

        current_time = time.time()
        if hover_index != self.last_hover_index:
            self.last_hover_index = hover_index
            self.hover_start_time = current_time

        R = self.menu.radius
        r = R * 0.5
        gap = 15

        surf_size = int(R * 2 + 20)
        temp_surface = pygame.Surface((surf_size, surf_size), pygame.SRCALPHA)
        temp_center = pygame.Vector2(surf_size // 2, surf_size // 2)

        sector_step = 2 * math.pi / n

        for i in range(n):
            item = self.menu.items[i]
            angle_start = i * sector_step
            angle_end = (i + 1) * sector_step

            base_color = item.color if item.enabled else (80, 80, 80)
            color = self.menu.highlight_color if (i == hover_index and item.enabled) else base_color

            rgba_fill = (*color, 140)
            rgba_edge = (*color, 255)

            half_gap_angle = (gap / 2) / r if r > 0 else 0
            s_a = angle_start + half_gap_angle
            e_a = angle_end - half_gap_angle

            points = []
            num_arc_pts = 12
            for j in range(num_arc_pts + 1):
                ang = s_a + (e_a - s_a) * (j / num_arc_pts)
                points.append(temp_center + pygame.Vector2(math.cos(ang), math.sin(ang)) * R)

            for j in range(num_arc_pts, -1, -1):
                ang = s_a + (e_a - s_a) * (j / num_arc_pts)
                points.append(temp_center + pygame.Vector2(math.cos(ang), math.sin(ang)) * r)

            renderer.screen.polygon(rgba_fill, points, custom_surface=temp_surface)
            renderer.screen.polygon(rgba_edge, points, 2, custom_surface=temp_surface)

        renderer.draw_blit(temp_surface, (cx, cy), centered=True, is_world_pos=False, z_index=LAYER_UI+UI_PRIORITY_LOW)

        for i in range(n):
            item = self.menu.items[i]
            text_color = (255, 255, 255) if item.enabled else (150, 150, 150)

            mid_angle = (i * sector_step) + (sector_step / 2)
            tx = cx + math.cos(mid_angle) * (r + R) / 2
            ty = cy + math.sin(mid_angle) * (r + R) / 2

            if item.icon_name:
                icon_surf = self.game.sprite_manager.get(item.icon_name)
                renderer.draw_blit(icon_surf, (tx, ty), centered=True, is_world_pos=False, z_index=LAYER_UI+UI_PRIORITY_LOW)

            label = self.game.language_manager.translate(item.label)
            display_text = f"[{item.hotkey}] {label}" if hasattr(item, 'hotkey') else label
            
            renderer.draw_text(
                display_text, 
                (tx, ty), 
                size=self.menu.font.size, 
                color=text_color, 
                center=True, 
                z_index=LAYER_UI+UI_PRIORITY_LOW
            )

        if hover_index is not None and (current_time - self.hover_start_time > self.tooltip_delay):
            item = self.menu.items[hover_index]
            if item.description:
                mx, my = self.game.ui.mouse_position
                renderer.draw_text(
                    self.game.language_manager.translate(item.description),
                    (mx + 20, my + 20),
                    size=18,
                    color=(255, 255, 255),
                    background_color=(30, 30, 30, 220),
                    padding=10,
                    wrap_width=250,
                    z_index=LAYER_UI+UI_PRIORITY_LOW
                )