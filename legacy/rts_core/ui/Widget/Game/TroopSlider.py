import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.ui.Widget.Controls import UIButton
from rts_core.ui.Widget.Controls import SliderBar
from rts_core.ui.Widget.Containers.VBox import VBox

from rts_core.engine.Renderer import Renderer

class TroopSlider(UIWidget):
    def __init__(self, game: "Game", size: tuple[int, int], anchor: tuple[float, float] = (0,0), pivot: tuple[float, float] = (0,0), offset: tuple[int, int] = (0,0), visible=True, collisions=True):
        super().__init__(game, size, "widgets.game.troopslider", anchor, pivot, offset, visible, collisions, allowed_contexts=["game", "radialmenu"])
        
        self.main_layout = VBox(game, padding=15, anchor=anchor, offset=(-75, -60))
        self.main_layout.parent = self

        self.bar = SliderBar(self.game, (150, 20))

        self.btn_ok = UIButton(game, "OK", size=(150, 40))
        self.btn_ok.action = self.confirm # type: ignore
        self.btn_ok.parent = self.main_layout

        self.main_layout.add_child(self.bar)
        self.main_layout.add_child(self.btn_ok)

        self.on_confirm = None


    def handle_event(self, event) -> bool:
        if not self.visible: return False
        if self.main_layout.handle_event(event): return True

        return False
    

    def confirm(self):
        if self.on_confirm: self.on_confirm(int(self.bar.value))
        self.visible = False

    def draw(self, render: Renderer, **_):
        if not self.visible: return

        self.main_layout.draw(render)