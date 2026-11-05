// Goggle-style OSD (on-screen display), laid out like Betaflight OSD in real FPV goggles.
const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
let t = 0, blink = false;

const pad = (v, n) => String(v).padStart(n);
function fmtTime(s) { s = Math.floor(s); return `${pad(Math.floor(s / 60), 2)}:${String(s % 60).padStart(2, '0')}`; }

// Text parts update 10x per second (cheap); the horizon moves every frame.
export function updateOsd(dt, d, info) {
  // artificial horizon: where the real horizon sits in the camera image
  const vfov = info.vfov * DEG, camPitch = info.pitch + info.uptilt * DEG;
  const y = Math.tan(camPitch) / Math.tan(vfov / 2) * (innerHeight / 2);
  $('horizon').style.transform = `translateY(${Math.max(-innerHeight, Math.min(innerHeight, y))}px) rotate(${info.roll / DEG}deg)`;

  if ((t += dt) < 0.1) return;
  t = 0; blink = !blink;
  const bat = Math.round(d.battery * 100), low = d.battery < 0.2;
  const rssi = Math.round(99 * (1 - info.noise));
  $('osdTL').innerHTML = `<span class="${low && blink ? 'warn' : ''}">${pad(bat, 3)}% ${d.voltage.toFixed(1)}V</span>\nTHR ${pad(Math.round(d.throttle * 100), 3)}%`;
  $('osdTR').innerHTML = `<span class="${rssi < 30 && blink ? 'warn' : ''}">RSSI ${pad(rssi, 2)}</span>\n${fmtTime(d.flightTime)}`;
  $('osdBL').textContent = `${pad(Math.round(d.speed * 3.6), 3)} KM/H\nALT ${info.alt.toFixed(1)} M`;
  $('osdBR').textContent = `${d.mode}\nHOME ${Math.round(info.home)} M`;
  let warn = '';
  if (!d.armed) warn = info.armHint ? 'THROTTLE ALL THE WAY DOWN, THEN PRESS B' : 'DISARMED\nHOLD LEFT STICK DOWN + PRESS B (SPACE) TO ARM';
  else if (d.battery <= 0) warn = 'BATTERY EMPTY';
  else if (low) warn = blink ? 'LOW BATTERY' : '';
  $('osdWarn').textContent = warn;
}
