from rts_core.engine import Screen
from rts_core.engine import Camera
from rts_core.engine import Renderer
from rts_core.engine import InputHandler

from rts_core.ui import UIState

from rts_core.system import CacheManager
from rts_core.system import ResourceManager
from rts_core.system import LocalizationSystem
from rts_core.system import SpriteManager
from rts_core.system import ChunkManager
from rts_core.system import SoundManager
from rts_core.system import FontManager

from rts_core.network.ClientManager import ClientManager

from rts_core.game_logic import LoggerManager
from rts_core.client_logic import ClientCombatManager
from rts_core.client_logic import ClientTaskManager
from rts_core.client_logic import ClientActionManager
from rts_core.client_logic import ClientMovementManager
from rts_core.game_logic import EconomyManager
from rts_core.game_logic.World.MapGenerator import MapGenerator
from rts_core.game_logic.env_parser import ENVParser

from rts_core.classes import Province, Player
# from rts_core.setup import game_init

import os
import sys
import time
import shutil
import pygame
import random
import traceback

LOG_BASE_DIR = "logs/game_session"

class Game:
    def __init__(self):
        pygame.init()

        IS_BUNDLE = getattr(sys, 'frozen', False)
        def get_resource_path(relative_path):
            if IS_BUNDLE:
                base_path = sys._MEIPASS # type: ignore
            else:
                base_path = os.path.abspath(".")

            return os.path.join(base_path, relative_path)
        
        pygame.display.set_icon(pygame.image.load(get_resource_path("assets/icon/icon.jpg"))) # icon :D

        self.env = ENVParser()
        self.env.load()

        infoObject = pygame.display.Info()
        self.WIDTH = infoObject.current_w if not self.env.get("WIDTH", None) else self.env.get_int("WIDTH")
        self.HEIGHT = infoObject.current_h if not self.env.get("HEIGHT", None) else self.env.get_int("HEIGHT")

        self.isdebug = False if IS_BUNDLE else self.env.get_bool("DEBUG")
        
        # Logger
        self.pending_logs = []
        self.game_time = 0.0
        self.logger_manager = LoggerManager(self)

        self.logger_info("[Client] Initialization")
        
        # Managers
        self.cache_manager = CacheManager()
        self.res = ResourceManager(self, get_resource_path("assets"))
        self.font_manager = FontManager()
        self.sprite_manager = SpriteManager(self.res, self)
        self.language_manager = LocalizationSystem(self.res)
        self.language_manager.set_language(self.env.get("LANGUAGE", "en_us"))
        self.sound_manager = SoundManager(self.res, self)

        self.screen = Screen(self.WIDTH, self.HEIGHT, self, fullscreen=(
            True if not self.env.get("FULLSCREEN", None) else self.env.get_bool("FULLSCREEN")))
        self.screen.set_caption("Game of War")

        self.camera = Camera(self.WIDTH, self.HEIGHT)
        
        self.camera.x+= self.WIDTH//2
        self.camera.y+= self.HEIGHT//2

        self.world_manager: MapGenerator | None = None
        self.chunk_manager: ChunkManager | None = None

        self.renderer = Renderer(self)
        self.ui = UIState(self)
        self.ui.setup_ui()
        self.inputhandler = InputHandler(self)

        # NetWork Manager
        self.network_manager = ClientManager(self, self.env.get("HOST", "localhost"), self.env.get_int("PORT", 7777))

        self.FPS = 60
        self.players: list[Player] = []

        self.me: Player = Player(-1, self.env.get("NAME", f"Player_{random.randint(0,2026)}"))

        self.provinces: list[Province] = []
        self.vp_goal = 10
        self.combat_logs: list[dict] = []

        self.combat_manager = ClientCombatManager(self)
        self.movement_manager = ClientMovementManager(self)
        self.task_manager = ClientTaskManager(self)
        self.economy_manager = EconomyManager(self)

        self.action_manager = ClientActionManager(self)

        self.logger_info(f"[Client] Initialization complete!")

        s = time.time()
        try: self.res.get_data("sprite", "")
        except FileNotFoundError: pass
        d = f"{time.time()-s:.2f}"
        self.logger_info(f"[ResourceManager] Test 'get_date' speed : {d}", speed_response=d)
        
        self.game_clock = self.screen.get_clock()

    def client_send_action(self, action: str, data: dict):
        "Short cut check connection and send data to server"
        if self.network_manager.is_connected:
            self.network_manager.send_action(action, data)

    def get_player_by_id(self, player_id: int):
        return next((x for x in self.players if x.player_id == player_id), None)

    def logger_info(self, *message, level="INFO", **kwargs):
        print(f"{level}: {' '.join(message)}")
        self.logger_manager.record_system(*message, level=level, **kwargs)

    def update_game_state(self, dt: float) -> bool:

        self.network_manager.update_network()

        self.task_manager.update(dt)
        self.movement_manager.update(dt)
        self.economy_manager.update(dt)
        self.combat_manager.update(dt)
        self.sound_manager.update(dt)
        self.ui.update(dt)

        return True

    def close_game(self):
        if self.chunk_manager: self.chunk_manager.stop()
        self.screen.quit()
        pygame.quit()
        sys.exit()

    def main_game_loop(self):

        running = True

        # create log file
        if os.path.exists(LOG_BASE_DIR):
            shutil.rmtree(LOG_BASE_DIR)
        os.makedirs(LOG_BASE_DIR, exist_ok=True)

        try:
            while running:
                dt = self.game_clock.tick(self.FPS) / 1000
                self.game_time += dt

                for event in pygame.event.get():
                    if event.type == pygame.QUIT:
                        running = False

                    self.inputhandler.handle_input(event)

                if running:
                    running = self.update_game_state(dt)

                self.renderer.draw(dt)
        except (KeyboardInterrupt, SystemExit):
            self.logger_info("Closing Client...")
        except BaseException as ex:
            self.logger_info(f"Client as crashed!\n - {ex}", level="ERROR")
            traceback.print_exc()
        self.close_game()
        
if __name__ == "__main__":
    game = Game()
    game.main_game_loop()