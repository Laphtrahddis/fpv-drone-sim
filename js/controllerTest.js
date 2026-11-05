// Controller test / calibration screen: live raw axes + buttons, the 4 mapped
// channels, "Detect" to remap a channel, invert toggles and throttle mapping.
import { settings, saveSettings } from './config.js';
import { pad, sticks } from './input.js';

const $ = id => document.getElementById(id);
const CH = { throttle: 'UP', yaw: 'RIGHT', pitch: 'UP', roll: 'RIGHT' };
const STICK = { throttle: 'LEFT', yaw: 'LEFT', pitch: 'RIGHT', roll: 'RIGHT' };
let detect = null; // { ch, base, until }

$('channels').innerHTML = Object.keys(CH).map(ch => `<tr>
  <td>${ch.toUpperCase()}</td><td><div class="bar"><i id="bar-${ch}"></i></div></td>
  <td id="ax-${ch}"></td>
  <td><button class="small" data-detect="${ch}">Detect</button></td>
  <td><label><input type="checkbox" data-inv="${ch}"> invert</label></td></tr>`).join('');

$('channels').addEventListener('click', e => {
  const ch = e.target.dataset.detect;
  if (ch) detect = { ch, base: [...pad.axes], until: performance.now() + 8000 };
});
$('channels').addEventListener('change', e => {
  const ch = e.target.dataset.inv;
  if (ch) { settings.invert[ch] = e.target.checked; saveSettings(); }
});
$('thrMode').onclick = () => {
  settings.throttleMode = settings.throttleMode === 'center' ? 'full' : 'center';
  saveSettings();
};

const bar = (el, v) => { el.style.left = (v < 0 ? 50 + 50 * v : 50) + '%'; el.style.width = 50 * Math.abs(v) + '%'; };

export function updateControllerTest() {
  $('testStatus').textContent = detect
    ? `Push the ${STICK[detect.ch]} stick fully ${CH[detect.ch]} and hold it...`
    : pad.connected ? `Connected: ${pad.id}` : 'No controller detected. Press any button on your controller.';

  if (detect) {
    // the axis that moved the most from where it started is this channel
    let best = -1, d = 0;
    pad.axes.forEach((v, i) => { const dv = v - (detect.base[i] || 0); if (Math.abs(dv) > Math.abs(d)) { d = dv; best = i; } });
    if (Math.abs(d) > 0.6) {
      settings.axes[detect.ch] = { i: best, s: Math.sign(d) };
      settings.invert[detect.ch] = false;
      saveSettings(); detect = null;
    } else if (performance.now() > detect.until) detect = null;
  }

  for (const ch in CH) {
    bar($('bar-' + ch), sticks[ch]);
    $('ax-' + ch).textContent = `axis ${settings.axes[ch].i}${settings.axes[ch].s < 0 ? ' (flipped)' : ''}  ${sticks[ch].toFixed(2)}`;
    document.querySelector(`[data-inv="${ch}"]`).checked = settings.invert[ch];
  }
  $('dotL').style.left = 50 + 45 * sticks.yaw + '%';
  $('dotL').style.top = 50 - 45 * sticks.throttle + '%';
  $('dotR').style.left = 50 + 45 * sticks.roll + '%';
  $('dotR').style.top = 50 - 45 * sticks.pitch + '%';
  $('thrMode').textContent = settings.throttleMode === 'center'
    ? 'CENTER = HOVER (best for gamepads)' : 'FULL RANGE (stick bottom = 0%)';

  $('rawAxes').innerHTML = pad.axes.map((v, i) => `<span>A${i}: ${v.toFixed(2)}</span>`).join('') || '-';
  $('rawBtns').innerHTML = pad.buttons.map((v, i) => `<span class="${v > 0.5 ? 'on' : ''}">B${i}</span>`).join('') || '-';
}

export const isDetecting = () => !!detect;
