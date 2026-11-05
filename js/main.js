// Entry point: scene, game loop, menus, camera.
import * as THREE from 'three';
import { settings, saveSettings } from './config.js';
import { sticks, pad, events, updateInput, resetInput } from './input.js';
import { Drone } from './drone.js';
import { World } from './world.js';
import { updateControllerTest } from './controllerTest.js';
import { initAudio, updateAudio, crashSound, audioReady } from './audio.js';
import { Video } from './video.js';
import { updateOsd } from './osd.js';
import { buildSettings } from './settingsMenu.js';

// audio may only start after a user gesture
addEventListener('pointerdown', initAudio);
addEventListener('keydown', initAudio);

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const SKY = 0x9cc4e4;

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const video = new Video(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 120, 760);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x445533, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 1000);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  const s = renderer.getDrawingBufferSize(new THREE.Vector2());
  video.setSize(s.x, s.y);
  camera.aspect = innerWidth / innerHeight;
  // settings.fov is horizontal (how FPV cameras are rated); Three.js wants vertical
  camera.fov = 2 * Math.atan(Math.tan(settings.fov * DEG / 2) / camera.aspect) / DEG;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const world = new World(scene, 1);
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
let state = 'menu';           // 'menu' | 'fly' | 'pause' | 'test' | 'settings'
let backTo = 'menu';
let crashTimer = 0, crashStatic = 0, armHint = 0;
const overlays = { menu: $('menu'), pause: $('pause'), test: $('test'), settings: $('settings') };

function setState(s) {
  if (s === 'test' || s === 'settings') backTo = state;
  if (s === 'settings') buildSettings($('settingsList'), applySettings);
  state = s;
  if (s === 'fly') document.activeElement?.blur(); // otherwise Space would "click" the last menu button
  for (const k in overlays) overlays[k].classList.toggle('hidden', k !== s);
  $('osd').classList.toggle('hidden', s !== 'fly' || !settings.osd);
  const first = overlays[s]?.querySelector('button, input');
  if (first) first.focus();
}

function applySettings() {
  resize();
  drone.mode = settings.defaultMode;
}

function respawn() {
  drone.reset(SPAWN); resetInput(); crashTimer = 0;
  drone.mode = settings.defaultMode;
  $('msg').classList.add('hidden');
}

const ACTIONS = {
  fly: () => { respawn(); setState('fly'); },
  resume: () => setState('fly'),
  restart: () => { respawn(); setState('fly'); },
  test: () => setState('test'),
  settings: () => setState('settings'),
  back: () => setState(backTo),
  quit: () => setState('menu'),
};
document.addEventListener('click', e => {
  const act = e.target.dataset?.act;
  if (act) ACTIONS[act]();
});

// Menu navigation with D-pad / keyboard. A presses the focused item, D-pad left/right moves sliders.
function menuNav(ev) {
  const items = [...overlays[state].querySelectorAll('button, input')];
  const i = items.indexOf(document.activeElement), el = items[i];
  const focus = j => { items[j].focus(); items[j].scrollIntoView({ block: 'nearest' }); };
  if (ev === 'pad12' || ev === 'ArrowUp') focus((i - 1 + items.length) % items.length);
  if (ev === 'pad13' || ev === 'ArrowDown') focus((i + 1) % items.length);
  if (ev === 'pad0') (el || items[0]).click();
  if (el?.type === 'range' && (ev === 'pad14' || ev === 'pad15')) {
    ev === 'pad14' ? el.stepDown() : el.stepUp();
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function handleEvents() {
  for (const ev of events) {
    if (ev.startsWith('pad')) initAudio(); // some browsers accept gamepad presses as a gesture
    if (ev === 'KeyN') { settings.mute = !settings.mute; saveSettings(); }
    if (state === 'fly') {
      if (ev === 'KeyR' || ev === 'pad0') respawn();
      if (ev === 'Space' || ev === 'pad1') { if (!drone.toggleArm(sticks)) armHint = 2; }
      if (ev === 'Escape' || ev === 'KeyP' || ev === 'pad9') setState('pause');
      if (ev === 'KeyC' || ev === 'pad3') { settings.chase = !settings.chase; saveSettings(); }
      if (ev === 'KeyV' || ev === 'pad8') { settings.video = !settings.video; saveSettings(); }
      if (ev === 'KeyM' || ev === 'pad2') {
        drone.mode = drone.mode === 'ANGLE' ? 'ACRO' : 'ANGLE';
        settings.defaultMode = drone.mode; saveSettings();
      }
    } else if (state === 'test') {
      // gamepad buttons are being tested here, so only keyboard Esc leaves
      if (ev === 'Escape') ACTIONS.back();
    } else if (state === 'pause' && (ev === 'Escape' || ev === 'KeyP' || ev === 'pad9' || ev === 'pad1')) setState('fly');
    else if (state === 'settings' && (ev === 'Escape' || ev === 'pad1')) ACTIONS.back();
    else menuNav(ev);
  }
  events.length = 0;
}

// --- camera ---
const uptiltQ = new THREE.Quaternion(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
function updateCamera(dt) {
  model.position.copy(drone.pos);
  model.quaternion.copy(drone.q);
  model.visible = settings.chase;
  if (settings.chase) {
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
  const noise = signalNoise(alt, home);

  if (state === 'fly') {
    acc += dt;
    while (acc >= STEP) { drone.step(STEP, sticks, world); acc -= STEP; }
    if (drone.crashed) {
      if (!crashTimer) {
        crashSound(); crashStatic = 1;
        $('msg').textContent = `CRASHED (${drone.crashed})  -  press A / R`; $('msg').classList.remove('hidden');
      }
      if ((crashTimer += dt) > 2.5) respawn();
    }
    if (settings.osd) {
      _e.setFromQuaternion(drone.q, 'YXZ');
      updateOsd(dt, drone, { alt, home, noise, armHint: armHint > 0, pitch: _e.x, roll: _e.z, uptilt: settings.uptilt, vfov: camera.fov });
    }
    $('osd').classList.toggle('hidden', !settings.osd);
    $('horizon').classList.toggle('hidden', settings.chase);
  }
  updateAudio(state === 'fly' ? drone : null);
  world.update(drone.pos.x, drone.pos.z);
  updateCamera(dt);
  video.render(scene, camera, { analog: settings.video, amount: settings.videoAmount, noise, fisheye: settings.fisheye });
}

respawn();
setState('menu');
requestAnimationFrame(frame);
