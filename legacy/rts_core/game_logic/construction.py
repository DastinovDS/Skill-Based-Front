import typing

class EconomyManager:
    def __init__(self, ctx: typing.Any):
        self.ctx = ctx

    def update(self, dt: float) -> None:
        self._update_production(dt)

    def _update_production(self, dt: float) -> None:
        """
        This function updates production for all players in the game and gives them resources from queries.
        :param game: needed to gain access to game state
        :param dt: delta time
        :return: None
        """
        for player in self.ctx.players:
            for province in player.provinces.values():
                for resource, rate in province.base_production.items():
                    player.resources[resource] += rate * dt

            for building in player.buildings.values():
                if building.status == 'Active':
                    for resource, rate in building.production.items():
                        player.resources[resource] += rate * dt