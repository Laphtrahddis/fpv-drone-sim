// Entry point: scene, game loop, menus, camera.
import * as THREE from 'three';
import { settings, saveSettings } from './config.js';
import { sticks, pad, events, updateInput, resetInput } from './input.js';
import { Drone } from './drone.js';
import { World } from './world.js';
import { updateControllerTest, isDetecting } from './controllerTest.js';

const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
const SKY = 0x9cc4e4;

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 150, 850);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x445533, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(90, 1, 0.05, 1000);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
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
let state = 'menu';           // 'menu' | 'fly' | 'pause' | 'test'
let testReturn = 'menu';
let crashTimer = 0;
const overlays = { menu: $('menu'), pause: $('pause'), test: $('test') };

function setState(s) {
  if (s === 'test') testReturn = state;
  state = s;
  for (const k in overlays) overlays[k].classList.toggle('hidden', k !== s);
  $('hud').classList.toggle('hidden', s !== 'fly');
  const first = overlays[s]?.querySelector('button');
  if (first) first.focus();
}

function respawn() {
  drone.reset(SPAWN); resetInput(); crashTimer = 0;
  $('msg').classList.add('hidden');
}

const ACTIONS = {
  fly: () => { respawn(); setState('fly'); },
  resume: () => setState('fly'),
  restart: () => { respawn(); setState('fly'); },
  test: () => setState('test'),
  back: () => setState(testReturn),
  quit: () => setState('menu'),
};
document.addEventListener('click', e => {
  const act = e.target.dataset?.act;
  if (act) ACTIONS[act]();
});

// Menu navigation with D-pad / keyboard; A or Enter presses the focused button.
function menuNav(ev) {
  const btns = [...overlays[state].querySelectorAll('button')];
  const i = btns.indexOf(document.activeElement);
  if (ev === 'pad12' || ev === 'ArrowUp') btns[(i - 1 + btns.length) % btns.length].focus();
  if (ev === 'pad13' || ev === 'ArrowDown') btns[(i + 1) % btns.length].focus();
  if (ev === 'pad0') (btns[i] || btns[0]).click();
}

function handleEvents() {
  for (const ev of events) {
    if (state === 'fly') {
      if (ev === 'KeyR' || ev === 'pad0') respawn();
      if (ev === 'Escape' || ev === 'KeyP' || ev === 'pad9') setState('pause');
      if (ev === 'KeyC' || ev === 'pad3') { settings.chase = !settings.chase; saveSettings(); }
    } else if (state === 'test') {
      // gamepad buttons are being tested here, so only keyboard Esc leaves
      if (ev === 'Escape') ACTIONS.back();
    } else {
      if (state === 'pause' && (ev === 'Escape' || ev === 'KeyP' || ev === 'pad9' || ev === 'pad1')) setState('fly');
      else menuNav(ev);
    }
  }
  events.length = 0;
}

// --- camera ---
const uptiltQ = new THREE.Quaternion(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();
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
  }
}

// --- HUD (Phase 2 replaces this with a proper goggle OSD) ---
let hudT = 0;
function updateHud(dt) {
  if ((hudT += dt) < 0.1) return;
  hudT = 0;
  const alt = drone.pos.y - world.groundAt(drone.pos.x, drone.pos.z) - 0.15;
  $('hud').textContent =
    `ANGLE   THR ${String(Math.round(drone.throttle * 100)).padStart(3)}%\n` +
    `${String(Math.round(drone.speed * 3.6)).padStart(3)} KM/H  ALT ${alt.toFixed(1)} M` +
    (settings.chase ? '\nCHASE CAM' : '');
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
  $('padStatus').textContent = pad.connected ? '🎮 controller connected' : '🎮 press any button on your controller';
  if (state === 'test') updateControllerTest();

  if (state === 'fly') {
    acc += dt;
    while (acc >= STEP) { drone.step(STEP, sticks, world); acc -= STEP; }
    if (drone.crashed) {
      if (!crashTimer) { $('msg').textContent = `CRASHED (${drone.crashed})  -  press A / R`; $('msg').classList.remove('hidden'); }
      if ((crashTimer += dt) > 2.5) respawn();
    }
    updateHud(dt);
  }
  world.update(drone.pos.x, drone.pos.z);
  updateCamera(dt);
  renderer.render(scene, camera);
}

respawn();
setState('menu');
requestAnimationFrame(frame);
