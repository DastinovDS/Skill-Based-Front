import numpy as np
import threading 
import time
import sys
from typing import Optional, Dict
from .BaseCache import BaseCache, K
from .CacheStats import CacheStats

class NumpyCache(BaseCache[K, np.ndarray]):
    """
    Memory-optimized cache for NumPy arrays with fixed shapes.
    Pre-allocates a contiguous memory block to reduce fragmentation.
    """
    
    def __init__(self, name: str, capacity: int = 500, 
                 dtype: np.dtype = np.float32, shape: Optional[tuple] = None): # type: ignore
        self.name = name
        self.capacity = capacity
        self.dtype = dtype
        self.shape = shape
        
        self._data = np.zeros((capacity, *shape), dtype=dtype) if shape else None
        self._keys: Dict[K, int] = {}
        self._index_to_key: Dict[int, K] = {}
        self._free_indices = list(range(capacity))
        
        self._lock = threading.RLock()
        self._stats = CacheStats()
        self._access_times = np.zeros(capacity, dtype=np.float64)
    
    def _evict_oldest(self) -> int:
        """
        Finds the index of the least recently used array using access timestamps.
        """
        active_indices = np.array(list(self._index_to_key.keys()))
        if active_indices.size == 0:
            return 0
        
        idx_in_active = np.argmin(self._access_times[active_indices])
        oldest_idx = active_indices[idx_in_active]
        
        oldest_key = self._index_to_key[oldest_idx]
        del self._keys[oldest_key]
        del self._index_to_key[oldest_idx]
        self._free_indices.append(oldest_idx)
        self._stats.evictions += 1
        
        return oldest_idx

    def set(self, key: K, value: np.ndarray) -> None:
        """Store a numpy array. Shape must match cache initialization."""
        with self._lock:
            if self.shape is None:
                self.shape = value.shape
                self._data = np.zeros((self.capacity, *self.shape), dtype=self.dtype)
            
            if key in self._keys:
                idx = self._keys[key]
            else:
                idx = self._free_indices.pop() if self._free_indices else self._evict_oldest()
                self._keys[key] = idx
                self._index_to_key[idx] = key
            
            self._data[idx] = value # type: ignore
            self._access_times[idx] = time.time()
    
    def get(self, key: K, default: Optional[np.ndarray] = None) -> Optional[np.ndarray]:
        with self._lock:
            if key in self._keys:
                idx = self._keys[key]
                self._access_times[idx] = time.time()
                self._stats.hits += 1
                return self._data[idx] if self._data is not None else None
            else:
                self._stats.misses += 1
                return default
            
    def clear(self) -> None:
        with self._lock:
            self._keys.clear()
            self._index_to_key.clear()
            self._free_indices = list(range(self.capacity))
            self._stats = CacheStats()
            self._access_times.fill(0.0)
            if self._data is not None:
                self._data.fill(0)

    def get_stats(self) -> CacheStats:
        with self._lock:
            stats = CacheStats(**self._stats.__dict__)
            if self._data is not None:
                stats.memory_bytes = self._data.nbytes
            stats.memory_bytes += sys.getsizeof(self._keys) * 2  # оба словаря
            return stats