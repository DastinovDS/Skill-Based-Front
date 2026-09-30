import typing

if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine import Renderer
    from rts_core.classes.core_classes import UnitGroup

from rts_core.engine.Renderer.LAYERS import LAYER_UNITS, LAYER_VFX
from rts_core.ui.Context.BaseHandler import BaseHandler

from random import randint

from .Projectile import Projectile

import pygame

class ArtilleryStrike(BaseHandler):
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
                    new_bullet = Projectile.create_artillery_shell(
                        (unitgroup.current_pos[0] + trig.get("offset", [0, 0])[0], 
                         unitgroup.current_pos[1] + trig.get("offset", [0, 0])[1]), 
                        (target.current_pos[0] + randint(-10, 10), 
                         target.current_pos[1] + randint(-10, 10))
                    )
                    
                    new_bullet.fly_sound = self.game.sound_manager.play_spatial(
                        "roket.Whizz",
                        new_bullet.current_pos, 
                        volume=0.1,
                        speed=1.2
                    )
                    
                    self.projectiles.append(new_bullet)
                case "schoot_sound":
                    self.game.sound_manager.play_spatial(
                        "roket.schoot_v1", 
                        unitgroup.current_pos, 
                        volume=0.1,
                        speed=1.6
                    )

    def update(self, dt: float) -> None:
        """Обновление логики и звуков."""
        self.projectiles = [p for p in self.projectiles if not p.hit_triggered]

        for p in self.projectiles:
            p.update(dt)

            if hasattr(p, 'fly_sound') and p.fly_sound:
                p.fly_sound.world_pos = pygame.Vector2(p.current_pos)

            if p.is_finished and not p.hit_triggered:
                if hasattr(p, 'fly_sound') and p.fly_sound:
                    p.fly_sound.stop()
                    p.fly_sound = None

                self.game.sound_manager.play_spatial(
                    "roket.Earthquake", 
                    p.end_pos, 
                    volume=0.3,
                    speed=0.9
                )
                
    def draw(self, render: "Renderer", z_index: int) -> None:
        for p in self.projectiles:
            if not p.is_finished:
                render.circle((200, 200, 200), p.current_pos, 4, z_index=10 + z_index)
            else:
                if not p.hit_triggered:
                    render.vfx_manager.spawn("vfx.dust-effect", p.current_pos, 0.5, 1, "combat", 5) 
                    p.hit_triggered = True

    @staticmethod
    def get_type():
        return "artillery"