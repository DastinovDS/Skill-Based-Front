import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.engine.Renderer import Renderer
from rts_core.ui.Widget.UIWidget import UIWidget

import pygame

class WindowWidget(UIWidget):
    def __init__(self, game: "Game", size: tuple[int, int], title: str, anchor: tuple[float, float]=(0,0), pivot: tuple[float, float]=(0,0), offset: tuple[int, int]=(0,0), visible=True, collisions=True, allowed_contexts=None):
        super().__init__(game, size, "widgets.containers.window", anchor, pivot, offset, visible, collisions, allowed_contexts=allowed_contexts)

        self.title = title
        self.children: list[UIWidget] = [] 

        self.is_dragging = False
        self.drag_offset = (0, 0)

        self.header_height = 35
        
        self.close_btn_size = 20

    @property
    def header_rect(self):
        return pygame.Rect(self.rect.x, self.rect.y, self.rect.width, self.header_height)

    def add_child(self, widget: "UIWidget"):
        widget.parent = self
        widget.update_position()
        self.children.append(widget)

    def handle_event(self, event) -> bool:
        if not self.visible: return False
        
        if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
            close_rect = pygame.Rect(self.rect.right - 25, self.rect.y + 7, 20, 20)
            if close_rect.collidepoint(event.pos):
                self.visible = False
                return True

            if self.header_rect.collidepoint(event.pos):
                self.is_dragging = True
                self.drag_offset = (event.pos[0] - self.rect.x, event.pos[1] - self.rect.y)
                return True

        elif event.type == pygame.MOUSEBUTTONUP:
            self.is_dragging = False

        elif event.type == pygame.MOUSEMOTION:
            if self.is_dragging:
                old_pos = (self.rect.x, self.rect.y)
                self.rect.x = event.pos[0] - self.drag_offset[0]
                self.rect.y = event.pos[1] - self.drag_offset[1]
                
                dx = self.rect.x - old_pos[0]
                dy = self.rect.y - old_pos[1]
                for child in self.children:
                    child.rect.x += dx
                    child.rect.y += dy
                    if hasattr(child, 'recalculate_layout'):
                        child.recalculate_layout() # type: ignore
                return True

        for child in self.children:
            if child.handle_event(event): return True
            
        if event.type == pygame.MOUSEBUTTONDOWN and self.rect.collidepoint(event.pos):
            return True
            
        return False

    def draw(self, screen: "Renderer", **kwargs):
        if not self.visible: return
        
        screen.rect(self.game.ui.theme.COLOR_BG, self.rect, border_radius=10, is_world_pos=False)
        
        header_color = (max(0, self.game.ui.theme.COLOR_BG[0]-20), 
                        max(0, self.game.ui.theme.COLOR_BG[1]-20), 
                        max(0, self.game.ui.theme.COLOR_BG[2]-20), 200)
        screen.rect(header_color, self.header_rect, border_top_left_radius=10, border_top_right_radius=10,is_world_pos=False)
        
        screen.draw_text(self.game.language_manager.translate(self.title), (self.rect.x + 15, self.rect.y + 8), size=self.game.ui.theme.FONT_SIZE_MAIN)
        close_rect = pygame.Rect(self.rect.right - 25, self.rect.y + 7, 20, 20)
        screen.rect((200, 50, 50), close_rect, border_radius=5, is_world_pos=False)

        for child in self.children:
            child.draw(screen)