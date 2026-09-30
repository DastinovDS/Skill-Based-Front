from rts_core.ui.Widget.UIWidget import UIWidget

class VBox(UIWidget):
    def __init__(self, game, size=(0, 0), anchor=(0, 0), pivot=(0, 0), offset=(0, 0), padding=5, allowed_contexts=None):
        super().__init__(game, size, "widgets.containers.vbox", anchor, pivot, offset, allowed_contexts=allowed_contexts)
        self.children: list[UIWidget] = []
        self.padding = padding

    def add_child(self, widget: UIWidget):
        widget.parent = self
        self.children.append(widget)
        # self.recalculate_layout()

    def recalculate_layout(self):
        if not self.children:
            return

        for child in self.children:
            if hasattr(child, 'recalculate_layout'):
                child.recalculate_layout() # type: ignore

        # Теперь размеры всех детей известны, считаем размеры текущего VBox
        max_width = max(child.rect.width for child in self.children)
        total_height = sum(child.rect.height for child in self.children) + (self.padding * (len(self.children) - 1))

        self.size = (max_width, total_height)
        self.rect.size = self.size
        
        # 2. Этап позиционирования (Сверху вниз):
        # Обновляем позицию самого VBox относительно его родителя
        self.update_position()

        # Расставляем детей строго по центру горизонтально внутри VBox
        current_y_offset = 0
        for child in self.children:
            # Центрирование по X: координата X контейнера + (половина ширины контейнера - половина ширины ребенка)
            child.rect.x = self.rect.x + (self.rect.width - child.rect.width) // 2
            child.rect.y = self.rect.y + current_y_offset
            
            # Просим дочерний контейнер (VBox или HBox) обновить позиции его под-элементов
            if hasattr(child, 'update_children_positions'):
                child.update_children_positions() # type: ignore
            
            current_y_offset += child.rect.height + self.padding

    def update_children_positions(self):
        """ Вспомогательный метод для обновления позиций детей без изменения размеров """
        current_y_offset = 0
        for child in self.children:
            child.rect.x = self.rect.x + (self.rect.width - child.rect.width) // 2
            child.rect.y = self.rect.y + current_y_offset
            
            if hasattr(child, 'update_children_positions'):
                child.update_children_positions() # type: ignore
                
            current_y_offset += child.rect.height + self.padding

    def draw(self, screen, **kwargs):
        if not self.visible: return
        for child in self.children:
            child.draw(screen, **kwargs)

    def handle_event(self, event) -> bool:
        if not self.visible: return False
        for child in reversed(self.children):
            if child.handle_event(event): return True
        return super().handle_event(event)