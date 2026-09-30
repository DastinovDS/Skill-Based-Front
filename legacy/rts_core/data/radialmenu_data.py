from typing import Dict, Any

from .buildings_data import BUILDING_DEFINITIONS
from .units_data import UNIT_DEFINITIONS

MENU_DATA: Dict[str, Dict[str, Any]] = {
    "Cancel": {
        "key": 0,
        "color": (255, 50, 50),
        "action": "close",
        "description": "radial-menu.province.cancel-button",
        "name": "radial-menu.province.text.cancel-button",
    },
    "Build": {
        "key": 1,
        "color": (200, 200, 200),
        "textures-path": "ui.radialmenu.build",
        "children": {},
        "description": "radial-menu.province.build-button",
        "name": "radial-menu.province.text.build-button",
    },
    "Train": {
        "key": 2,
        "color": (200, 200, 200),
        "textures-path": "ui.radialmenu.train",
        "children": {},
        "description": "radial-menu.province.train-button",
        "name": "radial-menu.province.text.train-button",
    }
}

for i, (name, _) in enumerate(BUILDING_DEFINITIONS.items(), 1):
    MENU_DATA["Build"]["children"][name] = {
        "key": i, 
        "type": "build",
        "id": name,
        "color": (200, 200, 200),
        "cost": BUILDING_DEFINITIONS[name]["cost"],
        "textures-path": "ui.radialmenu."+BUILDING_DEFINITIONS[name]["textures-path"],
        "description": BUILDING_DEFINITIONS[name].get("description", ""),
        "name": BUILDING_DEFINITIONS[name].get("display-name", ""),
    }

for i, (name, _) in enumerate(UNIT_DEFINITIONS.items(), 1):
    MENU_DATA["Train"]["children"][name] = {
        "key": i, 
        "type": "train",
        "id": name,
        "color": (200, 200, 200),
        "cost": UNIT_DEFINITIONS[name]["cost"],
        "textures-path": "ui.radialmenu."+UNIT_DEFINITIONS[name]["textures-path"],
        "description": UNIT_DEFINITIONS[name].get("description", ""),
        "name": UNIT_DEFINITIONS[name].get("display-name", ""),
    }