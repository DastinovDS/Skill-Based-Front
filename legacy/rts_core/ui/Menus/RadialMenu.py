import math

import pygame
import math
from typing import List, Callable, Optional

from rts_core.system.FontManager import Font

class RadialMenuItem:
    def __init__(self, label: str, action: Callable, color=(200, 200, 200), enabled: bool=True):
        self.label = label
        self.action = action
        self.color = color
        self.enabled = enabled
        self.hotkey = 0
        self.icon_name = None
        self.description = ""

class RadialMenu:
    def __init__(
        self,
        font: Font,
        radius: int = 80,
        item_radius: int = 30,
        item_color=(200, 200, 200),
        highlight_color=(255, 255, 0)
    ):
        self.font = font
        self.radius = radius
        self.item_radius = item_radius
        self.item_color = item_color
        self.highlight_color = highlight_color

        self.items: List[RadialMenuItem] = []
        self.center: tuple[int, int] = (0, 0)
        self.active = False
        self.selected_index: Optional[int] = None

    def open(self, center: tuple[int, int], items: List[RadialMenuItem]) -> None:
        self.center = center
        self.items = items
        self.active = True
        self.selected_index = None

    def close(self):
        self.active = False
        self.items = []
        self.selected_index = None


    def handle_click(self, mouse_pos: tuple[int, int]) -> None | RadialMenuItem:
        if not self.active:
            return

        cx, cy = self.center
        mx, my = mouse_pos

        dx, dy = mx - cx, my - cy
        distance = math.hypot(dx, dy)
        if distance > self.radius:
            return
        
        angle = (math.atan2(dy, dx) + 2*math.pi) % (2*math.pi)
        n = len(self.items)
        sector_size = 2*math.pi / n
        index = int(angle// sector_size)

        if index >= len(self.items):
            return
        
        item = self.items[index]
        item.action()
        return item

    @staticmethod
    def get_radial_positions(center, radius, n):
        cx, cy = center
        positions = []
        for i in range(n):
            angle = 2 * math.pi * i / n - math.pi / 2
            x = cx + int(radius * math.cos(angle))
            y = cy + int(radius * math.sin(angle))
            positions.append((x, y))
        return positions
    
    def pick_radial_item_screen(self, mouse_pos: tuple[int, int], screen_center: tuple[int, int]) -> RadialMenuItem | None:
        """Проверка клика полностью в экранных координатах (устойчива к зуму)"""
        if not self.active or not self.items:
            return None

        cx, cy = screen_center
        mx, my = mouse_pos

        dx, dy = mx - cx, my - cy
        distance = math.hypot(dx, dy)

        # Проверка внешнего радиуса (он фиксирован на экране, например 80)
        if distance > self.radius:
            return None

        # Проверка мертвой зоны в центре
        inner_deadzone = self.item_radius * 0.6
        if distance < inner_deadzone:
            return None

        angle = (math.atan2(dy, dx) + 2 * math.pi) % (2 * math.pi)

        n = len(self.items)
        sector_size = 2 * math.pi / n
        index = int(angle // sector_size)

        if index < 0 or index >= n:
            return None

        return self.items[index]

    @staticmethod
    def get_hover_index_screen(menu: "RadialMenu", mouse_pos: tuple[int, int], screen_center: tuple[int, int]):
        """Проверка ховера полностью в экранных координатах"""
        cx, cy = screen_center
        mx, my = mouse_pos
        dx, dy = mx - cx, my - cy
        distance = math.hypot(dx, dy)
        
        if distance > menu.radius:
            return None

        angle = (math.atan2(dy, dx) + 2 * math.pi) % (2 * math.pi)
        n = len(menu.items)
        sector_size = 2 * math.pi / n
        index = int(angle // sector_size)
        
        if index >= n:
            return None
        return index