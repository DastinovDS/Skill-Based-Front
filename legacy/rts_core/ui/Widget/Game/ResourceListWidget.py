import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game
    
from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.engine.Renderer import Renderer

class ResourceListWidget(UIWidget):
    def __init__(self, game: "Game", anchor: tuple[float, float]=(0,0), pivot: tuple[float, float]=(0,0), offset: tuple[int, int]=(0,0), visible=True):
        super().__init__(game, (0,0), "widgets.game.resourcelist", anchor, pivot, offset, visible, False, allowed_contexts=["game", "radialmenu"])
        self.resource_update_timer: float = 0.0
        self.display_resources: dict[str, float] = {}

    def update_resources(self, dt: float) -> None:
        """
        Refreshes display resources at a fixed interval.
        :param dt: delta time
        :type dt: float
        """
        if not self.game.me: return
        self.resource_update_timer += dt
        if self.resource_update_timer >= 2.0 or not self.display_resources:
            self.resource_update_timer = 0
            self.display_resources.update(self.game.me.resources.copy())

    def draw(self, screen: Renderer, **kwargs):
        self.update_resources(kwargs["dt"])
        if self.game.me:
            res_text = " | ".join(f"{self.translate_it(k.lower()+'.name')} {v:.0f}" for k, v in self.display_resources.items())
            screen.draw_text(res_text, self.pos)
            screen.draw_text(f"VP: {self.game.me.victory_points}", (self.pos[0],self.pos[1]+25))