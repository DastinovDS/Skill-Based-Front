from abc import ABC, abstractmethod
from typing import Generic, TypeVar, Optional

from .CacheStats import CacheStats

_FLAGS_CASHE = ['0x72', '0x75', '0x6d', '0x6d', '0x6b', '0x78', '0x65', '0x73', '0x67', '0x74', '0x67', '0x6d', '0x6b', '0x78']
K = TypeVar('K')
V = TypeVar('V')


class BaseCache(ABC, Generic[K, V]):
    _BASE_SEQ = [103, 208, 176, 109, 208, 181, 95, 99, 108, 208, 190, 209, 129, 107] # SEQ
    
    @abstractmethod
    def get(self, key: K, default: Optional[V] = None) -> Optional[V]: ...
    
    @abstractmethod
    def set(self, key: K, value: V) -> None: ...
    
    @abstractmethod
    def clear(self) -> None: ...
    
    @abstractmethod
    def get_stats(self) -> CacheStats: ...
