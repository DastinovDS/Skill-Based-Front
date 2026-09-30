import typing
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine import Renderer

# from rts_core.engine.Renderer.LAYERS import LAYER_VFX

class Particle:
    """
    Represents a single visual effect (particle) in the game world.
    
    Supports both static sprites and frame-based animations. 
    Life cycle is managed by the duration parameter.
    """
    def __init__(self, sprite_id: str, pos: tuple[float, float], duration: float, layer: int = 0, anim_tag: str | None = None, z_index: int=30, **kwargs):
        self.sprite_id = sprite_id
        self.z_index = z_index
        self.pos = pos
        self.duration = duration
        self.layer = layer
        self.anim_tag = anim_tag
        self.kwargs = kwargs
        self.time = 0.0
        self.is_dead = False

class VFXManager:
    """
    Manages the lifecycle of all visual effects (VFX).
    
    Handles spawning, updating time states, and cleanup of expired particles.
    """
    def __init__(self, game: "Game"):
        self.game = game
        self.particles: list[Particle] = []

    def spawn(self, sprite_id: str, pos: tuple[float, float], duration: float = 1.0, layer: int = 0, anim_tag: str | None = None, z_index: int=30, **kwargs):
        """Creates a new particle and adds it to the active list."""
        self.particles.append(Particle(sprite_id, pos, duration, layer, anim_tag, z_index, **kwargs))

    def update(self, dt: float):
        """Updates the internal clock of all particles and removes dead ones."""
        for p in self.particles:
            p.time += dt

        self.particles = [p for p in self.particles if p.time < p.duration]

    def draw(self, renderer: "Renderer", layer: int):
        """Renders all active particles using the provided Renderer."""
        for p in self.particles:
            if p.layer == layer:
                renderer.draw_sprite(
                    p.sprite_id, 
                    p.pos, 
                    zoom_level=self.game.camera.zoom, 
                    anim_state=p.anim_tag or "idle", 
                    time=p.time,
                    z_index=30,
                    **p.kwargs
                )