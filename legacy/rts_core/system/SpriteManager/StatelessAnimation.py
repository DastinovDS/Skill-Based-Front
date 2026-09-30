import pygame

class StatelessAnimation:
    """
    A stateless animation template. 
    It doesn't track current_frame; it just maps 'time' to a 'surface'.
    """
    def __init__(self, frames: list[pygame.Surface], speed: float, loop: bool = True, events: dict | None = None):
        self.frames = frames
        self.speed = speed
        self.loop = loop
        self.events = events or {}
        self.frame_count = len(frames)

    def get_frame(self, time: float) -> pygame.Surface:
        """Get the surface corresponding to the given elapsed time."""
        return self.frames[self.get_index(time)]

    def get_index(self, time: float) -> int:
        """Calculate the frame index based on time and speed."""
        idx = int(time * self.speed)
        return idx % self.frame_count if self.loop else min(idx, self.frame_count - 1)

    def get_triggered_events(self, old_time: float, new_time: float) -> list:
        """Get event name if defined for the current frame index."""
        triggered = []
        
        start_frame = int(old_time * self.speed)
        end_frame = int(new_time * self.speed)

        for f in range(start_frame + 1, end_frame + 1):
            if not self.loop and f >= self.frame_count:
                break
                
            actual_idx = f % self.frame_count
            event = self.events.get(str(actual_idx))
            if event:
                triggered.append(event)
                
        return triggered