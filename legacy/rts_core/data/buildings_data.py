from typing import Dict, Any

BUILDING_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "Metal Mine": {
        "cost": {"Money": 100, "Metal": 50},
        "production": {"Metal": 0.1},
        "construction_time": 30.0,
        "textures-path": "builds.metal_mine",
        "description": "buildings.metal-mine.description-tipp",
        "display-name": "buildings.metal-mine.name",
    },
    "Barracks": {
        "cost": {"Money": 150, "Metal": 0},
        "production": {},
        "construction_time": 2.0, # Value to test if barracks will be built
        "textures-path": "builds.barracks",
        "description": "buildings.barracks.description-tipp",
        "display-name": "buildings.barracks.name",
    },
    "Factory": {
        "cost": {"Money": 300, "Metal": 150},
        "production": {"Metal": 0.2, "Oil": 0.1},
        "construction_time": 60.0,
        "textures-path": "builds.factory",
        "description": "buildings.factory.description-tipp",
        "display-name": "buildings.factory.name",
    },
}