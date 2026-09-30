
import typing 

if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.classes.core_classes import Player
from rts_core.game_logic import TaskManager


class ClientTaskManager(TaskManager):
    ctx: "Game"
    def __init__(self, ctx: typing.Any):
        super().__init__(ctx)

    def _complete_building(self, player: Player, task: dict) -> None:
        pass

    def _complete_unit(self, player: Player, task: dict) -> None:
        pass