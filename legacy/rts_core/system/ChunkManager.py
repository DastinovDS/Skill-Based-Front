from rts_core.game_logic.World.MapGenerator import MapGenerator
from rts_core.game_logic.World.Chunk import Chunk


from rts_core.system.ManagerCache import CacheManager, SimpleLRUCache

import threading
import pygame
import queue
import math

import typing
if typing.TYPE_CHECKING:
    from rts_core.engine.Renderer import Renderer

class ChunkManager:
    def __init__(self, map_generator: MapGenerator):
        self.map_generator = map_generator

        self.cache_manager = CacheManager()
        self.chunk_surface_cache: "SimpleLRUCache" = self.cache_manager.get_or_create(
            "chunk_surfaces", 
            cache_type="lru" 
        )

        self.loaded_chunks = {}
        
        self.task_queue = queue.Queue()
        self.result_queue = queue.Queue()
        self.under_generation = set()     
        self.running = True
        
        self.workers = []
        num_workers = 2 
        
        for i in range(num_workers):
            t = threading.Thread(
                target=self._chunk_generation_worker, 
                name=f"ChunkWorker-{i}", 
                daemon=True
            )
            t.start()
            self.workers.append(t)

        self.biome_colors = {
            "beach": (238, 214, 175), "normal": (34, 139, 34), 
            "desert": (210, 180, 140), "jungle": (0, 100, 80),
            "snow": (255, 255, 255), "tundra": (120, 150, 150),
            "ice_shore": (200, 240, 255), "desert_beach": (225, 200, 150),
            "steppe": (140, 170, 90), "swamp": (40, 90, 70), "savanna": (180, 190, 100),
            "lake": (0, 133, 148)
        }

    def clear(self):
        self.chunk_surface_cache.clear()
    
    def size(self):
        return self.cache_manager
    
    def _chunk_generation_worker(self):
        while self.running:
            try:
                cx, cy = self.task_queue.get(timeout=1.0)
                
                chunk = Chunk(cx, cy, self.map_generator)
                
                self.result_queue.put(((cx, cy), chunk))
                self.task_queue.task_done()
            except queue.Empty:
                continue

    def _process_finished_chunks(self):
        while not self.result_queue.empty():
            try:
                chunk_key, chunk = self.result_queue.get_nowait()
                
                if chunk.is_dirty:
                    chunk.render_surface(self.biome_colors)
                
                self.loaded_chunks[chunk_key] = chunk
                
                if chunk_key in self.under_generation:
                    self.under_generation.remove(chunk_key)
                    
                self.result_queue.task_done()
            except queue.Empty:
                break
    
    @staticmethod
    def is_chunk_empty(cx: int, cy: int, map_generator: "MapGenerator") -> bool:
        """Быстро проверяет, есть ли провинции рядом с этим чанком"""
        chunk_pixel_size = Chunk.CHUNK_SIZE * map_generator.STEP
        chunk_center_x = (cx * chunk_pixel_size) + (chunk_pixel_size / 2)
        chunk_center_y = (cy * chunk_pixel_size) + (chunk_pixel_size / 2)

        max_dist = math.hypot(chunk_pixel_size/2, chunk_pixel_size/2) + map_generator.INFLUENCE_RADIUS + 100

        for prov in map_generator.provinces:
            dist = math.hypot(prov.pos_x - chunk_center_x, prov.pos_y - chunk_center_y)
            if dist < max_dist:
                return False

        return True

    def draw_visible_chunks(self, renderer: "Renderer") -> None:

        self._process_finished_chunks()

        vx, vy, vw, vh = renderer.camera.get_world_view_rect()
        zoom = round(renderer.camera.zoom, 2)
        
        chunk_pixel_size = Chunk.CHUNK_SIZE * self.map_generator.STEP
        
        start_cx = int(vx // chunk_pixel_size)
        end_cx = int((vx + vw) // chunk_pixel_size) + 1
        start_cy = int(vy // chunk_pixel_size)
        end_cy = int((vy + vh) // chunk_pixel_size) + 1

        for cx in range(start_cx, end_cx):
            for cy in range(start_cy, end_cy):
                chunk_key = (cx, cy)
                
                if chunk_key not in self.loaded_chunks:
                    if self.is_chunk_empty(cx, cy, self.map_generator):
                        continue
                    # self.loaded_chunks[chunk_key] = Chunk(cx, cy, self.map_generator)
                    if chunk_key not in self.under_generation:
                        self.under_generation.add(chunk_key)
                        self.task_queue.put(chunk_key) # Кинули задачу в поток
                    
                    continue
                
                chunk: Chunk = self.loaded_chunks[chunk_key]
                
                if chunk.is_dirty:
                    chunk.render_surface(self.biome_colors)
                
                surface_cache_key = (cx, cy, zoom)
                chunk_surf = self.chunk_surface_cache.get(surface_cache_key)

                if not chunk.surface:
                    continue

                if chunk_surf is None:
                    if zoom != 1.0:
                        new_w = math.ceil(chunk.world_w * zoom) + 1
                        new_h = math.ceil(chunk.world_h * zoom) + 1
                        chunk_surf = pygame.transform.scale(chunk.surface, (new_w, new_h))
                    else:
                        chunk_surf = chunk.surface
                    
                    self.chunk_surface_cache.set(surface_cache_key, chunk_surf)

                renderer.draw_blit(
                    surface=chunk_surf,
                    pos=(chunk.world_pos_x, chunk.world_pos_y),
                    centered=False,
                    is_world_pos=True,
                    z_index=0
                )
    
    def stop(self):
        self.running = False
        for t in self.workers:
            t.join()