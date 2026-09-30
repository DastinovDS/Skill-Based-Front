import typing

from main import VERSION

if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.classes.core_classes import Player, Province

from rts_core.classes.core_classes import Building
from rts_core.classes.core_classes import UnitGroup

from rts_core.data.units_data import UNIT_DEFINITIONS as UD
from rts_core.data.buildings_data import BUILDING_DEFINITIONS as BD

import socket
import json
import struct
import threading
import queue

class ClientManager:
    def __init__(self, game: "Game", host: str, port: int) -> None:
        self.game = game
        
        self.host = host
        self.port = port

        self.logger = self.game.logger_info

        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.is_connected = False

        self.packet_queue = queue.Queue()
        self.network_thread = None

    def connect(self) -> bool:
        try:
            self.socket.connect((self.host, self.port))
            self.is_connected = True
            self.logger(f"[ClientManager] Connected to server {self.host}:{self.port}")
            
            self.network_thread = threading.Thread(target=self._background_recv_loop, daemon=True)
            self.network_thread.start()
            
            self.send_action("JOIN", {
                "name": self.game.me.name,
                "version": VERSION
            })

            return True
        except Exception as e:
            self.logger(f"[ClientManager] Connection failed: {e}")
            self.is_connected = False
            return False
        
    def _disconnect(self) -> None:
        self.game.ui.reset_context()
        self.disconnect()

    def disconnect(self) -> None:
        self.is_connected = False
        if self.socket:
            self.socket.close()
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        
    
    def _background_recv_loop(self):
        """ЭТОТ МЕТОД РАБОТАЕТ В ОТДЕЛЬНОМ ПОТОКЕ. Только слушает сеть."""
        buffer = b""
        try:
            while self.is_connected:
                chunk = self.socket.recv(4096)
                if not chunk:
                    self.logger("[ClientManager] Server closed connection.")
                    self._disconnect()
                    break
                
                buffer += chunk
                
                while len(buffer) >= 4:
                    payload_size = struct.unpack(">I", buffer[:4])[0]
                    if len(buffer) < 4 + payload_size:
                        break
                        
                    packet_data = buffer[4:4+payload_size]
                    buffer = buffer[4+payload_size:]
                    
                    packet = json.loads(packet_data.decode('utf-8'))
                    
                    self.packet_queue.put(packet)
                    
        except Exception as e:
            self.logger(f"[ClientManager] Network thread error: {e}")
            self.is_connected = False

    def update_network(self):
        """
        ВЫЗЫВАЕТСЯ В ОСНОВНОМ ПОТОКЕ PYGAME (каждый кадр).
        Разбирает накопившиеся в очереди пакеты и безопасно меняет состояние игры.
        """
        if not self.is_connected: return

        while not self.packet_queue.empty():
            try:
                packet = self.packet_queue.get_nowait()
                self._dispatch_packet(packet)
                self.packet_queue.task_done()
            except queue.Empty:
                break

    def _dispatch_packet(self, packet: dict):
        """Здесь мы находимся в безопасности основного потока, можно менять данные игры"""
        action = packet.get("action")
        data: dict = packet.get("data", {})
        if action == "SYNC_RESOURCES":
            player_id = data["player_id"]
            server_resources = data["resources"]
            
            for player in self.game.players:
                if player.player_id == player_id:
                    player.resources = server_resources
                    break

        elif action == "REJECT-CONNECTION":
            reason = data.get("reason", "Unknown error")
            self.logger(f"\n[CRITICAL] Connection rejected by server! Reason: {reason}\n")
            self.disconnect()
            self.game.ui.reset_context()

        elif action == "UPDATE-PLAYER-LIST":
            server_players = data.get("players", [])
            server_ids = {int(x["id"]) for x in server_players}
            
            current_me = self.game.me
            
            self.game.players = [
                p for p in self.game.players 
                if p.player_id in server_ids or p.player_id == current_me.player_id
            ]
            
            for s_player in server_players:
                p_id = int(s_player["id"])
                p_name = s_player.get("name", "Noname")
                
                existing_player = next((p for p in self.game.players if p.player_id == p_id), None)
                
                if existing_player:
                    existing_player.name = p_name
                else:
                    new_player = Player(player_id=p_id, name=p_name)
                    self.game.players.append(new_player)
                    
            me_found = False
            for p in self.game.players:
                if p.player_id == current_me.player_id:
                    self.game.me = p
                    me_found = True
                    break
            
            if not me_found:
                self.game.players.append(current_me)
                self.game.me = current_me

        elif action == "INIT-WORLD":
            server_seed = data.get("seed", 12345)
            server_provs = data.get("provinces", [])
            
            cam_pos = data.get("camera-position", (0,0))
            self.game.camera.set_position(*cam_pos)
            self.game.camera.zoom = 1.0
            
            my_assigned_id = int(data.get("player_id", -1))
            self.logger(f"[Client] Server assigned us ID: {my_assigned_id}")
            
            server_spawned_me = next((p for p in self.game.players if p.player_id == my_assigned_id), None)
            
            if server_spawned_me and server_spawned_me != self.game.me:
                if self.game.me in self.game.players:
                    self.game.players.remove(self.game.me)
                self.game.me = server_spawned_me
            else:
                self.game.me.player_id = my_assigned_id

            local_provinces_dict = {}
            temp_neighbors_map = {}
            
            users = {x.player_id: x for x in self.game.players}
            
            for p_data in server_provs:
                p_id = p_data["id"]
                
                prov = Province(
                    name=p_data["name"],
                    id=p_id,
                    vp_value=p_data["vp_value"],
                    pos_x=p_data["pos_x"],
                    pos_y=p_data["pos_y"],
                    base_resource_type=p_data["base_resource_type"],
                    is_city=p_data["is_city"]
                )
                if p_data["owner"] and int(p_data["owner"]) in users:
                    prov.owner = users.get(int(p_data["owner"]))
                
                local_provinces_dict[p_id] = prov
                temp_neighbors_map[p_id] = p_data["neighbors_ids"]
            
            for p_id, prov in local_provinces_dict.items():
                neighbor_ids = temp_neighbors_map[p_id]
                for n_id in neighbor_ids:
                    if n_id in local_provinces_dict:
                        prov.neighbors.append(local_provinces_dict[n_id])
            
            self.game.provinces = list(local_provinces_dict.values())
            self.logger(f"[Client] Successfully assembled {len(self.game.provinces)} provinces with neighbors!")

            from rts_core.game_logic.World.MapGenerator import MapGenerator
            from rts_core.system.ChunkManager import ChunkManager
            
            self.game.world_manager = MapGenerator(
                provinces=self.game.provinces, 
                seed=server_seed
            )
            self.game.chunk_manager = ChunkManager(self.game.world_manager)
            
            self.logger("[Client] Procedural World Successfully Synthesized from Server Seed!")

        elif action == "SYNC_BUILDINGS":
            buildings_data = data["buildings"]

            for prov_id_str, s_buildings in buildings_data.items():
                prov_id = int(prov_id_str)
                try:
                    prov_idx = self.game.provinces.index(prov_id) # type: ignore
                    local_province = self.game.provinces[prov_idx]
                except ValueError:
                    continue

                for b_type, b_info in s_buildings.items():
                    if b_type not in local_province.buildings:
                        new_building = Building(
                            owner=b_info["owner_id"],
                            building_type=b_type,
                            province=local_province,
                            construction_time=b_info["construction_time"],
                            building_id=b_info["building_id"],
                            production=b_info["production"]
                        )
                        new_building.status = b_info["status"]
                        
                        local_province.buildings[b_type] = new_building
                        
                        player = self.game.get_player_by_id(b_info["owner_id"])
                        if player:
                            player.buildings[b_info["building_id"]] = new_building
                            
                        self.logger(f"[Client] Новое здание {b_type} успешно воссоздано в {local_province.name}")
                    else:
                        local_province.buildings[b_type].status = b_info["status"]

        elif action == "SYNC_UNITS":
            
            units_data = data["units"]
            alive_server_units = set()

            active_global_keys = set(data["units"].keys())

            for player in self.game.players:
                for group_id in list(player.unit_groups.keys()):
                    global_key = f"{player.player_id}_{group_id}"
                    
                    if global_key not in active_global_keys:
                        unit_to_remove = player.unit_groups[group_id]
                        
                        if unit_to_remove.current_province:
                            if unit_to_remove in unit_to_remove.current_province.units:
                                unit_to_remove.current_province.units.remove(unit_to_remove)
                                
                        del player.unit_groups[group_id]
                        self.logger(f"[Client] Removed ghost unit {global_key}")

            for global_key, s_unit in units_data.items():
                p_id, u_id = map(int, global_key.split("_"))
                player = self.game.get_player_by_id(p_id)
                alive_server_units.add(global_key)

                if not player: continue

                def find_prov(p_id_target):
                    if p_id_target is None: return None
                    try:
                        idx = self.game.provinces.index(p_id_target)
                        return self.game.provinces[idx]
                    except ValueError:
                        return None

                server_province = find_prov(s_unit["province_id"])

                if u_id in player.unit_groups:
                    local_unit = player.unit_groups[u_id]

                    for prov in self.game.provinces:
                        if local_unit in prov.units:
                            prov.units.remove(local_unit)

                    local_unit.current_province = find_prov(s_unit["province_id"]) # type: ignore
                    local_unit.origin_province = find_prov(s_unit["origin_province_id"]) # type: ignore
                    local_unit.target_province = find_prov(s_unit["target_province_id"])

                    if server_province and local_unit not in server_province.units:
                        server_province.units.append(local_unit)

                    local_unit.move_progress = s_unit["move_progress"]

                    local_unit.state = s_unit["state"]
                    local_unit.current_health = s_unit["hp"]
                    local_unit.count = s_unit["count"]
                    if s_unit["target_province_id"] is not None:
                        try:
                            idx = self.game.provinces.index(s_unit["target_province_id"])
                            local_unit.target_province = self.game.provinces[idx]
                        except ValueError:
                            local_unit.target_province = None
                    else:
                        local_unit.target_province = None

                    t_id = s_unit.get("active_target_id")
                    t_owner_id = s_unit.get("active_target_owner")
                    if t_id is not None and t_owner_id is not None:
                        enemy_player = self.game.get_player_by_id(t_owner_id)
                        local_unit.active_target = enemy_player.unit_groups.get(t_id) if enemy_player else None
                    else:
                        local_unit.active_target = None

                else:
                    prov_idx = self.game.provinces.index(s_unit["province_id"])
                    local_province = self.game.provinces[prov_idx]
                    
                    defn = UD[s_unit["unit_type"]]
                    
                    new_unit = UnitGroup(
                        owner=player,
                        current_province=local_province,
                        unit_type=s_unit["unit_type"],
                        count=s_unit["count"],
                        group_id=u_id,
                        upkeep=defn["upkeep"],
                        attack_damage=defn["attack_damage"],
                        max_health=defn["max_health"],
                        armor=defn["armor"],
                        attack_cooldown=defn["attack_cooldown"],
                        training_time=defn["training_time"],
                        pos_x=s_unit["x"],
                        pos_y=s_unit["y"]
                    )

                    new_unit.attack_range = defn["attack_range"]
                    new_unit.combat_stance = defn["combat_stance"]
                    new_unit.current_health = s_unit["hp"]
                    new_unit.state = s_unit["state"]
                    new_unit.target_unit = None 
                    new_unit.path = []

                    new_unit.origin_province = find_prov(s_unit["origin_province_id"]) # type: ignore
                    new_unit.target_province = find_prov(s_unit["target_province_id"])
                    new_unit.move_progress = s_unit["move_progress"]

                    new_unit.active_target = None

                    player.unit_groups[u_id] = new_unit
                    local_province.units.append(new_unit)


            for player in self.game.players:
                for u_id in list(player.unit_groups.keys()):
                    global_key = f"{player.player_id}_{u_id}"
                    
                    if global_key not in alive_server_units:
                        dead_unit = player.unit_groups[u_id]
                        
                        if dead_unit.current_province and dead_unit in dead_unit.current_province.units:
                            dead_unit.current_province.units.remove(dead_unit)
                            
                        del player.unit_groups[u_id]
                        self.logger(f"[Client] Юнит {u_id} игрока {player.player_id} погиб в бою.")


        elif action == "SYNC_PROVINCES":
            provinces: dict[int, list[int]] = data["users_provinces"]
            
            for owner_id_str, province_ids in provinces.items():
                owner_id = int(owner_id_str)
                player = self.game.get_player_by_id(owner_id)
                if not player: 
                    continue
                
                for province_id in province_ids:
                    try:
                        idx = self.game.provinces.index(province_id) # type: ignore
                        prov: Province = self.game.provinces[idx]
                    except ValueError:
                        continue 
                    
                    if prov.owner is not None and prov.owner != player:
                        prov.owner.provinces.pop(province_id, None)
                    
                    prov.owner = player
                    player.provinces[province_id] = prov     

        elif action == "SYNC_QUEUES":
            queues_data = data["queues"]
            
            for p_id_str, p_queues in queues_data.items():
                player = self.game.get_player_by_id(int(p_id_str))
                if not player: continue
                
                new_building_queue = []
                for s_task in p_queues["building_queue"]:
                    prov_idx = self.game.provinces.index(s_task["province_id"])
                    local_prov = self.game.provinces[prov_idx]
                    
                    defn = BD[s_task["building_type"]]
                    
                    new_building_queue.append({
                        "building_type": s_task["building_type"],
                        "province": local_prov,
                        "time_left": s_task["time_left"],
                        "definition": defn
                    })
                player.building_queue = new_building_queue

                new_training_queue = []
                for s_task in p_queues["training_queue"]:
                    prov_idx = self.game.provinces.index(s_task["province_id"])
                    local_prov = self.game.provinces[prov_idx]
                    
                    defn = UD[s_task["unit_type"]]
                    
                    new_training_queue.append({
                        "unit_type": s_task["unit_type"],
                        "province": local_prov,
                        "time_left": s_task["time_left"],
                        "definition": defn
                    })
                player.training_queue = new_training_queue

    def send_action(self, action_type: str, data: dict):
        if not self.is_connected: return
        packet = {"action": action_type, "data": data}
        try:
            raw_data = json.dumps(packet).encode('utf-8')
            header = struct.pack(">I", len(raw_data))
            self.socket.sendall(header + raw_data)
        except Exception as e:
            self.logger(f"[ClientManager] Send error: {e}")
            self.is_connected = False