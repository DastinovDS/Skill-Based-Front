import typing
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.classes import Province

class ClientActionManager:
    """
    Этот менеджер живет ТОЛЬКО на клиенте.
    Именно ЕГО должен вызывать UI вместо прямых вызовов методов класса Player.
    """
    def __init__(self, ctx: "Game"):
        self.ctx = ctx

    def request_construction(self, building_type: str, province: Province) -> None:
        """UI вызывает этот метод вместо player.start_construction()"""
        # 1. Отправляем пакет на сервер
        if self.ctx.network_manager.is_connected:
            self.ctx.network_manager.send_action("START-CONSTRUCTION", {
                "building_type": building_type,
                "province_id": province.province_id
            })

        # 2. Локальное предсказание (Client-Side Prediction)
        # Вызываем оригинальный метод. Игрок МГНОВЕННО видит, 
        # что деньги списались и полоска пошла, игра откликается без пинга!
        self.ctx.me.start_construction(building_type, province)

    def request_train_unit(self, unit_type: str, province: Province) -> None:
        """UI вызывает этот метод вместо player.train_unit()"""
        if self.ctx.network_manager.is_connected:
            self.ctx.network_manager.send_action("TRAIN-UNIT", {
                "unit_type": unit_type,
                "province_id": province.province_id
            })

        # Локальное предсказание
        self.ctx.me.train_unit(unit_type, province)