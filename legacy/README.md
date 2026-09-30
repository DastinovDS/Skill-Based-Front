# Skill-Based Front (Codename)
### **The Turbo-Grand Strategy Engine**

**Skill-Based Front** is an ambitious Real-Time Geo-Political Strategy (RTGS) engine built in Python. Inspired by the ancient game of **Go** and the tactical depth of **OpenFront**, this project aims to bridge the gap between deep grand strategies and fast-paced session gaming.

> **The Vision:** No Pay-to-Win, no tedious waiting, and a focus on geometric strategy where skill and supply lines determine the victor.

---

## Core Philosophy

* **Turbo-Sessions:** Designed for 2.5 to 4-hour matches — perfect for a "Board Game Night" timeframe.
* **Go-Inspired Strategy:** Victory is achieved through encirclements, supply line management, and mastering the concepts of *Sente* (initiative) and *Gote* (defense), rather than just raw unit stats.
* **Skill-Based & Fair:** Zero microtransactions affecting gameplay. The engine is built for competitive integrity.
* **Modern Minimalism:** Moving away from cluttered 2010s-style interfaces toward a sleek, high-tech military HUD focused on data visualization and "Juice."

---

## Technical Stack & Architecture

The project follows a **System-Oriented Design** to ensure scalability and performance:

* **Language:** Python 3.10+
* **Graphics:** `Pygame` (Core) with planned `ModernGL` integration for shaders.
* **Data Processing:** Transitioning toward `Polars` for vectorized calculations (handling thousands of entities efficiently).
* **Systems Architecture:**
    * **Universal Scheduler:** A centralized engine handling all time-based tasks (construction, unit training).
    * **Decoupled Logic:** Independent modules for `Combat`, `Movement`, `Pathfinding`, and `Production`.
    * **Graph-Based Map:** Provinces act as nodes in a graph, enabling complex supply and influence calculations.

---

## 📁 Project Structure


```text
.
├── rts_core/
│   ├── classes/          # Core Data Entities (Player, Province, Building, Unit)
│   ├── game_logic/       # Pure Systems (Combat, Movement, Scheduler, Production)
│   ├── data/             # Game Definitions (Unit stats, Building costs)
│   ├── ui/               # I/O Layer (Renderer, InputHandler, SpriteManager)
│   └── setup/            # World Generation & Initialization
├── main.py               # Application Entry Point & Game Loop
└── logs/                 # Combat & System Event Logging
```

---

## Key Features Implemented
- [x] Universal Scheduler: A unified system for all production queues, reducing code redundancy.

- [x] Tactical Combat: Real-time battle resolution with armor absorption, attack cooldowns, and damage scaling.
  
- [x] Dynamic Movement: Node-to-node pathfinding with travel time calculations.

- [x] Province Economy: Multi-resource production system influenced by urban development and infrastructure.

- [x] Smart Input: Context-aware controls with hotkey support (M for Mines, B for Barracks, T for Training).

# Roadmap

Supply Line System (Go Mechanics): Implementing BFS-based connectivity checks. Provinces cut off from the capital will suffer production and combat penalties.

Fog of War: Sight-radius implementation for units and provinces.

National Focus Tree: A macro-management automation system to reduce tedious micro-tasks.

Networking: Moving from Local vs AI to high-performance WAN multiplayer.

## Installation & Quick Start

> Requirements: Ensure you have Python 3.10 or higher installed.

```Bash
python --version
```
> Setup: Install the necessary dependencies:

```Bash
pip install pygame
```
> Run: Execute the main script to start the engine:

```Bash
python main.py
```
