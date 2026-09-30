from rts_core.classes import Province

def find_path(start_province: Province, end_province: Province) -> list[Province] | None:
    """
    BFS pathfinding algorithm
    :param start_province: Province from where unit group starts to move
    :param end_province: Province where unit group ends to move
    :return: list[Province] | None
    """
    if start_province == end_province:
        return []

    queue = []
    parents = {}
    queue.append(start_province)
    parents[start_province] = None

    while len(queue) > 0:
        current_prov: Province = queue.pop(0)

        if current_prov == end_province:
            path = []
            temp_prov = end_province
            while temp_prov != start_province:
                path.append(temp_prov)
                temp_prov = parents[temp_prov]

            path.reverse()
            return path

        for neighbor in current_prov.neighbors:
            if neighbor not in parents:
                parents[neighbor] = current_prov
                queue.append(neighbor)

    return []