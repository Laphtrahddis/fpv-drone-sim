// Infinite, seeded, chunked world. Chunks (200m squares) are built around the drone
// and disposed behind it, so memory stays flat. Same seed = same world.
// Contents: noise terrain, forests, rocks, and city zones with buildings, buildings
// with tunnels to fly through, arches over streets, and ring gates in open country.
import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

const CHUNK = 200, CELL = 10, NC = CHUNK / CELL; // terrain: 20 x 20 cells per chunk
const BLOCK = 50, STREET = 16;                    // city grid: 50m period, 16m wide streets
const TREE_CELL = 16, ROCK_CELL = 8;

// Small deterministic random generator
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Shared geometries + materials (reused by every chunk, never disposed)
const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const CONE = new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0);
const ROCK = new THREE.IcosahedronGeometry(1, 0);
const RING = new THREE.TorusGeometry(1, 0.1, 6, 24);
// Biomes: same generator, different parameters + palette
export const BIOMES = {
  meadow:    { label: 'Meadows & city', sky: 0x9cc4e4, light: 1.6, hills: 1, city: 1, trees: 1, treeH: 1 },
  mountains: { label: 'Mountains', sky: 0xa9c2dc, light: 1.7, hills: 3.2, city: 0, trees: 0.7, treeH: 1 },
  neon:      { label: 'Neon city (night)', sky: 0x0b0c22, light: 0.75, hills: 0.15, city: 2, trees: 0, treeH: 1, neon: true },
  forest:    { label: 'Forest dive', sky: 0xa8c8b0, light: 1.4, hills: 0.6, city: 0, trees: 3, treeH: 1.5 },
  canyon:    { label: 'Canyon run', sky: 0xe8c49a, light: 1.7, hills: 0, city: 0, trees: 0.05, treeH: 1, canyon: true },
};

const MAT = {
  glow: new THREE.MeshBasicMaterial(),  // unlit: gap frames + neon strips stay bright, even at night
  ground: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  box: new THREE.MeshLambertMaterial({ flatShading: true }),
  tree: new THREE.MeshLambertMaterial({ color: 0x2f6b3a, flatShading: true }),
  rock: new THREE.MeshLambertMaterial({ color: 0x6f7a4a, flatShading: true }),
  ring: new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x662200 }),
};

export class World {
  constructor(scene, seed = 1) {
    this.scene = scene;
    this.seed = seed;
    this.B = BIOMES.meadow;
    this.biome = 'meadow';
    this.noise = createNoise2D(mulberry32(seed));
    this.chunks = new Map();
    this.radius = 3; // chunks loaded around the drone (set from graphics quality)
    this.clear = 60; // open, flat area around the spawn (Flight School uses a bigger one)
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.2, 24), new THREE.MeshLambertMaterial({ color: 0xdd8822 }));
    pad.position.y = this.height(0, 0) + 0.1;
    scene.add(this.pad = pad);
  }

  hash(i, j, k = 0) { return mulberry32(i * 374761393 + j * 668265263 + k * 2147483647 + this.seed * 1013904223)(); }

  // 0..1: how much this spot is "city". There's always a city just ahead (-Z) of the spawn.
  city(x, z) {
    if (!this.B.city) return 0;
    if (this.B.city === 2) return smooth(this.clear - 20, this.clear + 30, Math.hypot(x, z)); // all city
    const n = smooth(0.25, 0.45, this.noise(x / 1400 + 50, z / 1400));
    const nearSpawn = 1 - smooth(250, 450, Math.hypot(x, z + 500));
    return Math.max(n, nearSpawn) * smooth(this.clear - 20, this.clear + 30, Math.hypot(x, z)); // keep the spawn clear
  }

  // Terrain height: hills everywhere, flattened in cities and around the spawn.
  height(x, z) {
    const n = this.noise, B = this.B;
    let h = (45 * n(x / 700, z / 700) + 18 * n(x / 220, z / 220) + 4 * n(x / 60, z / 60)) * B.hills;
    if (B.canyon) { // steep walls, with winding flat channels where the noise is near zero
      const wall = smooth(0.05, 0.16, Math.abs(n(x / 650, z / 650)));
      h = wall * (110 + 35 * n(x / 150, z / 150)) + 3 * n(x / 40, z / 40);
    }
    const flat = Math.max(smooth(0.05, 0.5, this.city(x, z)), 1 - smooth(this.clear, this.clear + 190, Math.hypot(x, z)));
    return h * (1 - flat);
  }
  vtx(i, j) { return this.height(i * CELL, j * CELL); }

  // Exact height of the rendered triangles (used for collision).
  groundAt(x, z) {
    const fx = x / CELL, fz = z / CELL, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = this.vtx(i, j), b = this.vtx(i + 1, j), c = this.vtx(i, j + 1), d = this.vtx(i + 1, j + 1);
    return u + v < 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }

  groundColor(c, h, r, cityAmt) {
    const B = this.B;
    if (B.neon) return c.setRGB(0.12 + r, 0.12 + r, 0.18 + r);
    if (cityAmt > 0.3) return c.setRGB(0.32 + r, 0.33 + r, 0.35 + r);   // asphalt / concrete
    if (B.canyon) return h > 6 ? c.setHSL(0.05, 0.45, 0.42 + 0.08 * Math.sin(h * 0.35) + r) : c.setRGB(0.78 + r, 0.62 + r, 0.42);
    if (B === BIOMES.forest) return c.setRGB(0.17 + r, 0.33 + r, 0.15);
    if (B === BIOMES.mountains && h > 110) return c.setRGB(0.92 + r, 0.94 + r, 0.97);  // snow
    if (h > 40) return c.setRGB(0.55 + r, 0.55 + r, 0.55 + r);          // rock
    if (h > 22) return c.setRGB(0.45 + r, 0.42 + r, 0.3);               // dry grass
    return c.setRGB(0.3 + r, 0.5 + r, 0.25);                            // grass
  }

  // Tree for a grid cell, or null. Pure function, so collision needs no list.
  tree(i, j) {
    const x = (i + 0.2 + 0.6 * this.hash(i, j, 1)) * TREE_CELL, z = (j + 0.2 + 0.6 * this.hash(i, j, 2)) * TREE_CELL;
    if (Math.hypot(x, z) < this.clear || this.city(x, z) > 0.05) return null;
    if (this.hash(i, j, 3) > this.B.trees * (0.15 + 0.35 * this.noise(x / 400 + 99, z / 400))) return null;
    const y = this.groundAt(x, z);
    if (this.B.canyon && y > 6) return null;
    return { x, z, y: y - 0.5, h: (8 + 10 * this.hash(i, j, 4)) * this.B.treeH, r: 2.5 + 2 * this.hash(i, j, 5) };
  }

  // ---------- chunk building ----------
  buildChunk(ci, cj) {
    const ch = { group: new THREE.Group(), boxes: [], rings: [], gaps: [] };
    const x0 = ci * CHUNK, z0 = cj * CHUNK;

    // terrain: two triangles per cell, split on the same diagonal as groundAt()
    const pos = new Float32Array(NC * NC * 18), col = new Float32Array(NC * NC * 18), c = new THREE.Color();
    let p = 0;
    for (let a = 0; a < NC; a++) for (let b = 0; b < NC; b++) {
      const I = ci * NC + a, J = cj * NC + b;
      const cityAmt = this.city((I + 0.5) * CELL, (J + 0.5) * CELL);
      for (const q of [[0, 0, 0, 1, 1, 0], [1, 0, 0, 1, 1, 1]]) {
        const hs = [this.vtx(I + q[0], J + q[1]), this.vtx(I + q[2], J + q[3]), this.vtx(I + q[4], J + q[5])];
        const avg = (hs[0] + hs[1] + hs[2]) / 3, r = this.hash(I, J, q[0] + q[5] * 2) * 0.06;
        this.groundColor(c, avg, r, cityAmt);
        for (let k = 0; k < 6; k += 2) {
          pos[p] = (I + q[k]) * CELL; pos[p + 1] = hs[k / 2]; pos[p + 2] = (J + q[k + 1]) * CELL;
          col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b; p += 3;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    ch.group.add(new THREE.Mesh(geo, MAT.ground));

    // city: buildings, tunnel buildings, arches (everything is boxes -> one instanced mesh)
    const boxes = [], colors = [], glows = [], glowColors = [];
    const addBox = (x0, y0, z0, x1, y1, z1, color, glow = false, solid = true) => {
      const b = { x0, y0, z0, x1, y1, z1 };
      (glow ? glows : boxes).push(b); (glow ? glowColors : colors).push(color);
      if (solid) ch.boxes.push(b);
    };
    const NEON = [0x00e5ff, 0xff2bd6, 0x8a5bff, 0xff8a00, 0x39ff88];
    const n = CHUNK / BLOCK;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const bx = x0 + a * BLOCK, bz = z0 + b * BLOCK, cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
      const cityAmt = this.city(cx, cz);
      if (cityAmt < 0.5) continue;
      const I = Math.round(bx / BLOCK), J = Math.round(bz / BLOCK), h = k => this.hash(I, J, 20 + k);
      const gy = this.height(cx, cz);
      const col = new THREE.Color().setHSL([0.07, 0.1, 0.55, 0.6, 0.02][Math.floor(h(2) * 5)], 0.25, this.B.neon ? 0.2 + 0.12 * h(1) : 0.55 + 0.25 * h(1));
      // footprint: block minus half a street on each side, minus a random margin
      const m = STREET / 2 + 3 * h(3);
      const X0 = bx + m, X1 = bx + BLOCK - m, Z0 = bz + m, Z1 = bz + BLOCK - m;
      const H = 12 + 85 * h(4) * h(4) * cityAmt;
      if (h(5) < 0.1) {
        // empty plaza with a ring gate
        this.addRing(ch, cx, gy + 6 + 6 * h(6), cz, h(7) * Math.PI, 4);
      } else if (h(5) < 0.4 && H > 18) {
        // building with a tunnel through it: a "gap" to thread
        const along = h(8) < 0.5;                    // tunnel runs along X or along Z
        const hw = 2.5 + 2.5 * h(9), hh = 2 + 2 * h(10), hy = gy + 4 + (H - 10) * 0.6 * h(11);
        const mid = along ? (Z0 + Z1) / 2 : (X0 + X1) / 2;
        addBox(X0, gy - 5, Z0, X1, hy, Z1, col);                            // below the hole
        addBox(X0, hy + 2 * hh, Z0, X1, gy + H, Z1, col);                   // above the hole
        if (along) { addBox(X0, hy, Z0, X1, hy + 2 * hh, mid - hw, col); addBox(X0, hy, mid + hw, X1, hy + 2 * hh, Z1, col); }
        else { addBox(X0, hy, Z0, mid - hw, hy + 2 * hh, Z1, col); addBox(mid + hw, hy, Z0, X1, hy + 2 * hh, Z1, col); }
        // bright frame around both openings so you can spot them
        const glow = new THREE.Color(0xffaa22), t = 0.4;
        for (const face of along ? [X0 - t, X1] : [Z0 - t, Z1]) {
          const F = (u0, v0, u1, v1) => along ? addBox(face, v0, u0, face + t, v1, u1, glow, true) : addBox(u0, v0, face, u1, v1, face + t, glow, true);
          F(mid - hw - t, hy - t, mid + hw + t, hy);                   // bottom
          F(mid - hw - t, hy + 2 * hh, mid + hw + t, hy + 2 * hh + t); // top
          F(mid - hw - t, hy, mid - hw, hy + 2 * hh);                  // left
          F(mid + hw, hy, mid + hw + t, hy + 2 * hh);                  // right
        }
        ch.gaps.push({ x: along ? (X0 + X1) / 2 : mid, y: hy + hh, z: along ? mid : (Z0 + Z1) / 2, axis: along ? 'x' : 'z', hw, hh });
      } else {
        addBox(X0, gy - 5, Z0, X1, gy + H, Z1, col);
      }
      if (this.B.neon) { // glowing strips: roof outline + a corner stripe
        const nc = new THREE.Color(NEON[Math.floor(h(15) * NEON.length)]), e = 0.3, top = gy + H;
        addBox(X0 - e, top - 0.6, Z0 - e, X1 + e, top, Z0, nc, true, false);
        addBox(X0 - e, top - 0.6, Z1, X1 + e, top, Z1 + e, nc, true, false);
        addBox(X0 - e, top - 0.6, Z0, X0, top, Z1, nc, true, false);
        addBox(X1, top - 0.6, Z0, X1 + e, top, Z1, nc, true, false);
        addBox(X0 - e, gy, Z0 - e, X0 + 0.4, top, Z0 + 0.4, nc, true, false);
      }
      // arch over the street on this block's -Z side
      if (h(12) < 0.15) {
        const ax = cx + (h(13) - 0.5) * 20, ah = 8 + 8 * h(14), s = STREET / 2 + 1, w = 1.5, ac = new THREE.Color(0x8a6e5a);
        addBox(ax - w, gy - 1, bz - s - w, ax + w, gy + ah, bz - s, ac);          // pillar
        addBox(ax - w, gy - 1, bz + s, ax + w, gy + ah, bz + s + w, ac);          // pillar
        addBox(ax - w, gy + ah, bz - s - w, ax + w, gy + ah + 2, bz + s + w, ac); // beam
      }
    }
    for (const [list, cols, mat] of [[boxes, colors, MAT.box], [glows, glowColors, MAT.glow]]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(BOX, mat, list.length), mx = new THREE.Matrix4();
      list.forEach((b, k) => {
        mesh.setMatrixAt(k, mx.makeScale(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2));
        mesh.setColorAt(k, cols[k]);
      });
      ch.group.add(mesh);
    }

    // open country: a ring gate now and then
    if (this.city(x0 + 100, z0 + 100) < 0.2 && this.hash(ci, cj, 30) < 0.5) {
      const rx = x0 + 40 + 120 * this.hash(ci, cj, 31), rz = z0 + 40 + 120 * this.hash(ci, cj, 32);
      if (Math.hypot(rx, rz) > this.clear + 20) this.addRing(ch, rx, this.groundAt(rx, rz) + 5 + 8 * this.hash(ci, cj, 33), rz, this.hash(ci, cj, 34) * Math.PI, 3.5);
    }
    if (ch.rings.length) {
      const mesh = new THREE.InstancedMesh(RING, MAT.ring, ch.rings.length), mx = new THREE.Matrix4(), q = new THREE.Quaternion();
      ch.rings.forEach((r, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw);
        mesh.setMatrixAt(k, mx.compose(new THREE.Vector3(r.x, r.y, r.z), q, new THREE.Vector3(r.R, r.R, r.R)));
      });
      ch.group.add(mesh);
    }

    // trees + rocks (instanced)
    const mx = new THREE.Matrix4(), trees = [], rocks = [];
    for (let i = ci * CHUNK / TREE_CELL; i < (ci + 1) * CHUNK / TREE_CELL; i++)
      for (let j = cj * CHUNK / TREE_CELL; j < (cj + 1) * CHUNK / TREE_CELL; j++) {
        const t = this.tree(i, j);
        if (t) trees.push(mx.clone().makeScale(t.r, t.h, t.r).setPosition(t.x, t.y, t.z));
      }
    for (let i = ci * CHUNK / ROCK_CELL; i < (ci + 1) * CHUNK / ROCK_CELL; i++)
      for (let j = cj * CHUNK / ROCK_CELL; j < (cj + 1) * CHUNK / ROCK_CELL; j++) {
        if (this.hash(i, j, 7) > 0.4) continue;
        const x = (i + this.hash(i, j, 8)) * ROCK_CELL, z = (j + this.hash(i, j, 9)) * ROCK_CELL;
        if (this.city(x, z) > 0.3) continue;
        const s = 0.25 + 0.8 * this.hash(i, j, 10);
        rocks.push(mx.clone().makeScale(s, s * 0.7, s).setPosition(x, this.groundAt(x, z), z));
      }
    for (const [list, g, mat] of [[trees, CONE, MAT.tree], [rocks, ROCK, MAT.rock]]) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach((m2, k) => mesh.setMatrixAt(k, m2));
      ch.group.add(mesh);
    }

    ch.group.traverse(o => { if (o.isInstancedMesh) o.computeBoundingSphere(); });
    this.scene.add(ch.group);
    return ch;
  }

  // Change seed / biome / open area around the spawn. Rebuilds all chunks if anything changed.
  configure({ seed = this.seed, biome = this.biome, clear = this.clear }) {
    if (seed === this.seed && biome === this.biome && clear === this.clear) return;
    if (seed !== this.seed) this.noise = createNoise2D(mulberry32(seed));
    Object.assign(this, { seed, biome, clear, B: BIOMES[biome] || BIOMES.meadow });
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.pad.position.y = this.height(0, 0) + 0.1;
  }

  addRing(ch, x, y, z, yaw, R) { ch.rings.push({ x, y, z, yaw, R, tube: R * 0.1 }); }

  disposeChunk(ch) {
    this.scene.remove(ch.group);
    ch.group.traverse(o => {
      if (o.isInstancedMesh) o.dispose();   // frees the per-chunk instance buffers
      else if (o.isMesh) o.geometry.dispose(); // terrain geometry belongs to this chunk
    });
  }

  // Load chunks around (x,z), unload far ones. Builds at most 1 per call to avoid
  // stutter, unless `all` is set (e.g. on respawn).
  update(x, z, all = false) {
    const ci = Math.floor(x / CHUNK), cj = Math.floor(z / CHUNK), R = this.radius;
    for (const [k, ch] of this.chunks) {
      const [i, j] = k.split(',').map(Number);
      if (Math.abs(i - ci) > R + 1 || Math.abs(j - cj) > R + 1) { this.disposeChunk(ch); this.chunks.delete(k); }
    }
    const missing = [];
    for (let i = ci - R; i <= ci + R; i++) for (let j = cj - R; j <= cj + R; j++)
      if (!this.chunks.has(i + ',' + j)) missing.push([i, j, (i - ci) ** 2 + (j - cj) ** 2]);
    missing.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of missing.slice(0, all ? missing.length : 1)) this.chunks.set(i + ',' + j, this.buildChunk(i, j));
  }

  chunkAt(x, z) { return this.chunks.get(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK)); }

  // Chunks within ~30m of a point (boxes can poke over chunk edges)
  nearChunks(x, z) {
    const set = new Set();
    for (const dx of [-30, 0, 30]) for (const dz of [-30, 0, 30]) { const c = this.chunkAt(x + dx, z + dz); if (c) set.add(c); }
    return set;
  }

  // Does point p (radius r) hit something? Returns 'ground' | 'tree' | 'building' | 'ring' | null.
  hit(p, r = 0.15) {
    if (p.y - r < this.groundAt(p.x, p.z)) return 'ground';
    const i0 = Math.floor(p.x / TREE_CELL), j0 = Math.floor(p.z / TREE_CELL);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const t = this.tree(i, j);
      if (!t || p.y > t.y + t.h) continue;
      const rAtY = t.r * (1 - Math.max(0, p.y - t.y) / t.h);  // cone narrows with height
      if (Math.hypot(p.x - t.x, p.z - t.z) < rAtY + r) return 'tree';
    }
    for (const ch of this.nearChunks(p.x, p.z)) {
      for (const b of ch.boxes)
        if (p.x > b.x0 - r && p.x < b.x1 + r && p.y > b.y0 - r && p.y < b.y1 + r && p.z > b.z0 - r && p.z < b.z1 + r) return 'building';
      for (const g of ch.rings) {
        // distance from p to the ring's tube (ring stands upright, turned by yaw)
        const dx = p.x - g.x, dy = p.y - g.y, dz = p.z - g.z, c = Math.cos(g.yaw), s = Math.sin(g.yaw);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.hypot(Math.hypot(lx, dy) - g.R, lz) < g.tube + r) return 'ring';
      }
    }
    return null;
  }
}
