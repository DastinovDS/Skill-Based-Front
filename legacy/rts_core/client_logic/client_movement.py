
import typing 

if typing.TYPE_CHECKING:
    from rts_client import Game

from rts_core.classes import Province
from rts_core.classes.core_classes import UnitGroup
from rts_core.game_logic import MovementManager

class ClientMovementManager(MovementManager):
    ctx: "Game"
    def __init__(self, ctx):
        super().__init__(ctx)

    def update(self, dt: float) -> None:
        """
        Переопределяем update на клиенте.
        Вместо сурового просчета путей синглплеера, мы плавно притягиваем 
        координаты юнитов к серверным буферам.
        """
        for player in self.ctx.players:
            for unit in player.unit_groups.values():
                if unit.state == "MOVING" and unit.target_province is None:
                     continue
                     
                if unit.state == "MOVING" and unit.move_progress < 1.0:
                    travel_time = 2.0 
                    unit.move_progress += dt / travel_time
                    
                    if unit.move_progress > 1.0:
                        unit.move_progress = 1.0
                        self._execute_move_step(unit)

    def _execute_move_step(self, unit_group: "UnitGroup") -> None:
        destination = unit_group.target_province

        if destination is None:
            unit_group.state = "IDLE"
            return
        
        for province in self.ctx.provinces:
            if unit_group in province.units:
                province.units.remove(unit_group)

        unit_group.current_province = destination
        
        if unit_group not in destination.units:
            destination.units.append(unit_group)

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

    def move_order(self, unit_group: UnitGroup, new_path: list[Province], priority_target: typing.Optional[UnitGroup] = None) -> None:
        self.ctx.client_send_action("MOVE-TO", {
            "id_group": unit_group.group_id,
            "id_province_path": [x.province_id for x in new_path]
        })

        return super().move_order(unit_group, new_path, priority_target)
    
    def stop_unit(self, unit_group: UnitGroup) -> None:
        self.ctx.client_send_action("MOVE-STATUS-IDLE", {
            "id_group": unit_group.group_id
        })

        return super().stop_unit(unit_group)