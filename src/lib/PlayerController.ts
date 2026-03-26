import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';

export interface Collider {
  bvh: MeshBVH;
  matrix: THREE.Matrix4;
  invMatrix: THREE.Matrix4;
}

export class PlayerController {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  colliders: Collider[] = [];
  worldBounds = new THREE.Box3();
  
  playerVelocity = new THREE.Vector3();
  playerOnGround = false;
  
  // Spawn info for resetting
  spawnPosition = new THREE.Vector3();
  spawnDirection: THREE.Vector3 | null = null;
  
  // Player dimensions
  playerRadius = 0.5;
  playerHeight = 1.9;
  
  // Movement settings
  baseSpeed = 12;
  sprintSpeed = 22;
  jumpForce = 12;
  gravity = -35;
  
  // Input state
  keys: { [key: string]: boolean } = {};
  mouseDelta = new THREE.Vector2();
  
  private onKeyDown = (e: KeyboardEvent) => { this.keys[e.code] = true; };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.domElement || document.pointerLockElement === document.body) {
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
    }
  };

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, domElement: HTMLElement) {
    this.camera = camera;
    this.scene = scene;
    this.domElement = domElement;
    this.camera.rotation.order = 'YXZ';
    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  unbindEvents() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
  }

  clearColliders() {
    this.colliders = [];
    this.worldBounds.makeEmpty();
  }

  addCollider(bvh: MeshBVH, matrix: THREE.Matrix4 = new THREE.Matrix4().identity()) {
    const invMatrix = new THREE.Matrix4().copy(matrix).invert();
    this.colliders.push({ bvh, matrix, invMatrix });
    
    // Update world bounds
    if (bvh.geometry.boundingBox) {
      const box = bvh.geometry.boundingBox.clone();
      box.applyMatrix4(matrix);
      this.worldBounds.union(box);
    }
  }

  // Keep for backward compatibility or simple cases
  setCollider(bvh: MeshBVH) {
    this.clearColliders();
    this.addCollider(bvh);
  }

  setPosition(pos: THREE.Vector3, direction?: THREE.Vector3) {
    this.spawnPosition.copy(pos);
    this.spawnDirection = direction ? direction.clone() : null;
    
    this.camera.position.copy(pos);
    
    if (direction) {
      const target = this.camera.position.clone().add(direction);
      this.camera.lookAt(target);
    }
    
    // Level the head: reset pitch (X) and roll (Z), keep yaw (Y)
    this.camera.rotation.set(0, this.camera.rotation.y, 0);
    this.playerVelocity.set(0, 0, 0);
    this.playerOnGround = false;
  }

  update(delta: number) {
    if (this.colliders.length === 0) return;
    
    // 0. Safety: Check for NaN and reset if necessary
    if (isNaN(this.camera.position.x) || isNaN(this.camera.position.y) || isNaN(this.camera.position.z)) {
      this.setPosition(this.spawnPosition, this.spawnDirection || undefined);
      return;
    }

    const dt = Math.min(delta, 0.1);

    // 1. Rotation
    const rotationSpeed = 0.002;
    this.camera.rotation.y -= this.mouseDelta.x * rotationSpeed;
    this.camera.rotation.x -= this.mouseDelta.y * rotationSpeed;
    this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
    this.mouseDelta.set(0, 0);

    // 2. Movement Input & Sprint
    const isSprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const currentSpeed = isSprinting ? this.sprintSpeed : this.baseSpeed;
    
    const moveVector = new THREE.Vector3();
    if (this.keys['KeyW']) moveVector.z -= 1;
    if (this.keys['KeyS']) moveVector.z += 1;
    if (this.keys['KeyA']) moveVector.x -= 1;
    if (this.keys['KeyD']) moveVector.x += 1;
    moveVector.normalize();
    
    const angle = this.camera.rotation.y;
    const sideVector = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    const forwardVector = new THREE.Vector3(-Math.sin(angle), 0, -Math.cos(angle));
    
    const velocity = forwardVector.multiplyScalar(-moveVector.z).add(sideVector.multiplyScalar(moveVector.x));
    velocity.multiplyScalar(currentSpeed);
    
    this.playerVelocity.x = velocity.x;
    this.playerVelocity.z = velocity.z;
    
    // 3. Gravity & Jump
    if (this.playerOnGround) {
      if (this.keys['Space']) {
        this.playerVelocity.y = this.jumpForce;
        this.playerOnGround = false;
      } else {
        this.playerVelocity.y = 0;
      }
    } else {
      this.playerVelocity.y += this.gravity * dt;
    }

    // 4. Physics & Collision
    this.camera.position.addScaledVector(this.playerVelocity, dt);
    
    // Cap extreme velocity to prevent tunneling
    const maxVelocity = 100;
    if (this.playerVelocity.length() > maxVelocity) {
      this.playerVelocity.setLength(maxVelocity);
    }

    this.checkCollisions();

    // 5. Fall & Out-of-Bounds Check
    const fallThreshold = this.worldBounds.min.y - 20;
    const horizontalMargin = 100;
    
    const isBelowFloor = this.camera.position.y < fallThreshold;
    const isTooFarX = Math.abs(this.camera.position.x) > Math.max(Math.abs(this.worldBounds.min.x), Math.abs(this.worldBounds.max.x)) + horizontalMargin;
    const isTooFarZ = Math.abs(this.camera.position.z) > Math.max(Math.abs(this.worldBounds.min.z), Math.abs(this.worldBounds.max.z)) + horizontalMargin;

    if (isBelowFloor || isTooFarX || isTooFarZ) {
      this.setPosition(this.spawnPosition, this.spawnDirection || undefined);
    }
  }

  checkCollisions() {
    if (this.colliders.length === 0) return;

    const capsuleRadius = this.playerRadius;
    const capsuleHeight = this.playerHeight;
    this.playerOnGround = false;

    const tempTriangle = new ExtendedTriangle();
    const capsuleBox = new THREE.Box3();
    const tempPointOnTri = new THREE.Vector3();
    const tempPointOnSegment = new THREE.Vector3();
    const tempSegment = new THREE.Line3();

    // Reusable vectors for space transformation
    const localSegment = new THREE.Line3();
    const localCapsuleBox = new THREE.Box3();
    const worldNormal = new THREE.Vector3();

    for (let i = 0; i < 5; i++) {
      // 1. Define capsule in WORLD space
      const start = this.camera.position.clone();
      start.y -= (capsuleHeight - capsuleRadius);
      const end = this.camera.position.clone();
      end.y -= capsuleRadius;
      tempSegment.set(start, end);

      capsuleBox.makeEmpty();
      capsuleBox.expandByPoint(start);
      capsuleBox.expandByPoint(end);
      capsuleBox.min.subScalar(capsuleRadius);
      capsuleBox.max.addScalar(capsuleRadius);

      let hit = false;

      // 2. Iterate through all colliders
      for (const collider of this.colliders) {
        // Quick AABB check in world space
        const colliderWorldBox = collider.bvh.geometry.boundingBox!.clone().applyMatrix4(collider.matrix);
        if (!capsuleBox.intersectsBox(colliderWorldBox)) continue;

        // Transform capsule to LOCAL space
        localSegment.copy(tempSegment).applyMatrix4(collider.invMatrix);
        localCapsuleBox.copy(capsuleBox).applyMatrix4(collider.invMatrix);

        collider.bvh.shapecast({
          intersectsBounds: box => box.intersectsBox(localCapsuleBox),
          intersectsTriangle: (tri) => {
            tempTriangle.copy(tri);
            tempTriangle.closestPointToSegment(localSegment, tempPointOnTri, tempPointOnSegment);
            const distSq = tempPointOnTri.distanceToSquared(tempPointOnSegment);

            if (distSq < capsuleRadius * capsuleRadius) {
              hit = true;
              const dist = Math.sqrt(distSq);
              const depth = capsuleRadius - dist;
              const localNormal = new THREE.Vector3();

              if (dist > 0.0001) {
                localNormal.subVectors(tempPointOnSegment, tempPointOnTri).normalize();
              } else {
                tempTriangle.getNormal(localNormal);
              }

              // Transform normal back to WORLD space
              worldNormal.copy(localNormal).transformDirection(collider.matrix).normalize();

              if (worldNormal.y > 0.5) this.playerOnGround = true;

              // Resolve in WORLD space
              this.camera.position.addScaledVector(worldNormal, depth);
              
              // Update world segment and box for next triangle/collider in this iteration
              tempSegment.start.addScaledVector(worldNormal, depth);
              tempSegment.end.addScaledVector(worldNormal, depth);
              capsuleBox.min.addScaledVector(worldNormal, depth);
              capsuleBox.max.addScaledVector(worldNormal, depth);

              // Update local segment/box for subsequent triangles in THIS collider
              localSegment.copy(tempSegment).applyMatrix4(collider.invMatrix);
              localCapsuleBox.copy(capsuleBox).applyMatrix4(collider.invMatrix);

              const dot = this.playerVelocity.dot(worldNormal);
              if (dot < 0) this.playerVelocity.addScaledVector(worldNormal, -dot);
            }
          }
        });
      }
      if (!hit) break;
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.domElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  }
}
