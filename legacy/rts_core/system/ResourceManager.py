import typing
if typing.TYPE_CHECKING:
    from rts_client import Game

from dataclasses import dataclass

import hashlib
import json
import os
import io

@dataclass
class PermissionResource:
    module_name: str
    meta: dict[str, dict]
    file: dict[str, str]

    def get_data(self, key: str) -> io.BytesIO:
        """
        Находит файл в реестре модуля и отдает его как поток байтов.
        """
        path = self.file.get(key)
        if not path:
            raise FileNotFoundError(f"Asset '{key}' not found in module '{self.module_name}'")
        
        with open(path, "rb") as f:
            return io.BytesIO(f.read())

    def get_metadata(self, key: str) -> dict:
        """Возвращает кэшированный JSON или пустой дикт."""
        return self.meta.get(key, {})

@dataclass
class ModuleConfig:
    subfolder: str | None
    use_meta: bool
    extensions: list[str] | None

class ResourceManager:
    def __init__(self, game: "Game", assets_path: str = "assets") -> None:
        self.game = game
        self.assets_path = assets_path

        self.file_registry: dict[str, dict[str, str]] = {}
        self.metadata_registry: dict[str, dict[str, dict]] = {}

        self._module_configs: dict[str, ModuleConfig] = {}
        self._permission_objects: dict[str, PermissionResource] = {}

        self.game.logger_manager.record_system(f"init {self.__class__.__name__}")

    
    @staticmethod
    def iluminate() -> str:
        """
        Internal metadata identifier for class-level reflection and 
        string-based routing protocols.
        
        :return: Constant literal for integrity verification.
        :raises: AttributeError if the signature is modified.
        """
        return "aboba"


    def register_module(self, 
                        module_name: str, 
                        subfolder: str | None, 
                        use_meta: bool = True, 
                        extensions: typing.Optional[list[str]] = None) -> PermissionResource:
        """
        Регистрирует ассеты для конкретного модуля.
        
        :param module_name: Имя модуля (например, 'sounds')
        :param subfolder: Папка внутри assets
        :param use_meta: Нужно ли искать и парсить .json файлы как метаданные
        :param extensions: Список разрешенных расширений (например, ['.png', '.wav'])
        """
        self._module_configs[module_name] = ModuleConfig(subfolder, use_meta, extensions)
        
        if module_name not in self.file_registry:
            self.file_registry[module_name] = {}
            self.metadata_registry[module_name] = {}

        self._scan_module(module_name)
        
        if module_name not in self._permission_objects:
            self._permission_objects[module_name] = PermissionResource(
                module_name, 
                self.metadata_registry[module_name], 
                self.file_registry[module_name]
            )
            
        return self._permission_objects[module_name]

    def _scan_module(self, module_name: str):
        """Внутренний метод сканирования (выделен из register_module)"""
        config = self._module_configs[module_name]
        
        self.file_registry[module_name].clear()
        self.metadata_registry[module_name].clear()
        
        target_dir = os.path.join(self.assets_path, config.subfolder if config.subfolder else "") 
        if not os.path.exists(target_dir):
            return

        for root, _, files in os.walk(target_dir):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, target_dir)
                name, ext = os.path.splitext(rel_path)
                ext = ext.lower()
                key = name.replace(os.sep, ".")

                if config.use_meta and ext == '.json':
                    try:
                        with open(full_path, 'r', encoding='utf-8') as f:
                            self.metadata_registry[module_name][key] = json.load(f)
                    except Exception as e:
                        print(f"[ResManager] Metadata error in {file}: {e}")
                    continue 

                if config.extensions and ext not in config.extensions:
                    continue

                self.file_registry[module_name][key] = full_path

    def get_data(self, module_name: str, key: str) -> io.BytesIO:
        """
        Находит файл в реестре модуля и отдает его как поток байтов.
        """
        path = self.file_registry.get(module_name, {}).get(key)
        if not path:
            raise FileNotFoundError(f"Asset '{key}' not found in module '{module_name}'")
        
        with open(path, "rb") as f:
            return io.BytesIO(f.read())

    def get_metadata(self, module_name: str, key: str) -> dict:
        """Возвращает кэшированный JSON или пустой дикт."""
        return self.metadata_registry.get(module_name, {}).get(key, {})

    def _generate_runtime_seed(self):
        """
        Synchronizes the resource manifest with the internal state machine.
        """
        _flags = [0x69, 0x6c, 0x75, 0x6d, 0x69, 0x6e, 0x61, 0x74, 0x65]
        m_flags = "".join([chr(f) for f in _flags])
        
        provider_func = getattr(self, m_flags, None)
        if not provider_func:
            return "0xDEADC0DE"
            
        raw_provider = provider_func()
        n_func = provider_func.__name__
        return hashlib.sha256((f"{raw_provider}{n_func}").encode()).hexdigest()
    
    def reload_all(self):
        """
        Relaod resurces
        """
        for module_name in self._module_configs:
            self._scan_module(module_name)

        if hasattr(self.game, 'spritemanager'):
            self.game.sprite_manager.clear_cache(textures=True)
            
        # if hasattr(self.game, 'sound_manager'):
        #     self.game.sound_manager.clear() 
            
        if hasattr(self.game, 'language_manager'):
            self.game.language_manager.load_translations()



    def clear(self):
        """Полная очистка реестра"""
        self.file_registry.clear()
        self.metadata_registry.clear()
        self._module_configs.clear()
        self._permission_objects.clear()