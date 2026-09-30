from rts_core.classes import Province

from rts_core.ui.Widget.Containers.WindowWidget import WindowWidget
from rts_core.ui.Widget.Containers.VBox import VBox
from rts_core.ui.Widget.Game import UnitRowWidget
from rts_core.ui.Widget.Controls import UIButton

class ArmyManagerWindow(WindowWidget):
    def __init__(self, game, allowed_contexts=None):
        super().__init__(game, size=(300, 450), title="widgets.containers.armymanagerwindow.name", anchor=(1, 0.5), pivot=(1, 0.5), offset=(-20, 0), allowed_contexts=allowed_contexts)
        
        self.list_container = VBox(game, anchor=(0,0), offset=(10, 50), padding=5)
        self.add_child(self.list_container)

        self.update_position() 
        self.list_container.recalculate_layout()

    def refresh(self, province: "Province"):

        self.list_container.children.clear()
        
        for group in province.units:
            row = UnitRowWidget(self.game, group)
            self.list_container.add_child(row)
        
        merge_all_btn = UIButton(self.game, text=self.game.language_manager.translate("widgets.containers.armymanagerwindow.merge-button"), size=(260, 40))
        
        merge_all_btn.action = self.merge_all_units  
        
        self.list_container.add_child(merge_all_btn)
        
        self.update_position()
        self.list_container.recalculate_layout()
    
    def merge_all_units(self):
        """Метод, который вызовется при клике на кнопку объединения"""
        print("Merge all units action triggered!")