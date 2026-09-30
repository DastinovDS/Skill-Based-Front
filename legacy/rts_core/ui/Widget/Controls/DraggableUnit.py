import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.ui.Widget.UIWidget import UIWidget

import pygame, typing


class DraggableUnit(UIWidget):
    def __init__(self, game: "Game", size: tuple[int, int], unit_data: typing.Any, anchor: tuple[float, float]=(0,0), pivot: tuple[float, float]=(0,0), offset: tuple[int, int]=(0,0), visible=True, collisions=True, allowed_contexts=None):
        super().__init__(game, size, "widgets.controls.draggableunit", anchor, pivot, offset, visible, collisions, allowed_contexts=allowed_contexts)
        self.unit_data = unit_data
        self.is_dragging = False
        self.drag_offset = (0, 0)

    def handle_event(self, event) -> bool:
        if event.type == pygame.MOUSEBUTTONDOWN:
            if self.rect.collidepoint(event.pos):
                self.is_dragging = True
                self.drag_offset = (event.pos[0] - self.rect.x, event.pos[1] - self.rect.y)
                return True
                
        elif event.type == pygame.MOUSEBUTTONUP:
            if self.is_dragging:
                self.is_dragging = False
                return True
                
        elif event.type == pygame.MOUSEMOTION:
            if self.is_dragging:
                self.rect.topleft = (event.pos[0] - self.drag_offset[0], 
                                     event.pos[1] - self.drag_offset[1])
                return True
        return False