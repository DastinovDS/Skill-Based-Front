import pygame
import typing
from typing import Callable, Any

from rts_core.ui.Widget.UIWidget import UIWidget

if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine.Renderer import Renderer

from rts_core.engine.Renderer.LAYERS import LAYER_UI, UI_PRIORITY_DEBUG


class DebugState(UIWidget):
    """
    A dynamic debug overlay that utilizes the Screen.text method 
    for automatic background scaling and multi-line rendering.
    """
    def __init__(self, game: "Game", anchor=(0, 0), pivot=(0, 0), offset=(10, 10), visible=True, allowed_contexts=None):
        super().__init__(game, (0, 0), "widgets.debug.debugstate", anchor, pivot, offset, visible, False, allowed_contexts=allowed_contexts)
        
        self.watchers: list[tuple[str, Callable[[], Any]]] = []

        self.bg_color = (0, 0, 0, 160)
        self.text_color = (255, 255, 255)
        self.font_size = 18
        self.padding = 8

    def watch(self, label: str, getter: Callable[[], Any]):
        """
        Register a new variable to monitor.
        :param label: Name displayed before the value.
        :param getter: Function or lambda that returns the value.
        """
        self.watchers.append((label, getter))

    def draw(self, screen: "Renderer", **_):
        if not self.visible or not self.watchers:
            return

        lines = []
        for label, getter in self.watchers:
            try:
                value = getter()
                lines.append(f"{label}: {value}")
            except Exception:
                lines.append(f"{label}: <Error>")
        full_text = "\n".join(lines)
    
        self.update_position()
        text_w, text_h = screen.draw_text(
            text=full_text,
            pos=self.rect.topleft,
            size=self.font_size,
            color=self.text_color,
            background_color=self.bg_color,
            padding=self.padding,
            center=False,
            is_world_pos=False, 
            z_index=LAYER_UI+UI_PRIORITY_DEBUG
        )

        self.rect.size = (text_w, text_h)
        self.size = (text_w, text_h)
        