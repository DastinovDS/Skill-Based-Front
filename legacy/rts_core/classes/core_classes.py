from typing import Dict, TYPE_CHECKING, Optional
from rts_core.data.units_data import UNIT_DEFINITIONS
from rts_core.data.buildings_data import BUILDING_DEFINITIONS

import math

FIXED_TRAVEL_TIME = 2.0

if TYPE_CHECKING:
    from rts_core.game_logic import find_path
    from rts_client import Game

class Province:
    def __init__(self, name: str, id: int, vp_value: int, pos_x: int, pos_y: int, base_resource_type: str, is_city: bool = False) -> None:

        # Basic values
        self.name: str = name
        self.province_id: int = id
        self.vp_value: int = vp_value
        self.is_city: bool = is_city

        # Ownership
        self.owner: Player | None = None

        # Screen position
        self.pos_x: int = pos_x
        self.pos_y: int = pos_y

        # Dictionaries
        self.buildings: Dict[str, 'Building'] = {}

        # Lists
        self.units: list['UnitGroup'] = []
        self.neighbors: list['Province'] = []

        # Production
        self.base_resource_type: str = base_resource_type # Type of resource production
        self.base_production: Dict[str, float] = self._calculate_base_production() # Amount of resource production

    def _calculate_base_production(self) -> Dict[str, float]:
        """
        This funktion calculates base production rate for provinces
        :return: Dict[str, float]
        """
        multiplier = 2.0 if self.is_city else 1.0

        if self.base_resource_type == "Money":
            rate = 0.5 * multiplier
        else:
            rate = 0.05 * multiplier

        production = {
            "Food": 0.0,
            "Oil": 0.0,
            "Metal": 0.0,
            "Fossils": 0.0,
            "Money": 0.0
        }

        if self.base_resource_type in production:
            production[self.base_resource_type] = rate

        return production

    def has_active_building(self, building_type: str) -> bool:
        """
        This funktion checks if there is an active building of input type in current province
        :param building_type: type of a building
        :return: bool
        """
        building = self.buildings.get(building_type)
        return building is not None and building.status == 'Active'

    def __eq__(self, value: object) -> bool:
        "Перегрузка оператора сравнения чтобы искать провинцию по id"
        if isinstance(value, Province):
            return self.province_id == value.province_id
        elif isinstance(value, int):
            return value == self.province_id
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self.province_id)

def connect_provinces(prov1: Province, prov2: Province) -> None:
    """
    Connect two provinces(making them neighbors)
    :param prov1: First province
    :param prov2: Second province
    :return: None
    """
    if prov2 not in prov1.neighbors:
        prov1.neighbors.append(prov2)

    if prov1 not in prov2.neighbors:
        prov2.neighbors.append(prov1)


class Building:
    def __init__(self, owner: int, building_type: str, province: Province, construction_time: float,
                 building_id: int, production: Dict[str, float]) -> None:

        # Basic values
        self.building_id: int = building_id
        self.building_type: str = building_type
        self.owner: int = owner
        self.province: Province = province

        self.status: str = 'Under Construction' # Construction status

        self.production = production

        # Time variables
        self.construction_time: float = construction_time
        self.time_remaining: float = construction_time


class Player:
    def __init__(self, player_id: int, name: str) -> None:

        # Basic values
        self.player_id: int = player_id
        self.name: str = name
        self.victory_points: int = 0

        # Dictionaries dependencies
        self.buildings: dict[int, Building] = {}
        self.unit_groups: Dict[int, "UnitGroup"] = {}
        self.provinces: Dict[int, 'Province'] = {}

        self.training_queue: list[dict] = []
        self.building_queue: list[dict] = []

        # Resources/production
        self.resources: Dict[str, int | float] = {"Food": 0, "Oil": 0, "Metal": 0, "Fossils": 0, "Money": 200}

    def can_afford(self, cost_dict: dict) -> bool:
        return all(self.resources[res] >= cost for res, cost in cost_dict.items())

    def pay_cost(self, cost_dict: dict) -> None:
        """
        If player can afford an action, applies the payment
        :param cost_dict: dictionary with costs of an action
        :return: None
        """
        for resource_type, cost in cost_dict.items():
            self.resources[resource_type] -= cost

    def can_build(self, building_type: str, province: Province) -> bool:
        definition = BUILDING_DEFINITIONS.get(building_type)
        if not definition or building_type in province.buildings or self.building_queue:
            return False
        return province.owner == self and self.can_afford(definition["cost"])

    def check_train_ability(self, unit_type: str, province: "Province") -> bool:
        unit_def = UNIT_DEFINITIONS.get(unit_type)
        if not unit_def:
            return False

        required_buildings = unit_def.get("dependencies", [])

        for b_type in required_buildings:
            if not province.has_active_building(b_type):
                return False

        return True

    def start_construction(self, building_type: str, province: Province) -> None:
        defn = BUILDING_DEFINITIONS[building_type]
        if self.can_build(building_type, province):
            self.pay_cost(defn["cost"])
            self.building_queue.append({
                "building_type": building_type,
                "province": province,
                "time_left": defn["construction_time"],
                "definition": defn
            })

    def can_train_unit(self, unit_type: str, province: Province) -> bool:
        defn = UNIT_DEFINITIONS.get(unit_type, {})
        if not self.check_train_ability(unit_type, province):
            return False
        return province.owner == self and self.can_afford(defn["cost"])

    def train_unit(self, unit_type: str, province: Province) -> None:
        if self.can_train_unit(unit_type, province):
            defn = UNIT_DEFINITIONS[unit_type]
            self.pay_cost(defn["cost"])
            self.training_queue.append({
                "unit_type": unit_type,
                "province": province,
                "time_left": defn["training_time"],
                "definition": defn
            })

    def __eq__(self, value: object) -> bool:
        "Перегрузка оператора сравнения чтобы искать игрока по id"
        if isinstance(value, Player):
            return self.player_id == value.player_id
        elif isinstance(value, int):
            return value == self.player_id
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self.player_id)
    

class UnitGroup:
    def __init__(self, owner: Player, current_province: Province, unit_type: str, count: int, group_id: int,
                 upkeep: dict[str, float], attack_damage: int, max_health: int, armor: int,
                 attack_cooldown: float, training_time: float, pos_x: int, pos_y: int) -> None:

        # Basic fields
        self.owner: Player = owner
        self.group_id: int = group_id
        self.unit_type: str = unit_type

        self.count: int = count
        self.upkeep: dict[str, float] = upkeep

        # Unit battle stats
        self.max_health_base: int = max_health
        self.current_health: float = float(max_health * count)
        self.max_health_total: float = float(max_health * count)
        self.attack_damage_base: int = attack_damage
        self.armor: int = armor

        # Positions
        self.pos_x = pos_x
        self.pos_y = pos_y

        # Ranged attack attributes
        self.attack_range: float = 0.0
        self.combat_stance: str = ''
        self.target_unit: UnitGroup | None = None
        self.active_target: UnitGroup | None = None

        # Timers/cooldowns
        self.attack_cooldown: float = attack_cooldown
        self.training_time: float = training_time
        self.cooldown_timer: float = self.attack_cooldown

        # Movement dependencies/timers
        self.current_province: Province = current_province
        self.target_province: Optional[Province] = None
        self.path: list[Province] = []
        self.time_to_next_province: float = 0.0

        # Movement on the edges of graph

        self.state = "IDLE"  # IDLE, MOVING, COMBAT
        self.move_progress = 0.0
        self.origin_province: Optional[Province] = None
        self.target_province: Optional[Province] = None

    @property
    def current_pos(self) -> tuple[float, float]:
        if self.move_progress <= 0.0 or self.target_province is None:
            return (float(self.current_province.pos_x), float(self.current_province.pos_y))

        start = self.origin_province if self.origin_province else self.current_province
        end = self.target_province

        x = start.pos_x + (end.pos_x - start.pos_x) * self.move_progress
        y = start.pos_y + (end.pos_y - start.pos_y) * self.move_progress
        
        return (x, y)

    def is_dead(self) -> bool:
        """
        Checks, if unit group is dead
        :return: bool
        """
        return self.current_health <= 0

    def take_damage(self, damage_amount: int) -> None:
        """
        Reduces current unit grop health by damage_amount
        :param damage_amount: Amount of taken damage
        :return: None
        """
        self.current_health = max(0, self.current_health - damage_amount)

    def move_group_to(self, game: "Game", destination_province: Province) -> None:
        """
        This funktion moves selected unit_group to the chosen province using pathfinding algorythm
        :param destination_province: Destination province
        :return: None
        """
        from rts_core.game_logic.pathfinding import find_path

        if destination_province == self.current_province and self.move_progress <= 0:
            self.path = []
            self.target_province = None
            self.state = "IDLE"
            return

        new_path = find_path(self.current_province, destination_province)

        if new_path:
            game.movement_manager.move_order(self, new_path)
            game.logger_manager.record_movement_start(self, destination_province)
        else:
            self.move_progress = 0
            self.path = []
            self.target_province = None
            self.state = "IDLE"

    def get_distance_to(self, other: "UnitGroup") -> float:
        """
        Calculates Euclidean distance between this group and another group
        using their actual world positions.
        """
        x1, y1 = self.current_pos
        x2, y2 = other.current_pos
        return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)