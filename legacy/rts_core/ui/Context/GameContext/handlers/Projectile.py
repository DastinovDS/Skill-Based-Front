import math

import typing 

from rts_core.system.SoundManager import ActiveSound

class Projectile:
    def __init__(self, start_pos: tuple[float, float], end_pos: tuple[float, float], 
                 speed: float = 800.0, arc_height: float = 0.0):
        self.start_pos = start_pos
        self.end_pos = end_pos
        self.current_pos = start_pos

        distance = math.hypot(end_pos[0] - start_pos[0], end_pos[1] - start_pos[1])
        
        self.duration = distance / speed if speed > 0 else 1.0
        
        self.arc_height = arc_height
        self.elapsed_time = 0.0
        self.is_finished = False
        self.hit_triggered = False
        self.fly_sound: typing.Optional[ActiveSound] = None

    def update(self, dt: float):
        if self.is_finished:
            return

        self.elapsed_time += dt
        t = min(self.elapsed_time / self.duration, 1.0)

        curr_x = self.start_pos[0] + (self.end_pos[0] - self.start_pos[0]) * t
        curr_y = self.start_pos[1] + (self.end_pos[1] - self.start_pos[1]) * t

        arc_offset = 4 * self.arc_height * t * (1 - t)
        
        self.current_pos = (curr_x, curr_y - arc_offset)

        if t >= 1.0:
            self.is_finished = True


    
    @staticmethod
    def create_tank_shell(start, end):
        return Projectile(start, end, speed=900.0, arc_height=10.0)

    @staticmethod
    def create_artillery_shell(start, end):
        dist = math.hypot(end[0]-start[0], end[1]-start[1])
        return Projectile(start, end, speed=150.0, arc_height=dist * 0.5)