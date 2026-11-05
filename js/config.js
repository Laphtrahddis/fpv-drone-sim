// All tunable values live here. Settings are saved to localStorage; PHYS are code constants.
const KEY = 'fpv-settings-v1';

const defaults = {
  startMode: 'ACRO',               // mode each flight starts in: 'ACRO' (real FPV: flips) or 'ANGLE' (self-levels)
  throttleMode: 'center',          // 'center' = stick center is hover, 'full' = bottom is 0%
  deadzone: 0.05,
  // Betaflight "Actual" rates per axis: center sensitivity (deg/s), max rate (deg/s), expo
  rates: {
    pitch: { center: 70, max: 600, expo: 0.5 },
    roll:  { center: 70, max: 600, expo: 0.5 },
    yaw:   { center: 70, max: 400, expo: 0.4 },
  },
  gravity: 1.4,                    // gravity multiplier (thrust scales too, so hover stays the same)
  maxAngle: 60,                    // Angle mode tilt limit
  invert: { throttle: false, yaw: false, pitch: false, roll: false },
  // Which gamepad axis drives each channel. s = sign so that UP / RIGHT is +1.
  // Defaults match the browser "standard" (XInput) layout.
  axes: { throttle: { i: 1, s: -1 }, yaw: { i: 0, s: 1 }, pitch: { i: 3, s: -1 }, roll: { i: 2, s: 1 } },
  uptilt: 25,                      // camera uptilt, degrees
  fov: 115,                        // horizontal field of view, degrees
  chase: false,
  shake: 0.35,                     // camera shake multiplier
  fisheye: false,
  video: true,                     // analog video effect
  videoAmount: 0.7,
  osd: true,
  volume: 0.7,
  mute: false,
};

function load() {
  const s = structuredClone(defaults);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    for (const k in saved) if (k in s && k !== 'rates') s[k] = typeof s[k] === 'object' ? { ...s[k], ...saved[k] } : saved[k];
    if (saved.rates?.pitch?.max) s.rates = saved.rates; // ignore the old Phase 1 rate format
  } catch {}
  return s;
}

export const settings = load();
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }

// A typical 5" freestyle quad: ~650g, thrust-to-weight ~9:1, top speed ~170 km/h.
const mass = 0.65, gravity = 9.81, tw = 9;
export const PHYS = {
  mass, gravity,
  maxThrust: tw * mass * gravity, // N, all 4 motors at 100%
  idle: 0.05,                     // motors keep spinning at 5% (Betaflight air mode)
  motorLag: 0.035,                // s, motor spool-up time constant
  rateLag: 0.03,                  // s, how quickly the rate loop reaches the requested rotation
  angleGain: 7,                   // Angle mode: rad/s of correction per rad of tilt error
  propSpeed: 70,                  // m/s of air through the props at which thrust drops to 0
  dragUp: 0.022,                  // quadratic drag along UP (flat side: big)
  dragFlat: 0.007,                // quadratic drag in the prop plane (edge-on: small)
  linDrag: 0.03,
  turbulence: 0.08,
  batteryLife: 0.011,             // battery used per second at full throttle (~90 s flat out)
  sag: 0.25,                      // empty battery gives 25% less max thrust
};
// thrust ~ motor^2, so hover throttle is sqrt(weight / max thrust), adjusted for idle
PHYS.hoverThrottle = (Math.sqrt(1 / tw) - PHYS.idle) / (1 - PHYS.idle);
