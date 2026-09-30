import typing
import yaml
import os

from .ManagerCache import CacheManager, SimpleLRUCache, BaseCache

if typing.TYPE_CHECKING:
    from .ResourceManager import ResourceManager


class LocalizationSystem:
    """
    Handles multi-language support by loading YAML translation files.
    Supports nested keys and fallback logic (Current Lang -> English -> Key).
    """

    def __init__(self, resurce_manger: "ResourceManager", default_lang: str = "en_us") -> None:
        """
        Initializes the localization system.

        Args:
            directory: Path to the folder containing .yaml language files.
            default_lang: The backup language code (usually 'en').
        """

        self.res = resurce_manger.register_module(
            "lang", 
            "lang", 
            use_meta=False, 
            extensions=[".yaml"]
        )

        self.default_lang = default_lang
        self.current_lang = default_lang
        
        self.translations: SimpleLRUCache[str, str] = CacheManager().get_or_create("Localization Translations")
        self.fallback_translations: SimpleLRUCache[str, str] = CacheManager().get_or_create("Localization Fallback Translations") # type: ignore
        
        self.load_translations()

    def _load_file(self, lang_code: str) -> dict:
        """
        Reads a YAML file from the disk.

        Args:
            lang_code: The language file name without extension.

        Returns:
            A dictionary of translations or an empty dict if the file is missing.
        """
        return yaml.load(self.res.get_data(lang_code), Loader=yaml.SafeLoader) or {}

    def load_translations(self) -> None:
        """
        Loads the active language and the default fallback language into memory.
        """
        self.translations.update( self._flatten_dict(self._load_file(self.current_lang)) )
        if self.current_lang != self.default_lang:
            self.fallback_translations.update( self._flatten_dict(self._load_file(self.default_lang)) )
        else:
            self.fallback_translations = self.translations.copy()

    def set_language(self, code: str) -> None:
        """
        Updates the current language and reloads translation data.

        Args:
            code: The new language code (e.g., 'de', 'uk').
        """
        self.current_lang = code
        self.load_translations()

    def translate(self, key: str, *args) -> str:
        """
        Resolves a translation key into a string.

        Logic: 
        1. Search in current language.
        2. If not found, search in default (English).
        3. If still not found, return the key prefixed with '#'.

        Args:
            key: Dot-separated path (e.g., 'units.tank.name').

        Returns:
            The translated string or a debug key string.
        """
        result = self._get_nested_value(self.translations, key)
        if result: return result.format(*args)
        
        result = self._get_nested_value(self.fallback_translations, key)
        if result: return result.format(*args)
        
        return f"#{key}"

    def _get_nested_value(self, data: BaseCache, key_path: str) -> str | None:
        """
        Navigates through a nested dictionary using a dot-separated path.

        Args:
            data: The translation dictionary to search in.
            key_path: Path like 'category.item.property'.

        Returns:
            The string value if found, otherwise None.
        """
        return data.get(key_path, None)

    def _flatten_dict(self, d: dict, parent_key: str = '', sep: str = '.') -> dict[str, str]:
        """
        Recursively flattens a nested dictionary into a single-level dictionary 
        with dot-separated keys.
        """
        items = []
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            
            if isinstance(v, dict):
                items.extend(self._flatten_dict(v, new_key, sep=sep).items())
            else:
                items.append((new_key, str(v)))

        return dict(items)