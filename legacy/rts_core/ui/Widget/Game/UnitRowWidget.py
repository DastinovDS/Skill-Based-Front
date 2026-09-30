from rts_core.ui.Widget.UIWidget import UIWidget
from rts_core.ui.Widget.Game import TroopSlider
from rts_core.ui.Widget.Controls import UIButton

from rts_core.engine.Renderer import Renderer
from rts_core.classes import UnitGroup

from rts_core.engine.Renderer.LAYERS import LAYER_UI


class UnitRowWidget(UIWidget):
    def __init__(self, game, unit_group, size=(280, 40)):
        super().__init__(
            game, 
            size, 
            "widgets.game.unitrow", 
            anchor=(0, 0), 
            pivot=(0, 0), 
            offset=(0, 0),
            allowed_contexts=["game", "radialmenu"]
        )
        
        self.unit_group = unit_group
        self.is_mouse_over = False

        self.split_button = UIButton(
            game=self.game, 
            text="÷", 
            size=(30, 30), 
            anchor=(1.0, 0.5), 
            pivot=(1.0, 0.5), 
            offset=(-5, 0),
            color=(70, 80, 100),
            allowed_contexts=["game", "radialmenu"]
        )
        self.split_button.parent = self
        self.split_button.action = self.show_split_dialog

    def handle_event(self, event) -> bool:
        if self.split_button.handle_event(event):
            return True

        mouse_pos = getattr(event, 'pos', None)
        if mouse_pos:
            self.is_mouse_over = self.rect.collidepoint(mouse_pos)

        return super().handle_event(event)

    def draw(self, screen: Renderer, **kwargs):
        self.split_button.update_position()

        is_selected = self.game.ui.selected_group == self.unit_group

        bg_color = (80, 85, 95) if self.is_mouse_over else (50, 55, 65)

        screen.rect(bg_color, self.rect, border_radius=5, z_index=LAYER_UI+1, is_world_pos=False)
        
        if is_selected:
            screen.rect((100, 255, 100), self.rect, border_radius=5, z_index=LAYER_UI+2, is_world_pos=False, width=2)

        screen.draw_text(
            self.translate_it("unit-info", self.unit_group.count, self.unit_group.unit_type), 
            (self.rect.x + 10, self.rect.y + 10), 
            size=16, 
            z_index=LAYER_UI+3
        )

        self.split_button.draw(screen, **kwargs)

    def on_click(self, event):
        self.game.ui.selected_group = self.unit_group
        self.game.logger_info(f"[UI] Выделен конкретный юнит: {self.unit_group.unit_type} (ID: {self.unit_group.group_id})")

    def on_confirm(self, value):
        self.game.logger_info(f"Funny Click: {value}", level="DEBUG")

    def show_split_dialog(self):
        self.game.logger_info(f"Открываем диалог деления для группы {self.unit_group.group_id}", level="DEBUG")