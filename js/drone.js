// Quadcopter physics. Thrust pushes along the drone's own UP axis, so tilting
// the drone turns part of that thrust sideways: that's how drones move.
import * as THREE from 'three';
import { PHYS, settings } from './config.js';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _a = new THREE.Vector3(), _up = new THREE.Vector3();
const RADIUS = 0.15; // collision radius (m)

export class Drone {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();  // attitude
    this.heading = 0;                 // yaw angle (rad), used by Angle mode
    this.throttle = 0;                // 0..1 motor output
    this.crashed = false;
  }

  reset(p) {
    this.pos.copy(p); this.vel.set(0, 0, 0); this.q.identity();
    this.heading = 0; this.crashed = false;
  }

  // Stick (-1..1) -> motor throttle (0..1)
  throttleFrom(y) {
    if (settings.throttleMode === 'full') return (y + 1) / 2;
    const h = PHYS.hoverThrottle; // center stick = hover (when level)
    return y >= 0 ? h + y * (1 - h) : h * (1 + y);
  }

  step(dt, s, world) {
    if (this.crashed) return;
    this.throttle = this.throttleFrom(s.throttle);

    // ANGLE mode: stick = target tilt angle; let go and it self-levels.
    // Three.js axes: forward = -Z, up = +Y, right = +X.
    const maxA = settings.maxAngle * DEG;
    this.heading -= s.yaw * settings.rates.yaw * DEG * dt;
    _e.set(-s.pitch * maxA, this.heading, -s.roll * maxA, 'YXZ');
    _q.setFromEuler(_e);
    this.q.slerp(_q, 1 - Math.exp(-PHYS.angleResponse * dt));

    // Forces -> acceleration
    _up.set(0, 1, 0).applyQuaternion(this.q);
    _a.copy(_up).multiplyScalar(this.throttle * PHYS.maxThrust / PHYS.mass);
    _a.y -= PHYS.gravity;
    _a.addScaledVector(this.vel, -(PHYS.linDrag + PHYS.quadDrag * this.vel.length()));
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);

    // Ground: gentle touch = landing, hard hit = crash
    const gy = world.groundAt(this.pos.x, this.pos.z) + RADIUS;
    if (this.pos.y < gy) {
      const hSpeed = Math.hypot(this.vel.x, this.vel.z);
      if (-this.vel.y > 6 || hSpeed > 8 || _up.y < 0.5) return this.crash('ground');
      this.pos.y = gy;
      this.vel.y = Math.max(0, this.vel.y);
      const f = Math.exp(-6 * dt); this.vel.x *= f; this.vel.z *= f; // skid friction
    }
    if (world.hit(this.pos, RADIUS) === 'tree') this.crash('tree');
  }

  crash(what) { this.crashed = what; this.vel.set(0, 0, 0); }
  get speed() { return this.vel.length(); }
}
