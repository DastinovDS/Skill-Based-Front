from rts_core.classes import Province, Player, connect_provinces, UnitGroup
from rts_core.data import UNIT_DEFINITIONS

import typing

if typing.TYPE_CHECKING:
    from rts_client import Game

# PROVINCE_CONFIG = {
#     1: ("Capital A", 2, 200, 300, "Money", True),
#     2: ("Metal Hub", 1, 400, 200, "Metal", False),
#     3: ("P3", 1, 550, 250, "Food", False),
#     4: ("P4", 1, 700, 350, "Fossils", False),
#     5: ("P5", 1, 500, 450, "Money", False),
#     6: ("P6", 1, 650, 500, "Metal", False),
#     7: ("P7", 1, 850, 450, "Food", False),
#     8: ("P8", 1, 950, 550, "Oil", False),
#     9: ("Capital B", 2, 1000, 300, "Money", True),
#     10: ("Oil Field", 1, 800, 200, "Oil", False),
# }

# CONNECTION_CONFIG = [
#     (2, 5),
#     (4, 7),
#     (5, 6),
#     (7, 10),
# ]

import random
import math

def generate_huge_map_config(num_provinces=60, width=1800, height=1200):
    resources = ["Money", "Metal", "Food", "Fossils", "Oil"]
    
    padding = 200
    
    positions = []
    attempts = 0
    min_distance = 130
    
    while len(positions) < num_provinces and attempts < 3000:
        attempts += 1
        angle = random.uniform(0, 2 * math.pi)
        r = random.uniform(0, 1) * random.uniform(0, 1) 
        
        x = int((width / 2) + (width / 2 - padding) * r * math.cos(angle))
        y = int((height / 2) + (height / 2 - padding) * r * math.sin(angle))
        
        if all(math.hypot(p[0] - x, p[1] - y) >= min_distance for p in positions):
            positions.append((x, y))

    positions.sort(key=lambda p: p[0])

    for idx, (x, y) in enumerate(positions, start=1):
        is_city = False
        vp_value = 1
        res = random.choice(resources)
        name = f"Province {idx}"
        
        if idx == 1:
            name = "Western Capital"
            is_city = True
            vp_value = 3
            res = "Money"
        elif idx == len(positions):
            name = "Eastern Capital"
            is_city = True
            vp_value = 3
            res = "Money"
        elif idx in (num_provinces // 3, (num_provinces // 3) * 2):
            name = f"Central City {idx}"
            is_city = True
            vp_value = 2

        PROVINCE_CONFIG[idx] = (name, vp_value, x, y, res, is_city)

    connections = set()
    
    for i in range(1, len(positions) + 1):
        x1, y1 = PROVINCE_CONFIG[i][2], PROVINCE_CONFIG[i][3]
        
        distances = []
        for j in range(1, len(positions) + 1):
            if i == j: continue
            x2, y2 = PROVINCE_CONFIG[j][2], PROVINCE_CONFIG[j][3]
            dist = math.hypot(x1 - x2, y1 - y2)
            distances.append((dist, j))
            
        distances.sort(key=lambda d: d[0])
        
        num_connections = random.randint(2, 3)
        for _, neighbor_id in distances[:num_connections]:
            edge = tuple(sorted([i, neighbor_id]))
            connections.add(edge)

    CONNECTION_CONFIG = list(connections)
    return PROVINCE_CONFIG, CONNECTION_CONFIG

PROVINCE_CONFIG = {}
PROVINCE_CONFIG, CONNECTION_CONFIG = generate_huge_map_config(num_provinces=100)

# for i in range(1, 10):
#     CONNECTION_CONFIG.append((i, i + 1))

INFANTRY_TYPE = "Infantry"
INFANTRY_COUNT = 3

INITIAL_SETUP = [
    # Player 1
    {"player_id": 1, "province_id": 1, "unit_type": INFANTRY_TYPE, "count": INFANTRY_COUNT},
    {"player_id": 1, "province_id": 2, "unit_type": INFANTRY_TYPE, "count": INFANTRY_COUNT},
    # Player 2
    {"player_id": 2, "province_id": 9, "unit_type": INFANTRY_TYPE, "count": INFANTRY_COUNT},
    {"player_id": 2, "province_id": 10, "unit_type": INFANTRY_TYPE, "count": INFANTRY_COUNT},
]


def game_init(game: "Game"):
    player_1 = Player(1, "Dastinov")
    game.me = player_1
    player_2 = Player(2, "Chara")
    game.players = [player_1, player_2]

    player_map = {1: player_1, 2: player_2}

    provinces: dict[int, Province] = {}

    for prov_id, data in PROVINCE_CONFIG.items():
        name, vp_value, pos_x, pos_y, resource, is_city = data

        new_province = Province(name, prov_id, vp_value, pos_x, pos_y, resource, is_city)
        provinces[prov_id] = new_province

    game.provinces.extend(list(provinces.values()))

    for id1, id2 in CONNECTION_CONFIG:
        if id1 in provinces and id2 in provinces:
            connect_provinces(provinces[id1], provinces[id2])

    current_unit_id = 1

    for setup_item in INITIAL_SETUP:
        player_id = setup_item["player_id"]
        prov_id = setup_item["province_id"]
        unit_type = setup_item["unit_type"]
        count = setup_item["count"]

        player = player_map[player_id]
        province = provinces[prov_id]

        province.owner = player
        player.provinces[prov_id] = province

        unit_data = UNIT_DEFINITIONS.get(unit_type)

        if unit_data:
            new_group = UnitGroup(
                owner=player,
                current_province=province,
                unit_type=unit_type,
                count=count,
                group_id=current_unit_id,

                upkeep=unit_data["upkeep"],
                attack_damage=unit_data["attack_damage"],
                max_health=unit_data["max_health"],
                armor=unit_data["armor"],
                attack_cooldown=unit_data["attack_cooldown"],
                training_time=unit_data["training_time"],
                pos_x = province.pos_x,
                pos_y = province.pos_y,
            )

            new_group.attack_range = unit_data["attack_range"]
            new_group.combat_stance = unit_data["combat_stance"]

            player.unit_groups[current_unit_id] = new_group
            province.units.append(new_group)

            current_unit_id += 1

    for province in provinces.values():
        if province.owner:
            province.owner.provinces[province.province_id] = province