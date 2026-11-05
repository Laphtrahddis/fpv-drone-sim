// Gates (rings) used by Flight School and race modes: mesh, pass detection, collision.
import * as THREE from 'three';

const GEO = new THREE.TorusGeometry(1, 0.07, 8, 32);
export const GATE_COLORS = { next: 0xff7a1a, later: 0xdddddd, done: 0x33dd55 };

export function makeGate(group, x, y, z, yaw = 0, R = 4) {
  const mesh = new THREE.Mesh(GEO, new THREE.MeshLambertMaterial({ color: GATE_COLORS.later, emissive: 0x222222 }));
  mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.setScalar(R);
  group.add(mesh);
  return { mesh, pos: mesh.position, n: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), R, tube: R * 0.07 };
}

export function setGateColor(g, key) { g.mesh.material.color.setHex(GATE_COLORS[key]); }

const _d = new THREE.Vector3();
// Did the drone cross the gate plane, inside the ring, between prev and cur?
export function gatePassed(g, prev, cur) {
  const a = _d.subVectors(prev, g.pos).dot(g.n), b = _d.subVectors(cur, g.pos).dot(g.n);
  if (Math.sign(a) === Math.sign(b) || a === b) return false;
  const t = a / (a - b);
  _d.lerpVectors(prev, cur, t).sub(g.pos);
  return _d.length() < g.R - g.tube;
}

// Is point p touching the ring's tube?
export function gateHit(g, p, r = 0.15) {
  _d.subVectors(p, g.pos);
  const along = _d.dot(g.n), inPlane = Math.sqrt(Math.max(0, _d.lengthSq() - along * along));
  return Math.hypot(inPlane - g.R, along) < g.tube + r;
}
