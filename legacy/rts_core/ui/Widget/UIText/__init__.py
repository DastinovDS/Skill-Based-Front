import typing
import pygame
from rts_core.ui.Widget.UIWidget import UIWidget
from rts_core.engine.Renderer import LAYER_UI

if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine.Renderer import Renderer

class UIText(UIWidget):
    def __init__(self, game: "Game", text: str, font_size: int = 24, 
                 color: tuple[int, int, int] = (255, 255, 255), 
                 anchor=(0, 0), pivot=(0, 0), offset=(0, 0),
                 translate_key: str | None = None, is_localized: bool = False):
        """
        Виджет для отображения текста.
        
        :param text: Текст или ключ перевода.
        :param font_size: Размер шрифта.
        :param is_localized: Если True, будет использовать translate_it.
        """
        super().__init__(game, (0, 0), translate_key, anchor, pivot, offset, collisions=False)
        
        self.font_size = font_size
        self.color = color
        self.is_localized = is_localized
        self._text_str = text
        
        self.refresh_text(notify_parent=False)

    @property
    def text(self) -> str:
        return self._text_str

    @text.setter
    def text(self, value: str):
        if self._text_str != value:
            self._text_str = value
            self.refresh_text(notify_parent=True)

    def refresh_text(self, notify_parent=True):
        """Обновляет содержимое и пересчитывает размеры виджета."""
        display_content = self.translate_it(self._text_str) if self.is_localized else self._text_str

        try:
            w, h = self.game.renderer.screen.get_text_size(display_content, self.font_size)
        except AttributeError:
            font = pygame.font.SysFont("Arial", self.font_size)
            w, h = font.size(display_content)
        
        self.size = (w, h)
        self.rect.size = self.size

        self.update_position()
        
        if notify_parent and hasattr(self, 'parent') and self.parent and hasattr(self.parent, 'recalculate_layout'):
            self.parent.recalculate_layout() # type: ignore

    def draw(self, render: "Renderer", **kwargs):
        if not self.visible:
            return
            
        display_content = self.translate_it(self._text_str) if self.is_localized else self._text_str
        
        render.draw_text(
            text=display_content,
            pos=self.rect.topleft, 
            color=self.color,
            size=self.font_size,
            center=False,
            z_index=LAYER_UI
        )