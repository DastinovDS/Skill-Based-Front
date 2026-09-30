import random
import math

from rts_core.classes.core_classes import Province, connect_provinces

def generate_huge_map_config(num_provinces=60, width=1800, height=1200):
    resources = ["Money", "Metal", "Food", "Fossils", "Oil"]

    province_ = {}
    
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

        province_[idx] = (name, vp_value, x, y, res, is_city)

    connections = set()
    
    for i in range(1, len(positions) + 1):
        x1, y1 = province_[i][2], province_[i][3]
        
        distances = []
        for j in range(1, len(positions) + 1):
            if i == j: continue
            x2, y2 = province_[j][2], province_[j][3]
            dist = math.hypot(x1 - x2, y1 - y2)
            distances.append((dist, j))
            
        distances.sort(key=lambda d: d[0])
        
        num_connections = random.randint(2, 3)
        for _, neighbor_id in distances[:num_connections]:
            edge = tuple(sorted([i, neighbor_id]))
            connections.add(edge)

    return province_, list(connections)


def get_province(province: dict, connections: list) -> list[Province]:
    _provinces: dict[int, Province] = {}
    provinces = []
    for prov_id, data in province.items():
        name, vp_value, pos_x, pos_y, resource, is_city = data

        new_province = Province(name, prov_id, vp_value, pos_x, pos_y, resource, is_city)
        _provinces[prov_id] = new_province

    provinces.extend(list(_provinces.values()))

    for id1, id2 in connections:
        if id1 in _provinces and id2 in _provinces:
            connect_provinces(_provinces[id1], _provinces[id2])
            
    return provinces