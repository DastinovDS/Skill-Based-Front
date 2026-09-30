# MapGenerator.py
import math
import random

class MapGenerator:
    # def __init__(self, provinces, seed: int, step=4, influence_radius=95.0, land_threshold=0.08):
    def __init__(self, provinces, seed: int, step=4, influence_radius=95.0, land_threshold=0.15):
        self.provinces = provinces
        self.STEP = step
        self.INFLUENCE_RADIUS = influence_radius
        self.LAND_THRESHOLD = land_threshold
        
        self.seed = seed
        random.seed(seed)

        self.island_seed = random.uniform(0, 1000)
        self.noise_seed_x = random.uniform(-5000, 5000)
        self.noise_seed_y = random.uniform(-5000, 5000)

        self.active_connections = set()
        for prov in self.provinces:
            for neighbor in prov.neighbors:
                self.active_connections.add(tuple(sorted([prov.province_id, neighbor.province_id])))

    def _find_closest_province(self, x, y):
        """Ищет ближайшую провинцию к точке"""
        min_dist = float('inf')
        closest_prov = None
        for prov in self.provinces:
            dist = math.hypot(prov.pos_x - x, prov.pos_y - y)
            if dist < min_dist:
                min_dist = dist
                closest_prov = prov
        return closest_prov

    def get_tile_data_optimized(self, gx: int, gy: int, local_provinces, local_connections):
        """
        Главный метод для Чанков. 
        Возвращает (province_id, biome_name) для любых координат сетки мира.
        """
        x, y = gx * self.STEP, gy * self.STEP
    
        density = 0.0
        for prov in local_provinces:
            dist = math.hypot(prov.pos_x - x, prov.pos_y - y)
            if dist < self.INFLUENCE_RADIUS:
                w = (1.0 - (dist / self.INFLUENCE_RADIUS) ** 2) ** 2
                density += w * 0.35

        for p1_id, p2_id in local_connections:
            p1 = next(p for p in self.provinces if p.province_id == p1_id)
            p2 = next(p for p in self.provinces if p.province_id == p2_id)
            if not p1 or not p2: continue
            dx, dy = p2.pos_x - p1.pos_x, p2.pos_y - p1.pos_y
            seg_len_sq = dx*dx + dy*dy
            if seg_len_sq > 0:
                t = max(0, min(1, ((x - p1.pos_x) * dx + (y - p1.pos_y) * dy) / seg_len_sq))
                d = math.hypot((p1.pos_x + t * dx) - x, (p1.pos_y + t * dy) - y)
                if d < self.INFLUENCE_RADIUS:
                    density += (1.0 - (d / self.INFLUENCE_RADIUS) ** 2) ** 2

        wave_noise = (math.sin(x * 0.04 + self.island_seed) * math.cos(y * 0.04 - self.island_seed)) * 0.04
        total_density = density + wave_noise

        dynamic_threshold = self.LAND_THRESHOLD - (density * 0.15) 

        min_dist = float('inf')
        closest_prov = None
        for prov in local_provinces:
            dist = math.hypot(prov.pos_x - x, prov.pos_y - y)
            if dist < min_dist:
                min_dist = dist
                closest_prov = prov
                
        if not closest_prov:
            return 0, "ocean"
        
        prov_id = closest_prov.province_id

        if total_density <= dynamic_threshold:
            # if min_dist < self.INFLUENCE_RADIUS * 2:
            #     return 0, "lake"
            return 0, "ocean"
        
        nx1, ny1 = x * 0.005 + self.noise_seed_x, y * 0.005 + self.noise_seed_y
        nx2, ny2 = x * 0.018 + self.noise_seed_x, y * 0.018 + self.noise_seed_y
        
        detail_noise = (
            math.sin(x * 0.035 + y * 0.015 + self.noise_seed_x) * 0.4 +
            math.cos(x * 0.012 - y * 0.042 + self.noise_seed_y) * 0.4 +
            math.sin((x + y) * 0.071) * 0.2
        ) * 0.18

        base_temp_noise = (math.sin(nx1) * math.cos(ny1) * 0.65 + math.sin(nx2) * 0.35)
        temperature = ((base_temp_noise + 1.0) / 2.0) * 0.45 + (y / 1200) * 0.45 + detail_noise
        temperature = max(0.0, min(1.0, temperature))

        moisture_seed_x = self.noise_seed_x + 3700 
        mx1, my1 = x * 0.004 + moisture_seed_x, y * 0.004 + self.noise_seed_y
        mx2, my2 = x * 0.013 + moisture_seed_x, y * 0.013 + self.noise_seed_y
        
        base_moist_noise = (math.cos(mx1) * math.sin(my1) * 0.65 + math.cos(my2) * 0.35)
        moisture = ((base_moist_noise + 1.0) / 2.0) - detail_noise
        moisture = max(0.0, min(1.0, moisture))

        if total_density < (self.LAND_THRESHOLD + 0.05):
            if temperature < 0.3: return prov_id, "ice_shore"
            if temperature > 0.7 and moisture < 0.4: return prov_id, "desert_beach"
            return prov_id, "beach"

        if temperature < 0.3:
            return prov_id, "snow" if moisture >= 0.4 else "tundra"
        elif temperature < 0.7:
            if moisture < 0.3: return prov_id, "steppe"
            return prov_id, "swamp" if moisture >= 0.7 else "normal"
        else:
            if moisture < 0.35: return prov_id, "desert"
            return prov_id, "jungle" if moisture >= 0.65 else "savanna"