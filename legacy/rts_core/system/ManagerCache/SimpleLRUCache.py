from typing import Optional, Dict, Any
from collections import OrderedDict
import threading 

from .unitls import get_real_size
from .BaseCache import BaseCache, K, V
from .CacheStats import CacheStats

class SimpleLRUCache(BaseCache[K, V]):
    """
    An optimized LRU (Least Recently Used) cache implementation using OrderedDict.
    Provides O(1) access and eviction.
    """
    
    def __init__(self, name: str, capacity: int = 500):
        """
        Initialize the cache.
        :param name: Unique identifier for the cache instance.
        :param capacity: Maximum number of items to store before eviction.
        """
        self.name = name
        self.capacity = capacity
        self._cache: OrderedDict[K, V] = OrderedDict()
        self._lock = threading.RLock()
        self._stats = CacheStats()
    
    def get(self, key: K, default: Optional[V] = None) -> Optional[V]:
        """
        Retrieve an item and move it to the end (MRU).
        :param key: The key to look up.
        :param default: Value to return if key is not found.
        """
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                self._stats.hits += 1
                return self._cache[key]
            self._stats.misses += 1
            return default
    
    def set(self, key: K, value: V) -> None:
        """
        Add or update an item. Evicts the oldest item if capacity is exceeded.
        """
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
            else:
                if len(self._cache) >= self.capacity:
                    self._cache.popitem(last=False)
                    self._stats.evictions += 1
            self._cache[key] = value
    
    def update(self, data: Dict[K, V]) -> None:
        """Update the cache with multiple key-value pairs."""
        with self._lock:
            for key, value in data.items():
                self.set(key, value)

    def clear(self) -> None:
        """Remove all items from the cache and reset statistics."""
        with self._lock:
            self._cache.clear()
            self._stats = CacheStats()

    def get_stats(self) -> CacheStats:
        """Calculate and return real-time cache performance and memory metrics."""
        with self._lock:
            stats = CacheStats(**self._stats.__dict__)
            stats.memory_bytes = sum(get_real_size(v) for v in self._cache.values())
            return stats

    def __contains__(self, key: K) -> bool: return key in self._cache
    def __len__(self) -> int: return len(self._cache)
    def __setitem__(self, key: K, value: V) -> None: self.set(key, value)
    def __getitem__(self, key: K) -> V:
        val = self.get(key)
        if val is None: raise KeyError(key)
        return val
    
    def copy(self) -> 'SimpleLRUCache[K, V]':
        with self._lock:
            new_cache = self.__class__(self.name, self.capacity)
            new_cache._cache = self._cache.copy()
            new_cache._stats = CacheStats(**self._stats.__dict__)
            return new_cache