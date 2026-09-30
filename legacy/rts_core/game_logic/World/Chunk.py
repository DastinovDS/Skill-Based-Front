import pygame
import typing
import math


if typing.TYPE_CHECKING:
    from .MapGenerator import MapGenerator

class Chunk:
    CHUNK_SIZE = 32

    def __init__(self, chunk_x, chunk_y, map_generator: "MapGenerator"):
        self.chunk_x = chunk_x
        self.chunk_y = chunk_y
        self.step = map_generator.STEP
        
        self.world_w = self.CHUNK_SIZE * self.step
        self.world_h = self.CHUNK_SIZE * self.step
        
        self.world_pos_x = chunk_x * self.world_w
        self.world_pos_y = chunk_y * self.world_h

        self.surface: typing.Optional[pygame.Surface] = None
        self.is_dirty = True 
        
        self.tiles = {} 

        self.edges = []
        self.road_borders = {}

        self.local_provinces = []
        self.local_connections = []

        self._filter_local_data(map_generator)
        self._generate_chunk_data(map_generator)
        # self._calculate_chunk_boundaries()

    def _calculate_chunk_boundaries(self):
        """Вычисляет локальные границы провинций внутри этого чанка"""
        boundary_points = {}
        
        for ox in range(self.CHUNK_SIZE):
            for oy in range(self.CHUNK_SIZE):
                data = self.tiles.get((ox, oy))
                if not data: 
                    continue
                
                curr_id = data["prov_id"]
                if curr_id == 0: 
                    continue

                abs_x = self.world_pos_x + ox * self.step
                abs_y = self.world_pos_y + oy * self.step

                if ox < self.CHUNK_SIZE - 1:
                    right_data = self.tiles.get((ox + 1, oy))
                    if right_data:
                        right_id = right_data["prov_id"]
                        if right_id != curr_id and right_id != 0:
                            self.edges.append(((abs_x + self.step, abs_y), (abs_x + self.step, abs_y + self.step)))
                            edge_key = tuple(sorted([curr_id, right_id]))
                            boundary_points.setdefault(edge_key, []).append((abs_x + self.step, abs_y + self.step // 2))

                if oy < self.CHUNK_SIZE - 1:
                    bottom_data = self.tiles.get((ox, oy + 1))
                    if bottom_data:
                        bottom_id = bottom_data["prov_id"]
                        if bottom_id != curr_id and bottom_id != 0:
                            self.edges.append(((abs_x, abs_y + self.step), (abs_x + self.step, abs_y + self.step)))
                            edge_key = tuple(sorted([curr_id, bottom_id]))
                            boundary_points.setdefault(edge_key, []).append((abs_x + self.step // 2, abs_y + self.step))

        for edge_key, pts in boundary_points.items():
            avg_x = sum(p[0] for p in pts) / len(pts)
            avg_y = sum(p[1] for p in pts) / len(pts)
            self.road_borders[edge_key] = (avg_x, avg_y)

    def _filter_local_data(self, map_generator: "MapGenerator"):
        """Оставляет только те провинции и связи, которые близко к чанку"""
        chunk_center_x = self.world_pos_x + self.world_w / 2
        chunk_center_y = self.world_pos_y + self.world_h / 2
        
        max_dist = math.hypot(self.world_w/2, self.world_h/2) + map_generator.INFLUENCE_RADIUS + 100

        for prov in map_generator.provinces:
            dist = math.hypot(prov.pos_x - chunk_center_x, prov.pos_y - chunk_center_y)
            if dist < max_dist:
                self.local_provinces.append(prov)

        for id1, id2 in map_generator.active_connections:
            p1 = next((p for p in map_generator.provinces if p.province_id == id1), None)
            p2 = next((p for p in map_generator.provinces if p.province_id == id2), None)
            if not p1 or not p2: 
                continue
            
            d1 = math.hypot(p1.pos_x - chunk_center_x, p1.pos_y - chunk_center_y)
            d2 = math.hypot(p2.pos_x - chunk_center_x, p2.pos_y - chunk_center_y)
            
            if d1 < max_dist or d2 < max_dist:
                self.local_connections.append((id1, id2))

    def _generate_chunk_data(self, map_generator: "MapGenerator"):
        """Заполняет данные тайлов, используя ТОЛЬКО локальные (близкие) провинции"""
        start_gx = self.chunk_x * self.CHUNK_SIZE
        start_gy = self.chunk_y * self.CHUNK_SIZE

        for ox in range(self.CHUNK_SIZE):
            for oy in range(self.CHUNK_SIZE):
                gx = start_gx + ox
                gy = start_gy + oy
                
                prov_id, biome = map_generator.get_tile_data_optimized(
                    gx, gy, 
                    self.local_provinces, 
                    self.local_connections
                )
                self.tiles[(ox, oy)] = {"prov_id": prov_id, "biome": biome}

    def render_surface(self, biome_colors):
        if self.surface is None:
            self.surface = pygame.Surface((self.world_w, self.world_h)).convert()
        
        self.surface.fill((0, 105, 148))
        for (ox, oy), data in self.tiles.items():
            biome = data["biome"]
            if biome == "ocean":
                continue
            color = biome_colors.get(biome, (200, 200, 200))
            rect = (ox * self.step, oy * self.step, self.step +1, self.step +1)
            pygame.draw.rect(self.surface, color, rect)
        self.is_dirty = False