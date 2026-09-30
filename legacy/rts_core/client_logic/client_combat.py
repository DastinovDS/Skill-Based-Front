# Файл: rts_core/client/client_combat.py
import typing
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.game_logic.combat import CombatManager

class ClientCombatManager(CombatManager):
    ctx: "Game"
    def __init__(self, ctx: typing.Any):
        super().__init__(ctx)

    def update(self, dt: float) -> None:
        """
        Переопределяем update на клиенте.
        Мы полностью отключаем просчет урона и захват провинций,
        так как эти данные прилетают в готовом виде от сервера.
        """
        
        self._update_cooldowns(dt)
