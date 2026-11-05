// Entry point: scene, game loop, menus, camera.
import * as THREE from 'three';
import { settings, saveSettings, PHYS } from './config.js';
import { sticks, pad, events, updateInput, resetInput } from './input.js';
import { Drone } from './drone.js';
import { World } from './world.js';
import { updateControllerTest } from './controllerTest.js';
import { initAudio, updateAudio, crashSound, audioReady } from './audio.js';
import { Video } from './video.js';
import { updateOsd } from './osd.js';
import { buildSettings } from './settingsMenu.js';
import { LESSONS, progress, markDone } from './school.js';

// audio may only start after a user gesture
addEventListener('pointerdown', initAudio);
addEventListener('keydown', initAudio);

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const SKY = 0x9cc4e4;

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
const video = new Video(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 150, 560);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x445533, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 1000);
// graphics quality: view distance (chunks) + resolution
const QUALITY = { low: [2, 1], medium: [3, 1.25], high: [4, 2] };
function resize() {
  const [chunks, pr] = QUALITY[settings.quality] || QUALITY.medium;
  world.radius = chunks;
  scene.fog.far = chunks * 200 - 40; scene.fog.near = scene.fog.far * 0.3;
  camera.far = scene.fog.far + 20;
  renderer.setPixelRatio(Math.min(devicePixelRatio, pr));
  renderer.setSize(innerWidth, innerHeight, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  video.setSize(s.x, s.y);
  camera.aspect = innerWidth / innerHeight;
  // settings.fov is horizontal (how FPV cameras are rated); Three.js wants vertical
  camera.fov = 2 * Math.atan(Math.tan(settings.fov * DEG / 2) / camera.aspect) / DEG;
  camera.updateProjectionMatrix();
}
const world = new World(scene, 1);
addEventListener('resize', resize);
resize();

const drone = new Drone();
const SPAWN = new THREE.Vector3(0, world.groundAt(0, 0) + 0.15, 0);

// simple drone model, only visible in chase cam
const model = new THREE.Group();
const dark = new THREE.MeshLambertMaterial({ color: 0x222222 }), prop = new THREE.MeshLambertMaterial({ color: 0xff5522 });
model.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.2), dark));
for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), dark);
  arm.position.set(x * 0.06, 0, z * 0.06); arm.rotation.y = x * z * Math.PI / 4; model.add(arm);
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12), prop);
  p.position.set(x * 0.11, 0.03, z * 0.11); model.add(p);
}
scene.add(model);

// --- game state & menus ---
let state = 'menu';           // 'menu' | 'fly' | 'pause' | 'test' | 'settings' | 'school' | 'lessonIntro' | 'lessonDone'
let backTo = 'menu';
let crashStatic = 0, armHint = 0, crashes = 0;
let mission = null;           // current Flight School lesson, or null for free flight
const overlays = {};
for (const k of ['menu', 'pause', 'test', 'settings', 'school', 'lessonIntro', 'lessonDone']) overlays[k] = $(k);

function setState(s) {
  if (s === 'test' || s === 'settings') backTo = state;
  if (s === 'settings') buildSettings($('settingsList'), applySettings);
  state = s;
  if (s === 'fly') document.activeElement?.blur(); // otherwise Space would "click" the last menu button
  for (const k in overlays) overlays[k].classList.toggle('hidden', k !== s);
  $('osd').classList.toggle('hidden', s !== 'fly' || !settings.osd);
  $('lesson').classList.toggle('hidden', s !== 'fly' || !mission);
  if (s === 'school') $('lessonList').innerHTML = LESSONS.map((l, i) =>
    `<button data-lesson="${i}">${progress.includes(i) ? '✓' : '·'} ${i + 1}. ${l.title}</button>`).join('');
  const first = overlays[s]?.querySelector('button, input');
  if (first) first.focus();
}

function applySettings() { resize(); }

let flashT = 0;
function flash(text, secs = 2) {
  $('msg').textContent = text; $('msg').classList.remove('hidden'); flashT = secs;
}

function respawn() {
  replay = null;
  const sp = mission ? LESSONS[mission.i].spawn : {};
  const p = sp.pos ? new THREE.Vector3(sp.pos[0], world.groundAt(sp.pos[0], sp.pos[2]) + sp.pos[1], sp.pos[2]) : SPAWN;
  world.update(p.x, p.z, true);
  drone.reset(p); resetInput();
  drone.mode = sp.mode || settings.startMode;
  if (sp.armed) { drone.armed = true; drone.motor = PHYS.idle + (1 - PHYS.idle) * PHYS.hoverThrottle; } // already hovering
  history.length = 0;
  $('msg').classList.add('hidden');
  if (mission) startSteps();
}

// ---------- Flight School ----------
const props = new THREE.Group(); // lesson markers + gates
scene.add(props);
function startSteps() {
  props.clear();
  mission.cur = 0;
  mission.steps = LESSONS[mission.i].steps(lessonCtx());
}
let hintT = 0, restartLesson = false;
const lastPos = new THREE.Vector3();
function lessonCtx(alt = 0) {
  return { drone, sticks, alt, props, prev: lastPos,
    say: t => { $('lessonHint').textContent = t; hintT = 2; },
    restart: () => { restartLesson = true; } };
}
function openLesson(i) {
  mission = { i };
  const L = LESSONS[i];
  $('introTitle').textContent = `Lesson ${i + 1}: ${L.title}`;
  $('introText').textContent = L.teach.replace(/\n(?=[a-z(])/g, ' '); // join wrapped lines, keep real line breaks
  setState('lessonIntro');
}
function updateLesson(dt, alt) {
  const st = mission.steps[mission.cur];
  if (st && st.check(lessonCtx(alt), dt)) {
    mission.cur++;
    if (mission.cur >= mission.steps.length) {
      markDone(mission.i);
      $('doneText').textContent = mission.i + 1 < LESSONS.length
        ? `Nice flying! Lesson ${mission.i + 1} done. Ready for "${LESSONS[mission.i + 1].title}"?`
        : 'You graduated from Flight School! You know the real basics of FPV flying now. Go rip in Free Flight!';
      drone.armed = false;
      return setState('lessonDone');
    }
    $('lessonHint').textContent = '✓ Nice!'; hintT = 1.2;
  }
  if (restartLesson) { restartLesson = false; respawn(); }
  if ((hintT -= dt) <= 0) $('lessonHint').textContent = '';
  const cur = mission.steps[mission.cur], text = typeof cur.text === 'function' ? cur.text() : cur.text;
  $('lessonTitle').textContent = `${mission.i + 1}. ${LESSONS[mission.i].title}   (step ${mission.cur + 1}/${mission.steps.length})`;
  $('lessonGoal').textContent = text;
  $('lessonBar').style.width = Math.round(100 * Math.min(1, cur.check.p || 0)) + '%';
  // live stick diagram
  $('lDotL').style.left = 50 + 42 * sticks.yaw + '%'; $('lDotL').style.top = 50 - 42 * sticks.throttle + '%';
  $('lDotR').style.left = 50 + 42 * sticks.roll + '%'; $('lDotR').style.top = 50 - 42 * sticks.pitch + '%';
}

// ---------- crash replay: rolling buffer of the last seconds, played back in slow motion ----------
const history = [];   // { p, q } recorded every frame (~last 4 s)
let replay = null;    // { frames, t, cam }
function startReplay() {
  const tEnd = history.length ? history[history.length - 1].t : 0;
  const frames = history.filter(h => h.t > tEnd - 2.5);
  if (frames.length < 5) return respawn();
  const end = frames[frames.length - 1].p, from = frames[0].p;
  const back = new THREE.Vector3().subVectors(from, end).setY(0);
  if (back.lengthSq() < 1) back.set(0, 0, 1);
  replay = { frames, t: 0, k: 0, end: 0, cam: end.clone().add(back.normalize().multiplyScalar(5)).add(new THREE.Vector3(1.5, 2.5, 0)) };
}

const ACTIONS = {
  fly: () => { mission = null; props.clear(); world.setClear(60); respawn(); setState('fly'); },
  school: () => { mission = null; setState('school'); },
  lessonStart: () => { world.setClear(450); respawn(); setState('fly'); },
  lessonNext: () => { if (mission.i + 1 < LESSONS.length) openLesson(mission.i + 1); else setState('school'); },
  resume: () => setState('fly'),
  restart: () => { respawn(); setState('fly'); },
  test: () => setState('test'),
  settings: () => setState('settings'),
  back: () => setState(backTo),
  quit: () => { mission = null; setState('menu'); },
};
document.addEventListener('click', e => {
  const act = e.target.dataset?.act, lesson = e.target.dataset?.lesson;
  if (act) ACTIONS[act]();
  if (lesson !== undefined) openLesson(+lesson);
});

// Menu navigation with D-pad / keyboard. A presses the focused item, D-pad left/right moves sliders.
function menuNav(ev) {
  const items = [...overlays[state].querySelectorAll('button, input')];
  const i = items.indexOf(document.activeElement), el = items[i];
  const focus = j => { items[j].focus(); items[j].scrollIntoView({ block: 'nearest' }); };
  const up = ev === 'pad12' || ev === 'navUp' || ev === 'ArrowUp', down = ev === 'pad13' || ev === 'navDown' || ev === 'ArrowDown';
  const left = ev === 'pad14' || ev === 'navLeft', right = ev === 'pad15' || ev === 'navRight';
  if (up) focus((i - 1 + items.length) % items.length);
  if (down) focus((i + 1) % items.length);
  if (ev === 'pad0') (el || items[0]).click();
  if (el?.type === 'range' && (left || right)) {
    left ? el.stepDown() : el.stepUp();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function handleEvents() {
  for (const ev of events) {
    if (ev.startsWith('pad')) initAudio(); // some browsers accept gamepad presses as a gesture
    if (ev === 'KeyN') { settings.mute = !settings.mute; saveSettings(); }
    if (state === 'fly' && replay) {
      if (['KeyR', 'pad0', 'pad1', 'Space', 'Enter'].includes(ev)) respawn(); // skip replay
    } else if (state === 'fly') {
      if (ev === 'KeyR' || ev === 'pad0') respawn();
      if (ev === 'Space' || ev === 'pad1') { if (!drone.toggleArm(sticks)) armHint = 2; }
      if (ev === 'Escape' || ev === 'KeyP' || ev === 'pad9') setState('pause');
      if (ev === 'KeyC' || ev === 'pad3') { settings.chase = !settings.chase; saveSettings(); }
      if (ev === 'KeyV' || ev === 'pad8') { settings.video = !settings.video; saveSettings(); }
      if (ev === 'KeyM' || ev === 'pad2') {
        // only for this flight; the start mode is chosen in Settings
        drone.mode = drone.mode === 'ANGLE' ? 'ACRO' : 'ANGLE';
        flash(drone.mode === 'ACRO' ? 'ACRO MODE: flips & rolls, no self-level' : 'ANGLE MODE: self-levelling, no flips');
      }
    } else if (state === 'test') {
      // gamepad buttons are being tested here, so only START (or Esc) leaves
      if (ev === 'Escape' || ev === 'pad9') ACTIONS.back();
    } else if (state === 'pause' && (ev === 'Escape' || ev === 'KeyP' || ev === 'pad9' || ev === 'pad1')) setState('fly');
    else if (state === 'settings' && (ev === 'Escape' || ev === 'pad1')) ACTIONS.back();
    else if (['school', 'lessonIntro', 'lessonDone'].includes(state) && (ev === 'Escape' || ev === 'pad1')) state === 'school' ? ACTIONS.quit() : ACTIONS.school();
    else menuNav(ev);
  }
  events.length = 0;
}

// --- camera ---
const uptiltQ = new THREE.Quaternion(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function updateCamera(dt) {
  model.position.copy(drone.pos);
  model.quaternion.copy(drone.q);
  model.visible = settings.chase || !!replay;
  if (replay) {
    camera.position.copy(replay.cam);
    camera.lookAt(drone.pos);
  } else if (settings.chase) {
    // behind and above the drone, following its heading only (not its tilt)
    _q.setFromAxisAngle(_v.set(0, 1, 0), drone.heading);
    const target = _v.set(0, 0.6, 2.2).applyQuaternion(_q).add(drone.pos);
    camera.position.lerp(target, 1 - Math.exp(-8 * dt));
    camera.lookAt(drone.pos);
  } else {
    // FPV camera: rigidly mounted, tilted up by `uptilt` degrees
    uptiltQ.setFromAxisAngle(_v.set(1, 0, 0), settings.uptilt * DEG);
    camera.quaternion.copy(drone.q).multiply(uptiltQ);
    camera.position.copy(drone.pos);
    // shake from motor vibration + wind, stronger with throttle and speed
    const t = performance.now() / 1000;
    const amp = settings.shake * (0.0015 + 0.003 * drone.motor + 0.004 * Math.min(1, drone.speed / 40));
    camera.rotateX(amp * (Math.sin(t * 53) + Math.sin(t * 31.7)));
    camera.rotateZ(amp * (Math.sin(t * 47.3) + Math.sin(t * 23.1)));
  }
}

// Analog signal quality: worse far from home and right next to the ground (like real 5.8GHz video)
function signalNoise(alt, home) {
  const range = Math.max(0, (home - 500) / 1500);
  const ground = Math.max(0, 1 - alt / 1.5) * 0.25 * (drone.armed ? 1 : 0);
  return Math.min(1, 0.03 + range * range * 0.8 + ground + crashStatic);
}

// --- main loop (physics at a fixed 120 Hz for stable, frame-rate independent flight) ---
const STEP = 1 / 120;
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  updateInput(dt);
  handleEvents();
  $('padStatus').textContent = (pad.connected ? '🎮 controller connected' : '🎮 press any button on your controller') +
    (!audioReady() ? '  |  🔇 click or press a key for sound' : settings.mute ? '  |  🔇 muted (N)' : '');
  if (state === 'test') updateControllerTest();

  const alt = drone.pos.y - world.groundAt(drone.pos.x, drone.pos.z) - 0.15;
  const home = Math.hypot(drone.pos.x - SPAWN.x, drone.pos.z - SPAWN.z);
  crashStatic = Math.max(0, crashStatic - dt * 1.2);
  armHint = Math.max(0, armHint - dt);
  if (flashT > 0 && (flashT -= dt) <= 0 && !drone.crashed) $('msg').classList.add('hidden');
  const noise = signalNoise(alt, home);

  if (state === 'fly' && replay) {
    // slow-motion replay (35% speed) of the last seconds before the crash
    replay.t += dt * 0.35;
    const f = replay.frames;
    while (replay.k < f.length - 1 && f[replay.k + 1].t - f[0].t < replay.t) replay.k++;
    drone.pos.copy(f[replay.k].p); drone.q.copy(f[replay.k].q);
    if (replay.k >= f.length - 1 && (replay.end += dt) > 1.2) respawn();
  } else if (state === 'fly') {
    lastPos.copy(drone.pos);
    acc += dt;
    while (acc >= STEP) { drone.step(STEP, sticks, world); acc -= STEP; }
    history.push({ p: drone.pos.clone(), q: drone.q.clone(), t: now / 1000 });
    if (history.length > 400) history.shift();
    if (drone.crashed) {
      crashes++; crashSound(); crashStatic = 1;
      $('msg').textContent = `CRASH #${crashes} (${drone.crashed})  -  slow-mo replay, A to skip`;
      $('msg').classList.remove('hidden');
      startReplay();
    } else if (mission) updateLesson(dt, alt);
  }
  if (state === 'fly') {
    if (settings.osd) {
      _e.setFromQuaternion(drone.q, 'YXZ');
      updateOsd(dt, drone, { alt, home, noise, armHint: armHint > 0, pitch: _e.x, roll: _e.z, uptilt: settings.uptilt, vfov: camera.fov });
    }
    $('osd').classList.toggle('hidden', !settings.osd || !!replay);
    $('horizon').classList.toggle('hidden', settings.chase);
  }
  updateAudio(state === 'fly' && !replay ? drone : null);
  world.update(drone.pos.x, drone.pos.z);
  updateCamera(dt);
  video.render(scene, camera, { analog: settings.video, amount: settings.videoAmount, noise, fisheye: settings.fisheye });
}

respawn();
setState('menu');
requestAnimationFrame(frame);
