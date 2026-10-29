import * as THREE from 'three';
import { makeFishModel } from '../world/models.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
const LOCAL_RIGHT = new THREE.Vector3(0, 0, 1);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

const rand = (min, max) => min + Math.random() * (max - min);
const dampAngle = (current, target, lambda, dt) => {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
};
const clampMagnitude = (vector, max) => {
  if (vector.lengthSq() > max * max) vector.setLength(max);
  return vector;
};

function createSatietyLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 144;
  canvas.height = 60;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.15, 0.48, 1);
  sprite.position.set(0, 1.4, 0);
  sprite.renderOrder = 5;
  return { canvas, texture, sprite, material, value: -1 };
}

function updateSatietyLabel(label, satiety) {
  const percent = Math.round(satiety);
  if (label.value === percent) return;

  label.value = percent;
  const context = label.canvas.getContext('2d');
  context.clearRect(0, 0, label.canvas.width, label.canvas.height);
  context.fillStyle = 'rgba(5, 21, 28, 0.88)';
  context.beginPath();
  context.roundRect(4, 4, 136, 52, 24);
  context.fill();
  context.strokeStyle = percent < 25 ? '#f0a887' : '#91e2d3';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = percent < 25 ? '#ffc3a5' : '#e8fff5';
  context.font = 'bold 32px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${percent}%`, 72, 30);
  label.texture.needsUpdate = true;
}

export class FishAgent {
  constructor(definition, waterLevel, index = 0) {
    this.id = definition.id;
    this.species = definition.species;
    this.model = makeFishModel(this.species);
    this.root = this.model.root;
    this.position = new THREE.Vector3(rand(-3.9, 3.9), rand(1.5, Math.max(2, waterLevel - 1.0)), rand(-2.15, 2.15));
    const angle = rand(0, Math.PI * 2);
    this.velocity = new THREE.Vector3(Math.cos(angle), rand(-0.08, 0.08), Math.sin(angle)).multiplyScalar(rand(0.7, 1.25));
    this.acceleration = new THREE.Vector3();
    this.wanderTarget = this.randomWaypoint(waterLevel, this.position);
    this.waypointAge = 0;
    this.waypointMaxAge = rand(30, 42);
    this.state = Math.random() < 0.18 ? 'resting' : 'exploring';
    this.stateTimer = this.state === 'resting' ? rand(4.5, 8) : rand(36, 64);
    this.satiety = rand(36, 82);
    this.satietyLabel = createSatietyLabel();
    this.root.add(this.satietyLabel.sprite);
    updateSatietyLabel(this.satietyLabel, this.satiety);
    this.foodSearchCooldown = rand(16, 28);
    this.targetFoodId = null;
    this.targetFood = null;
    this.cruise = rand(0.82, 1.35);
    this.phase = Math.random() * 100;
    this.size = this.species === 'tang' ? 0.76 : this.species === 'gold' ? 0.72 : 0.66;
    this.root.scale.setScalar(this.size);
    this.root.position.copy(this.position);
    this.yaw = Math.atan2(-this.velocity.z, this.velocity.x);
    this.pitch = Math.asin(THREE.MathUtils.clamp(this.velocity.y / this.velocity.length(), -0.9, 0.9));
    this.bank = 0;
    this.root.rotation.y = this.yaw;
    this.index = index;
    this.age = Math.random() * 10;
  }

  randomWaypoint(waterLevel, fromPosition = null) {
    // Pick a genuinely distant destination so an exploratory swim crosses a
    // meaningful part of the aquarium instead of orbiting a tiny local area.
    const candidates = [];
    for (let i = 0; i < 18; i++) {
      candidates.push(new THREE.Vector3(
        rand(-4.82, 4.82),
        rand(0.98, Math.max(1.08, waterLevel - 0.68)),
        rand(-2.52, 2.52),
      ));
    }
    if (!fromPosition) return candidates[Math.floor(Math.random() * candidates.length)];
    const distant = candidates.filter(point => {
      const dx = point.x - fromPosition.x;
      const dz = point.z - fromPosition.z;
      return Math.hypot(dx, dz) >= 3.25;
    });
    if (distant.length) return distant[Math.floor(Math.random() * distant.length)];
    return candidates.reduce((best, point) => {
      const score = Math.hypot(point.x - fromPosition.x, point.z - fromPosition.z);
      return score > best.score ? { point, score } : best;
    }, { point: candidates[0], score: -1 }).point;
  }

  chooseExplorationWaypoint(waterLevel) {
    this.wanderTarget.copy(this.randomWaypoint(waterLevel, this.position));
    this.waypointAge = 0;
    this.waypointMaxAge = rand(30, 44);
  }

  setState(state, duration) {
    this.state = state;
    this.stateTimer = duration;
    if (state !== 'seeking food') {
      this.targetFoodId = null;
      this.targetFood = null;
    }
  }

  chooseFood(foodItems) {
    if (!foodItems.length) return null;
    // A little randomness keeps fish from moving as a synchronized group.
    const candidates = foodItems.filter(food => !food.consumed);
    if (!candidates.length) return null;
    const food = candidates[Math.floor(Math.random() * candidates.length)];
    this.targetFoodId = food.id;
    this.targetFood = food;
    return food;
  }

  steerToward(target, desiredSpeed, maxForce = 1.5) {
    const desired = _v1.copy(target).sub(this.position);
    if (desired.lengthSq() < 0.0001) return new THREE.Vector3();
    desired.normalize().multiplyScalar(desiredSpeed).sub(this.velocity);
    return clampMagnitude(desired, maxForce);
  }

  update(dt, context) {
    this.age += dt;
    this.satiety = Math.max(0, this.satiety - dt * 0.34);
    updateSatietyLabel(this.satietyLabel, this.satiety);
    this.stateTimer -= dt;
    this.foodSearchCooldown = Math.max(0, this.foodSearchCooldown - dt);
    const { agents, foods, obstacles, bounds, waterLevel } = context;

    if (this.state === 'seeking food') {
      const targetAlive = this.targetFood && foods.some(f => f.id === this.targetFoodId && !f.consumed);
      if (!targetAlive) {
        this.targetFood = null;
        this.targetFoodId = null;
        const next = this.chooseFood(foods);
        if (!next) {
          this.setState('exploring', rand(24, 38));
          this.chooseExplorationWaypoint(waterLevel);
        } else this.stateTimer = rand(12, 22);
      }
    } else if (this.satiety < 62 && foods.length && this.foodSearchCooldown <= 0) {
      const target = this.chooseFood(foods);
      this.foodSearchCooldown = rand(18, 30);
      if (target) this.setState('seeking food', rand(12, 22));
    }

    if (this.stateTimer <= 0) {
      if (this.state === 'resting') {
        this.setState('exploring', rand(34, 58));
        this.chooseExplorationWaypoint(waterLevel);
      } else if (this.state === 'seeking food') {
        this.setState('exploring', rand(26, 42));
        this.chooseExplorationWaypoint(waterLevel);
      } else if (Math.random() < 0.16 && this.satiety > 25) {
        this.setState('resting', rand(4, 8));
      } else {
        // Keep the current destination when an exploration state rolls over.
        // State timers must not cause a new turn every few seconds.
        this.stateTimer = rand(34, 58);
      }
    }

    let targetForce = new THREE.Vector3();
    let desiredSpeed = this.cruise * (0.91 + 0.12 * Math.sin(this.age * 0.8 + this.phase));

    if (this.state === 'seeking food' && this.targetFood) {
      targetForce.add(this.steerToward(this.targetFood.mesh.position, 1.5, 1.8).multiplyScalar(1.55));
      desiredSpeed = this.cruise * 1.18;
    } else if (this.state === 'resting') {
      desiredSpeed = 0.36 + 0.08 * Math.sin(this.age * 0.7 + this.phase);
      // Stay near a small, shifting resting area rather than freezing in place.
      this.waypointAge += dt;
      if (this.position.distanceTo(this.wanderTarget) < 0.55 || this.waypointAge > this.waypointMaxAge) {
        this.wanderTarget.copy(this.position).add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.25, 0.25), rand(-0.6, 0.6)));
        this.waypointAge = 0;
        this.waypointMaxAge = rand(8, 13);
      }
      targetForce.add(this.steerToward(this.wanderTarget, desiredSpeed, 0.65).multiplyScalar(1.2));
    } else {
      this.waypointAge += dt;
      if (this.position.distanceTo(this.wanderTarget) < 0.78 || this.waypointAge > this.waypointMaxAge) {
        this.chooseExplorationWaypoint(waterLevel);
      }
      targetForce.add(this.steerToward(this.wanderTarget, desiredSpeed, 1.1).multiplyScalar(1.0));
    }

    // Gentle flocking: separation is stronger than alignment/cohesion so fish do not bunch up.
    const separation = new THREE.Vector3();
    const alignment = new THREE.Vector3();
    const cohesion = new THREE.Vector3();
    let neighbours = 0;
    let separationCount = 0;
    for (const other of agents) {
      if (other === this) continue;
      const delta = _v2.copy(this.position).sub(other.position);
      const distance = delta.length();
      if (distance > 0 && distance < 1.35) {
        separation.add(delta.normalize().multiplyScalar(1 / Math.max(0.15, distance)));
        separationCount++;
      }
      if (distance > 0 && distance < 3.2) {
        alignment.add(other.velocity);
        cohesion.add(other.position);
        neighbours++;
      }
    }
    if (separationCount) targetForce.add(clampMagnitude(separation, 1.7).multiplyScalar(1.15));
    if (neighbours) {
      alignment.divideScalar(neighbours).normalize().multiplyScalar(desiredSpeed).sub(this.velocity);
      targetForce.add(clampMagnitude(alignment, 0.55).multiplyScalar(0.24));
      cohesion.divideScalar(neighbours);
      targetForce.add(this.steerToward(cohesion, desiredSpeed * 0.75, 0.5).multiplyScalar(0.18));
    }

    // Soft boundary steering keeps every fish inside the glass without abrupt reflections.
    const margin = 0.68;
    const softWall = (value, limit, sign) => {
      const distance = limit - Math.abs(value);
      if (distance < margin) return sign * THREE.MathUtils.clamp((margin - distance) / margin, 0, 1) * 2.0;
      return 0;
    };
    targetForce.x += softWall(this.position.x, bounds.x, -Math.sign(this.position.x || 1));
    targetForce.z += softWall(this.position.z, bounds.z, -Math.sign(this.position.z || 1));
    if (this.position.y < 1.0) targetForce.y += (1.0 - this.position.y) * 1.8;
    if (this.position.y > waterLevel - 0.65) targetForce.y -= (this.position.y - (waterLevel - 0.65)) * 1.8;

    // Decorations are approximated by soft 3D avoidance volumes. Coral remains porous in the visual model,
    // while a conservative outer radius prevents obvious fish/prop intersections.
    for (const obstacle of obstacles) {
      const away = _v3.set(this.position.x - obstacle.x, (this.position.y - obstacle.y) * 0.75, this.position.z - obstacle.z);
      const distance = away.length();
      const safe = obstacle.radius + 0.28;
      if (distance > 0.001 && distance < safe + 0.75) {
        const strength = THREE.MathUtils.clamp((safe + 0.75 - distance) / 0.75, 0, 1);
        targetForce.add(away.normalize().multiplyScalar(strength * 2.1));
      }
    }

    // Limit acceleration and let velocity turn gradually. No instant direction flips.
    clampMagnitude(targetForce, 2.3);
    this.acceleration.copy(targetForce);
    this.velocity.addScaledVector(this.acceleration, dt);
    const maxSpeed = this.state === 'resting' ? 0.62 : this.cruise * 1.48;
    if (this.velocity.length() > maxSpeed) this.velocity.setLength(maxSpeed);
    const minSpeed = this.state === 'resting' ? 0.18 : 0.48;
    if (this.velocity.length() < minSpeed) this.velocity.setLength(minSpeed);
    this.position.addScaledVector(this.velocity, dt);
    this.position.x = THREE.MathUtils.clamp(this.position.x, -bounds.x, bounds.x);
    this.position.z = THREE.MathUtils.clamp(this.position.z, -bounds.z, bounds.z);
    this.position.y = THREE.MathUtils.clamp(this.position.y, 0.78, waterLevel - 0.52);
    this.root.position.copy(this.position);

    // Derive orientation from yaw/pitch angles instead of mapping the forward
    // vector with setFromUnitVectors (which leaves roll free to flip at poles).
    // Yaw and pitch follow the smoothed velocity; roll is a small bank around
    // the fish's own forward axis and is always clamped to +/-20 degrees.
    const direction = this.velocity.clone().normalize();
    const previousYaw = this.yaw;
    const horizontalLength = Math.hypot(direction.x, direction.z);
    const targetYaw = horizontalLength < 0.045 ? this.yaw : Math.atan2(-direction.z, direction.x);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1));
    this.yaw = dampAngle(this.yaw, targetYaw, 6.2, dt);
    this.pitch = THREE.MathUtils.damp(this.pitch, targetPitch, 5.4, dt);
    const yawStep = Math.atan2(Math.sin(this.yaw - previousYaw), Math.cos(this.yaw - previousYaw));
    const turnRate = dt > 0 ? yawStep / dt : 0;
    const maxBank = THREE.MathUtils.degToRad(20);
    const targetBank = THREE.MathUtils.clamp(-turnRate * 0.075, -maxBank, maxBank);
    this.bank = THREE.MathUtils.damp(this.bank, targetBank, 4.2, dt);
    this.bank = THREE.MathUtils.clamp(this.bank, -maxBank, maxBank);

    const yawQ = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, this.yaw);
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(LOCAL_RIGHT, this.pitch);
    const rollQ = new THREE.Quaternion().setFromAxisAngle(LOCAL_FORWARD, this.bank);
    this.root.quaternion.copy(yawQ).multiply(pitchQ).multiply(rollQ);

    const speed = this.velocity.length();
    const finRate = 5.8 + speed * 5.5;
    this.model.tailPivot.rotation.y = Math.sin(this.age * finRate + this.phase) * (0.25 + speed * 0.13);
    for (const fin of this.model.pectorals) {
      fin.pivot.rotation.x = fin.sign * (0.18 + Math.sin(this.age * 7.2 + this.phase) * 0.17);
      fin.pivot.rotation.y = Math.cos(this.age * 5.2 + this.phase) * 0.12;
    }
    this.model.body.rotation.z = Math.sin(this.age * 3.1 + this.phase) * 0.018;

    if (this.state === 'seeking food' && this.targetFood && this.position.distanceTo(this.targetFood.mesh.position) < 0.5) {
      const eatenId = this.targetFoodId;
      this.satiety = Math.min(100, this.satiety + 38);
      updateSatietyLabel(this.satietyLabel, this.satiety);
      this.foodSearchCooldown = rand(22, 34);
      this.setState('exploring', rand(28, 44));
      this.chooseExplorationWaypoint(waterLevel);
      return eatenId;
    }
    return null;
  }

  dispose() {
    const materials = new Set();
    this.root.traverse(object => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    for (const material of materials) material.dispose();
    this.satietyLabel.texture.dispose();
  }
}
