// Fully synthesized drone sound (Web Audio, zero files).
//  - 4 sawtooth "motors": each motor's pitch follows its own output, like a real quad's
//    motor mixing, so rolls/flips make the motors split apart and beat against each other.
//  - Prop wash: band-passed noise, louder with throttle.
//  - Wind: low-passed noise, louder with speed.
import { settings } from './config.js';

let ctx, master, motors = [], wash, wind, noiseBuf;

function noiseSource() {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf; s.loop = true; s.start();
  return s;
}

// Browsers only allow audio after a user gesture, so call this from click/keydown.
export function initAudio() {
  if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }
  ctx = new AudioContext();
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  master = ctx.createGain();
  master.connect(ctx.destination);

  // motors -> lowpass (takes the harsh edge off the sawtooth)
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 3500; tone.Q.value = 0.7;
  tone.connect(master);
  for (let i = 0; i < 4; i++) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sawtooth'; osc.frequency.value = 100; osc.detune.value = (i - 1.5) * 9;
    g.gain.value = 0;
    osc.connect(g).connect(tone); osc.start();
    motors.push({ osc, g });
  }

  wash = ctx.createGain(); wash.gain.value = 0;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
  noiseSource().connect(bp).connect(wash).connect(master);
  wash.filter = bp;

  wind = ctx.createGain(); wind.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
  noiseSource().connect(lp).connect(wind).connect(master);
  wind.filter = lp;
}

export const audioReady = () => ctx?.state === 'running';

// Called every frame. drone = null means silence (menus, crashed).
export function updateAudio(drone) {
  if (!ctx) return;
  const t = ctx.currentTime, k = 0.03;
  master.gain.setTargetAtTime(settings.mute ? 0 : settings.volume, t, 0.05);
  const on = drone && !drone.crashed && drone.motor > 0.01; // silent when disarmed, spins up on arm
  const m = on ? drone.motor : 0, w = on ? drone.w : { x: 0, y: 0, z: 0 };

  // quad-X motor mix: front-left, front-right, back-left, back-right
  // (pitch/roll/yaw rates make some motors speed up and others slow down)
  const mix = [[+1, +1, -1], [+1, -1, +1], [-1, +1, +1], [-1, -1, -1]];
  motors.forEach(({ osc, g }, i) => {
    const [p, r, y] = mix[i];
    const mi = Math.max(0, Math.min(1, m + 0.025 * (p * w.x + r * -w.z + y * w.y)));
    osc.frequency.setTargetAtTime(70 + 680 * mi, t, k);  // RPM -> pitch
    g.gain.setTargetAtTime(on ? 0.05 + 0.1 * mi : 0, t, k);
  });
  wash.gain.setTargetAtTime(on ? 0.02 + 0.25 * m * m : 0, t, k);
  wash.filter.frequency.setTargetAtTime(500 + 1500 * m, t, k);
  const sp = on ? Math.min(1, drone.speed / 45) : 0;
  wind.gain.setTargetAtTime(0.6 * sp * sp, t, 0.1);
  wind.filter.frequency.setTargetAtTime(300 + 900 * sp, t, 0.1);
}

// Short noise burst + low thud.
export function crashSound() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  const src = noiseSource(); src.connect(g).connect(master); src.stop(t + 0.5);
  const thud = ctx.createOscillator(), tg = ctx.createGain();
  thud.frequency.setValueAtTime(120, t); thud.frequency.exponentialRampToValueAtTime(40, t + 0.3);
  tg.gain.setValueAtTime(0.9, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  thud.connect(tg).connect(master); thud.start(t); thud.stop(t + 0.4);
}
