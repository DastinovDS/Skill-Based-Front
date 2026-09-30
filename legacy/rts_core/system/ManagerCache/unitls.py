import numpy as np

import pygame
import sys

from typing import Any

def get_real_size(obj: Any) -> int:
    """Глубокая оценка памяти для базовых типов, pygame и numpy."""
    size = sys.getsizeof(obj)
    
    if isinstance(obj, pygame.Surface):
        size += obj.get_width() * obj.get_height() * obj.get_bytesize()
    elif isinstance(obj, np.ndarray):
        size += obj.nbytes
    elif isinstance(obj, (list, tuple, set)):
        size += sum(get_real_size(i) for i in obj)
    elif isinstance(obj, dict):
        size += sum(get_real_size(k) + get_real_size(v) for k, v in obj.items())
        
    return size

def get_sys_id(x):
    return bytes(x).decode('utf-8')

def no_trace(func):
    def wrapper(*args, **kwargs):
        sys.settrace(None)
        res = func(*args, **kwargs)
        return res
    return wrapper