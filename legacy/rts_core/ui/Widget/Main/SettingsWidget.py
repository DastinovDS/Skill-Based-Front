from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.engine.Renderer import Renderer

from rts_core.ui.Widget.Containers import WindowWidget
from rts_core.ui.Widget.Containers import VBox, HBox 
from rts_core.ui.Widget.Controls import UIButton
from rts_core.ui.Widget.Controls import SliderBar
from rts_core.ui.Widget.UIText import UIText


class SettingsWidget(UIWidget):
    def __init__(self, game, size: tuple[int, int], anchor=(0.5, 0.5), pivot=(0.5, 0.5), offset=(0, 0)):
        super().__init__(game, size, "widgets.settings_widget", anchor, pivot, offset)
        self.main_layout = WindowWidget(self.game, size, "widgets.settings_widget.title", anchor=anchor, pivot=pivot)
        self.settings_list = VBox(self.game, size, anchor=anchor, pivot=pivot, padding=30, offset=(0, 50))
        self.settings_list.parent = self.main_layout

        self.main_layout.add_child(self.settings_list)

        self.setup_buttons()

        self.update_position()
        self.main_layout.update_position()
        self.settings_list.recalculate_layout()

    def setup_buttons(self):

        sound_bar_box = HBox(self.game)
        sound_bar_text = UIText(self.game, self.translate_it("sound.level"), 15)
        sound_bar_slider = SliderBar(self.game, (100, 20))
        sound_bar_box.add_child(sound_bar_text)
        sound_bar_box.add_child(sound_bar_slider)
        self.settings_list.add_child(sound_bar_box)

        test_bar_box = HBox(self.game)
        test_bar_text = UIText(self.game, self.translate_it("test"), 15)
        test_bar_slider = SliderBar(self.game, (100, 20))
        test_bar_box.add_child(test_bar_text)
        test_bar_box.add_child(test_bar_slider)
        self.settings_list.add_child(test_bar_box)

        back_btn = UIButton(self.game, self.translate_it("back-btn"), size=(200, 30))
        back_btn.action = self.back_button
        self.settings_list.add_child(back_btn)


    def back_button(self):
        self.game.sound_manager.play_spatial("ui.select", speed=2)
        self.game.ui.pop_context()

    def draw(self, screen: Renderer, **kwargs):
        if not self.visible: return
        if not self.main_layout.visible: self.back_button()

        self.main_layout.draw(screen, **kwargs)

    def handle_event(self, event) -> bool:
        if not self.visible: return False
        return self.main_layout.handle_event(event)