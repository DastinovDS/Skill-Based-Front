import typing

from rts_core.classes.core_classes import Building, UnitGroup, Player

class TaskManager:
    def __init__(self, ctx: typing.Any):
        self.ctx = ctx
        self._log_timer = 0.0

    def update(self, dt: float) -> None:
        """
        This function updates all task queues
        :param dt: delta time
        :return: None
        """
        for player in self.ctx.players:
            for task in player.building_queue[:]:
                task["time_left"] -= dt
                if task["time_left"] <= 0:
                    self._complete_building(player, task)
                    player.building_queue.remove(task)

            for task in player.training_queue[:]:
                task["time_left"] -= dt
                if task["time_left"] <= 0:
                    self._complete_unit(player, task)
                    player.training_queue.remove(task)

        self._log_timer += dt
        if self._log_timer >= 2.0:
            self.ctx.logger_manager.flush_logs()
            self._log_timer = 0.0

    def _complete_building(self, player: "Player", task: dict) -> None:
        """
        This function creates a building after timer expires
        :param player: player, who creates building
        :param task: current task to complete
        :return: None
        """
        prov = task["province"]
        defn = task["definition"]
        b_type = task["building_type"]

        new_id = len(player.buildings) + 1
        building = Building(
            owner=player.player_id,
            building_type=b_type,
            province=prov,
            construction_time=defn["construction_time"],
            building_id=new_id,
            production=defn.get("production", {})
        )

        building.status = 'Active'
        player.buildings[new_id] = building
        prov.buildings[b_type] = building

        self.ctx.logger_manager.record_event({
            "type": "BUILDING_COMPLETE",
            "player": player.player_id,
            "building": b_type,
            "province": prov.name
        }, category="ECONOMY")

        print(f"Building created: {b_type} in {prov.name}")

    def _complete_unit(self, player: "Player", task: dict) -> None:
        """
        This function creates a unit after timer expires
        :param player: player, who trains unit
        :param task: current task to complete
        :return: None
        """
        prov = task["province"]
        defn = task["definition"]
        unit_type = task["unit_type"]

        if not hasattr(player, 'next_group_id'):
            player.next_group_id = 1 # type: ignore

        new_id = player.next_group_id # type: ignore
        player.next_group_id += 1 # type: ignore

        new_id = len(player.unit_groups) + 1
        unit = UnitGroup(
            owner=player,
            current_province=prov,
            unit_type=unit_type,
            count=1,
            group_id=new_id,
            upkeep=defn["upkeep"],
            attack_damage=defn["attack_damage"],
            max_health=defn["max_health"],
            armor=defn["armor"],
            attack_cooldown=defn["attack_cooldown"],
            training_time=defn["training_time"],
            pos_x = prov.pos_x,
            pos_y = prov.pos_y,
        )
        unit.attack_range = defn["attack_range"]
        unit.combat_stance = defn["combat_stance"]

        player.unit_groups[new_id] = unit
        prov.units.append(unit)

        self.ctx.logger_manager.record_event({
            "type": "UNIT_TRAINED",
            "player": player.player_id,
            "unit": unit_type,
            "province": prov.name
        }, category="UNITS")

        print(f"Unit trained: {unit_type} in {prov.name}")