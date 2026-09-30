import pygame
import os 

from dataclasses import dataclass

@dataclass
class Font:
    font: pygame.font.Font
    size: int

class FontManager:
    """
    Manages loading and caching of fonts.

    Provides a centralized way to load pygame fonts and reuse them
    to avoid redundant loading and improve performance.
    """

    def __init__(self): 
        """
        Initializes the FontManager and the font cache.
        """

        pygame.font.init()   
        self.cache: dict[tuple[str | None, int], Font] = {}
        self.default_font = None 

    def get(self, size: int, name: str | None = None) -> Font:
        """
        Returns a font from the cache or loads it if necessary.

        :param size: Font size in pixels
        :type size: int
        :param name: Path to the font file or None to use the default font
        :type name: str | None
        :return: Cached pygame font object
        :rtype: pygame.font.Font
        """

        font_name = name or self.default_font
        key = (font_name, size)
        
        if key not in self.cache:
            try:
                if font_name and os.path.exists(font_name):
                    self.cache[key] = Font(pygame.font.Font(font_name, size), size)
                else:
                    self.cache[key] = Font(pygame.font.SysFont(font_name, size), size)
            except Exception:
                self.cache[key] = Font(pygame.font.Font("None", size), size)
                
        return self.cache[key]


    def render(self, surface: pygame.Surface, text: str, pos: tuple[int, int], 
               size: int = 20, color: tuple[int,int,int]=(255, 255, 255), name: str | None = None, center: bool=False) -> None:
        """
        Draw Text on surface

        :param surface: 
        :type surface: pygame.Surface
        :param text: 
        :type text: str
        :param pos: 
        :type pos: tuple[int, int]
        :param size: 
        :type size: int
        :param color: 
        :type color: tuple[int,int,int]
        :param name: 
        :type name: str | None
        :param center: 
        :type center: bool
        """
        font = self.get(size, name)
        text_surf = font.font.render(str(text), True, color)
        rect = text_surf.get_rect()
        if center:
            rect.center = pos
        else:
            rect.topleft = pos
        surface.blit(text_surf, rect)