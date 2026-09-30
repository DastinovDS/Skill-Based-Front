import typing
from rts_core.classes import FIXED_TRAVEL_TIME

if typing.TYPE_CHECKING:
    from rts_core.classes import UnitGroup, Province


class MovementManager:
    def __init__(self, ctx: typing.Any):
        self.ctx = ctx

    def update(self, dt: float) -> None:
        speed_per_second = 1.0 / FIXED_TRAVEL_TIME
        progress_delta = speed_per_second * dt

        for player in self.ctx.players:
            for unit_group in player.unit_groups.values():
                if unit_group.state != "MOVING":
                    continue

                # --- ЛОГИКА УМНОГО СБЛИЖЕНИЯ ---
                # Если у нас есть цель для атаки, проверяем, не пора ли остановиться
                if unit_group.target_unit and not unit_group.target_unit.is_dead():
                    if unit_group.get_distance_to(unit_group.target_unit) <= unit_group.attack_range:
                        unit_group.state = "IDLE"
                        # Очищаем путь, чтобы юнит не дергался дальше после убийства цели
                        unit_group.path = []
                        unit_group.target_province = None
                        continue
                # -------------------------------

                if unit_group.target_province is None:
                    unit_group.state = "IDLE"
                    continue

                unit_group.move_progress += progress_delta

                if unit_group.move_progress >= 1.0:
                    self._execute_move_step(unit_group)

    def stop_unit(self, unit_group: "UnitGroup") -> None:
        """
        Halts the unit group's movement without clearing its current path or progress.
        """
        unit_group.state = "IDLE"

    def move_order(self, unit_group: "UnitGroup", new_path: list["Province"], priority_target: "typing.Optional[UnitGroup]" = None) -> None:
        """
        Processes a new movement command and handles target assignment.
        """
        if not new_path:
            return

        # Если первая точка пути - текущая провинция, убираем её
        if new_path[0] == unit_group.current_province:
            new_path.pop(0)

        if not new_path:
            unit_group.state = "IDLE"
            return

        # ОБНОВЛЕНИЕ ЦЕЛЕЙ
        unit_group.active_target = None  # Прекращаем текущий обстрел
        unit_group.target_unit = priority_target # Устанавливаем (или сбрасываем в None) цель

        next_target = new_path[0]
        current_target = unit_group.target_province

        if unit_group.move_progress > 0 and current_target is not None:
            if next_target == current_target:
                unit_group.path = new_path[1:]
                unit_group.state = "MOVING"
                return

            if next_target == unit_group.origin_province:
                unit_group.origin_province, unit_group.target_province = (
                    unit_group.target_province,
                    unit_group.origin_province,
                )
                unit_group.current_province = unit_group.target_province # type: ignore
                
                unit_group.move_progress = max(0.0, 1.0 - unit_group.move_progress)
                unit_group.path = new_path[1:]
                unit_group.state = "MOVING"
                return
            
            unit_group.pos_x = unit_group.current_province.pos_x
            unit_group.pos_y = unit_group.current_province.pos_y

        unit_group.move_progress = 0.0
        unit_group.origin_province = unit_group.current_province
        unit_group.target_province = next_target
        unit_group.path = new_path[1:]
        unit_group.state = "MOVING"

        if unit_group not in unit_group.current_province.units:
            unit_group.current_province.units.append(unit_group)

    def _execute_move_step(self, unit_group: "UnitGroup") -> None:
        """
        Completes a single leg of movement, updating province occupancy
        and queuing the next destination in the path.
        """
        destination = unit_group.target_province

        if destination is None:
            unit_group.state = "IDLE"
            return

        self.ctx.logger_manager.record_movement_arrival(unit_group, destination)

        if unit_group.current_province and unit_group in unit_group.current_province.units:
            unit_group.current_province.units.remove(unit_group)
            
        if unit_group.origin_province and unit_group in unit_group.origin_province.units:
            unit_group.origin_province.units.remove(unit_group)

        unit_group.current_province = destination
        
        if unit_group not in destination.units:
            destination.units.append(unit_group)

        has_enemies = any(u.owner != unit_group.owner for u in destination.units)
        
        if not has_enemies and destination.owner != unit_group.owner:
            old_owner = destination.owner
            new_owner = unit_group.owner

            destination.owner = new_owner

            if old_owner and destination.province_id in old_owner.provinces:
                del old_owner.provinces[destination.province_id]
            
            new_owner.provinces[destination.province_id] = destination

            for b_type, building in destination.buildings.items():
                building.owner = new_owner.player_id
                building.status = 'Active'

        unit_group.move_progress = 0.0
        unit_group.origin_province = destination

        unit_group.pos_x = destination.pos_x
        unit_group.pos_y = destination.pos_y

        if unit_group.path:
            unit_group.target_province = unit_group.path.pop(0)
        else:
            unit_group.target_province = None
            unit_group.origin_province = None
            unit_group.state = "IDLE"