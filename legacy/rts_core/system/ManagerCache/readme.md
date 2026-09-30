
## Unified Caching Framework

A high-performance, thread-safe memory management suite designed for resource-intensive applications. It provides specialized caching strategies for general Python objects and heavy numerical data (NumPy).

### Core Components

* **`CacheManager`**: A thread-safe Singleton that orchestrates cache lifecycles, global statistics, and automated memory optimization.
* **`SimpleLRUCache`**: An  Least Recently Used cache backed by an `OrderedDict`. Optimized for generic objects like `pygame.Surface`, localized strings, or pre-computed game logic.
* **`NumpyCache`**: A memory-optimized cache for NumPy arrays. It utilizes **memory pre-allocation** to minimize Garbage Collector pressure and fragmentation during high-frequency data updates.

### Key Features

* **Thread Safety**: All operations are protected by `threading.RLock`, allowing safe access from rendering, logic, and resource-loading threads.
* **Deep Memory Inspection**: Real-time memory tracking using `get_real_size`, which accounts for unmanaged memory in `pygame.Surface` and `numpy.ndarray`.
* **Heuristic Optimization**: The `optimize_memory` routine can automatically evict low-performance caches (based on hit-ratio) when the system hits a defined memory ceiling.

---

## Quick Start for Developers

### 1. Initialize or Access a Cache

Caches are managed via the `CacheManager`. You don't instantiate caches directly; let the manager handle the lifecycle.

```python
from framework.cache import CacheManager

manager = CacheManager()

# Create/Access a standard LRU cache
sprite_cache = manager.get_or_create("render_zoom", cache_type="lru", capacity=1000)

# Create/Access a specialized NumPy cache for heightmaps
map_cache = manager.get_or_create(
    "terrain_data", 
    cache_type="numpy", 
    capacity=50, 
    shape=(512, 512), 
    dtype=np.float32
)

```

### 2. Basic Operations (SimpleLRUCache)

The `SimpleLRUCache` implements the standard mapping interface.

```python
# Check and Get
if "player_idle" in sprite_cache:
    surf = sprite_cache["player_idle"]
else:
    surf = generate_scaled_surface()
    sprite_cache["player_idle"] = surf

# Batch updates (useful for Localization/Configs)
lang_data = {"ui.start": "Start", "ui.quit": "Exit"}
translations = manager.get_or_create("loc_en")
translations.update(lang_data)

```

### 3. Numerical Data (NumpyCache)

Designed for fixed-shape arrays. Setting a value into a `NumpyCache` performs a memory copy into pre-allocated buffers.

```python
# Data must match the initialized shape and dtype
height_data = np.random.rand(512, 512).astype(np.float32)
map_cache.set("sector_a1", height_data)

# Retrieval returns a view into the pre-allocated block
cached_map = map_cache.get("sector_a1")

```

### 4. Memory Management & Stats

Use the manager to prevent memory leaks and monitor performance.

```python
# Get global performance report
stats = manager.get_stats_summary()
print(f"Total Cache Usage: {stats['total_memory_mb']:.2f} MB")

# Force optimize if memory exceeds 500MB
# Low hit-ratio caches will be cleared first
manager.optimize_memory(max_memory_mb=500.0)

# Wipe everything (e.g., during level transitions)
manager.clear_all()

```

---

## Implementation Notes

* **Key Selection**: Avoid using large objects as keys. For `pygame.Surface`, use `id(surface)` or a descriptive string/tuple to keep the `OrderedDict` overhead minimal.
* **Numpy Shape**: `NumpyCache` requires all stored arrays to share the same dimensions. If dimensions vary, use `SimpleLRUCache` instead.
* **Eviction Policy**: Eviction is strictly LRU. Accessing a key via `get()` or `__getitem__` automatically promotes it to the "Most Recently Used" position.
