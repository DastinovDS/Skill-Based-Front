import numpy as np
import pygame
import typing
import time
import random
import os

if typing.TYPE_CHECKING:
    from rts_client import Game
    from .ResourceManager import ResourceManager

from rts_core.system.ManagerCache import SimpleLRUCache


class ActiveSound:
    def __init__(self, channel: pygame.mixer.Channel, name: str, world_pos: pygame.Vector2, base_volume: float = 1, looping: bool = False):
        self.channel = channel
        self.name = name
        self.world_pos = world_pos
        self.base_volume = base_volume
        self.looping = looping
        self.is_active = True
        self.start_time = time.time()

    def update(self, manager: "SoundManager"):
        # Если звук перестал играть сам по себе (закончился файл)
        if not self.channel.get_busy():
            self.is_active = False
            return

        # Рассчитываем новые параметры на основе текущего положения камеры
        dist_factor, pan = manager.calculate_spatial_logic(self.world_pos)
        final_vol = self.base_volume * dist_factor
        manager.apply_params_to_channel(self.channel, final_vol, pan)

    def stop(self):
        self.channel.stop()
        self.is_active = False

class SoundManager:
    def __init__(self, resurce_manger: "ResourceManager", game: "Game"):
        
        self.res = resurce_manger.register_module(
            "sounds",
            "sounds",
            extensions=[".wav"]
            )

        self.game = game
        # Кэши из твоего CacheManager
        self.sfx_cache: SimpleLRUCache[str, pygame.mixer.Sound] = \
            self.game.cache_manager.get_or_create("sfx_assets", cache_type="lru", capacity=128)
        
        self.pitched_cache: SimpleLRUCache[str, pygame.mixer.Sound] = \
            self.game.cache_manager.get_or_create("pitched_sfx", cache_type="lru", capacity=64)
        
        # Настройка каналов
        pygame.mixer.set_num_channels(128)
        
        # Список звуков, которые нужно обновлять каждый кадр
        self.active_sounds: list[ActiveSound] = []
        
        self.master_sfx_volume = 1.0
        self._min_interval = 0.05
        self._last_played = {}

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")

    def _get_pitched_sound(self, name: str, speed: float) -> pygame.mixer.Sound | None:
        """Получает звук с измененной скоростью (использует кэш и NumPy)"""
        if speed == 1.0:
            return self._load_base_sound(name)

        cache_key = f"{name}_v{speed:.2f}"
        if cache_key in self.pitched_cache:
            return self.pitched_cache[cache_key]

        base_sound = self._load_base_sound(name)
        if not base_sound: return None

        # Ресемплирование через NumPy
        raw_array = pygame.sndarray.array(base_sound)
        indices = np.round(np.arange(0, len(raw_array), speed))
        indices = indices[indices < len(raw_array)].astype(int)
        new_array = raw_array[indices]
        
        new_sound = pygame.sndarray.make_sound(new_array)
        self.pitched_cache[cache_key] = new_sound
        return new_sound

    def _load_base_sound(self, name: str) -> pygame.mixer.Sound | None:
        if name in self.sfx_cache: return self.sfx_cache[name]
        sound_name = self.res.file.get(name)
        if not sound_name: return None
        sound = pygame.mixer.Sound(sound_name)
        self.sfx_cache[name] = sound
        return sound

    def play_spatial(self, name: str, world_pos: tuple | str = "center", speed: float = 1.0, volume: float = 1, looping: bool = False, **kwargs) -> ActiveSound | None:
        """
        Запускает пространственный звук и регистрирует его для обновлений 
        file foramt .wav
        """
        now = time.time()
        if name in self._last_played and now - self._last_played[name] < self._min_interval and not looping:
            return None

        meta = self.res.get_metadata(name)

        actual_name = name
        if "variants" in meta:
            actual_name = random.choice(meta["variants"])
        
        
        final_volume = volume if volume is not None else meta.get("volume", 1.0)
        final_looping = looping if looping is not None else meta.get("looping", False)

        if speed is not None:
            final_speed = speed
        elif "pitch_range" in meta:
            final_speed = random.uniform(meta["pitch_range"][0], meta["pitch_range"][1])
        else:
            final_speed = meta.get("speed", 1.0)


        sound = self._get_pitched_sound(actual_name, final_speed)
        if not sound: 
            print(f"No sound id: {actual_name}")
            return None
        
        if isinstance(world_pos, str):
            match world_pos:
                case "center":
                    world_pos = self.game.camera.get_center_world()
                case _:
                    print(f"Not Found posittions: {actual_name}")
                    return None

        channel = pygame.mixer.find_channel(force=True)
        if channel:
            pos_vec = pygame.Vector2(world_pos)
            vol, pan = self.calculate_spatial_logic(pos_vec)
            self.apply_params_to_channel(channel, vol, pan)
            
            channel.play(sound, loops=-1 if final_looping else 0)
            
            active = ActiveSound(channel, actual_name, pos_vec, final_volume, looping)
            self.active_sounds.append(active)
            self._last_played[actual_name] = now
            return active
        return None

    def update(self, dt: float):
        """Обновляет параметры всех звучащих объектов (громкость/панораму)"""
        # Очищаем список от неактивных
        self.active_sounds = [s for s in self.active_sounds if s.is_active]
        
        for sound in self.active_sounds:
            sound.update(self)

    def calculate_spatial_logic(self, world_pos: pygame.Vector2):
        """Сердце математики звука: дистанция, зум и панорама"""
        cam = self.game.camera
        cam_center = cam.get_center_world()
        
        # Вектор от камеры до звука
        diff = world_pos - cam_center
        dist = diff.length()

        # Настройка затухания
        max_dist = 2000.0 / cam.zoom
        # Квадратичное затухание для реализма
        volume_factor = (max(0.0, 1.0 - (dist / max_dist)) ** 2) * cam.zoom
        
        # Расчет панорамы (Pan)
        # Насколько сильно объект смещен относительно ширины видимой области
        half_width = (cam.width / 2) / cam.zoom
        pan = max(-1.0, min(1.0, diff.x / half_width))
        
        return min(1.0, volume_factor), pan

    def apply_params_to_channel(self, channel: pygame.mixer.Channel, volume: float, pan: float):
        """Физическая установка громкости на каналы Pygame"""
        final_vol = volume * self.master_sfx_volume
        left = min(1.0, 1.0 - pan)
        right = min(1.0, 1.0 + pan)
        channel.set_volume(left * final_vol, right * final_vol)