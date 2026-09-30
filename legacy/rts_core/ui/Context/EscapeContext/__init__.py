
import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.ui.Context.InputContext import InputContext

from rts_core.engine import Renderer

from rts_core.ui.Widget.Escape.EscapeMenu import EscapeMenu

import pygame

class EscapeContext(InputContext):
    def __init__(self, game: "Game") -> None:
        super().__init__(game)
        self.is_transparent = True

    @staticmethod
    def indificator() -> str:
        return "escape_screen"

    def draw(self, renderer: Renderer, dt: float):
        renderer.rect((30, 30, 35, 240), (0, 0, self.game.camera.width, self.game.camera.height), is_world_pos=False)

    def on_hover(self, cordinats: tuple[int, int], rel):
        pass
    
    def on_click(self, button, cordinats: tuple[int, int]):
        pass
        
    def on_key(self, key):
        if key == pygame.K_ESCAPE:
            self.game.ui.pop_context()

    def on_setup_ui(self):
        self.add_widget("escape_menu", EscapeMenu, "hud", self.game, (200, 270), (0.5, 0.5), (0.5, 0.5))