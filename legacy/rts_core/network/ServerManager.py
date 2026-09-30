import typing

if typing.TYPE_CHECKING:
    from rts_server import Server
    from rts_core.classes.core_classes import Player

from main import VERSION

import random
import struct
import asyncio
import json

class ServerManager:
    def __init__(self, server: "Server", host: str = "0.0.0.0", port: int = 7777) -> None:
        self.server = server
        self.host = host
        self.port = port
        
        self.clients: dict[int, tuple[asyncio.StreamReader, asyncio.StreamWriter]] = {}
        self.next_player_id = 1
        self.logger = self.server.logger_info

    async def start_server(self):
        """Запускает асинхронный TCP-сервер"""
        server = await asyncio.start_server(self._handle_new_connection, self.host, self.port)
        self.logger(f"[ServerManager] Dedicated Server listening on {self.host}:{self.port}")
        return server

    async def _handle_new_connection(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        """Автоматически вызывается asyncio при подключении нового сокета"""
        player_id = self.next_player_id
        self.next_player_id += 1

        client_address = writer.get_extra_info('peername')
        self.logger(f"[ServerManager] Player {player_id} connected from {client_address}")

        player: Player | None = None
        if hasattr(self.server, "on_player_joined"):
            player = self.server.on_player_joined(player_id)

        self.clients[player_id] = (reader, writer)

        try:
            while True:
                header = await reader.readexactly(4)
                payload_size = struct.unpack(">I", header)[0]
                
                raw_data = await reader.readexactly(payload_size)
                packet = json.loads(raw_data.decode('utf-8'))
                
                self._handle_client_action(player, player_id, packet)

        except (asyncio.IncompleteReadError, ConnectionResetError):
            self.logger(f"[ServerManager] Player {player_id} connection reset/closed.")
        except Exception as e:
            self.logger(f"[ServerManager] Error with Player {player_id}: {e}")
        finally:
            self._disconnect_client(player_id, writer)

    def _handle_client_action(self, player: "Player | None", player_id: int, packet: dict):
        """Обработка входящих запросов от клиентов"""
        action = packet.get("action")
        data: dict = packet.get("data", {})
        
        self.logger(f"[ServerManager] Received action '{action}' from Player {player_id}")
        self.logger(f"<Packet: {action}, data: {data}>", level="DEBUG")

        if action == "JOIN":
            client_version = data.get("version")

            if client_version != VERSION:
                self.logger(f"[ServerManager] Rejecting Player {player_id}: Version mismatch (Client: {client_version}, Server: {VERSION})")
                
                self.send_to_player(player_id, "REJECT-CONNECTION", {
                    "reason": f"Version mismatch! Server: {VERSION}, Your client: {client_version}"
                })
                
                if player_id in self.clients:
                    _, writer = self.clients[player_id]
                    asyncio.create_task(self._close_bad_client(player_id, writer))
                return
            player_name = data.get("name", "player-228")
            if player:
                player.name = player_name
            else:
                player = next((x for x in self.server.players if x.player_id == player_id), None)
                if player:
                    player.name = player_name
                else:
                    player = self.server.on_player_joined(player_id)
                    player.name = player_name

            # TODO: if prov.owner is None
            player_prov = random.choice(self.server.provinces)
            player_prov.owner = player
            player.provinces[player_prov.province_id] = player_prov

            self.broadcast("UPDATE-PLAYER-LIST", {
                "players": [
                    {"name": x.name, "id": x.player_id} for x in self.server.players
                ]
            })

            provinces_data: list[dict] = []
            for prov in self.server.provinces:
                provinces_data.append({
                    "id": prov.province_id,
                    "name": prov.name,
                    "vp_value": prov.vp_value,
                    "is_city": prov.is_city,
                    "pos_x": prov.pos_x,
                    "pos_y": prov.pos_y,
                    "owner": prov.owner.player_id if prov.owner else None,
                    "base_resource_type": prov.base_resource_type,
                    "neighbors_ids": [n.province_id for n in prov.neighbors] 
                })
            self.send_to_player(player_id, "INIT-WORLD", {
                "player_id": player_id,
                "seed": self.server.server_config["seed"],
                "provinces": provinces_data,
                "camera-position": (player_prov.pos_x, player_prov.pos_y)
            })

        elif action == "MOVE-TO":
            group_id = data["id_group"]
            id_province_path = data["id_province_path"] 
            
            server_player = self.server.get_player_by_id(player_id)
            if not server_player: 
                return
                
            unit_group = server_player.unit_groups.get(group_id)
            if not unit_group:
                return 
            
            server_path = []
            try:
                for p_id in id_province_path:
                    idx = self.server.provinces.index(p_id)
                    server_path.append(self.server.provinces[idx])
            except ValueError:
                self.logger(f"[Server] Игрок {player_id} прислал невалидный ID провинции в пути!", "WARN")
                return

            if server_path:
                self.server.movement_manager.move_order(unit_group, server_path)


        elif action == "MOVE-STATUS-IDLE":
            group_id = data["id_group"]
            
            server_player = self.server.get_player_by_id(player_id)
            if not server_player: 
                return
                
            unit_group = server_player.unit_groups.get(group_id)
            
            if unit_group:
                self.server.movement_manager.stop_unit(unit_group)


        elif action == "START-CONSTRUCTION":
            building_type = data["building_type"]
            province_id = data["province_id"]

            server_player = self.server.get_player_by_id(player_id)
            
            try:
                prov_idx = self.server.provinces.index(province_id)
                server_province = self.server.provinces[prov_idx]
            except ValueError:
                return 
                
            if server_player and server_province:
                if server_player.can_build(building_type, server_province):
                    server_player.start_construction(building_type, server_province)

        elif action == "TRAIN-UNIT":
            unit_type = data["unit_type"]
            province_id = data["province_id"]
            
            server_player = self.server.get_player_by_id(player_id)
            try:
                prov_idx = self.server.provinces.index(province_id)
                server_province = self.server.provinces[prov_idx]
            except ValueError:
                return
        
            if server_player and server_province:
                if server_player.can_train_unit(unit_type, server_province):
                    server_player.train_unit(unit_type, server_province)
    

    def send_to_player(self, player_id: int, action_type: str, data: dict):
        """Отправляет пакет конкретному игроку"""
        if player_id not in self.clients:
            return
        
        _, writer = self.clients[player_id]
        packet = {"action": action_type, "data": data}
        
        try:
            raw_data = json.dumps(packet).encode('utf-8')
            header = struct.pack(">I", len(raw_data))
            
            writer.write(header + raw_data)
        except Exception as e:
            self.logger(f"[ServerManager] Failed to send data to Player {player_id}: {e}")

    def broadcast(self, action_type: str, data: dict):
        """Отправляет пакет абсолютно ВСЕМ подключенным игрокам"""
        for player_id in list(self.clients.keys()):
            self.send_to_player(player_id, action_type, data)

    def _disconnect_client(self, player_id: int, writer: asyncio.StreamWriter):
        """Очищает данные игрока при дисконнекте"""
        if player_id in self.clients:
            del self.clients[player_id]
            
        asyncio.create_task(self._safe_close_writer(writer, player_id))

        if hasattr(self.server, "on_player_left"):
            self.server.on_player_left(player_id)
        self.logger(f"[ServerManager] Cleaned up data for Player {player_id}")

        self.broadcast("UPDATE-PLAYER-LIST", {
            "players": [
                {"name": x.name, "id": x.player_id} for x in self.server.players
            ]
        })
    
    async def _safe_close_writer(self, writer: asyncio.StreamWriter, player_id: int):
        """Безопасно закрывает writer, игнорируя системные ошибки Windows при обрыве связи"""
        try:
            writer.close()
            await writer.wait_closed()
            self.logger(f"[ServerManager] Cleaned up data and closed connection for Player {player_id}")
        except (ConnectionResetError, OSError) as e:
            self.logger(f"[ServerManager] Connection for Player {player_id} was closed abruptly by remote host.")
        except Exception as e:
            self.logger(f"[ServerManager] Unexpected error while closing Player {player_id} connection: {e}")

    async def _close_bad_client(self, player_id: int, writer: asyncio.StreamWriter):
        """Вспомогательный метод, чтобы дать пакету REJECT уйти в сеть перед киком"""
        try:
            await writer.drain()
        except Exception:
            pass
        self._disconnect_client(player_id, writer)