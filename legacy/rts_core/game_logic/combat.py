import math
import typing

from rts_core.classes import UnitGroup, Province, Player


class CombatManager:
    def __init__(self, ctx: typing.Any):
        self.ctx = ctx
        self._dead_pool: list[UnitGroup] = []

    def update(self, dt: float) -> None:
        """
        Updates cooldown timer for all unit groups applying delta time
        and resolves combat in all provinces.
        """
        self._update_cooldowns(dt)

        # Сначала разрешаем ближний бой, чтобы выставить статус COMBAT
        for province in self.ctx.provinces:
            self.resolve_province_combat(province)

        self._resolve_road_skirmishes()

        # Теперь дальний бой увидит, что юнит в состоянии COMBAT, и не даст стрелять
        self._resolve_ranged_skirmishes()

        self._flush_dead_pool()

    def _update_cooldowns(self, dt: float) -> None:
        """
        Updates cooldown timer for all unit groups applying delta time.
        :param dt: delta time
        :return: None
        """
        for player in self.ctx.players:
            for unit_group in list(player.unit_groups.values()):
                if unit_group.cooldown_timer > 0:
                    unit_group.cooldown_timer = max(0, unit_group.cooldown_timer - dt)

    def _remove_dead_unit(self, group: UnitGroup, player: Player, province: Province) -> None:
        """
        This function removes dead unit group from province/player structures.
        :param group: unit group to be deleted
        :param player: player owner of the unit
        :param province: province where the unit is located
        :return: None
        """
        if group in province.units:
            province.units.remove(group)
        if group.group_id in player.unit_groups:
            del player.unit_groups[group.group_id]

    def _resolve_province_control(self, player_winner: Player, player_looser: Player, province: Province) -> None:
        """
        This function resolves province combat and gives control to the winning side.
        All buildings belonging to the loser in this province will be destroyed.
        :param player_winner: player who won the combat
        :param player_looser: player who lost the combat
        :param province: province where the combat occurred
        :return: None
        """
        if province.province_id in player_looser.provinces:
            del player_looser.provinces[province.province_id]

        for b_type, building in list(province.buildings.items()):
            if building.owner == player_looser.player_id:
                if building.building_id in player_looser.buildings:
                    del player_looser.buildings[building.building_id]
                del province.buildings[b_type]

        province.owner = player_winner
        player_winner.provinces[province.province_id] = province

    def _engage_in_combat(self, unit_group: "UnitGroup", other_group: "UnitGroup") -> bool:
        """
        This function describes combat damage dealing and makes logs per battle round.
        :param unit_group: unit group that is attacking
        :param other_group: unit group that is defending
        :return: bool (True if damage was dealt)
        """
        if unit_group.cooldown_timer <= 0 and other_group.count > 0:
            total_damage = unit_group.attack_damage_base * unit_group.count
            damage_reduction = other_group.armor * other_group.count

            effective_damage = max(0, total_damage - damage_reduction)
            other_group.current_health = max(0, other_group.current_health - effective_damage)

            if other_group.count == 1:
                new_count = 1 if other_group.current_health > 0 else 0
            else:
                new_count = math.ceil(other_group.current_health / other_group.max_health_base)

            units_lost = other_group.count - new_count
            other_group.count = new_count

            unit_group.cooldown_timer = unit_group.attack_cooldown

            self.ctx.logger_manager.record_combat_event(unit_group, other_group, effective_damage, units_lost, "CLOSE")

            if other_group.count <= 0:
                other_group.current_health = 0

            return True
        return False

    def resolve_province_combat(self, province: Province) -> None:
        """
        This function resolves province combat and gives control to the winning side.
        :param province: province where the combat occurred
        :return: None
        """
        unique_owners = {u.owner for u in province.units}
        combat_occurred_in_tick = False

        if len(unique_owners) >= 2:
            group_a = province.units[0]
            group_b = next((u for u in province.units if u.owner != group_a.owner), None)

            if group_b:
                # ПЕРЕВОДИМ ЮНИТОВ В СОСТОЯНИЕ БОЯ
                group_a.state = "COMBAT"
                group_b.state = "COMBAT"

                if self._engage_in_combat(group_a, group_b):
                    combat_occurred_in_tick = True

                if not group_b.is_dead():
                    if self._engage_in_combat(group_b, group_a):
                        combat_occurred_in_tick = True

                if group_a.is_dead():
                    self._dead_pool.append(group_a)
                if group_b.is_dead():
                    self._dead_pool.append(group_b)

        remaining_owners = {u.owner for u in province.units if not u.is_dead()}

        # ЕСЛИ БОЙ ОКОНЧЕН, ВОЗВРАЩАЕМ В IDLE
        if len(remaining_owners) <= 1:
            for unit in province.units:
                if not unit.is_dead() and unit.state == "COMBAT":
                    unit.state = "IDLE"

        if len(remaining_owners) == 1:
            winner_player = list(remaining_owners)[0]

            if province.owner != winner_player:
                if province.owner is not None:
                    self._resolve_province_control(winner_player, province.owner, province)
                    self.ctx.logger_manager.record_combat_outcome(province, combat_occurred_in_tick)
                else:
                    province.owner = winner_player
                    winner_player.provinces[province.province_id] = province

            elif combat_occurred_in_tick and len(unique_owners) >= 2:
                self.ctx.logger_manager.record_combat_outcome(province, combat_occurred_in_tick)

    def _resolve_road_skirmishes(self) -> None:
        """
        This function resolves road skirmishes
        :return: None
        """
        movers = []
        for p in self.ctx.players:
            for u in p.unit_groups.values():
                if u.target_province is not None and not u.is_dead():
                    movers.append(u)

        for i in range(len(movers)):
            u1 = movers[i]
            for j in range(i + 1, len(movers)):
                u2 = movers[j]

                if u1.owner == u2.owner or u1.is_dead() or u2.is_dead():
                    continue

                is_same_road = (u1.origin_province == u2.target_province and
                                u1.target_province == u2.origin_province)

                if is_same_road:
                    if (u1.move_progress + u2.move_progress) >= 1.0:
                        self._start_interception_battle(u1, u2)

    def _start_interception_battle(self, u1: UnitGroup, u2: UnitGroup) -> None:
        """
        This function starts the interception battle if two unit groups are in the same position
        :param u1: unit group 1
        :param u2: unit group 2
        :return: None
        """
        u1.state = "COMBAT"
        u2.state = "COMBAT"

        self._engage_in_combat(u1, u2)
        if not u2.is_dead():
            self._engage_in_combat(u2, u1)

        if u1.is_dead():
            self._dead_pool.append(u1)
        elif not self._has_enemies_on_road(u1):
            u1.state = "MOVING"

        if u2.is_dead():
            self._dead_pool.append(u2)
        elif not self._has_enemies_on_road(u2):
            u2.state = "MOVING"

    def _has_enemies_on_road(self, unit: UnitGroup) -> bool:
        """
        This function checks if the enemies on the road are on the road.
        :param unit: unit group, that make a move.
        :return: bool
        """
        for p in self.ctx.players:
            if p == unit.owner: continue
            for other in p.unit_groups.values():
                if (other.origin_province == unit.target_province and
                        other.target_province == unit.origin_province and
                        not other.is_dead()):
                    return True
        return False

    def _flush_dead_pool(self) -> None:
        """
        This function removes dead units from the pool
        :return: None
        """
        for unit in set(self._dead_pool):
            self._remove_dead_unit(unit, unit.owner, unit.current_province)
        self._dead_pool.clear()

    def _perform_ranged_attack(self, attacker: "UnitGroup", target: "UnitGroup") -> None:
        """
        Executes a one-way ranged attack if the cooldown allows.
        """
        if attacker.cooldown_timer <= 0 and not target.is_dead():
            total_damage = attacker.attack_damage_base * attacker.count
            damage_reduction = target.armor * target.count
            effective_damage = max(0, total_damage - damage_reduction)

            target.current_health = max(0, target.current_health - effective_damage)

            new_count = math.ceil(target.current_health / target.max_health_base) if target.current_health > 0 else 0
            units_lost = target.count - new_count
            target.count = new_count

            attacker.cooldown_timer = attacker.attack_cooldown
            self.ctx.logger_manager.record_combat_event(attacker, target, effective_damage, units_lost, "RANGED")

            if target.is_dead():
                self._dead_pool.append(target)

    def _find_best_target(self, attacker: "UnitGroup") -> "UnitGroup | None":
        """
        Scans for the best target within range.
        Priority: Closest target, then Lowest Health.
        """
        best_target = None
        min_dist = attacker.attack_range

        # Чтобы не сканировать всю карту, проверяем только юнитов других игроков
        for player in self.ctx.players:
            if player == attacker.owner:
                continue

            for enemy in player.unit_groups.values():
                if enemy.is_dead():
                    continue

                dist = attacker.get_distance_to(enemy)
                if dist <= attacker.attack_range:
                    # Логика выбора: самый близкий
                    if dist < min_dist:
                        min_dist = dist
                        best_target = enemy
                    # Если дистанция почти одинаковая, выбираем самого слабого
                    elif best_target and abs(dist - min_dist) < 1.0:
                        if enemy.current_health < best_target.current_health:
                            best_target = enemy

        return best_target

    def _resolve_ranged_skirmishes(self) -> None:
        for player in self.ctx.players:
            for unit in player.unit_groups.values():
                if unit.attack_range <= 0 or unit.is_dead() or unit.state != "IDLE":
                    continue

                target = None
                if unit.combat_stance == "AGGRESSIVE":
                    target = self._find_best_target(unit)
                elif unit.target_unit and not unit.target_unit.is_dead():
                    if unit.get_distance_to(unit.target_unit) <= unit.attack_range:
                        target = unit.target_unit

                if target:
                    unit.active_target = target
                    unit.state = "COMBAT"
                    if unit.cooldown_timer <= 0:
                        self._perform_ranged_attack(unit, target)
                    unit.cooldown_timer = unit.attack_cooldown
                    # self._perform_ranged_attack(unit, target)
                else:
                    unit.active_target = None
                    if unit.state == "COMBAT":
                        unit.state = "IDLE"
