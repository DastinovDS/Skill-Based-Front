from rts_core.network.ServerManager import ServerManager

from rts_core.server_logic import ServerSyncManager

from rts_core.game_logic import LoggerManager, TaskManager
from rts_core.game_logic import CombatManager
from rts_core.game_logic import MovementManager
from rts_core.game_logic import EconomyManager
from rts_core.game_logic.World.ProvGenerator import generate_huge_map_config, get_province
from rts_core.game_logic.env_parser import ENVParser

from rts_core.classes import Province, Player

import asyncio
import typing
import time
import sys

import random

class Server:
    def __init__(self, map_size: tuple[int, int]=(1800, 1200), _provinces: int=50, seed: typing.Optional[int] = None, host: typing.Optional[str] = None, port: typing.Optional[int] = None) -> None:
        self.env = ENVParser()
        self.env.load()

        self.pending_logs = []
        self.game_time = 0.0

        self.logger_manager = LoggerManager(self)
        self.logger_info("[Server] Initialization")
        self.task_manager = TaskManager(self)
        self.movement_manager = MovementManager(self)
        self.economy_manager = EconomyManager(self)
        self.combat_manager = CombatManager(self)

        self.server_config = {
            "seed": random.randrange(0, 200) if not seed else seed 
        }

        self.network_manager = ServerManager(self, host if host else self.env.get("HOST", "localhost"), port if port else self.env.get_int("PORT", 7777))
        self.server_brodcast = ServerSyncManager(self)

        self.players: list[Player] = []
        self.logger_info("[WMG] Start process...")
        self.logger_info(f"[WMG] Generateing map size: ({map_size}) and {_provinces} provinces")
        
        # Province Generator
        prov, con = generate_huge_map_config(_provinces, *map_size)

        self.logger_info(f"[WMG] World Map Create {len(prov)} prov and {len(con)} connections")
        self.provinces: list[Province] = get_province(prov, con)
        self.logger_info("[WMG] finish!")
        
        self.FPS = 30
        self.tick_rate = 1.0 / self.FPS
        self.sync_timer = 0.0

        self.logger_info("[Server] Initialization complete!")

    def logger_info(self, *message, level="INFO", **kwargs):
        print(f"{level}: {' '.join(message)}")
        self.logger_manager.record_system(*message, level=level, **kwargs)
    
    def on_player_joined(self, player_id: int) -> Player:
        """Вызывается из ServerManager, когда заходит новый клиент"""
        new_player = Player(player_id, None) # type: ignore
        self.players.append(new_player)
        self.logger_info(f"[SERVER LOGIC] Registered Player {player_id} in game state.")
        return new_player

    def on_player_left(self, player_id: int) -> None:
        self.logger_info(f"[Server] Player {player_id} left. Cleaning up units from world...")
        
        player_to_remove = next((p for p in self.players if p.player_id == player_id), None)
        
        if player_to_remove:
            
            for province in self.provinces:
                province.units = [u for u in province.units if u.owner.player_id != player_id]

            self.players.remove(player_to_remove)
            
        self.logger_info(f"[Server] Player {player_id} completely removed from logic.")

    def get_player_by_id(self, player_id: int):
        return next((x for x in self.players if x.player_id == player_id), None)

    def update_server_state(self, dt: float) -> None:
        self.task_manager.update(dt)
        self.movement_manager.update(dt)
        self.economy_manager.update(dt)
        self.combat_manager.update(dt)

        self.sync_timer += dt
        if self.sync_timer >= 0.05:
            
            self.server_brodcast.sync_all()

            self.sync_timer = 0.0

    def stop_server(self):
        pass

    async def main_server_loop(self) -> None:
        await self.network_manager.start_server()
        
        self.logger_info("[Server] Dedicated Server is running...")
        running = True
        last_time = time.time()
        
        while running:
            current_time = time.time()
            dt = current_time - last_time
            last_time = current_time

            self.game_time += dt
            self.update_server_state(dt)

            await asyncio.sleep(self.tick_rate)

    
    def start_server(self) -> None:
        try:
            asyncio.run(self.main_server_loop())
        except KeyboardInterrupt:
            self.logger_info("Stop Event")
            self.stop_server()
            self.logger_info("Server closed")


def main(args: list) -> None:
    kwargs = {}
    try:
        if '-size' in args:
            idx = args.index('-size')
            val = args[idx + 1]
            val = val.replace('(', '').replace(')', '')
            x, y = map(int, val.split(','))
            kwargs["map_size"] = (x, y)

        if '-prov' in args:
            idx = args.index('-prov')
            kwargs["_provinces"] = int(args[idx + 1])
        
        if '-seed' in args:
            idx = args.index('-seed')
            kwargs["seed"] = int(args[idx + 1])
        
        if '-host' in args:
            idx = args.index('-host')
            kwargs["host"] = str(args[idx + 1])
        
        if '-port' in args:
            idx = args.index('-port')
            kwargs["porthost"] = str(args[idx + 1])
            
    except (ValueError, IndexError):
        print("Error: Invalid argument format!")
        print("Usage: python script.py -size (x,y) -prov <int> -seed <int> -host <str> -port <int>")
        sys.exit(1)

    server = Server(**kwargs)
    server.start_server()

if __name__ == "__main__":
    main(sys.argv[1:])
    