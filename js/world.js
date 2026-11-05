// Phase 1 world: low-poly noise terrain + trees. The terrain mesh follows the drone
// (snapped to the grid) so you can fly forever. Phase 3 replaces this with real chunks.
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const CELL = 15, N = 160;        // terrain grid: 160 x 15m = 2.4km across
const TREE_CELL = 30, TREE_R = 900;

// Small deterministic random generator, so the same seed gives the same world.
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const hash = (i, j, k = 0) => mulberry32(i * 374761393 + j * 668265263 + k * 2147483647)();

export class World {
  constructor(scene, seed = 1) {
    this.noise = createNoise2D(mulberry32(seed));
    this.center = null;

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * N * 18), 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * N * 18), 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    scene.add(this.ground = new THREE.Mesh(this.geo, mat));

    const cone = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
    this.trees = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: 0x2f6b3a, flatShading: true }), 4000);
    scene.add(this.trees);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.2, 24), new THREE.MeshLambertMaterial({ color: 0xdd8822 }));
    pad.position.y = this.height(0, 0) + 0.1;
    scene.add(pad);
  }

  // Smooth noise height. Flattened near the spawn point so there's room to take off.
  height(x, z) {
    const n = this.noise;
    let h = 45 * n(x / 700, z / 700) + 18 * n(x / 220, z / 220) + 4 * n(x / 60, z / 60);
    const d = Math.min(1, Math.hypot(x, z) / 250);
    return h * d * d * (3 - 2 * d);
  }
  vtx(i, j) { return this.height(i * CELL, j * CELL); }

  // Exact height of the rendered triangles (matches the mesh, used for collision).
  groundAt(x, z) {
    const fx = x / CELL, fz = z / CELL, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = this.vtx(i, j), b = this.vtx(i + 1, j), c = this.vtx(i, j + 1), d = this.vtx(i + 1, j + 1);
    return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  // Tree for a grid cell, or null. Pure function of cell coords, so no tree list is needed.
  tree(i, j) {
    const x = (i + 0.2 + 0.6 * hash(i, j, 1)) * TREE_CELL, z = (j + 0.2 + 0.6 * hash(i, j, 2)) * TREE_CELL;
    if (Math.hypot(x, z) < 60) return null;
    const density = 0.15 + 0.35 * this.noise(x / 400 + 99, z / 400);
    if (hash(i, j, 3) > density) return null;
    return { x, z, y: this.groundAt(x, z) - 0.5, h: 8 + 10 * hash(i, j, 4), r: 2.5 + 2 * hash(i, j, 5) };
  }

  // Rebuild terrain + trees around (x,z) when the drone has moved far enough.
  update(x, z) {
    const ci = Math.round(x / 300) * 300 / CELL, cj = Math.round(z / 300) * 300 / CELL;
    if (this.center && this.center[0] === ci && this.center[1] === cj) return;
    this.center = [ci, cj];

    const pos = this.geo.attributes.position.array, col = this.geo.attributes.color.array;
    const H = new Float32Array((N + 1) * (N + 1));
    const i0 = ci - N / 2, j0 = cj - N / 2;
    for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) H[a * (N + 1) + b] = this.vtx(i0 + a, j0 + b);
    const c = new THREE.Color();
    let p = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const I = i0 + a, J = j0 + b, h = (da, db) => H[(a + da) * (N + 1) + b + db];
      // two triangles per cell, split along the same diagonal as groundAt()
      const tris = [[0, 0, 0, 1, 1, 0], [1, 0, 0, 1, 1, 1]];
      for (let t = 0; t < 2; t++) {
        const q = tris[t];
        const avg = (h(q[0], q[1]) + h(q[2], q[3]) + h(q[4], q[5])) / 3;
        const r = hash(I, J, t) * 0.06;
        if (avg > 40) c.setRGB(0.55 + r, 0.55 + r, 0.55 + r);           // rock
        else if (avg > 22) c.setRGB(0.45 + r, 0.42 + r, 0.3);            // dry grass
        else c.setRGB(0.3 + r, 0.5 + r, 0.25);                           // grass
        for (let k = 0; k < 6; k += 2) {
          pos[p] = (I + q[k]) * CELL; pos[p + 1] = h(q[k], q[k + 1]); pos[p + 2] = (J + q[k + 1]) * CELL;
          col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b; p += 3;
        }
      }
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();

    const m = new THREE.Matrix4(), cx = ci * CELL, cz = cj * CELL, R = TREE_R / TREE_CELL;
    let n = 0;
    for (let i = Math.floor(cx / TREE_CELL) - R; i <= cx / TREE_CELL + R; i++)
      for (let j = Math.floor(cz / TREE_CELL) - R; j <= cz / TREE_CELL + R && n < 4000; j++) {
        const t = this.tree(i, j);
        if (t) this.trees.setMatrixAt(n++, m.makeScale(t.r, t.h, t.r).setPosition(t.x, t.y, t.z));
      }
    this.trees.count = n;
    this.trees.instanceMatrix.needsUpdate = true;
    this.trees.computeBoundingSphere();
  }

  // Does point p hit the ground or a tree? Returns 'ground', 'tree' or null.
  hit(p, radius = 0.15) {
    if (p.y - radius < this.groundAt(p.x, p.z)) return 'ground';
    const i0 = Math.floor(p.x / TREE_CELL), j0 = Math.floor(p.z / TREE_CELL);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const t = this.tree(i, j);
      if (!t || p.y > t.y + t.h) continue;
      const rAtY = t.r * (1 - Math.max(0, p.y - t.y) / t.h);  // cone narrows with height
      if (Math.hypot(p.x - t.x, p.z - t.z) < rAtY + radius) return 'tree';
    }
    return null;
  }
}
