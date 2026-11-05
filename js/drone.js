// Quadcopter physics, modelled like a real 5" FPV quad running Betaflight:
//  - Sticks don't set the attitude directly. They set a ROTATION RATE (deg/s) and a
//    fast "rate loop" spins the drone to match, so rotation has momentum like a real quad.
//  - ACRO: stick = rotation rate. Let go and the drone holds whatever angle it is at.
//  - ANGLE: stick = target tilt. A P-controller turns the angle error into a rate (self-levels).
//  - Motors spool up with a small delay, and thrust ~ RPM^2 (so throttle is not linear).
//  - Props lose thrust as air flows through them faster (limits climb + top speed).
//  - Drag depends on direction: flat side (falling) has lots of drag, edge-on has little.
import * as THREE from 'three';
import { PHYS, settings } from './config.js';

const DEG = Math.PI / 180;
const RADIUS = 0.15; // collision radius (m)
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _a = new THREE.Vector3(), _v = new THREE.Vector3();
const _up = new THREE.Vector3(), _inv = new THREE.Quaternion(), _sp = new THREE.Vector3();

// Betaflight "Actual" rates: center sensitivity, max rate, expo -> deg/s
export function actualRate(x, r) {
  const a = Math.abs(x);
  const expoF = a * (Math.pow(x, 5) * r.expo + x * (1 - r.expo));
  return x * r.center + Math.max(0, r.max - r.center) * expoF;
}

export class Drone {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.q = new THREE.Quaternion();  // attitude
    this.w = new THREE.Vector3();     // body angular velocity (rad/s): x = pitch, y = yaw, z = roll
    this.motor = 0;                   // actual motor output 0..1 (lags behind throttle)
    this.throttle = 0;                // commanded throttle 0..1
    this.mode = settings.startMode;
    this.crashed = false;
    this.armed = false;
    this.battery = 1;                 // 0..1
    this.flightTime = 0;              // seconds armed
  }

  reset(p) {
    this.pos.copy(p); this.vel.set(0, 0, 0); this.q.identity(); this.w.set(0, 0, 0);
    this.motor = 0; this.crashed = false;
    this.armed = false; this.battery = 1; this.flightTime = 0;
  }

  // Real drones only arm with the throttle at the bottom, so props can't spin up by surprise.
  // Returns false if the throttle wasn't low.
  toggleArm(s) {
    if (this.armed || this.crashed) { this.armed = false; return true; }
    if (s.throttle > -0.75) return false;
    this.armed = true;
    return true;
  }

  // 4S LiPo: 16.8V full, ~14.0V empty, and the voltage dips under load ("sag")
  get voltage() { return 14 + 2.8 * this.battery - 0.8 * this.motor * this.motor; }

  // yaw angle of the nose, used by the chase cam
  get heading() { return _e.setFromQuaternion(this.q, 'YXZ').y; }
  get speed() { return this.vel.length(); }

  // Stick (-1..1) -> throttle (0..1). Center-hover puts the hover point at stick center.
  throttleFrom(y) {
    if (settings.throttleMode === 'full') return (y + 1) / 2;
    const h = PHYS.hoverThrottle;
    return y >= 0 ? h + y * (1 - h) : h * (1 + y);
  }

  step(dt, s, world) {
    if (this.crashed) return;
    const R = settings.rates;

    // ---- 1. rate setpoint (what rotation speed the pilot is asking for), body frame ----
    // Three.js axes: forward = -Z, up = +Y, right = +X.  Nose down = -X rotation, roll right = -Z.
    _sp.set(-actualRate(s.pitch, R.pitch), -actualRate(s.yaw, R.yaw), -actualRate(s.roll, R.roll)).multiplyScalar(DEG);
    const live = this.armed && this.battery > 0;
    if (!live) _sp.copy(this.w);   // no motors = no control: it just tumbles
    else if (this.mode === 'ANGLE') {
      // target attitude = current heading, tilted by the stick angle
      const maxA = settings.maxAngle * DEG;
      _e.setFromQuaternion(this.q, 'YXZ');
      _q.setFromEuler(_e.set(-s.pitch * maxA, _e.y, -s.roll * maxA, 'YXZ'));
      // angle error in the drone's own frame -> rotation rate (P controller)
      _inv.copy(this.q).invert().multiply(_q);
      if (_inv.w < 0) { _inv.x = -_inv.x; _inv.y = -_inv.y; _inv.z = -_inv.z; _inv.w = -_inv.w; }
      const ang = 2 * Math.acos(Math.min(1, _inv.w)), sn = Math.sqrt(1 - _inv.w * _inv.w) || 1;
      _sp.x = PHYS.angleGain * ang * _inv.x / sn;
      _sp.z = PHYS.angleGain * ang * _inv.z / sn;
    }

    // ---- 2. rate loop: real quads reach the requested rate in a few tens of ms ----
    this.w.lerp(_sp, 1 - Math.exp(-dt / PHYS.rateLag));
    // a little turbulence / prop wash, more with speed and throttle
    const turb = PHYS.turbulence * (0.3 + this.motor + this.speed / 30);
    this.w.x += (Math.random() - 0.5) * turb * dt * 60;
    this.w.z += (Math.random() - 0.5) * turb * dt * 60;
    // integrate attitude (body-frame rotation = multiply on the right)
    const wl = this.w.length();
    if (wl > 1e-6) this.q.multiply(_q.setFromAxisAngle(_v.copy(this.w).divideScalar(wl), wl * dt)).normalize();

    // ---- 3. motors: spool-up lag, thrust ~ rpm^2, idle spin (air mode) ----
    this.throttle = this.throttleFrom(s.throttle);
    const cmd = live ? PHYS.idle + (1 - PHYS.idle) * this.throttle : 0;
    this.motor += (cmd - this.motor) * (1 - Math.exp(-dt / PHYS.motorLag));
    _up.set(0, 1, 0).applyQuaternion(this.q);
    const inflow = this.vel.dot(_up);                                 // air speed through the props
    const dyn = THREE.MathUtils.clamp(1 - inflow / PHYS.propSpeed, 0, 1.15);
    const thrust = PHYS.maxThrust * settings.gravity * (1 - PHYS.sag * (1 - this.battery)) * this.motor * this.motor * dyn;
    if (live) {
      this.battery = Math.max(0, this.battery - dt * PHYS.batteryLife * (0.08 + this.motor * this.motor));
      this.flightTime += dt;
    }

    // ---- 4. forces: thrust + gravity + direction-dependent drag ----
    _a.copy(_up).multiplyScalar(thrust / PHYS.mass);
    _a.y -= PHYS.gravity * settings.gravity;
    const vUp = inflow, sp = this.speed;                              // split velocity: along UP vs in the prop plane
    _v.copy(this.vel).addScaledVector(_up, -vUp);
    _a.addScaledVector(_up, -PHYS.dragUp * vUp * sp);
    _a.addScaledVector(_v, -PHYS.dragFlat * sp);
    _a.addScaledVector(this.vel, -PHYS.linDrag);
    this.vel.addScaledVector(_a, dt);
    this.pos.addScaledVector(this.vel, dt);

    // ---- 5. collisions: gentle touch = landing, hard hit = crash ----
    const gy = world.groundAt(this.pos.x, this.pos.z) + RADIUS;
    if (this.pos.y < gy) {
      // forgiving: only a hard slam, a very fast touch or landing upside down is a crash
      if (-this.vel.y > 9 || this.speed > 16 || _up.y < 0) return this.crash('ground');
      this.pos.y = gy;
      this.vel.y = Math.max(0, this.vel.y);
      const f = Math.exp(-3 * dt); this.vel.x *= f; this.vel.z *= f;
      if (!live) this.w.set(0, 0, 0);
      if (_up.y < 0.98 && (!live || _up.y < 0.7 || this.throttle < PHYS.hoverThrottle)) this.q.slerp(_q.setFromEuler(_e.set(0, this.heading, 0)), 1 - Math.exp(-10 * dt)); // settle flat on its legs
    }
    const hit = world.hit(this.pos, RADIUS);
    if (hit && hit !== 'ground') this.crash(hit);
  }

  crash(what) { this.crashed = what; this.armed = false; this.vel.set(0, 0, 0); this.w.set(0, 0, 0); }
}
