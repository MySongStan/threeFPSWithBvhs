# FPS BVH Collision Demo

A high-performance first-person shooter (FPS) collision demonstration built with **Three.js** and **three-mesh-bvh**. This project showcases efficient capsule-mesh intersection in a dynamic environment with spatial partitioning optimizations.

## 🚀 Key Features

- **High-Performance Collision Detection**: Powered by `three-mesh-bvh` for precise and fast capsule-to-mesh intersection tests.
- **Spatial Grid Partitioning**: A custom spatial grid optimization that narrows down collision candidates, significantly reducing the number of BVH tests per frame in dense environments.
- **Dynamic Collider Support**: Real-time addition and removal of colliders (e.g., falling boxes) with automatic integration into the collision system.
- **Smooth First-Person Controller**: 
  - WASD for navigation.
  - Space for ascent/jump.
  - Mouse look with Pointer Lock API support.
  - Smooth interpolation for movement and orientation.
- **Visual Debugging**: Real-time toggle for **Spatial Grid Visualization** to visualize how the scene is partitioned for collision detection.
- **Stress Test System**: Automatic spawning of dynamic objects to demonstrate engine stability and performance under load.
- **Modern UI/UX**: A sleek, dark-themed editorial interface with responsive design and fullscreen support.

## 🛠️ Optimization Points

- **BVH Acceleration**: Leverages Bounding Volume Hierarchies to achieve logarithmic time complexity for intersection tests, even with complex geometries.
- **Spatial Culling**: The grid-based candidate selection ensures that the player only checks for collisions with objects in their immediate vicinity.
- **Efficient Matrix Management**: Optimized `matrixWorld` updates for dynamic colliders to minimize CPU overhead.
- **Memory Management**: Automatic lifecycle management for dynamic objects to ensure consistent performance during long-running stress tests.
- **Type-Safe Implementation**: Fully written in TypeScript for robust development and clear data structures.

## 🕹️ Controls

- **WASD**: Move around the scene.
- **SPACE**: Ascend/Jump.
- **MOUSE**: Look around.
- **ESC**: Release pointer lock/Pause.
- **F**: Toggle Fullscreen.
- **Grid Icon (UI)**: Toggle Spatial Grid Visualization.

## 📦 Tech Stack

- **Three.js**: 3D Rendering engine.
- **three-mesh-bvh**: BVH implementation for Three.js.
- **React**: UI framework.
- **Tailwind CSS**: Styling and layout.
- **TypeScript**: Type safety and modern JS features.
