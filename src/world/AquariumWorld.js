import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeBubble, makeDecoration, makeFoodPellet } from './models.js';
import { FishAgent } from '../simulation/FishAgent.js';

const TANK = { width: 12, height: 6.35, depth: 7, floor: 0.24 };
const FISH_BOUNDS = { x: 5.05, z: 2.72 };
const clamp = THREE.MathUtils.clamp;
const sandHeightAt = (x, z) => TANK.floor
  + Math.sin(x * 0.46 + 0.65) * Math.cos(z * 0.52 - 0.35) * 0.038
  + Math.sin((x - z) * 0.34 + 1.1) * 0.018;

export class AquariumWorld {
  constructor(host, store) {
    this.host = host;
    this.store = store;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c1920');
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(10.7, 7.5, 12.6);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'aquarium-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D aquarium. Drag decorations to rearrange, or orbit to view the tank.');
    host.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 2.7, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.enablePan = false;
    this.controls.minDistance = 8.5;
    this.controls.maxDistance = 23;
    this.controls.minPolarAngle = 0.16;
    this.controls.maxPolarAngle = 1.54;
    this.controls.rotateSpeed = 0.58;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.drag = null;
    this.pointerGesture = null;
    this.decorObjects = new Map();
    this.decorPickMeshes = [];
    this.fishAgents = new Map();
    this.fishPickMeshes = [];
    this.foods = [];
    this.bubbles = [];
    this.bubbleEmitters = new Map();
    this.nextFoodId = 0;
    this.lastState = store.getState();
    this.time = 0;
    this.disposed = false;

    this.buildLighting();
    this.buildTank();
    this.syncDecorations(this.lastState.decorations);
    this.syncFish(this.lastState.fish);
    this.setWaterLevel(this.lastState.waterLevel);
    this.setTheme(this.lastState.theme);

    this.unsubscribe = store.subscribe(state => this.onStoreChange(state));
    this.bindPointerEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.animate();
  }

  buildLighting() {
    const hemi = new THREE.HemisphereLight('#d8f4ff', '#324238', 1.05);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#fff3d5', 2.1);
    key.position.set(-4.5, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.bias = -0.0002;
    this.scene.add(key);

    const cool = new THREE.PointLight('#5dc8e9', 30, 17, 2);
    cool.position.set(4.5, 5.7, -2.8);
    this.scene.add(cool);
    const warm = new THREE.PointLight('#f1b76c', 12, 12, 2);
    warm.position.set(-4.2, 3.8, 2.1);
    this.scene.add(warm);
  }

  buildTank() {
    const w = TANK.width;
    const h = TANK.height;
    const d = TANK.depth;
    const floorY = TANK.floor;

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.34, 0.34, d + 0.34),
      new THREE.MeshStandardMaterial({ color: '#17272e', roughness: 0.36, metalness: 0.38 }),
    );
    plinth.position.y = -0.12;
    plinth.receiveShadow = true;
    this.scene.add(plinth);

    // Shallow, broad terrain: height changes are deliberately low amplitude so
    // the substrate reads as a soft sand bed, not a rocky landscape.
    const sandGeometry = new THREE.PlaneGeometry(w - 0.18, d - 0.18, 80, 48);
    const sandPositions = sandGeometry.attributes.position;
    for (let i = 0; i < sandPositions.count; i++) {
      const x = sandPositions.getX(i);
      const z = -sandPositions.getY(i);
      sandPositions.setZ(i, sandHeightAt(x, z) - floorY);
    }
    sandPositions.needsUpdate = true;
    sandGeometry.computeVertexNormals();
    const sand = new THREE.Mesh(
      sandGeometry,
      new THREE.MeshStandardMaterial({ color: '#c5ad82', roughness: 1, metalness: 0 }),
    );
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = floorY;
    sand.receiveShadow = true;
    sand.name = 'soft-sand-terrain';
    this.sandMesh = sand;
    this.scene.add(sand);

    this.causticsMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uTint: { value: new THREE.Color('#fff0c7') } },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime; uniform vec3 uTint; varying vec2 vUv;
        float caustic(vec2 p){
          float t = uTime * 0.16;
          vec2 q = p * 7.0;
          float a = sin(q.x + sin(q.y * 1.3 + t) * 1.8 + t);
          float b = sin(q.y - cos(q.x * 1.15 - t * 0.8) * 1.7 - t * 0.7);
          float c = sin((q.x + q.y) * 0.72 + sin(q.x * 1.8 + t));
          float wave = a * b + c * 0.55;
          return pow(max(0.0, wave - 0.15), 2.5);
        }
        void main(){
          float c = caustic(vUv + vec2(uTime * 0.008, -uTime * 0.006));
          float alpha = clamp(c * 0.35, 0.0, 0.24);
          gl_FragColor = vec4(uTint, alpha);
        }
      `,
    });
    const caustics = new THREE.Mesh(sandGeometry.clone(), this.causticsMaterial);
    caustics.rotation.x = -Math.PI / 2;
    caustics.position.y = floorY + 0.014;
    caustics.renderOrder = 1;
    this.scene.add(caustics);

    const edgeGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
    const edgeLines = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: '#83b4bf', transparent: true, opacity: 0.5 }));
    edgeLines.position.y = h / 2;
    this.scene.add(edgeLines);

    const frameMaterial = new THREE.MeshStandardMaterial({ color: '#233941', roughness: 0.32, metalness: 0.48 });
    const addBar = (x, y, z, sx, sy, sz) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMaterial);
      bar.position.set(x, y, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.scene.add(bar);
    };
    const post = 0.075;
    for (const x of [-w / 2, w / 2]) {
      for (const z of [-d / 2, d / 2]) addBar(x, h / 2, z, post, h, post);
    }
    for (const y of [0.03, h - 0.04]) {
      addBar(0, y, -d / 2, w, 0.075, 0.075);
      addBar(0, y, d / 2, w, 0.075, 0.075);
      addBar(-w / 2, y, 0, 0.075, 0.075, d);
      addBar(w / 2, y, 0, 0.075, 0.075, d);
    }

    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: '#a5d7e4', roughness: 0.08, metalness: 0.03,
      transparent: true, opacity: 0.085, depthWrite: false,
      transmission: 0.22, thickness: 0.25, side: THREE.DoubleSide,
    });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, h - 0.08), glassMaterial);
    front.position.set(0, h / 2, d / 2 - 0.018);
    front.renderOrder = 3;
    this.scene.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.08, h - 0.08), glassMaterial);
    back.position.set(0, h / 2, -d / 2 + 0.018);
    back.renderOrder = 0;
    this.scene.add(back);
    const sideGeo = new THREE.PlaneGeometry(d - 0.08, h - 0.08);
    const left = new THREE.Mesh(sideGeo, glassMaterial);
    left.rotation.y = Math.PI / 2;
    left.position.set(-w / 2 + 0.018, h / 2, 0);
    left.renderOrder = 2;
    this.scene.add(left);
    const right = new THREE.Mesh(sideGeo, glassMaterial);
    right.rotation.y = Math.PI / 2;
    right.position.set(w / 2 - 0.018, h / 2, 0);
    right.renderOrder = 2;
    this.scene.add(right);

    const waterMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uWater: { value: new THREE.Color('#268fb4') } },
      vertexShader: `
        varying vec3 vWorldPosition; varying vec3 vWorldNormal;
        void main(){
          vec4 world = modelMatrix * vec4(position,1.0);
          vWorldPosition = world.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform vec3 uWater; uniform float uTime;
        varying vec3 vWorldPosition; varying vec3 vWorldNormal;
        void main(){
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(dot(normalize(vWorldNormal), viewDir), 0.0), 2.6);
          float depthShade = smoothstep(0.2, 6.0, 6.0 - vWorldPosition.y);
          vec3 color = mix(uWater * 0.72, uWater * 1.35, fresnel);
          color += vec3(0.025, 0.10, 0.13) * depthShade;
          float alpha = 0.105 + fresnel * 0.11;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    this.waterMesh = new THREE.Mesh(new THREE.BoxGeometry(w - 0.18, 1, d - 0.18), waterMaterial);
    this.waterMesh.renderOrder = 2;
    this.scene.add(this.waterMesh);

    this.surfaceMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 p = position;
          p.z += sin(p.x * 1.7 + uTime * 1.2) * 0.018 + cos(p.y * 1.9 - uTime * 0.8) * 0.016;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime; varying vec2 vUv;
        void main(){
          float ripple = sin(vUv.x * 48.0 + uTime * 1.7) * cos(vUv.y * 33.0 - uTime * 1.1);
          float shimmer = 0.5 + 0.5 * ripple;
          vec3 color = mix(vec3(0.12,0.43,0.56), vec3(0.52,0.78,0.82), shimmer * 0.34);
          gl_FragColor = vec4(color, 0.25 + shimmer * 0.10);
        }
      `,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, d - 0.2, 40, 24), this.surfaceMaterial);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.renderOrder = 4;
    this.scene.add(this.surface);

    this.decorRoot = new THREE.Group();
    this.decorRoot.name = 'decorations';
    this.scene.add(this.decorRoot);
    this.fishRoot = new THREE.Group();
    this.fishRoot.name = 'fish';
    this.scene.add(this.fishRoot);
    this.foodRoot = new THREE.Group();
    this.scene.add(this.foodRoot);
    this.bubbleRoot = new THREE.Group();
    this.scene.add(this.bubbleRoot);

    this.selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.018, 8, 64),
      new THREE.MeshBasicMaterial({ color: '#72d5ce', transparent: true, opacity: 0.95 }),
    );
    this.selectionRing.rotation.x = 0;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);
  }

  syncBubbleEmitters(items) {
    // Every Bubble stone owns an independent emitter and bubble stream.
    const airItems = items.filter(item => item.type === 'air');
    const activeIds = new Set(airItems.map(item => item.id));

    for (const [id] of this.bubbleEmitters) {
      if (activeIds.has(id)) continue;
      this.bubbleEmitters.delete(id);
    }

    this.bubbles = this.bubbles.filter(bubble => {
      if (activeIds.has(bubble.emitterId)) return true;
      this.bubbleRoot.remove(bubble.mesh);
      bubble.mesh.geometry?.dispose();
      bubble.mesh.material?.dispose();
      return false;
    });

    for (const item of airItems) {
      if (this.bubbleEmitters.has(item.id)) continue;
      const emitter = { id: item.id, clock: randBetween(0, 0.12), count: 0, maxBubbles: 18 };
      this.bubbleEmitters.set(item.id, emitter);
      // Seed a visible rising trail immediately when a new stone is added.
      for (let i = 0; i < 6; i++) this.spawnBubble(item.id, randBetween(0.18, 1.65));
    }
  }

  getBubblerOrigin(emitterId) {
    const entry = this.decorObjects.get(emitterId);
    if (!entry || entry.item.type !== 'air') return null;
    entry.root.updateMatrixWorld(true);
    return entry.root.localToWorld(new THREE.Vector3(0.12, 0.42, 0));
  }

  spawnBubble(emitterId, rise = 0) {
    const emitter = this.bubbleEmitters.get(emitterId);
    const origin = this.getBubblerOrigin(emitterId);
    if (!emitter || !origin || emitter.count >= emitter.maxBubbles) return;
    const mesh = makeBubble();
    const offsetX = (Math.random() - 0.5) * 0.18;
    const offsetZ = (Math.random() - 0.5) * 0.16;
    mesh.position.set(origin.x + offsetX, origin.y + rise, origin.z + offsetZ);
    const bubble = {
      mesh, emitterId,
      speed: 0.48 + Math.random() * 0.72,
      phase: Math.random() * Math.PI * 2, drift: 0.035 + Math.random() * 0.055,
      offsetX, offsetZ, originX: origin.x, originZ: origin.z,
    };
    emitter.count += 1;
    this.bubbles.push(bubble);
    this.bubbleRoot.add(mesh);
  }

  onStoreChange(state) {
    if (state.decorations !== this.lastState.decorations) this.syncDecorations(state.decorations);
    if (state.fish !== this.lastState.fish) this.syncFish(state.fish);
    if (state.waterLevel !== this.lastState.waterLevel) this.setWaterLevel(state.waterLevel);
    if (state.theme !== this.lastState.theme) this.setTheme(state.theme);
    this.updateSelection(state);
    this.lastState = state;
  }

  setWaterLevel(level) {
    this.waterLevel = clamp(level, 3.4, TANK.height - 0.28);
    const depth = this.waterLevel - TANK.floor;
    this.waterMesh.scale.y = depth;
    this.waterMesh.position.y = TANK.floor + depth / 2;
    this.surface.position.y = this.waterLevel;
    for (const agent of this.fishAgents.values()) {
      agent.position.y = clamp(agent.position.y, 0.78, this.waterLevel - 0.56);
    }
  }

  setTheme(theme) {
    if (theme === 'light') {
      this.scene.background.set('#d9e8e4');
      this.causticsMaterial.uniforms.uTint.value.set('#ffffff');
    } else {
      this.scene.background.set('#0c1920');
      this.causticsMaterial.uniforms.uTint.value.set('#fff0c7');
    }
  }

  syncDecorations(items) {
    const incoming = new Set(items.map(item => item.id));
    for (const [id, entry] of this.decorObjects) {
      if (!incoming.has(id)) {
        this.decorRoot.remove(entry.root);
        entry.root.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material && !Array.isArray(obj.material)) obj.material.dispose();
        });
        this.decorObjects.delete(id);
      }
    }
    for (const item of items) {
      let entry = this.decorObjects.get(item.id);
      const isNew = !entry;
      if (isNew) {
        const descriptor = makeDecoration(item.type, hashString(item.id));
        const root = descriptor.group;
        root.userData.decorId = item.id;
        root.traverse(obj => {
          if (obj.isMesh) {
            obj.userData.decorId = item.id;
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        entry = { root, descriptor, velocityY: 0, drift: new THREE.Vector3(), item: { ...item }, supportedBy: null };
        this.decorRoot.add(root);
        this.decorObjects.set(item.id, entry);
      }
      const positionChanged = !isNew && (entry.item.x !== item.x || entry.item.z !== item.z);
      const scaleChanged = !isNew && entry.item.scale !== item.scale;
      const isStone = item.type === 'rock' || item.type === 'pebble';
      let currentY = isNew ? this.decorWorldY(item, entry.descriptor) : entry.root.position.y;
      if (positionChanged) {
        currentY = this.decorWorldY(item, entry.descriptor);
      } else if (scaleChanged && isStone) {
        const oldScale = entry.item.scale || 1;
        const newScale = item.scale || 1;
        const supportedBottom = entry.root.position.y - entry.descriptor.height * oldScale * 0.5;
        currentY = supportedBottom + entry.descriptor.height * newScale * 0.5;
      }
      entry.item = { ...item };
      entry.root.position.set(item.x, currentY, item.z);
      entry.root.rotation.y = item.rotation;
      entry.root.scale.setScalar(item.scale || 1);
      entry.velocityY = 0;
    }
    this.syncBubbleEmitters(items);
    this.rebuildPickMeshes();
    this.updateSelection(this.store.getState());
  }

  decorWorldY(item, descriptor) {
    const ground = sandHeightAt(item.x, item.z);
    if (item.type === 'rock' || item.type === 'pebble') return ground + descriptor.height * (item.scale || 1) * 0.5;
    return ground;
  }

  rebuildPickMeshes() {
    this.decorPickMeshes = [];
    for (const { root } of this.decorObjects.values()) {
      root.traverse(obj => { if (obj.isMesh) this.decorPickMeshes.push(obj); });
    }
  }

  syncFish(definitions) {
    const ids = new Set(definitions.map(f => f.id));
    for (const [id, agent] of this.fishAgents) {
      if (!ids.has(id)) {
        this.fishRoot.remove(agent.root);
        agent.dispose();
        this.fishAgents.delete(id);
      }
    }
    definitions.forEach((definition, index) => {
      if (!this.fishAgents.has(definition.id)) {
        const agent = new FishAgent(definition, this.waterLevel || 5.5, index);
        agent.root.userData.fishId = definition.id;
        agent.root.traverse(obj => { obj.userData.fishId = definition.id; });
        this.fishRoot.add(agent.root);
        this.fishAgents.set(definition.id, agent);
      }
    });
    this.fishPickMeshes = [];
    for (const agent of this.fishAgents.values()) agent.root.traverse(obj => { if (obj.isMesh) this.fishPickMeshes.push(obj); });
  }

  updateSelection(state) {
    const selectedId = state.selectedDecoration;
    if (selectedId && this.decorObjects.has(selectedId)) {
      const entry = this.decorObjects.get(selectedId);
      const radius = entry.descriptor.radius * (entry.item.scale || 1) + 0.14;
      const oldRadius = this.selectionRing.geometry.parameters?.radius;
      if (Math.abs((oldRadius || 0) - radius) > 0.001) {
        this.selectionRing.geometry.dispose();
        this.selectionRing.geometry = new THREE.TorusGeometry(radius, 0.018, 8, 64);
      }
      this.selectionRing.position.set(entry.root.position.x, sandHeightAt(entry.root.position.x, entry.root.position.z) + 0.035, entry.root.position.z);
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.visible = false;
    }
  }

  updateDecorPhysics(dt) {
    const stones = [...this.decorObjects.entries()].filter(([, e]) => e.item.type === 'rock' || e.item.type === 'pebble');
    for (const [id, entry] of stones) {
      const radius = entry.descriptor.radius * (entry.item.scale || 1);
      const halfHeight = entry.descriptor.height * (entry.item.scale || 1) * 0.5;
      const floor = sandHeightAt(entry.root.position.x, entry.root.position.z);
      let supportY = floor;
      let support = null;
      let supportOffset = null;
      for (const [otherId, other] of stones) {
        if (otherId === id) continue;
        const otherRadius = other.descriptor.radius * (other.item.scale || 1);
        const otherHalf = other.descriptor.height * (other.item.scale || 1) * 0.5;
        const otherTop = other.root.position.y + otherHalf;
        const myBottom = entry.root.position.y - halfHeight;
        const above = entry.root.position.y > other.root.position.y + 0.12;
        const verticalGap = myBottom - otherTop;
        if (!above || verticalGap > 0.20 || verticalGap < -0.18) continue;
        const dx = entry.root.position.x - other.root.position.x;
        const dz = entry.root.position.z - other.root.position.z;
        const horizontal = Math.hypot(dx, dz);
        if (horizontal < (radius + otherRadius) * 0.52 && otherTop > supportY) {
          supportY = otherTop;
          support = other;
          supportOffset = { dx, dz, horizontal, otherRadius };
        }
      }
      const bottom = entry.root.position.y - halfHeight;
      if (support && supportOffset && supportOffset.horizontal > supportOffset.otherRadius * 0.48) {
        const nudge = new THREE.Vector3(supportOffset.dx, 0, supportOffset.dz);
        if (nudge.lengthSq() > 0.001) {
          nudge.normalize();
          entry.drift.addScaledVector(nudge, dt * 0.85);
        }
        entry.root.rotation.z = THREE.MathUtils.damp(entry.root.rotation.z, -supportOffset.dx * 0.12, 2.2, dt);
        entry.root.rotation.x = THREE.MathUtils.damp(entry.root.rotation.x, supportOffset.dz * 0.12, 2.2, dt);
      } else if (support) {
        entry.drift.multiplyScalar(Math.max(0, 1 - dt * 3));
        entry.root.rotation.x = THREE.MathUtils.damp(entry.root.rotation.x, 0, 3, dt);
        entry.root.rotation.z = THREE.MathUtils.damp(entry.root.rotation.z, 0, 3, dt);
      }
      entry.root.position.x += entry.drift.x * dt;
      entry.root.position.z += entry.drift.z * dt;
      entry.drift.multiplyScalar(Math.max(0, 1 - dt * 0.5));

      const gap = bottom - supportY;
      if (gap > 0.015) {
        entry.velocityY -= 4.8 * dt;
        entry.root.position.y += entry.velocityY * dt;
        if (entry.root.position.y - halfHeight < supportY) {
          entry.root.position.y = supportY + halfHeight;
          entry.velocityY = 0;
        }
      } else {
        entry.root.position.y = supportY + halfHeight;
        entry.velocityY = 0;
      }
      // Keep a stone from escaping the glass while it settles or rolls.
      entry.root.position.x = clamp(entry.root.position.x, -5.55, 5.55);
      entry.root.position.z = clamp(entry.root.position.z, -3.05, 3.05);
      entry.item.y = entry.root.position.y - halfHeight;
      entry.supportedBy = support;
    }
  }

  getObstacles() {
    const obstacles = [];
    for (const entry of this.decorObjects.values()) {
      const type = entry.item.type;
      const scale = entry.item.scale || 1;
      const root = entry.root;
      const c = Math.cos(root.rotation.y);
      const s = Math.sin(root.rotation.y);
      const addLocal = (lx, ly, lz, radius) => {
        obstacles.push({
          x: root.position.x + (lx * c + lz * s) * scale,
          y: root.position.y + ly * scale,
          z: root.position.z + (-lx * s + lz * c) * scale,
          radius: radius * scale,
        });
      };

      if (type === 'coral') {
        // Individual branch volumes preserve the swim-through gaps in the coral cluster.
        [
          [-0.12, 0.54, 0.03, 0.15], [-0.33, 1.02, 0.14, 0.14], [-0.4, 1.40, 0.19, 0.13],
          [0.18, 0.56, -0.1, 0.15], [0.43, 0.98, -0.22, 0.14], [0.56, 1.3, -0.25, 0.13],
          [0.12, 0.62, 0.2, 0.14], [0.14, 1.1, 0.38, 0.13], [-0.3, 0.6, -0.18, 0.13],
          [-0.68, 0.98, -0.32, 0.13], [-0.12, 1.2, -0.4, 0.12],
        ].forEach(([x, y, z, r]) => addLocal(x, y, z, r));
        continue;
      }
      if (type === 'fan') {
        // The fan's ribs are sparse; avoid the central stalk and a few outer ribs, not its whole silhouette.
        [-0.62, -0.3, 0, 0.3, 0.62].forEach((x, i) => addLocal(x, 0.82 + (i % 2) * 0.12, 0, 0.11));
        addLocal(0, 0.48, 0, 0.14);
        continue;
      }
      if (type === 'seaweed') {
        addLocal(0, 0.65, 0, 0.22);
        addLocal(0.18, 1.15, 0.05, 0.16);
        addLocal(-0.18, 1.35, -0.08, 0.15);
        continue;
      }
      const radius = entry.descriptor.radius * scale;
      const centerY = type === 'air' ? root.position.y + entry.descriptor.height * scale * 0.35 : root.position.y;
      obstacles.push({ x: root.position.x, y: centerY, z: root.position.z, radius });
    }
    return obstacles;
  }

  addFood(position) {
    const mesh = makeFoodPellet();
    mesh.position.copy(position);
    const item = { id: `food-${++this.nextFoodId}`, mesh, velocity: 0.18 + Math.random() * 0.12, age: 0, resting: false, restTime: 0, consumed: false };
    this.foods.push(item);
    this.foodRoot.add(mesh);
    this.store.set({ foodCount: this.foods.length, toast: 'Food dropped — watch your fish find it' });
  }

  updateFood(dt) {
    const obstacles = this.getObstacles();
    for (const food of this.foods) {
      food.age += dt;
      if (!food.resting) {
        food.mesh.position.y -= food.velocity * dt;
        food.mesh.position.x += Math.sin(food.age * 1.7) * 0.025 * dt;
        for (const obstacle of obstacles) {
          const dx = food.mesh.position.x - obstacle.x;
          const dz = food.mesh.position.z - obstacle.z;
          const dy = food.mesh.position.y - obstacle.y;
          if (Math.hypot(dx, dz) < obstacle.radius + 0.08 && Math.abs(dy) < 0.18) {
            food.resting = true;
            food.restTime = 0;
            break;
          }
        }
        const sandY = sandHeightAt(food.mesh.position.x, food.mesh.position.z);
        if (food.mesh.position.y <= sandY + 0.09) {
          food.mesh.position.y = sandY + 0.09;
          food.resting = true;
          food.restTime = 0;
        }
      } else {
        food.restTime += dt;
        if (food.restTime > 5) {
          const opacity = clamp(1 - (food.restTime - 5) / 2.5, 0, 1);
          food.mesh.material.transparent = true;
          food.mesh.material.opacity = opacity;
        }
      }
    }
    const before = this.foods.length;
    this.foods = this.foods.filter(food => {
      const alive = !food.consumed && food.age < 20 && (!food.resting || food.restTime < 7.5);
      if (!alive) {
        this.foodRoot.remove(food.mesh);
        food.mesh.geometry.dispose();
        food.mesh.material.dispose();
      }
      return alive;
    });
    if (before !== this.foods.length) this.store.set({ foodCount: this.foods.length });
  }

  updateBubbles(dt) {
    const origins = new Map();
    for (const emitter of this.bubbleEmitters.values()) {
      const origin = this.getBubblerOrigin(emitter.id);
      if (!origin) continue;
      origins.set(emitter.id, origin);
      emitter.clock += dt;
      if (emitter.clock >= 0.17 && emitter.count < emitter.maxBubbles) {
        emitter.clock = 0;
        this.spawnBubble(emitter.id, 0.02);
      }
    }

    for (const bubble of this.bubbles) {
      const origin = origins.get(bubble.emitterId);
      if (!origin) continue;
      // Existing bubbles remain part of their own emitter column when the
      // corresponding Bubble stone is moved around the tank.
      bubble.mesh.position.x += origin.x - bubble.originX;
      bubble.mesh.position.z += origin.z - bubble.originZ;
      bubble.originX = origin.x;
      bubble.originZ = origin.z;
      bubble.mesh.position.y += bubble.speed * dt;
      bubble.mesh.position.x += Math.sin(this.time * 2.2 + bubble.phase) * bubble.drift * dt;
      bubble.mesh.position.z += Math.cos(this.time * 1.7 + bubble.phase) * bubble.drift * dt;
      const scale = 0.78 + Math.sin(this.time * 4 + bubble.phase) * 0.12;
      bubble.mesh.scale.setScalar(scale);
      if (bubble.mesh.position.y > this.waterLevel - 0.05) {
        bubble.offsetX = (Math.random() - 0.5) * 0.18;
        bubble.offsetZ = (Math.random() - 0.5) * 0.16;
        bubble.mesh.position.set(origin.x + bubble.offsetX, origin.y + 0.02, origin.z + bubble.offsetZ);
      }
    }
  }

  updateDecorAnimations() {
    for (const entry of this.decorObjects.values()) {
      if (entry.item.type !== 'seaweed') continue;
      const blades = entry.root.userData.grassBlades || [];
      for (const blade of blades) {
        const wave = this.time * 0.78 + blade.phase;
        blade.pivot.rotation.z = Math.sin(wave) * blade.amplitude;
        blade.pivot.rotation.x = Math.cos(wave * 0.83) * blade.secondary;
      }
    }
  }

  bindPointerEvents() {
    this.canvas = this.renderer.domElement;
    this.onPointerDown = event => {
      if (event.button !== 0) return;
      const state = this.store.getState();
      this.pointerGesture = { x: event.clientX, y: event.clientY, moved: false, feeding: state.feedingMode };
      if (state.feedingMode) {
        this.controls.enabled = false;
        return;
      }
      this.setPointerFromEvent(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const decorHits = this.raycaster.intersectObjects(this.decorPickMeshes, false);
      if (decorHits.length) {
        let node = decorHits[0].object;
        while (node && !node.userData.decorId) node = node.parent;
        if (node?.userData.decorId) {
          const id = node.userData.decorId;
          const entry = this.decorObjects.get(id);
          if (entry) {
            this.store.selectDecoration(id);
            this.drag = {
              id,
              root: entry.root,
              startX: entry.root.position.x,
              startZ: entry.root.position.z,
              startY: entry.root.position.y,
              plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -entry.root.position.y),
              moved: false,
            };
            this.controls.enabled = false;
            this.canvas.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
          }
        }
      }
      const fishHits = this.raycaster.intersectObjects(this.fishPickMeshes, false);
      if (fishHits.length) {
        let node = fishHits[0].object;
        while (node && !node.userData.fishId && !this.fishAgents.has(node.name)) node = node.parent;
        let agent = null;
        if (node?.userData.fishId) agent = this.fishAgents.get(node.userData.fishId);
        if (agent) {
          this.store.selectFish(agent.id);
          return;
        }
      }
      this.store.set({ selectedDecoration: null, selectedFish: null });
    };

    this.onPointerMove = event => {
      if (!this.pointerGesture) return;
      const dist = Math.hypot(event.clientX - this.pointerGesture.x, event.clientY - this.pointerGesture.y);
      if (dist > 4) this.pointerGesture.moved = true;
      if (!this.drag) return;
      this.setPointerFromEvent(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const point = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.drag.plane, point)) {
        this.drag.root.position.x = clamp(point.x, -5.45, 5.45);
        this.drag.root.position.z = clamp(point.z, -3.0, 3.0);
        const draggedEntry = this.decorObjects.get(this.drag.id);
        if (draggedEntry) {
          const ground = sandHeightAt(this.drag.root.position.x, this.drag.root.position.z);
          const scale = draggedEntry.item.scale || 1;
          const isStone = draggedEntry.item.type === 'rock' || draggedEntry.item.type === 'pebble';
          this.drag.root.position.y = ground + (isStone ? draggedEntry.descriptor.height * scale * 0.5 : 0);
        }
        this.drag.moved = true;
        this.updateSelection(this.store.getState());
      }
    };

    this.onPointerUp = event => {
      if (!this.pointerGesture) return;
      if (this.pointerGesture.feeding && !this.pointerGesture.moved) {
        this.setPointerFromEvent(event);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -Math.max(TANK.floor + 0.45, this.waterLevel - 0.2));
        const point = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(plane, point)) {
          point.x = clamp(point.x, -5.55, 5.55);
          point.z = clamp(point.z, -3.05, 3.05);
          this.addFood(point);
        }
      } else if (this.drag) {
        const { id, root, startX, startZ, moved } = this.drag;
        if (moved) {
          const entry = this.decorObjects.get(id);
          if (entry && (Math.abs(root.position.x - startX) + Math.abs(root.position.z - startZ) > 0.025)) {
            this.store.moveDecoration(id, root.position.x, root.position.z);
            this.snapRockOnDrop(id);
          }
        }
      }
      this.drag = null;
      this.pointerGesture = null;
      this.controls.enabled = true;
      try {
        if (this.canvas.hasPointerCapture?.(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      } catch { /* Pointer may have been released by OrbitControls already. */ }
    };

    this.onContextMenu = event => {
      event.preventDefault();
      this.setPointerFromEvent(event);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.decorPickMeshes, false)[0];
      if (!hit) return;
      let node = hit.object;
      while (node && !node.userData.decorId) node = node.parent;
      if (node?.userData.decorId) {
        this.store.selectDecoration(node.userData.decorId);
        this.store.removeSelected();
      }
    };

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  snapRockOnDrop(id) {
    const entry = this.decorObjects.get(id);
    if (!entry || !['rock', 'pebble'].includes(entry.item.type)) return;
    const myRadius = entry.descriptor.radius * (entry.item.scale || 1);
    const myHalf = entry.descriptor.height * (entry.item.scale || 1) * 0.5;
    let top = sandHeightAt(entry.root.position.x, entry.root.position.z);
    for (const [otherId, other] of this.decorObjects) {
      if (otherId === id || !['rock', 'pebble'].includes(other.item.type)) continue;
      const otherRadius = other.descriptor.radius * (other.item.scale || 1);
      const dx = entry.root.position.x - other.root.position.x;
      const dz = entry.root.position.z - other.root.position.z;
      if (Math.hypot(dx, dz) < (myRadius + otherRadius) * 0.52) {
        top = Math.max(top, other.root.position.y + other.descriptor.height * (other.item.scale || 1) * 0.5);
      }
    }
    entry.root.position.y = top + myHalf;
    entry.velocityY = 0;
  }

  setPointerFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  resize() {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    if (this.disposed) return;
    requestAnimationFrame(() => this.animate());
    const dt = Math.min(this.clock.getDelta(), 0.04);
    this.time += dt;
    this.controls.update();

    this.causticsMaterial.uniforms.uTime.value = this.time;
    this.waterMesh.material.uniforms.uTime.value = this.time;
    this.surfaceMaterial.uniforms.uTime.value = this.time;
    this.updateDecorPhysics(dt);
    this.updateDecorAnimations();
    this.updateFood(dt);
    this.updateBubbles(dt);

    const agents = [...this.fishAgents.values()];
    const context = {
      agents,
      foods: this.foods,
      obstacles: this.getObstacles(),
      bounds: FISH_BOUNDS,
      waterLevel: this.waterLevel,
    };
    for (const agent of agents) {
      const eatenId = agent.update(dt, context);
      if (eatenId) {
        const food = this.foods.find(item => item.id === eatenId);
        if (food) food.consumed = true;
        this.store.set({ toast: `${this.store.labelFor(agent.species)} found a snack` });
      }
    }
    const selected = this.store.getState().selectedFish;
    if (selected) {
      const agent = this.fishAgents.get(selected);
      if (agent) this.lastSelectedFishState = { id: selected, state: agent.state, satiety: Math.round(agent.satiety) };
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe?.();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.controls.dispose();
    for (const agent of this.fishAgents.values()) agent.dispose();
    this.renderer.dispose();
    this.host.removeChild(this.renderer.domElement);
  }
}

function randBetween(min, max) { return min + Math.random() * (max - min); }
function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
