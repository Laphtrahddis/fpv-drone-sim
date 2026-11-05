// Game modes. Each mode is an object main.js runs while flying:
//   title, intro          shown on the intro screen
//   world {seed,biome,clear}, spawn {pos,mode,armed}
//   setup(c)              build props (gates, beacons...) - called on every (re)start
//   update(c, dt)         run rules; call c.hud(title, goal, progress) and c.finish(...) when done
//   onCrash(c)            optional
// c = { drone, alt, props, prev, ghost, say(text), hud(...), finish(title, text, shareUrl), restart() }
import * as THREE from 'three';
import { settings } from './config.js';
import { LESSONS, markDone } from './school.js';
import { makeGate, setGateColor, gatePassed, gateHit } from './gates.js';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const freeWorld = () => ({ seed: settings.seed, biome: settings.biome, clear: 60 });

// Arrow + distance to a target, for the HUD
function pointer(d, x, y, z) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(d.q);
  let a = Math.atan2(x - d.pos.x, -(z - d.pos.z)) - Math.atan2(f.x, -f.z);
  a = Math.atan2(Math.sin(a), Math.cos(a)) * 180 / Math.PI;
  const arrow = Math.abs(a) < 20 ? '↑' : Math.abs(a) > 150 ? '↓' : a > 0 ? (a > 60 ? '→' : '↗') : (a < -60 ? '←' : '↖');
  const dy = y - d.pos.y, vert = dy > 4 ? ' ▲' : dy < -4 ? ' ▼' : '';
  return `${arrow}${vert} ${Math.round(Math.hypot(x - d.pos.x, z - d.pos.z))} m`;
}

// ---------------- Flight School lesson ----------------
export function lessonMode(i) {
  const L = LESSONS[i];
  return {
    title: `Lesson ${i + 1}: ${L.title}`, intro: L.teach, spawn: L.spawn,
    world: { seed: 1, biome: 'meadow', clear: 450 },
    next: i + 1 < LESSONS.length ? () => lessonMode(i + 1) : null,
    setup(c) { this.steps = L.steps(c); this.cur = 0; },
    update(c, dt) {
      if (this.steps[this.cur].check(c, dt)) {
        this.cur++;
        if (this.cur >= this.steps.length) {
          markDone(i);
          return c.finish('LESSON COMPLETE ✓', this.next
            ? `Nice flying! Next up: "${LESSONS[i + 1].title}".`
            : 'You graduated from Flight School! You know the real basics of FPV flying now. Go rip in Free Flight!');
        }
        c.say('✓ Nice!');
      }
      const cur = this.steps[this.cur];
      c.hud(`${i + 1}. ${L.title}   (step ${this.cur + 1}/${this.steps.length})`,
        typeof cur.text === 'function' ? cur.text() : cur.text, cur.check.p || 0);
    },
  };
}

// ---------------- Gate Race (also used by the Daily Challenge) ----------------
const N_GATES = 12, PENALTY = 3, REC_DT = 0.05;
export function raceMode(seed, { daily = false, rival = null } = {}) {
  const key = `fpv-race-${seed}`;
  return {
    title: daily ? `Daily Challenge (${new Date().toISOString().slice(0, 10)})` : `Gate Race #${seed}`,
    intro: `${N_GATES} gates. The ORANGE gate is next; fly through them in order.
Timer starts when you take off. Missing a gate costs +${PENALTY} s. Hitting a gate = crash = restart.
Your best run is saved, and you race against its GHOST (the see-through drone).` +
      (load(key, null) ? `\nYour best: ${load(key).time.toFixed(2)} s` : '') +
      (rival ? `\nA friend flew this course in ${rival.toFixed(2)} s. Beat it!` : '') +
      (daily ? `\nEveryone in the world gets this same course today.` : ''),
    world: { seed, biome: 'meadow', clear: 900 },
    setup(c) {
      // seeded course: a winding line of gates heading away from the spawn
      const r = rng(seed * 7 + 3);
      let x = 0, z = 0, head = 0;
      this.gates = [];
      for (let k = 0; k < N_GATES; k++) {
        head += (r() - 0.5) * 1.3;
        const d = 45 + 30 * r();
        x -= Math.sin(head) * d; z -= Math.cos(head) * d;
        this.gates.push(makeGate(c.props, x, 4 + 9 * r(), z, head, 4.5));
      }
      setGateColor(this.gates[0], 'next');
      Object.assign(this, { i: 0, t: 0, pen: 0, running: false, rec: [], recT: 0, best: load(key, null) });
      c.ghost.visible = false;
    },
    update(c, dt) {
      const d = c.drone, g = this.gates[this.i];
      if (!this.running && d.armed && c.alt > 0.3) this.running = true;
      if (this.running) {
        this.t += dt;
        if ((this.recT -= dt) <= 0) {
          this.recT = REC_DT;
          this.rec.push([d.pos.x, d.pos.y, d.pos.z, d.q.x, d.q.y, d.q.z, d.q.w].map(v => Math.round(v * 100) / 100));
        }
        const gh = this.best?.ghost?.[Math.floor(this.t / REC_DT)];
        c.ghost.visible = !!gh;
        if (gh) { c.ghost.position.set(gh[0], gh[1], gh[2]); c.ghost.quaternion.set(gh[3], gh[4], gh[5], gh[6]); }
      }
      for (const gg of this.gates) if (gateHit(gg, d.pos)) d.crash('gate');
      if (gatePassed(g, c.prev, d.pos)) this.advance('done');
      else { // crossed the gate's plane but outside the ring = missed
        const a = g.n.dot(c.prev.clone().sub(g.pos)), b = g.n.dot(d.pos.clone().sub(g.pos));
        if (Math.sign(a) !== Math.sign(b) && d.pos.distanceTo(g.pos) < g.R * 5) {
          this.pen += PENALTY; c.say(`Missed a gate! +${PENALTY} s`); this.advance('later');
        }
      }
      if (this.i >= N_GATES) {
        const time = this.t + this.pen, best = this.best?.time;
        const isBest = !best || time < best;
        if (isBest) save(key, { time, ghost: this.rec });
        const url = `${location.origin}${location.pathname}?seed=${seed}&time=${time.toFixed(2)}${daily ? '&daily=1' : ''}`;
        c.ghost.visible = false;
        return c.finish('FINISH! 🏁', `Time: ${time.toFixed(2)} s` + (this.pen ? ` (incl. ${this.pen} s penalty)` : '') +
          (isBest ? (best ? `\nNEW BEST! (old: ${best.toFixed(2)} s)` : '\nFirst run saved as your ghost.') : `\nBest: ${best.toFixed(2)} s`) +
          (rival ? (time < rival ? `\nYou beat your friend's ${rival.toFixed(2)} s! 🎉` : `\nFriend's time: ${rival.toFixed(2)} s. Try again!`) : ''), url);
      }
      c.hud(this.title, `Gate ${Math.min(this.i + 1, N_GATES)}/${N_GATES}   ⏱ ${this.t.toFixed(2)} s` + (this.pen ? `  +${this.pen} s` : '') +
        (this.best ? `   best ${this.best.time.toFixed(2)}` : '') + (this.running ? '' : '   (timer starts on take-off)'), this.i / N_GATES);
    },
    advance(color) {
      setGateColor(this.gates[this.i], color);
      this.i++;
      if (this.gates[this.i]) setGateColor(this.gates[this.i], 'next');
    },
  };
}

export function dailySeed() {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

// ---------------- Gap Challenge: thread the needle ----------------
export function gapMode() {
  const KEY = 'fpv-gap-best';
  return {
    title: 'Gap Challenge', world: { seed: settings.seed, biome: settings.biome === 'neon' ? 'neon' : 'meadow', clear: 60 },
    intro: `Fly THROUGH the tunnels in buildings (the openings with the glowing frame).
Your target gap has a light beam above it; the arrow at the top points to it.
Each gap scores a point, and the gaps get narrower as your score goes up.
Crashing resets your streak. Tip: slow down, line up early, small corrections.`,
    setup(c) {
      this.score ??= 0; this.streak ??= 0; this.used ??= new Set(); this.target = null; // score survives crashes, streak doesn't
      this.best = load(KEY, 0);
      this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 150, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.35, depthWrite: false }));
      c.props.add(this.beam);
    },
    onCrash() { this.streak = 0; this.target = null; },
    pick(c) {
      const d = c.drone, maxHw = Math.max(2.5, 5 - this.score * 0.25);
      let best = null, bestD = Infinity, any = null, anyD = Infinity;
      for (const ch of c.world.chunks.values()) for (const g of ch.gaps) {
        const id = `${g.x},${g.y},${g.z}`, dist = Math.hypot(g.x - d.pos.x, g.z - d.pos.z);
        if (this.used.has(id) || dist < 25) continue;
        if (dist < anyD) { any = g; anyD = dist; }
        if (g.hw <= maxHw && dist < bestD) { best = g; bestD = dist; }
      }
      this.target = best || any;
      if (this.target) this.beam.position.set(this.target.x, this.target.y + 75, this.target.z);
      this.beam.visible = !!this.target;
    },
    update(c) {
      const d = c.drone;
      if (!this.target || Math.hypot(this.target.x - d.pos.x, this.target.z - d.pos.z) > 700) this.pick(c);
      const g = this.target;
      if (g) {
        const ax = g.axis === 'x';
        const a = ax ? c.prev.x - g.x : c.prev.z - g.z, b = ax ? d.pos.x - g.x : d.pos.z - g.z;
        if (Math.sign(a) !== Math.sign(b) && Math.abs((ax ? d.pos.z - g.z : d.pos.x - g.x)) < g.hw && Math.abs(d.pos.y - g.y) < g.hh) {
          this.score++; this.streak++;
          this.used.add(`${g.x},${g.y},${g.z}`);
          if (this.score > this.best) { this.best = this.score; save(KEY, this.best); }
          c.say(`THREADED IT! +1   (gap ${(g.hw * 2).toFixed(1)} m wide)`);
          this.pick(c);
        }
      }
      c.hud('Gap Challenge', `Score ${this.score}   Streak ${this.streak}   Best ${this.best}` +
        (this.target ? `\nNext gap: ${pointer(d, this.target.x, this.target.y, this.target.z)}  (${(this.target.hw * 2).toFixed(1)} m wide)` : '\nLooking for gaps... fly toward the city'), null);
    },
  };
}

// ---------------- Battery Challenge: how far on one pack ----------------
export function batteryMode() {
  const KEY = 'fpv-battery-best';
  return {
    title: 'Battery Challenge', world: freeWorld(),
    intro: `How far can you fly on ONE battery?
Real LiPo batteries "sag": as they drain, the voltage drops and the motors get weaker.
Flying flat out drains it fast; smooth, efficient cruising goes further.
The run ends when the battery is empty and you're on the ground, or when you crash.`,
    setup(c) { this.dist = 0; this.last = c.drone.pos.clone(); this.best = load(KEY, 0); this.done = false; },
    end(c, why) {
      if (this.done) return; this.done = true;
      const m = Math.round(this.dist), isBest = m > this.best;
      if (isBest) save(KEY, m);
      c.finish('BATTERY CHALLENGE', `${why}\nDistance flown: ${(m / 1000).toFixed(2)} km` + (isBest ? '\nNEW BEST!' : `\nBest: ${(this.best / 1000).toFixed(2)} km`));
    },
    onCrash(c) { this.end(c, 'Crashed!'); },
    update(c) {
      const d = c.drone;
      if (d.armed) this.dist += Math.hypot(d.pos.x - this.last.x, d.pos.z - this.last.z);
      this.last.copy(d.pos);
      if (d.battery <= 0 && c.alt < 0.3 && d.speed < 1) return this.end(c, 'Battery empty!');
      c.hud('Battery Challenge', `Distance ${(this.dist / 1000).toFixed(2)} km   Battery ${Math.round(d.battery * 100)}%   ${d.voltage.toFixed(1)} V` +
        `   Best ${(this.best / 1000).toFixed(2)} km`, d.battery);
    },
  };
}

// ---------------- Free flight ----------------
export function freeMode() {
  return { title: 'Free Flight', free: true, world: freeWorld(), setup() {}, update() {} };
}
