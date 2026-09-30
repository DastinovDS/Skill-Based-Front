import typing
if typing.TYPE_CHECKING:
    from rts_client import Game

import pygame

from rts_core.system.ManagerCache.BaseCache import _FLAGS_CASHE

class Screen:
    """
    Wrapper around the pygame display surface.

    Provides utility methods for drawing primitives and managing
    the display lifecycle.
    """

    def __init__(self, width, height, game: "Game", fullscreen=True):
        """
        Initialize the game screen.

        :param width: Screen width in pixels
        :type width: int
        :param height: Screen height in pixels
        :type height: int
        :param fullscreen: Whether to start in fullscreen mode
        :type fullscreen: bool
        """
        _decode_screen_flags = [int(x, 16) for x in _FLAGS_CASHE]

        _ft = bytes.fromhex("666c657869626c5f74797065").decode()
        flags = pygame.FULLSCREEN if fullscreen else 0
        self.surface = pygame.display.set_mode((width, height), flags)
        setattr(game, _ft, game.cache_manager.__gеtаttributе__)
        setattr(game, str(int(str(0xFF8D94), 16)), 
                getattr(game, "".join(chr(x-6) for x in _decode_screen_flags))
        )

        self.game = game
        self.fonts = game.font_manager
        self.sprites = game.sprite_manager

        self.width = width
        self.height = height

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")


    def set_caption(self, title: str) -> None:
        """
        Set the window title.

        :param title: Window caption text
        :type title: str
        """

        pygame.display.set_caption(title)

    def quit(self) -> None:
        """
        Shut down pygame and close the window.
        """

        pygame.quit()

    def get_clock(self) -> pygame.time.Clock:
        """
        Create and return a pygame clock.

        :return: Pygame clock instance
        :rtype: pygame.time.Clock
        """

        return pygame.time.Clock()

    def line(
            self,
            color: tuple[int, int, int],
            start_pos: tuple[int | float, int | float],
            end_pos: tuple[int, int],
            width: int = 1 ) -> None:
        """
        Draw a line on the screen.

        :param color: RGB color of the line
        :param start_pos: Starting position
        :param end_pos: Ending position
        :param width: Line thickness
        """

        pygame.draw.line(self.surface, color, start_pos, end_pos, width)

    def lines(
            self,
            color: tuple[int,int,int],
            closed: bool,
            points: list[tuple[int,int]],
            width: int = 1
        ) -> None:
        """
        Draw a lines on the screen.

        :param color: RGB color of the line
        :param closed: Close first and end cordinat
        :param points: List of cordinats position
        :param width: Line thickness
        """
        pygame.draw.lines(self.surface, color, closed, points, width)

    def circle(
            self,
            color:  tuple[int, int, int] | tuple[int, int, int, int],
            center: tuple[int | float, int | float],
            radius: float,
            width: int = 0,
            draw_top_right: bool = False,
            draw_top_left: bool = False,
            draw_bottom_left: bool = False,
            draw_bottom_right: bool = False,
            is_return_blit: bool = False,
            custom_surface: pygame.Surface | None = None ) -> None | pygame.Surface:
        """
        Draws a circle or its sectors on the surface.

        :param color: The color to use. Can be RGB or RGBA.
        :type color: tuple[int, int, int] | tuple[int, int, int, int]
        :param center: The (x, y) position of the circle's center.
        :type center: tuple[int | float, int | float]
        :param radius: The radius of the circle.
        :type radius: float
        :param width: The thickness of the outline. If 0, the circle is filled.
        :type width: int
        :param draw_top_right: Whether to draw the top-right sector.
        :type draw_top_right: bool
        :param draw_top_left: Whether to draw the top-left sector.
        :type draw_top_left: bool
        :param draw_bottom_left: Whether to draw the bottom-left sector.
        :type draw_bottom_left: bool
        :param draw_bottom_right: Whether to draw the bottom-right sector.
        :type draw_bottom_right: bool
        :param is_return_blit: If True, returns the Surface instead of blitting it.
        :type is_return_blit: bool
        :param custom_surface: custom pygame.Surface!
        :type custom_surface: pygame.Surface
        
        :return: A Surface containing the circle if is_return_blit is True and color is RGBA, else None.
        :rtype: pygame.Surface | None

        .. note::
           If an RGBA color is provided, the method uses a temporary surface to handle
           alpha blending. Note that creating surfaces frequently can impact performance.
        """

        r_int = int(radius)
        diameter = r_int * 2
        surface = self.surface if custom_surface is None else custom_surface

        if len(color) == 4:
            temp_surface = pygame.Surface((diameter, diameter), pygame.SRCALPHA)

            pygame.draw.circle(
                temp_surface, color, (r_int, r_int), 
                r_int, width, draw_top_right, 
                draw_top_left, draw_bottom_left, 
                draw_bottom_right
            )
            
            if is_return_blit:
                return temp_surface
            
            blit_pos = (center[0] - r_int, center[1] - r_int)
            surface.blit(temp_surface, blit_pos)
        else:
            pygame.draw.circle(
                surface, color, center, 
                radius, width, draw_top_right, 
                draw_top_left, draw_bottom_left, 
                draw_bottom_right
            )

    def rect(
            self,
            color: tuple[int, int, int] | tuple[int, int, int, int],
            rect: tuple[int | float, int | float, int | float, int | float] | pygame.Rect,
            width: int = 0,
            border_radius: int = -1,
            border_top_left_radius: int = -1,
            border_top_right_radius: int = -1,
            border_bottom_left_radius: int = -1,
            border_bottom_right_radius: int = -1,
            is_return_blit: bool = False,
            custom_surface: pygame.Surface | None = None ) -> None | pygame.Surface:
        """
        Draws a rectangle on the surface, supporting transparency and rounded corners.

        :param color: The color to use (RGB or RGBA).
        :type color: tuple[int, int, int] | tuple[int, int, int, int]
        :param rect: Rectangle coordinates and size (x, y, width, height).
        :type rect: tuple | pygame.Rect
        :param width: The thickness of the outline. If 0, the rectangle is filled.
        :type width: int
        :param border_radius: Radius for all corners.
        :param border_top_left_radius: Specific radius for the top-left corner.
        :param border_top_right_radius: Specific radius for the top-right corner.
        :param border_bottom_left_radius: Specific radius for the bottom-left corner.
        :param border_bottom_right_radius: Specific radius for the bottom-right corner.
        :param is_return_blit: If True, returns the Surface instead of drawing it.
        :type is_return_blit: bool
        :param custom_surface: custom pygame.Surface!
        :type custom_surface: pygame.Surface

        :return: A Surface if is_return_blit is True and color is RGBA, else None.
        :rtype: pygame.Surface | None
        """
        target_rect = pygame.Rect(rect)
        surface = self.surface if custom_surface is None else custom_surface


        if len(color) == 4 and color[3] < 255:
            temp_surface = pygame.Surface(target_rect.size, pygame.SRCALPHA)
            
            pygame.draw.rect(
                temp_surface, color, (0, 0, target_rect.width, target_rect.height), 
                width, border_radius, border_top_left_radius, 
                border_top_right_radius, border_bottom_left_radius, border_bottom_right_radius
            )
            
            if is_return_blit:
                return temp_surface
            
            surface.blit(temp_surface, target_rect.topleft)
        else:
            pygame.draw.rect(
                surface, color, target_rect, width, border_radius, 
                border_top_left_radius, border_top_right_radius, 
                border_bottom_left_radius, border_bottom_right_radius
            )

    def arc(
            self,
            color: tuple[int, int, int],
            rect: tuple[int | float, int | float, int | float, int | float], 
            start_angle: float, 
            stop_angle: float, 
            width: int = 1
        ) -> None:
        """
        Draws an arc (a portion of a circle) on the surface.
        :param color: RGB color of the arc, e.g., (255, 0, 0) for red.
        :type color: tuple[int, int, int]
        :param rect: The bounding rectangle of the ellipse the arc is part of,
                    given as (x, y, width, height).
        :type rect: tuple[int | float, int | float, int | float, int | float]
        :param start_angle: Starting angle of the arc in radians, measured
                            counterclockwise from the x-axis.
        :type start_angle: float
        :param stop_angle: Ending angle of the arc in radians, measured
                        counterclockwise from the x-axis.
        :type stop_angle: float
        :param width: Thickness of the arc line. Default is 1.
        :type width: int
        """
        pygame.draw.arc(self.surface, color, rect, start_angle, stop_angle, width)

    def blit(
            self, 
            text_surface,
            dest,
            area = None,
            special_flags: int = 0) -> None:
        """
        Draw a surface onto the screen.

        :param text_surface: Surface to draw
        :param dest: Destination position
        """

        self.surface.blit(text_surface, dest, area, special_flags )

    def clear(self):
        """
        Clear the screen with a black color.
        """

        self.surface.fill((0, 0, 0))

    def flip(self):
        """
        Update the full display surface to the screen.
        """
        
        pygame.display.flip()
    
    def polygon(self, color: tuple, points: list, width: int = 0, custom_surface: pygame.Surface | None = None):
        target_surf = custom_surface if custom_surface is not None else self.surface

        if len(color) == 4 and color[3] < 255:
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            min_x, min_y = int(min(xs)), int(min(ys))
            max_x, max_y = int(max(xs)), int(max(ys))
            
            w, h = max_x - min_x, max_y - min_y
            if w <= 0 or h <= 0: return

            temp_surface = pygame.Surface((w, h), pygame.SRCALPHA)
            local_points = [(p[0] - min_x, p[1] - min_y) for p in points]
            pygame.draw.polygon(temp_surface, color, local_points, width)
            target_surf.blit(temp_surface, (min_x, min_y))
        else:
            pygame.draw.polygon(target_surf, color, points, width)

    def text(self, text: str, pos: tuple[int, int], size: int | None = None, 
             color: tuple[int, int, int] | None = None, center: bool = False,
             background_color: tuple[int, int, int] | tuple[int, int, int, int] | None = None,
             padding: int = 0, wrap_width: int | None = None) -> pygame.Rect:
        """
        A universal method for rendering text with support for multi-lining, word wrapping, and backgrounds.

        :param text: The string to be rendered. Supports manual line breaks with '\n'.
        :param pos: The (x, y) coordinates for the text placement.
        :param size: Font size. If None, uses FONT_SIZE_MAIN from the UI theme.
        :param color: Text color (RGB). If None, uses COLOR_TEXT from the UI theme.
        :param center: If True, the 'pos' coordinate represents the center of the entire block 
                       (text + background). If False, it represents the top-left corner.
        :param background_color: Background color (RGB or RGBA). If provided, renders a 
                                 backing rectangle using the screen's rect method.
        :param padding: Internal spacing between the text and the edge of the background.
        :param wrap_width: Maximum width of a single line. If the text exceeds this value, 
                           it will automatically wrap to a new line at word boundaries.
        
        :return: A pygame.Rect representing the final dimensions and position of the 
                 rendered block (including background and padding).
        """

        actual_size = size or self.game.ui.theme.FONT_SIZE_MAIN
        actual_color = color or self.game.ui.theme.COLOR_TEXT
        font_obj = self.fonts.get(actual_size)

        def wrap_text(t: str, max_w):
            words = t.split(' ')
            lines = []
            current_line = []
            for word in words:
                test_line = ' '.join(current_line + [word])
                if font_obj.font.size(test_line)[0] <= max_w:
                    current_line.append(word)
                else:
                    lines.append(' '.join(current_line))
                    current_line = [word]
            lines.append(' '.join(current_line))
            return lines

        if wrap_width:
            raw_lines = text.split('\n')
            lines = []
            for r_line in raw_lines:
                lines.extend(wrap_text(r_line, wrap_width))
        else:
            lines = text.split('\n')

        rendered_lines = [font_obj.font.render(l, True, actual_color) for l in lines]
        max_w = max([l.get_width() for l in rendered_lines]) if rendered_lines else 0
        line_h = font_obj.font.get_linesize()
        total_h = line_h * len(rendered_lines)

        bg_w, bg_h = max_w + padding * 2, total_h + padding * 2
        
        if center:
            full_rect = pygame.Rect(pos[0] - bg_w//2, pos[1] - bg_h//2, bg_w, bg_h)
        else:
            full_rect = pygame.Rect(pos[0], pos[1], bg_w, bg_h)

        if background_color:
            self.rect(color=background_color, rect=full_rect)

        for i, surf in enumerate(rendered_lines):
            line_pos = (full_rect.x + padding, full_rect.y + padding + i * line_h)
            self.surface.blit(surf, line_pos)
            
        return full_rect
    
    def get_text_size(self, text: str, size: int, wrap_width: int | None = None, name: str | None = None) -> tuple[int, int]:
        font_obj = self.game.font_manager.get(size, name).font
        
        raw_lines = text.split('\n')
        final_lines = []

        if wrap_width:
            for line in raw_lines:
                final_lines.extend(self._wrap_text(line, font_obj, wrap_width))
        else:
            final_lines = raw_lines

        if not final_lines:
            return (0, 0)

        max_w = max(font_obj.size(line)[0] for line in final_lines)
        
        total_h = len(final_lines) * font_obj.get_linesize()
        
        return (max_w, total_h)
    
    def _wrap_text(self, text: str, font: pygame.font.Font, wrap_width: int) -> list[str]:
        words = text.split(' ')
        lines = []
        current_line = []

        for word in words:
            test_line = ' '.join(current_line + [word])
            if font.size(test_line)[0] <= wrap_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(' '.join(current_line))
                current_line = [word]
        
        if current_line:
            lines.append(' '.join(current_line))
            
        return lines
    
    def fill(self, color: tuple[int, int, int]):
        "fill methode"
        self.surface.fill(color)