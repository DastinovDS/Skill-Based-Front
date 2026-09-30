import typing
if typing.TYPE_CHECKING:
    from rts_client import Game


class ActionRegistry:
    def __init__(self, game: "Game"):
        self.game = game
        self.handlers = {
            "build": {
                "exec": lambda p, obj_id: self.game.action_manager.request_construction(obj_id, p),  # type: ignore
                "check": lambda p, obj_id: self.game.me.can_build(obj_id, p)  # type: ignore
            },
            "train": {
                "exec": lambda p, obj_id: self.game.action_manager.request_train_unit(obj_id, p),  # type: ignore
                "check": lambda p, obj_id: self.game.me.can_train_unit(obj_id, p)  # type: ignore
            },
            "close": {
                "exec": lambda p, _: self.game.ui.radial_menu.close(),  # type: ignore
                "check": lambda p, _: True
            }
        }

    def execute(self, type_id, province, obj_id=None):
        if type_id in self.handlers:
            self.handlers[type_id]["exec"](province, obj_id)

    def is_available(self, type_id, province, obj_id=None):
        handler = self.handlers.get(type_id)
        return handler["check"](province, obj_id) if handler else True