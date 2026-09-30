import typing
from typing import Optional
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine.Renderer import Renderer

import pygame

class UIWidget:
    def __init__(self, game: "Game", size: tuple[int, int], translate_key: str | None = None,
                 anchor: tuple[float, float] = (0, 0), 
                 pivot: tuple[float, float] = (0, 0), 
                 offset: tuple[int, int] = (0, 0), 
                 visible: bool = True, collisions: bool = True,
                 allowed_contexts: list[str] | None = None):
        """
        Base class for all UI widgets.

        Handles positioning, visibility, input collision,
        parent-child layout logic, and localization support.

        :param game: Reference to the main Game instance.
        :param size: Widget size in pixels (width, height).
        :param translate_key: Base key for localization strings.
        :param anchor: Anchor point relative to the parent or screen (0.0 – 1.0).
        :param pivot: Pivot point inside the widget (0.0 – 1.0).
        :param offset: Pixel offset applied after anchor and pivot.
        :param visible: Whether the widget is rendered.
        :param collisions: Whether the widget reacts to mouse events.
        """
        self.game = game
        self.size = size
        self.anchor = anchor
        self.pivot = pivot
        self.offset = offset
        self.visible = visible
        self.collisions = collisions

        self.allowed_contexts = allowed_contexts

        # Translate
        self.translate_key = translate_key
        self.translate_it = lambda key, *args: self.game.language_manager.translate(f"{self.translate_key}.{key}" if "isglobal" not in args else f"{key}", *args)
        
        self.rect = pygame.Rect(0, 0, *size)
        self.parent: Optional['UIWidget'] = None
        self.update_position()

    @property
    def pos(self):
        """
        Returns the current top-left position of the widget.
        """
        return (self.rect.x, self.rect.y)

    def update_position(self):
        """
        Recalculates the widget position based on anchor, pivot,
        offset, and parent or screen size.
        """
        if hasattr(self, 'parent') and self.parent:
            base_w, base_h = self.parent.size
            base_x, base_y = self.parent.rect.topleft
        else:
            base_w = self.game.screen.width
            base_h = self.game.screen.height
            base_x, base_y = 0, 0

        final_x = base_x + (base_w * self.anchor[0]) - (self.size[0] * self.pivot[0]) + self.offset[0]
        final_y = base_y + (base_h * self.anchor[1]) - (self.size[1] * self.pivot[1]) + self.offset[1]
        
        self.rect.topleft = (int(final_x), int(final_y))

    def handle_event(self, event: "pygame.event.Event") -> bool:
        """
        Processes a pygame event.

        Handles mouse click detection and calls on_click()
        if the widget is visible and interactive.

        :param event: Pygame event.
        :return: True if the event was handled.
        """
        if not self.visible or not self.collisions: return False
        if event.type == pygame.MOUSEBUTTONDOWN and self.rect.collidepoint(event.pos):
            self.on_click(event)
            return True
        return False

    def on_click(self, event: "pygame.event.Event"): 
        """
        Called when the widget is clicked.

        Must be implemented by subclasses.
        """
        
    def draw(self, render: "Renderer", **kwargs): 
        """
        Draws the widget.

        Must be implemented by subclasses.
        """