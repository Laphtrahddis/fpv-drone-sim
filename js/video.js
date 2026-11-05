// One fullscreen shader pass: analog FPV video look + optional fisheye.
// The scene is rendered into a texture, then drawn through this shader.
import * as THREE from 'three';

const frag = /* glsl */`
uniform sampler2D tDiffuse;
uniform float time, noise, amount, barrel, analog;
varying vec2 vUv;
float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv, c = uv - 0.5;
  // fisheye / barrel distortion (wide FPV lens)
  uv = 0.5 + c * (1.0 + barrel * dot(c, c) * 1.6) / (1.0 + barrel * 0.4);
  if (analog < 0.5) { gl_FragColor = texture2D(tDiffuse, uv); return; }

  float n = noise;
  // signal breakup: rows jitter sideways, worse with more noise
  float row = floor(uv.y * 240.0);
  uv.x += (rnd(vec2(row, floor(time * 30.0))) - 0.5) * 0.04 * n * n;
  // colour bleed / chromatic aberration
  float off = (0.0012 + 0.004 * n) * amount;
  vec3 col = vec3(texture2D(tDiffuse, uv + vec2(off, 0.0)).r,
                  texture2D(tDiffuse, uv).g,
                  texture2D(tDiffuse, uv - vec2(off, 0.0)).b);
  // analog cameras: slightly washed out, a bit of contrast
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))), 0.15 * amount);
  // scanlines + grain
  col *= 1.0 - 0.08 * amount * step(1.0, mod(gl_FragCoord.y, 3.0));
  float g = rnd(uv * 500.0 + time);
  col += (g - 0.5) * (0.07 * amount + 0.6 * n);
  // heavy static when the signal is bad
  col = mix(col, vec3(rnd(vec2(uv.x * 300.0, row + time * 60.0))), smoothstep(0.45, 1.0, n) * 0.85);
  // vignette
  col *= 1.0 - 0.35 * amount * dot(c, c) * 2.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Video {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    this.uniforms = {
      tDiffuse: { value: this.target.texture }, time: { value: 0 }, noise: { value: 0 },
      amount: { value: 1 }, barrel: { value: 0 }, analog: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, fragmentShader: frag,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.Camera();
  }

  setSize(w, h) { this.target.setSize(w, h); }

  // opts: { analog, amount, noise, fisheye }
  render(scene, camera, o) {
    if (!o.analog && !o.fisheye) return this.renderer.render(scene, camera); // effect off: zero cost
    const u = this.uniforms;
    u.time.value = performance.now() / 1000;
    u.noise.value = o.noise; u.amount.value = o.amount;
    u.barrel.value = o.fisheye ? 1 : 0; u.analog.value = o.analog ? 1 : 0;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.cam);
  }
}
