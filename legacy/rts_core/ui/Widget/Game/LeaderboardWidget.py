import typing 
if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.engine.Renderer import Renderer

class LeaderboardWidget(UIWidget):
    def __init__(self, game: "Game", anchor=(0,0), pivot=(0,0), offset=(0,0), visible=True, ):
        super().__init__(game, (0,0), "widgets.game.leaderboard", anchor, pivot, offset, visible, False, ["game", "radialmenu"])

    def draw(self, screen: Renderer, **_):
        sorted_players = sorted(self.game.players, key=lambda p: p.victory_points, reverse=True)
        screen.draw_text(self.translate_it("name"), self.pos)
        if len(sorted_players) <= 0: return

        for i, p in enumerate(sorted_players[:5]):
            color = (255, 255, 255) if p != self.game.me else (255, 255, 0)
            screen.draw_text(f"{i+1}. {p.name[:10]}: {p.victory_points}", (self.pos[0], (self.pos[1]+25) + i * 18), color=color)

        if self.game.me:
            screen.draw_text(self.translate_it("player-pos", sorted_players.index(self.game.me)+1), (self.pos[0], self.pos[1]+100 ), wrap_width=abs(self.offset[0] if self.offset[0] != 0 else 100))