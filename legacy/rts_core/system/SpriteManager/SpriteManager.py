import pygame
import typing
import json
import os
import re

if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.system.ResourceManager import ResourceManager

from rts_core.system.SpriteManager.StatelessAnimation import StatelessAnimation
from rts_core.system.ManagerCache import SimpleLRUCache



class SpriteManager:
    """
    Manages loading, caching, and processing of game sprites and animations.
    
    Supports palette swapping, dynamic metadata resolution using #tags, 
    and automatic directory scanning for assets.
    """
    
    def __init__(self, resurce_manger: "ResourceManager", game: "Game"):
        """
        Initialize the sprite manager and scan for assets.

        :param game: Reference to the main game instance.
        """

        res = resurce_manger.register_module(
            "sprite",
            "textures",
            extensions=['.png', '.jpg', '.jpeg']
        )

        self.game = game
        self.cache: SimpleLRUCache[str, pygame.Surface] = self.game.cache_manager.get_or_create("Sprite Cache") # type: ignore
        self.anim_cache: SimpleLRUCache[str, StatelessAnimation] = self.game.cache_manager.get_or_create("StatelessAnimation Cache") # type: ignore
        self.texture_cache: SimpleLRUCache[str, pygame.Surface] = self.game.cache_manager.get_or_create("Texture Cache") # type: ignore
        
        self.sprite_map: dict[str, str] = res.file
        self.metadata: dict[str, dict] = res.meta
        self.error_sprite = pygame.Surface((32, 32))
        self.error_sprite.fill((255, 0, 255)) 

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")


    def _resolve_args(self, data: typing.Any, args: dict) -> typing.Any:
        """
        Recursively replace string values starting with '#' with values from args.

        :param data: The metadata structure (dict, list, or str).
        :param args: Dictionary of values to inject.
        :return: Processed data with resolved tags.
        """
        if isinstance(data, str) and data.startswith("#"):
            match = re.match(r"#(\w+)(?:\((\w+)\[(.*)\]\))?", data)
            
            if match:
                tag_name = match.group(1)
                tag_type = match.group(2)
                default_str = match.group(3)

                val = args.get(tag_name)
                if val is None and default_str is not None:
                    val = default_str

                if val is None: return data

                if tag_type == "int": return int(val)
                if tag_type == "float": return float(val)
                if tag_type == "tuple": return tuple(val.split(","))
                if tag_type == "bool": return str(val).lower() == "true"
                
                return val

        if isinstance(data, dict):
            return {k: self._resolve_args(v, args) for k, v in data.items()}
        if isinstance(data, list):
            return [self._resolve_args(v, args) for v in data]
        return data
    
    def _apply_modifiers(self, image: pygame.Surface, meta: dict) -> pygame.Surface:
        """
        Apply transformations like cropping, flipping, tinting, and scaling.

        :param image: Source surface.
        :param meta: Metadata dictionary containing modifier keys.
        :return: Modified surface.
        """
        if not meta: return image

        if "rect" in meta:
            r = meta["rect"]
            target_rect = pygame.Rect(r[0], r[1], r[2], r[3])
            img_rect = image.get_rect()

            if not img_rect.contains(target_rect):
                print(f"Warning: Rect {target_rect} out of bounds for {img_rect.size}")
                return self.error_sprite 

            image = image.subsurface(target_rect).copy()
        else:
            image = image.copy()
        
        if "rotate" in meta:
            angle = float(meta["rotate"])
            if angle != 0.0:
                image = pygame.transform.rotate(image, angle)

        if meta.get("flip_x") or meta.get("flip_y"):
            image = pygame.transform.flip(
                image, 
                bool(meta.get("flip_x")), 
                bool(meta.get("flip_y"))
            )

        if "tint" in meta:
            tint_surf = pygame.Surface(image.get_size(), pygame.SRCALPHA)
            tint_surf.fill(meta["tint"])
            image.blit(tint_surf, (0, 0), special_flags=pygame.BLEND_RGBA_MULT)

        if "scale" in meta:
            new_size = (
                int(image.get_width() * float(meta["scale"])), 
                int(image.get_height() * float(meta["scale"]))
            )
            image = pygame.transform.scale(image, new_size)

        return image

    def _get_cache_key(self, sprite_id: str, tag: str | None, kwargs: dict) -> str:
        """Helper to generate a unique string for any sprite configuration."""
        tag_part = f":{tag}" if tag else ""
        args_part = ":".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
        return f"{sprite_id}{tag_part}:{args_part}"

    def apply_palette(self, surface: pygame.Surface, palette: dict) -> pygame.Surface:
        """
        Perform a palette swap on a surface.

        :param surface: The source surface to modify.
        :param palette: Dictionary mapping " (R,G,B) " strings to new color strings.
        :return: A new surface with replaced colors.
        """
        new_surf = surface.copy()

        def get_color(data: str) -> list:
            clean_str = data.replace("(", "").replace(")", "")
            return [int(x) for x in clean_str.split(",")]

        with pygame.PixelArray(new_surf) as pixels:
            for old_c, new_c in palette.items():
                pixels.replace(
                    pygame.Color(get_color(old_c)), 
                    pygame.Color(get_color(new_c))
                )
        return new_surf
    
    def get_texture(self, texture_id: str) -> pygame.Surface:
        """
        Retrieve a base texture from cache or load it from disk.

        :param texture_id: Internal ID or path of the texture.
        :return: Pygame surface or error_sprite if not found.
        """

        image_path = self.sprite_map.get(texture_id)
        if not image_path: return self.error_sprite
        
        if image_path not in self.texture_cache:
            try:
                self.texture_cache[image_path] = pygame.image.load(image_path).convert_alpha()
            except Exception as e:
                print(f"Failed to load image {image_path}: {e}")
                return self.error_sprite
        return self.texture_cache[image_path]

    def get(self, sprite_id: str, **kwargs) -> pygame.Surface:
        """
        Get a processed static sprite with applied arguments and modifiers.

        :param sprite_id: ID of the sprite/metadata.
        :param kwargs: Dynamic arguments for #tags (e.g., damage_offset=32).
        :return: Final processed Pygame surface.
        """
        cache_key = self._get_cache_key(sprite_id, None, kwargs)
        if cache_key in self.cache:
            return self.cache[cache_key]

        meta = self._resolve_args(self.metadata.get(sprite_id, {}), kwargs)
        base_img = self.get_texture(meta.get("texture", sprite_id))
        
        if "palette" in kwargs and "palettes" in meta:
            p_data = meta["palettes"].get(kwargs["palette"])
            if p_data:
                base_img = self.apply_palette(base_img, p_data)

        final_sprite = self._apply_modifiers(base_img, meta)
        
        self.cache[cache_key] = final_sprite
        return final_sprite
    
    def get_animation(self, anim_id: str, tag: str, **kwargs) -> StatelessAnimation | None:
        """
        Build an Animation object by slicing a texture into frames.

        :param anim_id: Metadata ID containing animation definitions.
        :param tag: Specific animation tag (e.g., "drive", "shoot").
        :param kwargs: Arguments for #tags and palette selection.
        :return: Initialized Animation object or None.
        """
        cache_key = self._get_cache_key(anim_id, tag, kwargs)

        if cache_key in self.anim_cache:
            return self.anim_cache[cache_key]

        raw_meta = self.metadata.get(anim_id)
        if not raw_meta or "animations" not in raw_meta: return None
        
        meta: dict[str, typing.Any] = self._resolve_args(raw_meta, kwargs)
        anim_data: dict[str, typing.Any] = meta["animations"].get(tag)
        if not anim_data: return None

        base_img = self.get_texture(meta.get("texture", anim_id))
        texture_rect = base_img.get_rect()
        
        frames = []
        rects = []
        if anim_data.get("mode") == "grid":
            fw, fh = anim_data["frame_size"]
            sx, sy = anim_data.get("start_pos", [0, 0])
            for i in range(anim_data["count"]):
                rects.append([sx + i * fw, sy, fw, fh])
        else:
            rects = anim_data.get("frames", [])

        palette_name = kwargs.get("palette")
        palette = meta.get("palettes", {}).get(palette_name) if palette_name else None

        for r in rects:
            target_rect = pygame.Rect(r[0], r[1], r[2], r[3])
            
            if not texture_rect.contains(target_rect):
                print(f"SpriteManager ERROR: Frame {target_rect} is outside of texture {anim_id} {texture_rect.size}")
                frames.append(self.error_sprite)
                continue

            frame_meta = meta.copy()
            if "scale" in kwargs: frame_meta["scale"] = kwargs["scale"]
            if "rotate" in kwargs: frame_meta["rotate"] = kwargs["rotate"]
            elif "rotation" in kwargs: frame_meta["rotate"] = kwargs["rotation"]
            if "rect" in frame_meta: del frame_meta["rect"]
            frame_surf = base_img.subsurface(target_rect)
            
            if palette:
                frame_surf = self.apply_palette(frame_surf, palette)
            
            frames.append(self._apply_modifiers(frame_surf, frame_meta))

        anim = StatelessAnimation(
            frames=frames,
            speed=anim_data.get("speed", 10),
            loop=anim_data.get("loop", True),
            events=anim_data.get("events")
        )
        
        self.anim_cache[cache_key] = anim
        return anim
    
    
    def get_static(self, sprite_id: str, tag: str, **kwargs) -> pygame.Surface:
        """
        Returns a single static frame from an animation tag as a Surface.
        Uses self.cache to store processed results.
        """
        cache_key = f"{sprite_id}:{tag}:" + ":".join(f"{k}={v}" for k, v in sorted(kwargs.items()))
        
        if cache_key in self.cache:
            return self.cache[cache_key]

        raw_meta = self.metadata.get(sprite_id)
        if not raw_meta or "animations" not in raw_meta:
            return self.get_texture(sprite_id)

        meta = self._resolve_args(raw_meta, kwargs)
        anim_data = meta["animations"].get(tag)
        
        if not anim_data:
            return self.error_sprite

        if anim_data.get("mode") == "grid":
            fw, fh = anim_data["frame_size"]
            sx, sy = anim_data.get("start_pos", [0, 0])
            rect = [sx, sy, fw, fh]
        else:
            frames_list = anim_data.get("frames", [])
            rect = frames_list[0] if frames_list else [0, 0, 32, 32]

        frame_meta = meta.copy()
        frame_meta["rect"] = rect
        
        base_img = self.get_texture(meta.get("texture", sprite_id))
        
        palette_name = kwargs.get("palette")
        palette = meta.get("palettes", {}).get(palette_name) if palette_name else None

        frame_surf = base_img.subsurface(pygame.Rect(rect[0], rect[1], rect[2], rect[3])).copy()
        
        if palette:
            frame_surf = self.apply_palette(frame_surf, palette)

        final_sprite = self._apply_modifiers(frame_surf, frame_meta)

        self.cache[cache_key] = final_sprite
        return final_sprite
    
    def clear_cache(self, textures: bool = False):
        """
        Clears the processed sprites cache.
        
        :param textures: If True, also clears the raw texture atlas cache (texture_cache).
        """
        self.cache.clear()
        if textures:
            self.texture_cache.clear()

    def clear_all(self) -> None:
        self.clear_cache(True)
        self.anim_cache.clear()
        self.sprite_map.clear()
        self.metadata.clear()