from typing import Dict, Any

UNIT_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "Infantry": {
        "cost": {"Money": 50, "Food": 0}, # Test values
        "upkeep": {"Food": 0.01},
        "training_time": 1.0, # Test values

        "attack_damage": 5,
        "max_health": 20,
        "armor": 1,
        "attack_cooldown": 1.0,
        "attack_range": 0.0,
        "combat_stance": None,

        "dependencies": ["Barracks"],

        "textures-path": "units.infantry",
        "description": "units.infantry.description-tipp",
        "display-name": "units.infantry.name",
    },

    "Tank": {
        "cost": {"Money": 200, "Metal": 100, "Oil": 50},
        "upkeep": {"Money": 0.05, "Oil": 0.02},
        "training_time": 45.0,

        "attack_damage": 30,
        "max_health": 150,
        "armor": 10,
        "attack_cooldown": 2.0,
        "attack_range": 0.0,
        "combat_stance": None,

        "dependencies": ["Barracks"],
        
        "textures-path": "units.tank",
        "description": "units.tank.description-tipp",
        "display-name": "units.tank.name",
    },
    "Artillery": {
        "cost": {"Money": 20},
        "upkeep": {"Money": 0.0},
        "training_time": 1.0,

        "attack_damage": 30,
        "max_health": 20,
        "armor": 0,
        "attack_cooldown": 10.0,
        "attack_range": 170.0,
        "combat_stance": "AGGRESSIVE",

        "dependencies": ["Barracks"],

        "textures-path": "units.artillery",
        "description": "units.artillery.description-tipp",
        "display-name": "units.artillery.name",
    },
}