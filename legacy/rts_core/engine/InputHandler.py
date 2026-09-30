import pygame
import typing
from pygame.constants import K_m, K_b, K_t, K_s
from rts_core.classes import Player

if typing.TYPE_CHECKING:
    from rts_client import Game

import time

class InputHandler:
    """
    Handles player input events and translates them into game actions.

    This class processes mouse and keyboard events and updates
    the game state accordingly (unit selection, movement, and actions).
    """

    def __init__(self, game: "Game") -> None:
        """
        Create a new input handler.

        :param game: Needed to gain access to game state
        :type game: Game
        """
        
        self.game = game
        self.ui = game.ui
        self.click_per_tick: float = 0
        self.last_button: int | None = None 

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")


    def handle_input(self, event: pygame.event.Event) -> None:
        """
        Dispatch a pygame event to the appropriate input handler.

        :param event: Pygame input event
        :type event: pygame.event.Event
        """

        for name in reversed(self.ui.layer_names):
            for widget in reversed(self.ui.layers[name]):
                if widget.visible and widget.handle_event(event):
                    return

        ctx = self.ui.context
        if not ctx:
            return
        
        if event.type == pygame.MOUSEWHEEL:
            ctx.on_scroll(event.y)

        elif event.type == pygame.MOUSEMOTION:
            self.ui.mouse_position = event.pos
            ctx.on_hover(event.pos, event.rel)

        elif event.type == pygame.MOUSEBUTTONDOWN:
            if event.button in (4, 5): return
            now = time.time()
    
            if (now - self.click_per_tick) < 0.3 and event.button == self.last_button:
                ctx.on_double_click(event.pos)
                self.click_per_tick = 0 
            else:
                ctx.on_click(event.button, event.pos)
                self.click_per_tick = now
            
            self.last_button = event.button

        elif event.type == pygame.KEYDOWN:
            key = event.key
            # System buttons
            if key == pygame.K_F3 and self.game.isdebug:
                debug = self.game.ui.get_widget("debug_state")
                if debug:
                    debug.visible = not debug.visible

            elif key == pygame.K_F4:
                # Resource reload
                self.game.res.reload_all()

                if self.game.isdebug:
                    self.game.env.load()
            else:
                ctx.on_key(key)

        # if event.type == pygame.KEYDOWN:
        #     if event.key == pygame.K_s:  # Нажать 'S' для Stop
        #         if self.game.ui.selected_group:
        #             unit = self.game.ui.selected_group
        #             if unit.move_progress != 0:
        #                 self.game.movement_manager.stop_unit(unit)
        #                 print(f"Unit {unit.group_id} stopped at {unit.move_progress}")