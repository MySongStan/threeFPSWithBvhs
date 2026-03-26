import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';

/**
 * 碰撞体接口，用于管理多个独立的 BVH 碰撞对象
 */
export interface Collider {
  id: string;             // 唯一标识符
  bvh: MeshBVH;           // 预计算的 BVH 树
  matrix: THREE.Matrix4;    // 物体的世界矩阵
  invMatrix: THREE.Matrix4; // 逆矩阵
  isGlobal?: boolean;      // 是否为全局碰撞体（如大地图），全局物体跳过网格查询
}

export class PlayerController {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  domElement: HTMLElement;
  colliders: Collider[] = []; // 存储场景中所有的碰撞体
  worldBounds = new THREE.Box3(); // 场景的总包围盒，用于越界检测
  
  // --- 空间分区 (Spatial Grid) ---
  private gridSize = 20; // 每个格子的大小
  private grid = new Map<string, string[]>(); // key: "x,y,z", value: colliderIds[]
  private gridDebugGroup = new THREE.Group(); // 用于可视化网格的组
  public showGrid = false; // 是否显示网格开关

  playerVelocity = new THREE.Vector3(); // 玩家当前速度
  playerOnGround = false; // 玩家是否在地面上
  
  // 重置点信息
  spawnPosition = new THREE.Vector3();
  spawnDirection: THREE.Vector3 | null = null;
  
  // 玩家物理尺寸
  playerRadius = 0.5; // 胶囊体半径
  playerHeight = 1.9; // 胶囊体总高度
  
  // 移动参数设置
  baseSpeed = 12;    // 基础移动速度
  sprintSpeed = 22;  // 冲刺速度
  jumpForce = 12;    // 跳跃力度
  gravity = -35;     // 重力加速度
  
  // 输入状态管理
  keys: { [key: string]: boolean } = {};
  mouseDelta = new THREE.Vector2();

  // --- 性能优化：复用对象以减少垃圾回收 ---
  private moveVector = new THREE.Vector3();
  private sideVector = new THREE.Vector3();
  private forwardVector = new THREE.Vector3();
  private tempVector = new THREE.Vector3();
  private tempTriangle = new ExtendedTriangle();
  private capsuleBox = new THREE.Box3();
  private tempPointOnTri = new THREE.Vector3();
  private tempPointOnSegment = new THREE.Vector3();
  private tempSegment = new THREE.Line3();
  private localSegment = new THREE.Line3();
  private localCapsuleBox = new THREE.Box3();
  private worldNormal = new THREE.Vector3();
  private localNormal = new THREE.Vector3();
  private colliderWorldBox = new THREE.Box3();
  private capsuleStart = new THREE.Vector3();
  private capsuleEnd = new THREE.Vector3();
  private colliderCenter = new THREE.Vector3();

  private onKeyDown = (e: KeyboardEvent) => { this.keys[e.code] = true; };
  private onKeyUp = (e: KeyboardEvent) => { this.keys[e.code] = false; };
  private onMouseMove = (e: MouseEvent) => {
    // 仅在鼠标锁定状态下记录偏移
    if (document.pointerLockElement === this.domElement || document.pointerLockElement === document.body) {
      this.mouseDelta.x += e.movementX;
      this.mouseDelta.y += e.movementY;
    }
  };

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, domElement: HTMLElement) {
    this.camera = camera;
    this.scene = scene;
    this.domElement = domElement;
    this.camera.rotation.order = 'YXZ'; // 经典的 FPS 旋转顺序
    
    // 将调试组添加到场景
    this.scene.add(this.gridDebugGroup);
    
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

  /**
   * 清空所有碰撞体
   */
  clearColliders() {
    this.colliders = [];
    this.worldBounds.makeEmpty();
    this.grid.clear();
  }

  /**
   * 添加一个新的碰撞体
   * @param id 唯一ID
   * @param bvh BVH数据
   * @param matrix 物体的世界变换矩阵
   * @param isGlobal 是否为全局物体（默认 false）
   */
  addCollider(id: string, bvh: MeshBVH, matrix: THREE.Matrix4 = new THREE.Matrix4().identity(), isGlobal = false) {
    const invMatrix = new THREE.Matrix4().copy(matrix).invert();
    const collider = { id, bvh, matrix, invMatrix, isGlobal };
    this.colliders.push(collider);
    
    // 只有非全局物体才注册到空间网格
    if (!isGlobal) {
      this.registerToGrid(collider);
    }
    
    // 更新全局场景包围盒
    this.updateWorldBounds();
  }

  /**
   * 将物体注册到空间网格中
   */
  private registerToGrid(collider: Collider) {
    if (!collider.bvh.geometry.boundingBox) return;
    
    const box = collider.bvh.geometry.boundingBox.clone().applyMatrix4(collider.matrix);
    const min = box.min;
    const max = box.max;

    // 计算物体占据的所有格子
    for (let x = Math.floor(min.x / this.gridSize); x <= Math.floor(max.x / this.gridSize); x++) {
      for (let y = Math.floor(min.y / this.gridSize); y <= Math.floor(max.y / this.gridSize); y++) {
        for (let z = Math.floor(min.z / this.gridSize); z <= Math.floor(max.z / this.gridSize); z++) {
          const key = `${x},${y},${z}`;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key)!.push(collider.id);
        }
      }
    }
  }

  /**
   * 根据 ID 移除碰撞体
   */
  removeColliderById(id: string) {
    this.colliders = this.colliders.filter(c => c.id !== id);
    // 简单起见，移除时重建网格（如果频繁移除，建议优化为增量更新）
    this.rebuildGrid();
    this.updateWorldBounds();
  }

  private rebuildGrid() {
    this.grid.clear();
    this.colliders.forEach(c => {
      if (!c.isGlobal) this.registerToGrid(c);
    });
  }

  /**
   * 重新计算所有碰撞体的合并包围盒
   */
  private updateWorldBounds() {
    this.worldBounds.makeEmpty();
    this.colliders.forEach(collider => {
      if (collider.bvh.geometry.boundingBox) {
        const box = collider.bvh.geometry.boundingBox.clone();
        box.applyMatrix4(collider.matrix);
        this.worldBounds.union(box);
      }
    });

    // 如果开启了可视化，更新网格显示
    if (this.showGrid) this.updateGridVisuals();
  }

  /**
   * 更新网格的可视化线框
   */
  public updateGridVisuals() {
    // 清空旧的线框
    while (this.gridDebugGroup.children.length > 0) {
      const child = this.gridDebugGroup.children[0] as THREE.Mesh;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      this.gridDebugGroup.remove(child);
    }

    if (!this.showGrid) return;

    const boxGeom = new THREE.BoxGeometry(this.gridSize, this.gridSize, this.gridSize);
    const boxMat = new THREE.MeshBasicMaterial({ 
      color: 0x0088ff, 
      wireframe: true, 
      transparent: true, 
      opacity: 0.2 
    });

    // 为每个被占据的格子创建一个线框盒
    this.grid.forEach((_, key) => {
      const [gx, gy, gz] = key.split(',').map(Number);
      const mesh = new THREE.Mesh(boxGeom, boxMat);
      // 格子的中心位置
      mesh.position.set(
        (gx + 0.5) * this.gridSize,
        (gy + 0.5) * this.gridSize,
        (gz + 0.5) * this.gridSize
      );
      this.gridDebugGroup.add(mesh);
    });
  }

  /**
   * 设置单一碰撞体（兼容旧逻辑，通常用于静态大地图）
   */
  setCollider(bvh: MeshBVH) {
    this.clearColliders();
    this.addCollider('static-env', bvh, new THREE.Matrix4().identity(), true);
  }

  /**
   * 设置玩家位置和朝向
   */
  setPosition(pos: THREE.Vector3, direction?: THREE.Vector3) {
    this.spawnPosition.copy(pos);
    this.spawnDirection = direction ? direction.clone() : null;
    
    this.camera.position.copy(pos);
    
    if (direction) {
      this.tempVector.copy(this.camera.position).add(direction);
      this.camera.lookAt(this.tempVector);
    }
    
    // 重置旋转（保持水平）和速度
    this.camera.rotation.set(0, this.camera.rotation.y, 0);
    this.playerVelocity.set(0, 0, 0);
    this.playerOnGround = false;
  }

  /**
   * 每帧更新逻辑
   */
  update(delta: number) {
    if (this.colliders.length === 0) return;
    
    // 0. 安全检查：防止 NaN 导致崩溃
    if (isNaN(this.camera.position.x) || isNaN(this.camera.position.y) || isNaN(this.camera.position.z)) {
      this.setPosition(this.spawnPosition, this.spawnDirection || undefined);
      return;
    }

    // 1. 处理视角旋转 (独立于物理子步)
    const rotationSpeed = 0.002;
    this.camera.rotation.y -= this.mouseDelta.x * rotationSpeed;
    this.camera.rotation.x -= this.mouseDelta.y * rotationSpeed;
    this.camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.camera.rotation.x));
    this.mouseDelta.set(0, 0);

    // 2. 物理子步迭代 (Sub-stepping)
    // 将一帧的时间切分为多个微小步长，极大提升高速移动下的碰撞稳定性
    const physicsSteps = 5; 
    const dt = Math.min(delta, 0.1) / physicsSteps;

    for (let i = 0; i < physicsSteps; i++) {
      this.updatePhysicsStep(dt);
    }

    // 3. 越界检测
    this.checkOutOfBounds();
  }

  /**
   * 单个物理步进逻辑
   */
  private updatePhysicsStep(dt: number) {
    // 1. 处理移动输入与速度计算
    const isSprinting = this.keys['ShiftLeft'] || this.keys['ShiftRight'];
    const currentSpeed = isSprinting ? this.sprintSpeed : this.baseSpeed;
    
    this.moveVector.set(0, 0, 0);
    if (this.keys['KeyW']) this.moveVector.z -= 1;
    if (this.keys['KeyS']) this.moveVector.z += 1;
    if (this.keys['KeyA']) this.moveVector.x -= 1;
    if (this.keys['KeyD']) this.moveVector.x += 1;
    this.moveVector.normalize();
    
    const angle = this.camera.rotation.y;
    this.sideVector.set(Math.cos(angle), 0, -Math.sin(angle));
    this.forwardVector.set(-Math.sin(angle), 0, -Math.cos(angle));
    
    // 水平速度
    this.playerVelocity.x = (this.forwardVector.x * -this.moveVector.z + this.sideVector.x * this.moveVector.x) * currentSpeed;
    this.playerVelocity.z = (this.forwardVector.z * -this.moveVector.z + this.sideVector.z * this.moveVector.x) * currentSpeed;
    
    // 2. 重力与跳跃
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

    // 3. 应用位移
    this.camera.position.addScaledVector(this.playerVelocity, dt);
    
    // 限制极端速度
    const maxVelocity = 100;
    if (this.playerVelocity.length() > maxVelocity) {
      this.playerVelocity.setLength(maxVelocity);
    }

    // 4. 执行碰撞检测与修正
    this.checkCollisions();
  }

  /**
   * 越界检测
   */
  private checkOutOfBounds() {
    const fallThreshold = this.worldBounds.min.y - 20;
    const horizontalMargin = 100;
    
    const isBelowFloor = this.camera.position.y < fallThreshold;
    const isTooFarX = Math.abs(this.camera.position.x) > Math.max(Math.abs(this.worldBounds.min.x), Math.abs(this.worldBounds.max.x)) + horizontalMargin;
    const isTooFarZ = Math.abs(this.camera.position.z) > Math.max(Math.abs(this.worldBounds.min.z), Math.abs(this.worldBounds.max.z)) + horizontalMargin;

    if (isBelowFloor || isTooFarX || isTooFarZ) {
      this.setPosition(this.spawnPosition, this.spawnDirection || undefined);
    }
  }

  /**
   * 核心碰撞检测逻辑
   */
  checkCollisions() {
    if (this.colliders.length === 0) return;

    const capsuleRadius = this.playerRadius;
    const capsuleHeight = this.playerHeight;
    this.playerOnGround = false;

    // 迭代 3 次（配合外部子步迭代，3次足以处理复杂的墙角碰撞）
    for (let i = 0; i < 3; i++) {
      // 1. 在世界空间定义玩家胶囊体
      this.capsuleStart.copy(this.camera.position);
      this.capsuleStart.y -= (capsuleHeight - capsuleRadius);
      this.capsuleEnd.copy(this.camera.position);
      this.capsuleEnd.y -= capsuleRadius;
      this.tempSegment.set(this.capsuleStart, this.capsuleEnd);

      this.capsuleBox.makeEmpty();
      this.capsuleBox.expandByPoint(this.capsuleStart);
      this.capsuleBox.expandByPoint(this.capsuleEnd);
      this.capsuleBox.min.subScalar(capsuleRadius);
      this.capsuleBox.max.addScalar(capsuleRadius);

      // --- 空间网格查询 ---
      // 获取玩家当前占据的格子中所有的碰撞体 ID
      const nearbyColliderIds = new Set<string>();
      const min = this.capsuleBox.min;
      const max = this.capsuleBox.max;

      for (let x = Math.floor(min.x / this.gridSize); x <= Math.floor(max.x / this.gridSize); x++) {
        for (let y = Math.floor(min.y / this.gridSize); y <= Math.floor(max.y / this.gridSize); y++) {
          for (let z = Math.floor(min.z / this.gridSize); z <= Math.floor(max.z / this.gridSize); z++) {
            const key = `${x},${y},${z}`;
            const ids = this.grid.get(key);
            if (ids) ids.forEach(id => nearbyColliderIds.add(id));
          }
        }
      }

      let hit = false;

      // 2. 遍历所有碰撞体进行检测
      for (const collider of this.colliders) {
        // 如果是局部物体且不在附近网格中，则跳过
        if (!collider.isGlobal && !nearbyColliderIds.has(collider.id)) continue;

        // 第一级：距离裁剪 (Distance Culling)
        // 如果玩家距离物体中心非常远，直接跳过。这比 AABB 检查更廉价。
        if (collider.bvh.geometry.boundingBox) {
          collider.bvh.geometry.boundingBox.getCenter(this.colliderCenter);
          this.colliderCenter.applyMatrix4(collider.matrix);
          
          // 计算粗略半径（包围盒对角线的一半）
          const colliderRadius = collider.bvh.geometry.boundingBox.getSize(this.tempVector).length() * 0.5;
          const distToPlayer = this.camera.position.distanceTo(this.colliderCenter);
          
          // 如果距离大于 玩家高度 + 物体半径 + 安全余量，则跳过
          if (distToPlayer > capsuleHeight + colliderRadius + 5) continue;
        }

        // 第二级：世界空间 AABB 粗略裁剪
        if (collider.bvh.geometry.boundingBox) {
          this.colliderWorldBox.copy(collider.bvh.geometry.boundingBox).applyMatrix4(collider.matrix);
          if (!this.capsuleBox.intersectsBox(this.colliderWorldBox)) continue;
        }

        // 第二级：将胶囊体转换到碰撞体的局部空间
        this.localSegment.copy(this.tempSegment).applyMatrix4(collider.invMatrix);
        this.localCapsuleBox.copy(this.capsuleBox).applyMatrix4(collider.invMatrix);

        // 在局部空间执行精确的 BVH 碰撞检测
        collider.bvh.shapecast({
          intersectsBounds: box => box.intersectsBox(this.localCapsuleBox),
          intersectsTriangle: (tri) => {
            this.tempTriangle.copy(tri);
            this.tempTriangle.closestPointToSegment(this.localSegment, this.tempPointOnTri, this.tempPointOnSegment);
            const distSq = this.tempPointOnTri.distanceToSquared(this.tempPointOnSegment);

            if (distSq < capsuleRadius * capsuleRadius) {
              hit = true;
              const dist = Math.sqrt(distSq);
              const depth = capsuleRadius - dist;

              if (dist > 0.0001) {
                this.localNormal.subVectors(this.tempPointOnSegment, this.tempPointOnTri).normalize();
              } else {
                this.tempTriangle.getNormal(this.localNormal);
              }

              // 将局部空间的法线转换回世界空间
              this.worldNormal.copy(this.localNormal).transformDirection(collider.matrix).normalize();

              // 判断是否踩在地面（法线向上）
              if (this.worldNormal.y > 0.5) this.playerOnGround = true;

              // 在世界空间修正玩家位置
              this.camera.position.addScaledVector(this.worldNormal, depth);
              
              // 更新世界空间胶囊体，用于下一次三角形或碰撞体检测
              this.tempSegment.start.addScaledVector(this.worldNormal, depth);
              this.tempSegment.end.addScaledVector(this.worldNormal, depth);
              this.capsuleBox.min.addScaledVector(this.worldNormal, depth);
              this.capsuleBox.max.addScaledVector(this.worldNormal, depth);

              // 同步更新当前碰撞体的局部空间胶囊体
              this.localSegment.copy(this.tempSegment).applyMatrix4(collider.invMatrix);
              this.localCapsuleBox.copy(this.capsuleBox).applyMatrix4(collider.invMatrix);

              // 修正速度分量（防止穿墙）
              const dot = this.playerVelocity.dot(this.worldNormal);
              if (dot < 0) this.playerVelocity.addScaledVector(this.worldNormal, -dot);
            }
          }
        });
      }
      if (!hit) break; // 如果没有发生任何碰撞，提前结束迭代
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
