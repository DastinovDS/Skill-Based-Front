import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.engine.Renderer import Renderer
from rts_core.ui.Widget.UIWidget import UIWidget

import pygame

class SliderBar(UIWidget):
    def __init__(self, game: "Game", size: tuple[int, int], anchor: tuple[float, float] = (0,0), pivot: tuple[float, float] = (0,0), offset: tuple[int, int] = (0,0), visible=True, collisions=True, allowed_contexts=None):
        super().__init__(game, size, "widgets.controls.sliderbar", anchor, pivot, offset, visible, collisions, allowed_contexts=allowed_contexts)
        self.value = 0
        self.max_value = 100
        self.is_dragging = False

    def handle_event(self, event) -> bool:
        if not self.visible: return False

        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                self.is_dragging = True
                self._update_value(event.pos[0])
                return True 

        elif event.type == pygame.MOUSEBUTTONUP:
            if self.is_dragging:
                self.is_dragging = False
                return True

        elif event.type == pygame.MOUSEMOTION:
            if self.is_dragging:
                self._update_value(event.pos[0])
                return True
                
        return False


    def _update_value(self, mouse_x):
        rel_x = max(0, min(mouse_x - self.rect.x, self.rect.width))
        self.value = (rel_x / self.rect.width) * self.max_value

    def draw(self, screen: "Renderer", **_):
        theme = self.game.ui.theme
        
        screen.rect(theme.COLOR_BG, self.rect, border_radius=theme.ROUNDING, is_world_pos=False)
        
        fill_w = (self.value / self.max_value) * self.rect.width
        fill_rect = (self.rect.x, self.rect.y, fill_w, self.rect.height)
        screen.rect(theme.COLOR_ACCENT, fill_rect, border_radius=theme.ROUNDING, is_world_pos=False)
        
        screen.draw_text(f"Selected: {int(self.value)}", 
                   (self.rect.centerx, self.rect.y - 15), 
                   size=theme.FONT_SIZE_SMALL, center=True)