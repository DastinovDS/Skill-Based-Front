import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game 
from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.engine.Renderer import Renderer

from rts_core.engine.Renderer.LAYERS import LAYER_UI, UI_PRIORITY_DEBUG

class FPSCounter(UIWidget):
    
    def __init__(self, game: "Game", anchor: tuple[float, float]=(0,0), pivot: tuple[float, float]=(0,0), offset: tuple[int, int]=(0,0), visible=True):
        super().__init__(game, (0,0), "widgets.debug.fpscounter", anchor, pivot, offset, visible, False, ["game", "radialmenu"])

    def draw(self, screen: Renderer, **_):
        fps = int(self.game.game_clock.get_fps())
        screen.draw_text(f"FPS: {fps}", self.pos, size=self.game.ui.theme.FONT_SIZE_SMALL, color=(0, 255, 0) if fps > 30 else (255, 0, 0), z_index=LAYER_UI+UI_PRIORITY_DEBUG)