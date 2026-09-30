import typing
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine import Renderer
    from rts_core.ui.Widget.UIWidget import UIWidget

T = typing.TypeVar("T", bound="UIWidget")

class InputContext:
    def __init__(self, game: "Game") -> None:
        """
        Base class for input handling contexts.

        Input contexts define how the game reacts to
        mouse, keyboard, and scroll input depending
        on the current game state (e.g. gameplay, UI, editor).
        """
        self.game: "Game" = game
        self.is_transparent: bool = False

        self._owned_widgets: list[str] = []

    @staticmethod
    def indificator() -> str: 
        """Уникальный ID контекста для имен виджетов."""
        raise NotImplementedError
        
    def on_enter(self):
        """
        Called when the context becomes active.
        """

    def on_exit(self):
        """
        Called when the context is deactivated.
        """
        for widget_name in self._owned_widgets:
            self.game.ui.remove_widget(widget_name)
        self._owned_widgets.clear()

    def on_hover(self, cordinats: "tuple[int, int]", rel):
        """
        Called when the mouse moves.

        :param cordinats: Mouse position on the screen.
        :param rel: Relative mouse movement.
        """

    def on_click(self, button, cordinats: "tuple[int, int]"):
        """
        Called when a mouse button is pressed.

        :param button: Mouse button identifier.
        :param cordinats: Mouse position on the screen.
        """

    def on_double_click(self, cordinats: "tuple[int, int]"):
        """
        Called when a double click is detected.

        :param cordinats: Mouse position on the screen.
        """

    def on_key(self, key):
        """
        Called when a keyboard key is pressed.
        """
        
    def on_scroll(self, scroll: int): 
        """
        Called when the mouse wheel is scrolled.

        :param scroll: Scroll direction and amount.
        """

    def draw(self, renderer: "Renderer", dt: float): 
        """
        Draws context-specific overlays or helpers.

        :param renderer: Renderer target.
        :param dt: delta time.
        """

    def update(self, dt: float):
        """
        Update State ...
        """

    # Widget Tile!

    def on_setup_ui(self):
        """
        Creates and registers all default UI widgets.

        Plase where init ui elements, well yea...
        """

    def add_widget(self, name: str, widget_class: type[T], layer: str = "hud", *args, **kwargs) -> T:
        """
        Registers a UI widget and assigns it to a layer.

        :param name: Unique widget identifier.
        :param widget: UIWidget instance.
        :param layer: UI layer name.
        :return: The added widget.
        :raises ValueError: If the layer does not exist.
        """
        full_key = f"{self.indificator()}:{name}"
        if hasattr(widget_class, "allowed_contexts"):
            if "allowed_contexts" not in kwargs: kwargs["allowed_contexts"] = [] 
            kwargs["allowed_contexts"].append( self.indificator() )
        self._owned_widgets.append(full_key)
        return self.game.ui.add_widget(full_key, widget_class(*args, **kwargs), layer) # type: ignore
    
    def get_widget(self, name: str) -> T | None: # type: ignore
        """
        Get a UI widget

        :param name: Unique widget identifier.
        :return: The UIWidget.
        """
        return self.game.ui.widgets.get(f"{self.indificator()}:{name}") # type: ignore