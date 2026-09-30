from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.engine.Renderer import Renderer

from rts_core.ui.Widget.Containers import VBox
from rts_core.ui.Widget.Controls import UIButton
from rts_core.ui.Widget.UIText import UIText

from rts_core.ui.Context.GameContext import GameContext
from rts_core.ui.Context.SettingsScreen import SettingsScreen

class MainMenu(UIWidget):
    def __init__(self, game, size: tuple[int, int], anchor=(0.5, 0.5), pivot=(0.5, 0.5), offset=(0, 0)):
        super().__init__(game, size, "widgets.mainscreen", anchor, pivot, offset)
        self.bg_color = (30, 30, 35, 240)

        self.wow = VBox(self.game, anchor=(0.5, 0.5), pivot=(0.5, 0.5))
        self.wow.parent = self

        self.main_layout = VBox(self.game, padding=15)
        self.title = UIText(self.game, self.translate_it("game_name", "isglobal"), font_size=48)

        self.wow.add_child(self.title)
        self.wow.add_child(self.main_layout)

        self.setup_buttons()

        self.update_position()
        self.wow.recalculate_layout()

    def setup_buttons(self):
        play_btn = UIButton(self.game, self.translate_it("play-btn"), size=(200, 50))
        play_btn.action = self.start_button

        settings_btn = UIButton(self.game, self.translate_it("settings-btn"), size=(200, 50))
        settings_btn.action = self.settings_button

        exit_btn = UIButton(self.game, self.translate_it("exit-btn"), size=(200, 50), color=(100, 40, 40))
        exit_btn.action = self.exit_button

        self.main_layout.add_child(play_btn)
        self.main_layout.add_child(settings_btn)
        self.main_layout.add_child(exit_btn)

    def select_sound(self):
        self.game.sound_manager.play_spatial("ui.select", speed=2)

    def start_button(self):
        connected = self.game.network_manager.connect()
        if connected:
            self.game.ui.set_context(GameContext(self.game))
        self.select_sound()
    
    def settings_button(self):
        if isinstance(self.game.ui.context, SettingsScreen):
            return
        self.game.ui.push_context(SettingsScreen(self.game))
        self.select_sound()

    def exit_button(self):
        self.select_sound()
        self.game.close_game()

    def draw(self, screen: Renderer, **kwargs):
        if not self.visible: return

        screen.rect(self.bg_color, self.rect, border_radius=15, is_world_pos=False)
        self.wow.draw(screen, **kwargs)

    def handle_event(self, event) -> bool:
        if not self.visible: return False
        return self.wow.handle_event(event)