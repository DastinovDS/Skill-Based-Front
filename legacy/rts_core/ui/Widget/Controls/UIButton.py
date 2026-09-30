from rts_core.ui.Widget.UIWidget import UIWidget
from rts_core.engine.Renderer import Renderer, LAYER_UI

from typing import Optional, Callable

import pygame

class UIButton(UIWidget):
    def __init__(self, game, text, size=(150, 40), anchor=(0,0), pivot=(0,0), offset=(0,0), color=None, allowed_contexts=None):
        super().__init__(game, size, "widgets.controls.uibutton", anchor, pivot, offset,allowed_contexts=allowed_contexts)
        self.text = text
        self.base_color = color or (60, 65, 75)
        self.hover_color = (80, 85, 95)
        self.current_color = self.base_color
        self.action: Optional[Callable] = None 

    def handle_event(self, event) -> bool:
        if event.type == pygame.MOUSEMOTION:
            if self.rect.collidepoint(event.pos):
                self.current_color = self.hover_color
            else:
                self.current_color = self.base_color

        return super().handle_event(event)

    def on_click(self, event):
        if self.action:
            self.action()

    def draw(self, screen: Renderer, **kwargs):
        screen.rect(self.current_color, self.rect, border_radius=8, is_world_pos=False, z_index=LAYER_UI)
        screen.draw_text(self.text, self.rect.center, center=True, z_index=LAYER_UI)