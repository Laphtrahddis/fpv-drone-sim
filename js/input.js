// Gamepad + keyboard input, Mode 2. Produces 4 shaped channels in -1..1:
// throttle (+ = up), yaw (+ = right), pitch (+ = forward), roll (+ = right).
import { settings } from './config.js';

export const sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
export const pad = { connected: false, id: '', axes: [], buttons: [] };
export const events = []; // button/key presses this frame, e.g. 'pad0', 'KeyR'

const keys = new Set();
const kb = { throttle: 0, yaw: 0, pitch: 0, roll: 0 }; // smoothed keyboard values
const KEYMAP = {
  throttle: ['KeyW', 'KeyS'], yaw: ['KeyD', 'KeyA'],
  pitch: ['ArrowUp', 'ArrowDown'], roll: ['ArrowRight', 'ArrowLeft'],
};
let prevButtons = [];
let navDir = '', navT = 0; // menu navigation from any stick, with auto-repeat
let kbThrottleActive = false; // full-range mode: keyboard owns throttle until the pad stick moves
let prevPadThr = 0;

export function resetInput() { kb.throttle = settings.throttleMode === 'full' ? -1 : 0; }

addEventListener('keydown', e => {
  if (!e.repeat) events.push(e.code);
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Deadzone, rescaled so the output still reaches 1. (Expo lives in the rates, see drone.js.)
function shape(v) {
  const dz = settings.deadzone, a = Math.abs(v);
  if (a < dz) return 0;
  v = Math.sign(v) * Math.min(1, (a - dz) / (1 - dz));
  return v;
}

export function rawChannel(name) {
  const m = settings.axes[name];
  return (pad.axes[m.i] || 0) * m.s;
}

export function updateInput(dt) {
  // --- gamepad (browsers only expose it after a button press) ---
  const gp = [...(navigator.getGamepads?.() || [])].find(g => g);
  pad.connected = !!gp;
  pad.id = gp ? gp.id : '';
  pad.axes = gp ? [...gp.axes] : [];
  pad.buttons = gp ? gp.buttons.map(b => b.value) : [];
  pad.buttons.forEach((v, i) => { if (v > 0.5 && !(prevButtons[i] > 0.5)) events.push('pad' + i); });
  prevButtons = pad.buttons;

  // menu navigation: any stick (or D-pad buttons, handled as pad12-15) -> navUp/Down/Left/Right
  let dir = '';
  for (let i = 0; i + 1 < Math.min(pad.axes.length, 4); i += 2) {
    const x = pad.axes[i], y = pad.axes[i + 1];
    if (Math.abs(y) > 0.6 && Math.abs(y) >= Math.abs(x)) dir = y < 0 ? 'navUp' : 'navDown';
    else if (Math.abs(x) > 0.6) dir = x < 0 ? 'navLeft' : 'navRight';
  }
  if (dir && (dir !== navDir || (navT -= dt) <= 0)) { events.push(dir); navT = dir !== navDir ? 0.4 : 0.15; }
  navDir = dir;

  // --- keyboard: ramp smoothly instead of jumping 0 -> 1 ---
  for (const ch in KEYMAP) {
    const [pos, neg] = KEYMAP[ch];
    const target = (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
    if (ch === 'throttle' && settings.throttleMode === 'full') {
      kb.throttle = Math.max(-1, Math.min(1, kb.throttle + target * 0.8 * dt)); // keyboard throttle "stays put"
    } else {
      const rate = target ? 4 : 6; // reach full in 0.25s, return in ~0.17s
      kb[ch] += Math.max(-rate * dt, Math.min(rate * dt, target - kb[ch]));
    }
  }

  // --- merge: whichever source is deflected more wins ---
  for (const ch in sticks) {
    let p = pad.connected ? rawChannel(ch) : 0;
    p = shape(p);
    let v = Math.abs(p) > Math.abs(kb[ch]) ? p : kb[ch];
    if (ch === 'throttle' && settings.throttleMode === 'full') {
      if (keys.has('KeyW') || keys.has('KeyS')) kbThrottleActive = true;
      if (Math.abs(p - prevPadThr) > 0.1) { kbThrottleActive = false; prevPadThr = p; }
      v = kbThrottleActive || !pad.connected ? kb.throttle : p;
    }
    if (settings.invert[ch]) v = -v;
    sticks[ch] = v;
  }
}
