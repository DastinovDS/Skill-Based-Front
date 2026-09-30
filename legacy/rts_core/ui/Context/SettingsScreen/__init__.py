import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.ui.Context.InputContext import InputContext

from rts_core.engine import Renderer


from rts_core.ui.Widget.Main.SettingsWidget import SettingsWidget


class SettingsScreen(InputContext):
    def __init__(self, game: "Game") -> None:
        super().__init__(game)
        self.is_transparent = True

    @staticmethod
    def indificator() -> str:
        return "settings_screen"

    def draw(self, renderer: Renderer, dt: float):
        pass

    def on_hover(self, cordinats: tuple[int, int], rel):
        pass
    
    def on_click(self, button, cordinats: tuple[int, int]):
        pass
        
    def on_key(self, key):
        pass

    def on_setup_ui(self):
        self.add_widget("settings_menu", SettingsWidget, "hud", self.game, (200, 270), (0.5, 0.5), (0.5, 0.5))