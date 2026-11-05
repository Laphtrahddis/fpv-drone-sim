// All tunable values live here. Settings are saved to localStorage; PHYS are code constants.
const KEY = 'fpv-settings-v1';

const defaults = {
  throttleMode: 'center',          // 'center' = stick center is hover, 'full' = bottom is 0%
  deadzone: 0.05,
  expo: 0.3,
  rates: { pitch: 500, roll: 500, yaw: 250 },   // deg/s (yaw used now, pitch/roll for Acro later)
  maxAngle: 45,                    // Angle mode tilt limit, degrees
  invert: { throttle: false, yaw: false, pitch: false, roll: false },
  // Which gamepad axis drives each channel. s = sign so that UP / RIGHT is +1.
  // Defaults match the browser "standard" (XInput) layout.
  axes: { throttle: { i: 1, s: -1 }, yaw: { i: 0, s: 1 }, pitch: { i: 3, s: -1 }, roll: { i: 2, s: 1 } },
  uptilt: 25,                      // camera uptilt, degrees
  fov: 115,                        // horizontal field of view, degrees
  chase: false,
};

function load() {
  const s = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    for (const k in saved) s[k] = typeof s[k] === 'object' ? { ...s[k], ...saved[k] } : saved[k];
  } catch {}
  return s;
}

export const settings = load();
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }

const mass = 0.65; // kg, a typical 5" freestyle quad
export const PHYS = {
  mass,
  gravity: 9.81,
  maxThrust: 4.5 * mass * 9.81, // N, thrust-to-weight 4.5:1 (real 5" quads are 6-10:1)
  linDrag: 0.08,                // linear air drag
  quadDrag: 0.025,              // quadratic air drag (limits top speed to ~130 km/h)
  angleResponse: 9,             // how fast Angle mode reaches the target tilt
};
PHYS.hoverThrottle = (PHYS.mass * PHYS.gravity) / PHYS.maxThrust;
