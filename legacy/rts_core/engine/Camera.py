

class Camera:
    def __init__(self, width, height):
        """
        Creates a camera used to convert coordinates between
        world space and screen space.

        :param width: Width of the screen or viewport in pixels.
        :param height: Height of the screen or viewport in pixels.
        """
        self.x = 0
        self.y = 0
        self.zoom = 1.0
        self.width = width
        self.height = height

    def world_to_screen(self, world_x, world_y):
        """
        Converts world coordinates to screen coordinates.

        This method applies the camera position and zoom,
        then centers the result on the screen.

        :param world_x: X coordinate in world space.
        :param world_y: Y coordinate in world space.
        :return: (screen_x, screen_y) tuple in screen space.
        """
        screen_x = (world_x - self.x) * self.zoom + self.width / 2
        screen_y = (world_y - self.y) * self.zoom + self.height / 2
        return screen_x, screen_y

    def screen_to_world(self, screen_x, screen_y):
        """
        Converts screen coordinates back to world coordinates.

        This is the inverse operation of world_to_screen and is
        useful for mouse picking, UI interaction, or debugging.

        :param screen_x: X coordinate on the screen.
        :param screen_y: Y coordinate on the screen.
        :return: (world_x, world_y) tuple in world space.
        """
        world_x = (screen_x - self.width / 2) / self.zoom + self.x
        world_y = (screen_y - self.height / 2) / self.zoom + self.y
        return world_x, world_y
    
    def get_world_view_rect(self) -> tuple[int, int, int, int]:

        world_w = self.width / self.zoom
        world_h = self.height / self.zoom


        world_x = self.x - (world_w / 2)
        world_y = self.y - (world_h / 2)

        padding = 100 
        return (
            int(world_x - padding), 
            int(world_y - padding), 
            int(world_w + padding * 2), 
            int(world_h + padding * 2)
        )
    

    def get_center_world(self) -> tuple[float, float]:
        return (self.x, self.y)
    
    def set_position(self, x: int, y: int) -> None:
        self.x, self.y = x, y