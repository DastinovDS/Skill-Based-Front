import typing

if typing.TYPE_CHECKING:
    from rts_server import Server


class ServerSyncManager:
    def __init__(self, server_ctx: "Server"):
        self.server = server_ctx
        self.net = server_ctx.network_manager

    
    def sync_all(self):
        self.sync_resources()
        self.sync_units()
        self.sync_buildings_and_provinces()
        self.sync_queues()

    def sync_resources(self):
        for player in self.server.players:
            self.net.send_to_player(player.player_id, "SYNC_RESOURCES", {
                "player_id": player.player_id,
                "resources": player.resources
            })

    def sync_units(self):
        units_data = {}
        for player in self.server.players:
            for u_id, unit in player.unit_groups.items():
                global_key = f"{player.player_id}_{u_id}"

                units_data[global_key] = {
                    "unit_type": unit.unit_type,
                    "count": unit.count,
                    "province_id": unit.current_province.province_id,
                    "origin_province_id": unit.origin_province.province_id if unit.origin_province else None,
                    "target_province_id": unit.target_province.province_id if unit.target_province else None,
                    "move_progress": unit.move_progress,
                    "active_target_id": unit.active_target.group_id if unit.active_target else None,
                    "active_target_owner": unit.active_target.owner.player_id if unit.active_target else None,
                    "x": unit.current_pos[0],
                    "y": unit.current_pos[1],
                    "state": unit.state,
                    "hp": unit.current_health,
                }
        self.net.broadcast("SYNC_UNITS", {"units": units_data})

    def sync_buildings_and_provinces(self):
        buildings_data = {}
        users_province: dict[int, list] = {}

        for province in self.server.provinces:
            if province.buildings:
                buildings_data[province.province_id] = {
                    b_type: {
                        "building_id": b_obj.building_id,
                        "owner_id": b_obj.owner if isinstance(b_obj.owner, int) else (b_obj.owner.player_id if b_obj.owner else 0),
                        "construction_time": b_obj.construction_time,
                        "production": b_obj.production,
                        "status": b_obj.status
                    } for b_type, b_obj in province.buildings.items()
                }
            if province.owner:
                player_id = province.owner.player_id
                users_province.setdefault(player_id, [])
                if province.province_id not in users_province[player_id]:
                    users_province[player_id].append(province.province_id)
                    
        self.net.broadcast("SYNC_BUILDINGS", {"buildings": buildings_data})
        self.net.broadcast("SYNC_PROVINCES", {"users_provinces": users_province})

    def sync_queues(self):
        queues_data = {}
        for p in self.server.players:
            queues_data[p.player_id] = {
                "building_queue": [
                    {
                        "building_type": task["building_type"],
                        "province_id": task["province"].province_id,
                        "time_left": task["time_left"]
                    } for task in p.building_queue
                ],
                "training_queue": [
                    {
                        "unit_type": task["unit_type"],
                        "province_id": task["province"].province_id,
                        "time_left": task["time_left"]
                    } for task in p.training_queue
                ]
            }
        self.net.broadcast("SYNC_QUEUES", {"queues": queues_data})
