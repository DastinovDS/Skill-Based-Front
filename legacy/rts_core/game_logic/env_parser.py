import os

class ENVParser:
    def __init__(self, file_path: str = ".env") -> None:
        self.file_path = file_path

    def load(self) -> None:
        if not os.path.exists(self.file_path):
            return

        with open(self.file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                
                if not line or line.startswith("#"):
                    continue
                
                if "=" in line:
                    key, value = line.split("=", 1)
                    
                    key = key.strip()
                    value = value.strip().strip("'").strip('"')
                    
                    os.environ[key] = value

    def get(self, key: str, default: str | None = None) -> str:
        return os.environ.get(key, default) # type: ignore

    def get_bool(self, key: str, default: bool = False) -> bool:
        val = os.environ.get(key)
        if val is None:
            return default
        return val.lower() in ("true", "1", "yes", "on")

    def get_int(self, key: str, default: int = 0) -> int:
        try:
            return int(os.environ.get(key, default))
        except (ValueError, TypeError):
            return default