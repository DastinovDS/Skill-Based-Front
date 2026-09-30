import pygame

class Animation:
    """
    Represents a frame-based animation.

    Manages frame progression over time using a fixed playback speed
    and provides the current frame surface for rendering.
    """

    def __init__(self, frames: list[pygame.Surface], speed: float, loop: bool = True, events: dict | None = None):
        """
        Initialize the animation.

        :param frames: List of pygame Surfaces representing animation frames.
        :param speed: Playback speed (frames per second).
        :param loop: Whether the animation should restart after the last frame.
        :param events: Dictionary mapping frame indices (as strings) to event names.
        """
        self.frames = frames
        self.speed = speed
        self.loop = loop
        self.events = events or {}
        
        self.current_frame = 0.0
        self.last_index = -1
        self.is_playing = True
        self.finished = False
        self.event_handler = None

    def update(self, dt: float):
        """
        Advance the animation timer and trigger events.

        :param dt: Delta time since last frame (in seconds).
        """
        if not self.is_playing or self.finished:
            return

        self.current_frame += self.speed * dt
        
        if self.current_frame >= len(self.frames):
            if self.loop:
                self.current_frame %= len(self.frames)
                self.last_index = -1
            else:
                self.current_frame = float(len(self.frames) - 1)
                self.finished = True
                return

        idx = int(self.current_frame)
        if idx != self.last_index:
            event = self.events.get(str(idx))
            if event and self.event_handler:
                self.event_handler(event)
            self.last_index = idx

    def play(self):
        """Resume animation playback."""
        self.is_playing = True

    def stop(self):
        """Pause animation playback."""
        self.is_playing = False

    def restart(self):
        """Reset animation to the first frame and start playback."""
        self.current_frame = 0.0
        self.finished = False
        self.last_index = -1
        self.is_playing = True


    def flip(self, flip_x: bool, flip_y: bool):
        """
        Flip all frames in the animation.
        Note: This permanently modifies the surfaces in this animation instance.
        """
        self.frames = [pygame.transform.flip(f, flip_x, flip_y) for f in self.frames]

    def scale(self, width: int, height: int):
        """
        Rescale all frames to a specific size.
        """
        self.frames = [pygame.transform.scale(f, (width, height)) for f in self.frames]

    def scale_by(self, factor: float):
        """
        Rescale all frames by a multiplier factor.
        """
        new_frames = []
        for f in self.frames:
            new_size = (int(f.get_width() * factor), int(f.get_height() * factor))
            new_frames.append(pygame.transform.scale(f, new_size))
        self.frames = new_frames

    def get_current_surface(self) -> pygame.Surface:
        """
        Get the current frame surface for drawing.

        :return: The active pygame.Surface frame.
        """
        return self.frames[int(self.current_frame)]

    def get_progress(self) -> float:
        """
        Get animation progress as a percentage (0.0 to 1.0).
        """
        return self.current_frame / len(self.frames)