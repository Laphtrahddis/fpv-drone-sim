// Settings screen, built from a list. Everything saves to localStorage instantly.
import { settings, saveSettings } from './config.js';

// [path in settings, label, min/max/step | 'bool' | [choices]]
const ITEMS = [
  ['biome', 'World (Free Flight)', ['meadow', 'mountains', 'neon', 'forest', 'canyon']],
  ['seed', 'World seed / race course', 1, 999, 1],
  ['quality', 'Graphics quality', ['low', 'medium', 'high']],
  ['uptilt', 'Camera uptilt (°)', 0, 45, 1],
  ['fov', 'Field of view (°)', 90, 130, 1],
  ['shake', 'Camera shake', 0, 1, 0.05],
  ['fisheye', 'Fisheye lens', 'bool'],
  ['chase', 'Chase cam (3rd person)', 'bool'],
  ['video', 'Analog video effect', 'bool'],
  ['videoAmount', 'Analog effect strength', 0, 1, 0.05],
  ['osd', 'Show OSD', 'bool'],
  ['volume', 'Volume', 0, 1, 0.05],
  ['mute', 'Mute', 'bool'],
  ['startMode', 'Start flights in mode', ['ACRO', 'ANGLE']],
  ['throttleMode', 'Throttle mapping', ['center', 'full']],
  ['rates.roll.max', 'Roll rate (°/s)', 200, 1200, 10],
  ['rates.pitch.max', 'Pitch rate (°/s)', 200, 1200, 10],
  ['rates.yaw.max', 'Yaw rate (°/s)', 100, 800, 10],
  ['gravity', 'Gravity (1 = real)', 0.8, 2, 0.05],
  ['maxAngle', 'Angle mode max tilt (°)', 20, 80, 1],
  ['deadzone', 'Stick deadzone', 0, 0.2, 0.01],
];

const get = p => p.split('.').reduce((o, k) => o[k], settings);
function set(p, v) {
  const keys = p.split('.'), last = keys.pop();
  keys.reduce((o, k) => o[k], settings)[last] = v;
  saveSettings();
  onChange();
}
let onChange = () => {};

export function buildSettings(el, changed) {
  onChange = changed;
  el.innerHTML = ITEMS.map(([p, label, a, b, c]) => {
    const v = get(p);
    let input;
    if (a === 'bool') input = `<input type="checkbox" data-p="${p}" ${v ? 'checked' : ''}>`;
    else if (Array.isArray(a)) input = `<button class="small" data-p="${p}" data-choices="${a.join(',')}">${v}</button>`;
    else input = `<input type="range" data-p="${p}" min="${a}" max="${b}" step="${c}" value="${v}"><span>${v}</span>`;
    return `<label class="row"><span>${label}</span>${input}</label>`;
  }).join('');
}

addEventListener('input', e => {
  const p = e.target.dataset?.p;
  if (!p || e.target.type !== 'range') return;
  e.target.nextElementSibling.textContent = e.target.value;
  set(p, +e.target.value);
});
addEventListener('change', e => {
  const p = e.target.dataset?.p;
  if (p && e.target.type === 'checkbox') set(p, e.target.checked);
});
addEventListener('click', e => {
  const p = e.target.dataset?.p, ch = e.target.dataset?.choices;
  if (!p || !ch) return;
  const list = ch.split(','), v = list[(list.indexOf(get(p)) + 1) % list.length];
  e.target.textContent = v;
  set(p, v);
});
