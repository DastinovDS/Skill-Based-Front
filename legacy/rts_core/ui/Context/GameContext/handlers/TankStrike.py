import typing

if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine import Renderer
    from rts_core.classes.core_classes import UnitGroup

from rts_core.engine.Renderer.LAYERS import LAYER_UNITS, LAYER_VFX
from rts_core.ui.Context.BaseHandler import BaseHandler

from random import randint

from .Projectile import Projectile

class TankStrike(BaseHandler):
    

    def __init__(self, game: "Game"):
        super().__init__(game)
        self.projectiles: list[Projectile] = []

    def trigger(self, unitgroup: "UnitGroup", triggers: list[dict[str, typing.Any]]) -> None:
        target = unitgroup.active_target
        if not target:
            return

        for trig in triggers:
            match trig["name"]:
                case "spawn_projectile":
                    new_bullet = Projectile.create_tank_shell(
                        (unitgroup.current_pos[0]+trig.get("offset", [0,0])[0], unitgroup.current_pos[1]+trig.get("offset", [0,0])[1]), 
                        (target.current_pos[0]+randint(-10, 10), target.current_pos[1]+randint(-10, 10))
                    )
                    self.projectiles.append(new_bullet)

    def update(self, dt: float) -> None:
        """Cleanup old shells and update positions of active ones."""
        self.projectiles = [p for p in self.projectiles if not p.hit_triggered]

        for p in self.projectiles:
            p.update(dt)

    def draw(self, render: "Renderer", z_index: int) -> None:
        """Draw active shells and trigger VFX on impact."""
        for p in self.projectiles:
            if not p.is_finished:
                render.circle((200,200,200), p.current_pos, 2, z_index=LAYER_UNITS+z_index)
            else:
                if not p.hit_triggered:
                    render.vfx_manager.spawn("vfx/explosion-effect", p.current_pos, 0.5, 1, "combat", LAYER_VFX) 
                    p.hit_triggered = True

    @staticmethod
    def get_type():
        return "tank"