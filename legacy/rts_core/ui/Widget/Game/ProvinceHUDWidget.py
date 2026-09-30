from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.engine.Renderer import Renderer

class ProvinceHUDWidget(UIWidget):
    def __init__(self, game, size, anchor=(0,0), pivot=(0,0), offset=(0,0)):
        super().__init__(game, size, "widgets.game.provincehud", anchor, pivot, offset, collisions=False, allowed_contexts=["game", "radialmenu"])
        self.bg_color = (30, 30, 35, 220)

    def draw(self, screen: Renderer, **kwargs):
        province = self.game.ui.selected_province
        if not province or not self.visible:
            return

        screen.rect(self.bg_color, self.rect, border_radius=15, is_world_pos=False)
        
        groups_count = len(province.units)
        total_troops = sum(group.count for group in province.units)

        title_pos = (self.rect.x + 15, self.rect.y + 10)
        screen.draw_text(self.translate_it("province-name", province.name), title_pos, size=20)

        info_pos = (self.rect.x + 15, self.rect.y + 40)
        screen.draw_text(self.translate_it("province-info", groups_count, total_troops), info_pos, size=18)

        bar_rect = (self.rect.x + 15, self.rect.y + 65, self.rect.width - 30, 5)
        screen.rect((50, 50, 60), bar_rect, is_world_pos=False) 