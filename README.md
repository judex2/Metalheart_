# METALHEART_

An atmospheric, tech-brutalist 1v1 tactical grid dueling game featuring a host-authoritative P2P architecture, fluid spatial mechanics, and a haunting 10-tier single-player roguelike narrative campaign.

![License](https://img.shields.io/badge/license-MIT-clean?style=flat-square)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-black?style=flat-square)
![Engine](https://img.shields.io/badge/engine-Custom%20Web3D%20%2F%20Antigravity-teal?style=flat-square)

---

## Visual Art Direction

`METALHEART` leverages a deliberate **premium editorial digital collage** and **retro PS1 low-poly aesthetic**. All elements, arenas, and characters are built using flat-shaded, unshaded low-poly primitive meshes (`.obj`) to ensure fast client-side rendering, sharp network replication, and absolute readability under extreme combat conditions.

* **Core Palette:** Matte Concrete Grays, Stark Electric Teal, Deep Blood Crimson, and Blinding Golden Sunsets.
* **Rendering Pipeline:** Custom screen-space displacement shaders for atmospheric status effects (Cloud, Decay, Echo) wrapped over flat, jagged polygonal geometries.

---

## Core Systems Architecture

### 1. The 4-Slot Combo Construction Grid
Combat is resolved through a strict, high-stakes tactical queue. Players construct spells by combining core elements inside an active grid matrix. The host-authoritative simulation engine calculates trajectories, barriers, and status overrides deterministically across both peers.
