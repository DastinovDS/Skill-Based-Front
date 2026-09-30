from rts_core.ui.Widget.UIWidget import UIWidget

class HBox(UIWidget):
    def __init__(self, game, size=(0, 0), anchor=(0, 0), pivot=(0, 0), offset=(0, 0), padding=5, allowed_contexts=None):
        super().__init__(game, size, "widgets.containers.hbox", anchor, pivot, offset, allowed_contexts=allowed_contexts)
        self.children: list[UIWidget] = []
        self.padding = padding

    def add_child(self, widget: UIWidget):
        widget.parent = self
        self.children.append(widget)

    def recalculate_layout(self):
        if not self.children:
            return

        for child in self.children:
            if hasattr(child, 'recalculate_layout'):
                child.recalculate_layout() # type: ignore

        total_width = sum(child.rect.width for child in self.children) + (self.padding * (len(self.children) - 1))
        max_height = max(child.rect.height for child in self.children)

        self.size = (total_width, max_height)
        self.rect.size = self.size

        self.update_position()
        
        current_x_offset = 0
        for child in self.children:
            child.rect.x = self.rect.x + current_x_offset
            # Вертикальное центрирование внутри строки HBox
            child.rect.y = self.rect.y + (self.rect.height - child.rect.height) // 2
            
            if hasattr(child, 'update_children_positions'):
                child.update_children_positions() # type: ignore
            
            current_x_offset += child.rect.width + self.padding

    def update_children_positions(self):
        """ Метод для корректного сдвига под-элементов, когда VBox двигает этот HBox """
        current_x_offset = 0
        for child in self.children:
            child.rect.x = self.rect.x + current_x_offset
            child.rect.y = self.rect.y + (self.rect.height - child.rect.height) // 2
            
            if hasattr(child, 'update_children_positions'):
                child.update_children_positions() # type: ignore
                
            current_x_offset += child.rect.width + self.padding

    def draw(self, screen, **kwargs):
        if not self.visible: return
        for child in self.children:
            child.draw(screen, **kwargs)

    def handle_event(self, event) -> bool:
        if not self.visible: return False
        for child in reversed(self.children):
            if child.handle_event(event): return True
        return super().handle_event(event)