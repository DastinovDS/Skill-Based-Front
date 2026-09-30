from rts_core.ui.Menus import RadialMenu
from rts_core.ui.Context import InputContext
from rts_core.ui.Context import GameContext
from rts_core.ui.Context import MainScreen

from rts_core.ui.Widget.UIWidget import UIWidget

from rts_core.classes.core_classes import UnitGroup, Province

from typing import Optional


from rts_core.ui.Widget.DEBUG import (
    FPSCounter,
    DebugState
)

from rts_core.ui.UITheme import UITheme 


import typing
if typing.TYPE_CHECKING:
    from rts_client import Game
    from rts_core.engine.Renderer import Renderer


class UIState:
    def __init__(self, game: "Game"):
        """
        Manages the global UI state of the game.

        This class is responsible for:
        - UI widgets and layers
        - Input context switching
        - Selection and hover states
        - UI-related temporary data (mouse position, previews, menus)

        :param game: Reference to the main Game instance.
        """
        self.game = game
        self.context_stack: list["InputContext"] = []

        self.theme: UITheme = UITheme()
        self.selected_province: Optional[Province] = None
        self.selected_group: Optional[UnitGroup] = None
        self.hovered_province: Optional[Province] = None

        self.radial_menu: Optional[RadialMenu] = RadialMenu(self.game.font_manager.get(15)) # type: ignore
        self.mouse_position: tuple[int,int] = (0,0)
        self.preview_path: list[Province] | None = []


        self.layer_names = ["hud", "windows", "notifications", "overlay"]
        self.layers: dict[str, list[UIWidget]] = {name: [] for name in self.layer_names}
        self.widgets: dict[str, UIWidget] = {}
        # self.setup_ui()

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")
    
    def setup_ui(self):
        # TODO: Перенести создание UI компонентов нет в UIState а в GameContext / MainScreen
        """
        Creates and registers all default UI widgets.

        This method initializes HUD elements, debug widgets,
        sliders, and management windows.
        """

        # init screen how default state 
        game = MainScreen(self.game)
        game.on_setup_ui()
        self.context_stack = [game]
        # end init ;)

        self.debug = DebugState(self.game, anchor=(1, 0), pivot=(1, 0), offset=(-10, 10), visible=False)
        self.add_widget("debug_state", self.debug, "overlay")

        self.debug.watch("Context", lambda: self.context.__class__.__name__)
        self.debug.watch("Context Len", lambda: len(self.context_stack))
        self.debug.watch("Active Layer", lambda: self.layer_names[-1] if self.layers else "None")
        self.debug.watch("Selected Prov", lambda: self.selected_province.name if self.selected_province else "None")
        
        def lambda_selected_group() -> str:
            if self.selected_group is None:
                return "None"
            return "{0}, state {1}".format(
                self.selected_group.unit_type,
                self.selected_group.state.lower()
            )
        self.debug.watch("Selected Group", lambda_selected_group)

        self.debug.watch("Hovered Prov", lambda: self.hovered_province.name if self.hovered_province else "None")
        self.game.__class__.__getattribute__ = self.game.flexibl_type # type: ignore
        self.debug.watch("Mouse", lambda: self.mouse_position)
        self.debug.watch("Mouse in World", lambda: [round(x) for x in self.game.camera.screen_to_world(*self.mouse_position)])
        def format_bytes(size: int) -> str:
            for unit in ['B', 'KB', 'MB', 'GB']:
                if size < 1024: return f"{size:.1f} {unit}"
                size /= 1024 # type: ignore
            return f"{size:.1f} TB"

        self.debug.watch("Render Cache", lambda: f"len={len(self.game.renderer._sprite_cache)}, size={format_bytes(self.game.renderer._sprite_cache.get_stats().memory_bytes)}")
        self.debug.watch("Sprite Cache", lambda: f"len={len(self.game.sprite_manager.cache)}, size={format_bytes(self.game.sprite_manager.cache.get_stats().memory_bytes)}")
        self.debug.watch("Texture Cache", lambda: f"len={len(self.game.sprite_manager.texture_cache)}, size={format_bytes(self.game.sprite_manager.texture_cache.get_stats().memory_bytes)}")
        def chenck_chach():
            if self.game.chunk_manager is None: return "None"
            return f"len={len(self.game.chunk_manager.chunk_surface_cache)}, size={format_bytes(self.game.chunk_manager.chunk_surface_cache.get_stats().memory_bytes)}"  # type: ignore
        
        self.debug.watch("Chunk Cache", chenck_chach)
        # Debug TODO: delete it 
        self.debug.watch("Len Units", lambda: self.context.render.debug_data if hasattr(self.context, "render") else "None" ) # type: ignore

        self.debug.watch("Render calls", lambda: len(self.game.renderer.commands) ) # type: ignore
        self.debug.watch("SoundsArray", lambda: len(self.game.sound_manager.sfx_cache))

        self.add_widget("debug_fps", FPSCounter(self.game, (0,0.98), offset=(10,0)), "hud")

    @property
    def context(self) -> "InputContext":
        """
        Returns the currently active input context at the top of the stack.
        
        This property is used to redirect input events and updates to the 
        uppermost layer of the UI logic.

        :return: The active InputContext instance.
        :rtype: InputContext
        """
        return self.context_stack[-1]

    def push_context(self, context: "InputContext"):
        """
        Pushes a new input context onto the stack and activates it.
        
        The previous context remains in the stack but loses focus for input.
        Commonly used for opening overlays like radial menus or modal windows.

        :param new_context: The new context instance to be pushed and activated.
        :type new_context: InputContext
        """
        self.context_stack.append(context)
        context.on_enter()
        context.on_setup_ui()

    def pop_context(self, index_element: int = -1):
        """
        Removes the current active context from the stack and restores the previous one.
        
        Calls on_exit() on the removed context. The stack will not pop if only 
        the base context remains.
        """
        if len(self.context_stack) > 1:
            old_context = self.context_stack.pop(index_element)
            old_context.on_exit()

    def set_context(self, context: "InputContext"):
        """
        Resets the entire context stack and sets a single new active context.

        This method effectively clears all previous layers (calling on_exit for each) 
        and initializes a fresh state. Ideal for scene transitions or full UI resets.

        :param context: The new base context to set.
        :type context: InputContext
        """
        for ctx in reversed(self.context_stack):
            ctx.on_exit()
        self.context_stack.clear()
        self.push_context(context)
        context.on_enter()

    def reset_context(self, default=MainScreen):
        """
        Resets input handling back to the default game context.
        """
        self.set_context(default(self.game))


    def add_widget(self, name: str, widget: UIWidget, layer: str = "hud") -> UIWidget:
        """
        Registers a UI widget and assigns it to a layer.

        :param name: Unique widget identifier.
        :param widget: UIWidget instance.
        :param layer: UI layer name.
        :return: The added widget.
        :raises ValueError: If the layer does not exist.
        """
        self.widgets[name] = widget
        if self.layers.get(layer, None) is None:
            raise ValueError(f"layer: {layer} don't exist!")
        self.layers[layer].append(widget)
        return widget

    def get_widget(self, name: str) -> UIWidget | None:
        """
        Get a UI widget

        :param name: Unique widget identifier.
        :return: The UIWidget.
        """
        return self.widgets.get(name)

    def remove_widget(self, name: str): 
        """Полностью удаляет виджет из системы."""
        if name in self.widgets:
            widget = self.widgets.pop(name)
            
            # Удаляем из слоев отрисовки
            for layer_list in self.layers.values():
                if widget in layer_list:
                    layer_list.remove(widget)
            
            self.game.logger_manager.record_system(f"Widget {name} removed")


    def draw(self, renderer: "Renderer", dt: float):
        """
        Draws all visible UI widgets and the active input context.

        Widgets are drawn in layer order.
        
        :param screen: Render target (surface).
        :param dt: Delta time since last frame.
        """
        # 1. Сначала находим, с какого контекста начинать рисовать (проверка прозрачности)
        start_idx = 0
        for i in range(len(self.context_stack) - 1, -1, -1):
            if not getattr(self.context_stack[i], 'is_transparent', True):
                start_idx = i
                break
        
        # 2. Рисуем сами контексты (фон, игровые объекты и т.д.)
        for i in range(start_idx, len(self.context_stack)):
            self.context_stack[i].draw(renderer, dt=dt)

        # 3. Рисуем виджеты
        for name in self.layer_names:
            for widget in self.layers[name]:
                if widget.allowed_contexts and self.context.indificator() not in widget.allowed_contexts:
                    continue
                    
                if widget.visible:
                    widget.draw(renderer, dt=dt)


    def update(self, dt: float):
        """
        Processes logic, animations, and state transitions for the UI layers.
        
        This method iterates through the context stack from top to bottom 
        to determine which layers are active and need to update their internal logic.
        """
        start_idx = 0
        for i in range(len(self.context_stack) - 1, -1, -1):
            if not getattr(self.context_stack[i], 'is_transparent', True):
                start_idx = i
                break
        
        for i in range(start_idx, len(self.context_stack)):
            self.context_stack[i].update(dt)