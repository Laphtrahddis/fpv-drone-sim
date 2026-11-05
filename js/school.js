// Flight School: 15 short lessons. Each lesson = spawn setup + a list of steps.
// A step has a goal text and a check(c, dt) that returns true when it's done.
// c (context) = { drone, sticks, alt, props (THREE.Group for markers/gates), prev (last position) }
import * as THREE from 'three';
import { makeGate, setGateColor, gatePassed, gateHit } from './gates.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const KEY = 'fpv-school-v1';
export const progress = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } })();
export function markDone(i) { if (!progress.includes(i)) progress.push(i); try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch {} }

// ---- step helpers ----
// cond must stay true for `secs` seconds in a row
function hold(secs, cond) { let t = 0; const s = (c, dt) => { t = cond(c) ? t + dt : 0; s.p = t / secs; return t >= secs; }; return s; }
const step = (text, check) => ({ text, check });
const armStep = () => step('ARM: hold the LEFT stick fully DOWN and press B (Space)', c => c.drone.armed);

function pillar(c, x, z, color, h = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h, 12), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 }));
  m.position.set(x, h / 2, z); c.props.add(m); return m;
}
const flatDist = (d, x, z) => Math.hypot(d.pos.x - x, d.pos.z - z);
function facing(d, x, z) { // angle between the nose and the direction to (x,z)
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(d.q); f.y = 0;
  const to = new THREE.Vector3(x - d.pos.x, 0, z - d.pos.z);
  return f.angleTo(to);
}
// fly through a list of gates in order; returns a step check, optional per-gate condition
function gateRun(c, gates, extra) {
  let i = 0;
  setGateColor(gates[0], 'next');
  const s = (c) => {
    for (const g of gates) if (gateHit(g, c.drone.pos)) c.drone.crash('gate');
    if (i < gates.length && gatePassed(gates[i], c.prev, c.drone.pos)) {
      const ok = !extra || extra(c);
      if (ok) { setGateColor(gates[i], 'done'); i++; if (gates[i]) setGateColor(gates[i], 'next'); }
    }
    s.p = i / gates.length;
    return i >= gates.length;
  };
  return s;
}
// accumulate rotation around one body axis (for flips/rolls); resets if you stop rotating
function rotation(axis, need) {
  let acc = 0, idle = 0;
  const s = (c, dt) => {
    const w = c.drone.w[axis];
    acc += w * dt;
    idle = Math.abs(w) < 1 ? idle + dt : 0;
    if (idle > 0.6) acc = 0;
    s.p = Math.min(1, Math.abs(acc) / need);
    return Math.abs(acc) >= need;
  };
  return s;
}

const AIR = (y, mode) => ({ pos: [0, y, 0], armed: true, mode });

export const LESSONS = [
  { title: 'Controller check', spawn: { mode: 'ANGLE' },
    teach: `Before every real flight, pilots check their radio. Here we check your controller.
Move BOTH sticks all the way in every direction. Each one lights up when it reaches the edge.
If something is backwards, open Controller Test from the main menu and use Detect.`,
    steps: () => {
      const seen = new Set(), names = { 'throttle+': 'L↑', 'throttle-': 'L↓', 'yaw-': 'L←', 'yaw+': 'L→', 'pitch+': 'R↑', 'pitch-': 'R↓', 'roll-': 'R←', 'roll+': 'R→' };
      const s = step(() => 'Push each stick to every edge:  ' + Object.entries(names).map(([k, v]) => seen.has(k) ? '✓' : v).join(' '), c => {
        for (const ch in c.sticks) { if (c.sticks[ch] > 0.9) seen.add(ch + '+'); if (c.sticks[ch] < -0.9) seen.add(ch + '-'); }
        s.check.p = seen.size / 8; return seen.size === 8;
      });
      return [s];
    } },

  { title: 'What the sticks do', spawn: { mode: 'ANGLE' },
    teach: `You fly "Mode 2", the most common setup for real pilots:
LEFT stick up/down = THROTTLE (how hard the motors push: climb or sink)
LEFT stick left/right = YAW (spin flat like a turntable)
RIGHT stick up/down = PITCH (tilt nose down/up: this is how you go forward/back)
RIGHT stick left/right = ROLL (tilt sideways: slide left/right)
A drone moves by TILTING. The motors only push "up" out of the drone, so tilting aims that push.`,
    steps: () => [
      step('LEFT stick UP and hold: THROTTLE = motor power', hold(1, c => c.sticks.throttle > 0.7)),
      step('LEFT stick LEFT or RIGHT and hold: YAW = spin in place', hold(1, c => Math.abs(c.sticks.yaw) > 0.7)),
      step('RIGHT stick UP and hold: PITCH forward = tilt nose down', hold(1, c => c.sticks.pitch > 0.7)),
      step('RIGHT stick LEFT or RIGHT and hold: ROLL = tilt sideways', hold(1, c => Math.abs(c.sticks.roll) > 0.7)),
    ] },

  { title: 'Arming', spawn: { mode: 'ANGLE' },
    teach: `Real drones don't spin their props until you ARM them. It's a safety switch: props
are sharp and spin at 30,000 RPM. Betaflight (the software on real FPV drones) only lets you
arm with the throttle all the way DOWN, so the drone can't jump into the air by surprise.
After a crash, real pilots disarm immediately. Here, B (or Space) arms and disarms.`,
    steps: () => [
      armStep(),
      step('Hear the motors idling? Now DISARM: press B again', c => !c.drone.armed),
      step('Arm once more (throttle down + B)', c => c.drone.armed),
    ] },

  { title: 'Throttle & hover', spawn: { mode: 'ANGLE' },
    teach: `Hovering = holding one height. On a real drone it takes constant small throttle corrections.
Here, the stick CENTER is roughly hover. Push up a little to climb, down a little to sink.
Go gently: small stick movements! You're in ANGLE mode, so the drone keeps itself level.`,
    steps: () => [
      armStep(),
      step('Gently climb to between 3 and 6 m (watch ALT bottom-left)', c => c.alt > 3 && c.alt < 6),
      step('HOVER: stay between 3 and 6 m for 5 seconds', hold(5, c => c.alt > 3 && c.alt < 6)),
    ] },

  { title: 'Land gently', spawn: AIR(6, 'ANGLE'),
    teach: `Landing = sinking slowly and touching down softly. Real props and motors break if you
drop the drone. Lower the throttle a little below center so it sinks slowly, then ease
off just before the ground. Touch down under 2 m/s.`,
    steps: () => {
      let vy = 0;
      return [step('Sink slowly and touch down softly (under 2 m/s)', c => {
        if (c.alt > 0.05) { vy = -c.drone.vel.y; return false; }
        if (vy > 2) { c.say(`Too hard (${vy.toFixed(1)} m/s). Softer this time!`); c.restart(); return false; }
        return true;
      })];
    } },

  { title: 'Yaw', spawn: { mode: 'ANGLE' },
    teach: `YAW turns the drone's nose left or right without tilting it (left stick sideways).
Real pilots use yaw to point the camera where they want to go.
Take off a little (or stay on the ground armed) and turn to face each pillar.`,
    steps: c => {
      pillar(c, 25, 0, 0xff3333); pillar(c, 0, 25, 0x3388ff); pillar(c, -25, 0, 0x33dd55);
      const face = (x, z) => hold(0.6, c => facing(c.drone, x, z) < 12 * DEG);
      return [armStep(),
        step('Yaw RIGHT until the RED pillar is in the middle', face(25, 0)),
        step('Keep going: face the BLUE pillar (behind you)', face(0, 25)),
        step('Now face the GREEN pillar', face(-25, 0))];
    } },

  { title: 'Forward flight', spawn: { mode: 'ANGLE' },
    teach: `To go forward, a drone tilts its nose down (RIGHT stick up). Tilting aims some of the
motor push backwards, which pushes the drone forward, but less push is left for holding
height, so ADD A LITTLE THROTTLE when you tilt. Fly to the yellow pillar.`,
    steps: c => {
      pillar(c, 0, -80, 0xffdd00, 8);
      return [armStep(),
        step('Take off to about 3 m', c => c.alt > 2.5),
        step('Pitch forward (RIGHT stick up) and fly to the YELLOW pillar', c => flatDist(c.drone, 0, -80) < 8)];
    } },

  { title: 'Roll & strafing', spawn: { mode: 'ANGLE' },
    teach: `ROLL tilts the drone sideways (RIGHT stick left/right), so it slides sideways while the
nose keeps pointing forward. Pilots use this to line up with gaps. Slide right to the
pillar WITHOUT turning the nose (no yaw!).`,
    steps: c => {
      pillar(c, 50, 0, 0xff66cc, 8);
      return [armStep(),
        step('Take off to about 3 m', c => c.alt > 2.5),
        step(() => 'Roll RIGHT and slide to the PINK pillar. Keep the nose forward!', c => {
          if (facing(c.drone, 0, -100) > 40 * DEG) c.say('Nose turned! Use ROLL, not yaw.');
          return flatDist(c.drone, 50, 0) < 7;
        })];
    } },

  { title: 'Coordinated turns', spawn: { mode: 'ANGLE' },
    teach: `Real pilots turn like a plane: roll INTO the turn and yaw at the same time, with a bit
of pitch to keep moving. Fly a full circle around the pillar, staying 8-60 m from it.
Tip: small inputs on both sticks together.`,
    steps: c => {
      pillar(c, 0, -35, 0xffaa00, 15);
      let acc = 0, last = null;
      const circle = (c) => {
        const d = flatDist(c.drone, 0, -35), a = Math.atan2(c.drone.pos.z + 35, c.drone.pos.x);
        if (d > 8 && d < 60 && c.alt > 1.5 && last !== null) { let da = a - last; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU; acc += da; }
        last = a; circle.p = Math.min(1, Math.abs(acc) / TAU);
        return Math.abs(acc) >= TAU;
      };
      return [armStep(), step('Take off to about 3 m', c => c.alt > 2.5), step('Fly a full circle around the pillar', circle)];
    } },

  { title: 'First gate', spawn: { mode: 'ANGLE' },
    teach: `Gates are what racers fly through. Line up early, keep a steady height and go straight
through the middle. If you hit the ring, you crash, so slow and steady wins.`,
    steps: c => [armStep(), step('Fly through the orange gate', gateRun(c, [makeGate(c.props, 0, 5, -40, 0, 5)]))] },

  { title: 'Gate line', spawn: { mode: 'ANGLE' },
    teach: `Now several gates in a row. The ORANGE one is next. Look ahead to the next gate while
passing the current one. Real racers always look one gate ahead.`,
    steps: c => {
      const gs = [[0, 5, -40], [8, 6, -85], [-6, 5, -130], [6, 7, -175], [0, 5, -220]].map(([x, y, z]) => makeGate(c.props, x, y, z, 0, 4.5));
      return [armStep(), step('Fly through all 5 gates in order', gateRun(c, gs))];
    } },

  { title: 'Camera uptilt', spawn: { mode: 'ANGLE' },
    teach: `Real FPV cameras are tilted UP (usually 20-40°). Why? To fly fast, the drone tilts its
nose down a lot. With an upward camera, the view is level when you're flying fast.
Hovering, you'll see sky; at speed, you see ahead. More uptilt = built for speed.
Change it in Settings → Camera uptilt. Now go through the gates FAST (over 40 km/h).`,
    steps: c => {
      const gs = [[0, 6, -60], [0, 6, -140], [0, 6, -220]].map(([x, y, z]) => makeGate(c.props, x, y, z, 0, 5));
      return [armStep(), step('Fly through 3 gates faster than 40 km/h each', gateRun(c, gs, c => {
        const kmh = c.drone.speed * 3.6;
        if (kmh < 40) c.say(`Too slow (${Math.round(kmh)} km/h). Tilt more!`);
        return kmh >= 40;
      }))];
    } },

  { title: 'Intro to Acro mode', spawn: AIR(15, 'ACRO'),
    teach: `ACRO (rate) mode is how real FPV pilots fly. The stick sets how FAST the drone rotates.
Let go and it STAYS at whatever angle it's at. It does NOT level itself.
This is what makes flips, rolls and fast fluid flying possible.
You need small, short inputs: tilt, release, correct. Stay in the air for 15 seconds.`,
    steps: () => [step('Stay airborne (above 2 m) for 15 seconds', hold(15, c => c.alt > 2))] },

  { title: 'Acro: flips & rolls', spawn: AIR(40, 'ACRO'),
    teach: `Time for your first flip! Up high, flick the RIGHT stick fully forward (or back) and hold
until the drone goes all the way around, then let go and catch it with throttle.
Lower the throttle a bit during the flip; push it back up when you're level again.
Then do the same sideways for a roll.`,
    steps: () => [
      step('Do a FLIP: right stick fully forward or back for one full rotation', rotation('x', TAU * 0.92)),
      step('Now a ROLL: right stick fully left or right for one full rotation', rotation('z', TAU * 0.92)),
      step('Recover: fly level (camera on the horizon) for 3 seconds', hold(3, c => new THREE.Vector3(0, 1, 0).applyQuaternion(c.drone.q).y > 0.8 && c.alt > 2)),
    ] },

  { title: 'Graduation', spawn: { mode: 'ACRO' },
    teach: `Final exam: an S-shaped course of 6 gates, in ACRO mode. Use everything:
throttle control, coordinated turns, looking ahead and smooth acro corrections.
Pass all gates in order. You've got this, pilot!`,
    steps: c => {
      const gs = [[0, 5, -40, 0], [25, 7, -90, 0.6], [10, 6, -150, -0.4], [-25, 8, -200, 0.3], [-5, 5, -260, 0], [0, 10, -320, 0]]
        .map(([x, y, z, yaw]) => makeGate(c.props, x, y, z, yaw, 5));
      return [armStep(), step('Fly the course: all 6 gates in order', gateRun(c, gs))];
    } },
];
