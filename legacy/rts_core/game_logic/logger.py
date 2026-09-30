import json
import os
import typing

LOG_BASE_DIR = "logs/game_session"
LOG_PATHS = {
    "COMBAT": os.path.join(LOG_BASE_DIR, "combat.jsonl"),
    "ECONOMY": os.path.join(LOG_BASE_DIR, "economy.jsonl"),
    "UNITS": os.path.join(LOG_BASE_DIR, "units.jsonl"),
    "MOVEMENT": os.path.join(LOG_BASE_DIR, "moves.jsonl"),
    "SYSTEM": os.path.join(LOG_BASE_DIR, "system.jsonl")
}

class LoggerManager:
    def __init__(self, ctx: typing.Any) -> None:
        self.ctx = ctx

    def record_event(self, data: dict, category: str) -> None:
        time = round(self.ctx.game_time, 3) if hasattr(self.ctx, "game_time") else "Not include!"
        data["game_time"] = time
        data["category"] = category
        self.ctx.pending_logs.append(data)

    def flush_logs(self) -> None:
        if not self.ctx.pending_logs:
            return

        os.makedirs(LOG_BASE_DIR, exist_ok=True)

        logs_by_cat = {}
        for log in self.ctx.pending_logs:
            cat = log.get("category", "SYSTEM")
            logs_by_cat.setdefault(cat, []).append(log)

        try:
            for cat, messages in logs_by_cat.items():
                file_path = LOG_PATHS.get(cat, LOG_PATHS["SYSTEM"])
                with open(file_path, 'a', encoding='utf-8') as f:
                    for msg in messages:
                        f.write(json.dumps(msg) + '\n')

            self.ctx.pending_logs.clear()
        except IOError as e:
            print(f"Logger Error: {e}")

    def record_combat_event(self, attacker, defender, damage, units_lost, attack_type):
        log_data = {
            "event": "HIT",
            "atk_id": attacker.owner.player_id,
            "def_id": defender.owner.player_id,
            "dmg": damage,
            "lost": units_lost,
            "atk_hp": attacker.current_health,
            "def_hp": defender.current_health,
            "combat_type": attack_type,
        }
        self.record_event(log_data, category="COMBAT")

    def record_combat_outcome(self, province, combat_flag):
        if combat_flag:
            log_data = {
                "event": "OUTCOME",
                "prov": province.name,
                "winner": province.units[0].owner.player_id if province.units else 0
            }
            self.record_event(log_data, category="COMBAT")

    def record_movement_start(self, unit_group, destination) -> None:
        log_data = {
            "event": "MOVE_START",
            "unit_id": unit_group.group_id,
            "from": unit_group.current_province.name,
            "to": destination.name
        }
        self.record_event(log_data, category="MOVEMENT")

    def record_movement_arrival(self, unit_group, province) -> None:
        log_data = {
            "event": "ARRIVED",
            "unit_id": unit_group.group_id,
            "province": province.name
        }
        self.record_event(log_data, category="MOVEMENT")

    def record_system(self, *message, level = "INFO", **kwargs) -> None:
        log_data = {
            "event": f"Logger",
            "message": " ".join([str(x) for x in message]),
            "level": level, **kwargs
        }
        self.record_event(log_data, category="SYSTEM")