import typing
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine import Renderer
    from rts_core.classes.core_classes import UnitGroup

from typing import Any

class BaseHandler:
    def __init__(self, game: "Game"):
        self.game = game

    def trigger(self, unitgroup: "UnitGroup", triggers: list[dict[str, Any]]) -> None: pass

    def update(self, dt: float) -> None: pass

    def draw(self, render: "Renderer", z_index: int) -> None: pass

    def __eq__(self, other):
        if isinstance(other, str):
            return self.get_type() == other
        return super().__eq__(other)

    @staticmethod
    def get_type(): raise NotImplementedError