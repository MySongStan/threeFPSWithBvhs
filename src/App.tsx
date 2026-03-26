import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PlayerController } from './lib/PlayerController';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [spawnMode, setSpawnMode] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const controllerRef = useRef<PlayerController | null>(null);
  const spawnModeRef = useRef(true);

  useEffect(() => {
    spawnModeRef.current = spawnMode;
  }, [spawnMode]);

  useEffect(() => {
    if (!containerRef.current) return;

    let renderer: THREE.WebGLRenderer;
    let camera: THREE.PerspectiveCamera;
    let colliderMesh: THREE.Mesh;
    let ghostPlayer: THREE.Group;
    let animationId: number;
    let handleResize: () => void;
    let onPointerLockChange: () => void;
    let onMouseMoveSpawn: (event: MouseEvent) => void;
    let spawnInterval: NodeJS.Timeout;

    const mouse = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    onMouseMoveSpawn = (event: MouseEvent) => {
      if (!spawnModeRef.current) return;
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    const onCanvasClick = (event: MouseEvent) => {
      if (!spawnModeRef.current || !controllerRef.current || !colliderMesh) return;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(colliderMesh);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        // Pass the ray direction to look where the mouse was pointing
        controllerRef.current.setPosition(
          point.clone().add(new THREE.Vector3(0, 1.9, 0)),
          raycaster.ray.direction
        );
        setSpawnMode(false);
        document.body.requestPointerLock();
        if (ghostPlayer) ghostPlayer.visible = false;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyF') {
        controllerRef.current?.toggleFullscreen();
      }
    };

    const bindEvents = () => {
      window.addEventListener('resize', handleResize);
      window.addEventListener('mousemove', onMouseMoveSpawn);
      window.addEventListener('click', onCanvasClick);
      window.addEventListener('keydown', onKeyDown);
      document.addEventListener('pointerlockchange', onPointerLockChange);
    };

    const unbindEvents = () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', onMouseMoveSpawn);
      window.removeEventListener('click', onCanvasClick);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
    };

    try {
      // --- Scene Setup ---
      console.log('Initializing scene...');
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0a);
      scene.fog = new THREE.Fog(0x0a0a0a, 0, 100);

      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      scene.add(camera);
      // Initial "God view"
      camera.position.set(0, 80, 80);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.shadowMap.enabled = true;
      containerRef.current.appendChild(renderer.domElement);
      console.log('Renderer attached to DOM');

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(20, 40, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 100;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // --- Environment (The Collider) ---
    const environment = new THREE.Group();
    scene.add(environment);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(200, 2, 200),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 })
    );
    floor.position.y = -1;
    floor.receiveShadow = true;
    environment.add(floor);

    // Some obstacles
    for (let i = 0; i < 50; i++) {
      const size = Math.random() * 5 + 2;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ 
            color: new THREE.Color().setHSL(Math.random(), 0.5, 0.5),
            roughness: 0.5
        })
      );
      box.position.set(
        (Math.random() - 0.5) * 80,
        size / 2,
        (Math.random() - 0.5) * 80
      );
      box.castShadow = true;
      box.receiveShadow = true;
      environment.add(box);
    }

    // Stairs/Ramps
    for (let i = 0; i < 15; i++) {
        const step = new THREE.Mesh(
            new THREE.BoxGeometry(10, 0.5, 4),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
        );
        step.position.set(20, i * 0.5, i * 2 - 20);
        step.castShadow = true;
        step.receiveShadow = true;
        environment.add(step);
    }

    // --- BVH Generation ---
    console.log('Generating BVH...');
    const geometries: THREE.BufferGeometry[] = [];
    environment.updateMatrixWorld(true);
    environment.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            const clonedGeom = child.geometry.clone();
            clonedGeom.applyMatrix4(child.matrixWorld);
            geometries.push(clonedGeom);
        }
    });

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    mergedGeometry.boundsTree = new MeshBVH(mergedGeometry);
    console.log('BVH generated successfully');
    
    colliderMesh = new THREE.Mesh(mergedGeometry, new THREE.MeshStandardMaterial({ visible: false }));
    scene.add(colliderMesh);

    // --- Ghost Player (Visual Aid) ---
    ghostPlayer = new THREE.Group();
    const ghostBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 1, 4, 8),
      new THREE.MeshStandardMaterial({ 
        color: 0x00ff88, 
        transparent: true, 
        opacity: 0.5,
        emissive: 0x00ff88,
        emissiveIntensity: 0.5
      })
    );
    ghostBody.position.y = 0.8; // Half height
    ghostPlayer.add(ghostBody);
    scene.add(ghostPlayer);

    // --- Player Controller ---
    console.log('Initializing PlayerController...');
    const controller = new PlayerController(camera, scene, renderer.domElement);
    controllerRef.current = controller;
    
    const staticBVH = mergedGeometry.boundsTree as MeshBVH;
    controller.setCollider(staticBVH);
    console.log('PlayerController initialized');

    // --- Dynamic Boxes Stress Test ---
    const dynamicBoxes: { id: string; mesh: THREE.Mesh; bvh: MeshBVH }[] = [];
    const boxGeometry = new THREE.BoxGeometry(4, 4, 4);
    boxGeometry.computeBoundingBox();
    const boxBVH = new MeshBVH(boxGeometry);

    const updateColliders = () => {
      if (!controllerRef.current) return;
      controllerRef.current.clearColliders();
      controllerRef.current.addCollider('static-env', staticBVH);
      dynamicBoxes.forEach(box => {
        box.mesh.updateMatrixWorld();
        controllerRef.current?.addCollider(box.id, box.bvh, box.mesh.matrixWorld);
      });
    };

    spawnInterval = setInterval(() => {
      if (spawnModeRef.current) return; // Don't spawn while in selection mode

      if (dynamicBoxes.length < 30) {
        // Add a box
        const id = `box-${Math.random().toString(36).substr(2, 9)}`;
        const material = new THREE.MeshStandardMaterial({ 
          color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
          emissive: new THREE.Color().setHSL(Math.random(), 0.7, 0.2),
        });
        const mesh = new THREE.Mesh(boxGeometry, material);
        mesh.position.set(
          (Math.random() - 0.5) * 60,
          Math.random() * 20 + 2,
          (Math.random() - 0.5) * 60
        );
        mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        dynamicBoxes.push({ id, mesh, bvh: boxBVH });
      } else {
        // Remove oldest box
        const oldest = dynamicBoxes.shift();
        if (oldest) {
          scene.remove(oldest.mesh);
          if (Array.isArray(oldest.mesh.material)) {
            oldest.mesh.material.forEach(m => m.dispose());
          } else {
            oldest.mesh.material.dispose();
          }
        }
      }
      updateColliders();
    }, 1000);

    // --- Pointer Lock ---
    onPointerLockChange = () => {
      setIsLocked(document.pointerLockElement === document.body);
    };

    handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    bindEvents();

    // --- Animation Loop ---
    const clock = new THREE.Clock();
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      try {
        const delta = Math.min(clock.getDelta(), 0.1);
        
        if (controllerRef.current && !spawnModeRef.current) {
          controllerRef.current.update(delta);
        } else if (spawnModeRef.current && colliderMesh && ghostPlayer) {
          // Update ghost player position
          raycaster.setFromCamera(mouse, camera);
          const intersects = raycaster.intersectObject(colliderMesh);
          if (intersects.length > 0) {
            ghostPlayer.position.copy(intersects[0].point);
            ghostPlayer.visible = true;
          } else {
            ghostPlayer.visible = false;
          }
        }
        
        renderer.render(scene, camera);
      } catch (err) {
        console.error('Render error:', err);
        setInitError(err instanceof Error ? err.message : String(err));
      }
    };
    animate();
    console.log('Animation loop started');

    } catch (err) {
      console.error('Initialization error:', err);
      setInitError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      unbindEvents();
      clearInterval(spawnInterval);
      if (controllerRef.current) {
        controllerRef.current.unbindEvents();
      }
      if (animationId) cancelAnimationFrame(animationId);
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  const lockPointer = () => {
    document.body.requestPointerLock();
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-sans">
      {initError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 text-red-500 p-4 text-center">
          <div>
            <h2 className="text-xl font-bold mb-2">Initialization Error</h2>
            <p className="font-mono text-sm">{initError}</p>
            <button 
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      
      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
        <div className="w-6 h-6 border border-white/40 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 bg-white" />
      </div>

      {/* UI Overlay */}
      {spawnMode && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="text-center p-8 bg-zinc-900/80 rounded-2xl border border-white/20 shadow-2xl">
            <h1 className="text-3xl font-black text-white mb-2 tracking-tighter uppercase italic">SELECT SPAWN POINT</h1>
            <p className="text-zinc-300 text-sm font-light">
              Click anywhere in the scene to enter first-person mode.
            </p>
          </div>
        </div>
      )}

      {!isLocked && !spawnMode && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md transition-all duration-500">
          <div className="text-center p-12 bg-zinc-900/50 rounded-3xl border border-white/10 shadow-2xl max-w-lg">
            <h1 className="text-5xl font-black text-white mb-6 tracking-tighter uppercase italic">FPS BVH DEMO</h1>
            <p className="text-zinc-400 mb-10 text-lg font-light">
              High-performance collision detection powered by <span className="text-white font-medium">three-mesh-bvh</span>. 
              Experience smooth movement and precise physics.
            </p>
            <button
              onClick={lockPointer}
              className="group relative px-12 py-4 bg-white text-black font-bold rounded-full overflow-hidden transition-all hover:scale-105 active:scale-95 shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              <span className="relative z-10">RESUME SYSTEM</span>
              <div className="absolute inset-0 bg-zinc-200 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
            </button>
            <div className="mt-12 grid grid-cols-2 gap-4 text-[10px] text-zinc-500 uppercase tracking-widest font-mono">
              <div className="p-3 border border-white/5 rounded-lg bg-black/20">WASD: NAVIGATION</div>
              <div className="p-3 border border-white/5 rounded-lg bg-black/20">SPACE: ASCEND</div>
              <div className="p-3 border border-white/5 rounded-lg bg-black/20">MOUSE: ORIENTATION</div>
              <div className="p-3 border border-white/5 rounded-lg bg-black/20">ESC: DISCONNECT</div>
            </div>
          </div>
        </div>
      )}

      {/* Stats/Debug info */}
      <div className="absolute bottom-6 left-6 flex flex-col gap-1">
        <div className="text-white/20 text-[9px] font-mono uppercase tracking-[0.2em]">
          Engine: Three.js + three-mesh-bvh
        </div>
        <div className="text-white/20 text-[9px] font-mono uppercase tracking-[0.2em]">
          Collision: Capsule-Mesh Intersection
        </div>
        <div className="text-white/20 text-[9px] font-mono uppercase tracking-[0.2em]">
          Fullscreen: {isFullscreen ? 'ON' : 'OFF'} (Press F)
        </div>
      </div>

      {/* Debug/Grid Toggle Button */}
      <button 
        onClick={() => {
          if (controllerRef.current) {
            controllerRef.current.showGrid = !controllerRef.current.showGrid;
            controllerRef.current.updateGridVisuals();
          }
        }}
        className="absolute top-6 right-20 z-50 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/40 transition-all backdrop-blur-sm cursor-pointer"
        title="Toggle Spatial Grid Visualization"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
      </button>

      {/* Fullscreen Button */}
      <button 
        onClick={() => controllerRef.current?.toggleFullscreen()}
        className="absolute top-6 right-6 z-50 p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-white/40 transition-all backdrop-blur-sm cursor-pointer"
        title="Toggle Fullscreen (F)"
      >
        {isFullscreen ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        )}
      </button>
    </div>
  );
}
