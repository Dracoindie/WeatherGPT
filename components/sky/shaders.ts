/**
 * GLSL for the Living Sky engine. Screen-space layers (sky, clouds, fog) draw
 * a fullscreen quad; particles (rain, splashes, snow) live in world space so
 * camera parallax gives real depth.
 */

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
`

export const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const SKY_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec2 uSun;
uniform vec2 uMoon;
uniform float uSunElev;
uniform float uStars;
uniform float uTime;
uniform float uFlash;
uniform float uHeat;
uniform float uCloud;
uniform float uAspect;
uniform vec2 uParallax;
varying vec2 vUv;

void main() {
  vec2 uv = vUv + uParallax * 0.25;

  // Heat shimmer: refractive wobble strongest near the horizon.
  float sh = uHeat * (1.0 - smoothstep(0.0, 0.65, uv.y));
  uv.x += (sin(uv.y * 95.0 + uTime * 7.0) * 0.0028 + (noise(vec2(uv.y * 45.0, uTime * 2.3)) - 0.5) * 0.006) * sh;
  uv.y += sin(uv.x * 70.0 + uTime * 5.0) * 0.0018 * sh;

  vec3 col = mix(uBottom, uTop, pow(clamp(uv.y, 0.0, 1.0), 0.85));

  // Sun: disk + bloom + god rays
  vec2 d = (uv - uSun) * vec2(uAspect, 1.0);
  float r = length(d);
  float sunVis = smoothstep(-0.12, 0.12, uSunElev) * (1.0 - uCloud * 0.72);
  vec3 sunCol = mix(vec3(1.0, 0.55, 0.25), vec3(1.0, 0.95, 0.86), clamp(uSunElev * 1.8, 0.0, 1.0));
  float disk = 1.0 - smoothstep(0.038, 0.048, r);
  float bloom = exp(-r * 7.0) * 0.6 + exp(-r * 2.2) * 0.2;
  float ang = atan(d.y, d.x);
  float rays = pow(noise(vec2(ang * 7.0, uTime * 0.12)) * noise(vec2(ang * 13.0 + 4.0, uTime * 0.07)), 1.6);
  rays *= exp(-r * 2.4) * (0.6 + uHeat * 0.6);
  col += sunCol * (disk * 1.3 + bloom * (1.0 + uHeat * 0.6) + rays * 0.9) * sunVis;

  // Moon
  float moonVis = (1.0 - smoothstep(-0.2, 0.08, uSunElev)) * (1.0 - uCloud * 0.85);
  float m = length((uv - uMoon) * vec2(uAspect, 1.0));
  float crater = noise((uv - uMoon) * 260.0) * 0.18;
  col += vec3(0.86, 0.9, 1.0) * ((1.0 - smoothstep(0.026, 0.03, m)) * (0.85 - crater) + exp(-m * 16.0) * 0.22) * moonVis;

  // Stars with twinkle
  vec2 g = uv * vec2(uAspect, 1.0) * 85.0;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  vec2 off = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
  float star = step(0.982, h) * (1.0 - smoothstep(0.0, 0.09, length(f - off)));
  star *= 0.55 + 0.45 * sin(uTime * (0.8 + h * 3.0) + h * 40.0);
  col += star * uStars * smoothstep(0.12, 0.55, uv.y);

  // Lightning wash
  col += uFlash * vec3(0.5, 0.56, 0.75);

  // Vignette
  col *= 1.0 - 0.28 * length((vUv - 0.5) * vec2(1.0, 0.85));
  gl_FragColor = vec4(col, 1.0);
}
`

export const CLOUD_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uCover;
uniform float uDark;
uniform float uFlash;
uniform float uAlpha;
uniform float uScale;
uniform float uAspect;
uniform float uSunElev;
uniform vec3 uBottom;
uniform vec2 uOffset;
uniform vec2 uParallax;
varying vec2 vUv;

void main() {
  vec2 uv = vUv + uParallax;
  vec2 p = vec2(uv.x * uAspect, uv.y * 1.6) * uScale + uOffset;
  vec2 q = vec2(fbm(p + uTime * 0.012), fbm(p + vec2(5.2, 1.3) - uTime * 0.008));
  float n = fbm(p + 1.6 * q);

  float threshold = mix(0.72, 0.22, uCover);
  float density = smoothstep(threshold, threshold + 0.32, n);
  density *= mix(0.45, 1.0, smoothstep(0.05, 0.75, uv.y));

  float day = clamp(uSunElev * 2.2 + 0.35, 0.0, 1.0);
  vec3 light = mix(vec3(0.95, 0.96, 1.0), uBottom, 0.35) * mix(0.28, 1.0, day);
  vec3 shadow = mix(light * 0.55, vec3(0.08, 0.09, 0.12), uDark);
  // cheap self-shadowing: reuse n plus one octave of detail (keeps 60 fps)
  float shade = n * 0.75 + noise(p * 3.1 + q * 2.0) * 0.35;
  vec3 col = mix(shadow, light, clamp(shade * 1.35 - uDark * 0.55, 0.0, 1.0));

  // Lightning illuminates clouds from inside
  col += uFlash * vec3(0.75, 0.8, 1.0) * density * 1.4;

  gl_FragColor = vec4(col, density * uAlpha);
}
`

export const FOG_FRAG = /* glsl */ `
${NOISE}
uniform float uTime;
uniform float uFog;
uniform float uWind;
uniform float uAspect;
uniform float uSunElev;
uniform vec3 uBottom;
uniform vec2 uParallax;
varying vec2 vUv;

void main() {
  float f = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 uv = vUv + uParallax * (1.0 + fi * 0.8);
    vec2 p = vec2(uv.x * uAspect * (1.1 + fi * 0.7) + uTime * (0.015 + fi * 0.012) * uWind, uv.y * (2.2 + fi * 1.4));
    f += fbm(p + fi * 7.3) * (0.55 - fi * 0.12);
  }
  float low = 1.0 - smoothstep(0.0, 0.9, vUv.y);
  float a = clamp((f - 0.25) * 1.9, 0.0, 1.0) * mix(0.35, 1.0, low) * uFog;
  float day = clamp(uSunElev * 2.0 + 0.4, 0.0, 1.0);
  vec3 col = mix(uBottom, vec3(0.78, 0.8, 0.84), 0.6) * mix(0.25, 1.0, day);
  gl_FragColor = vec4(col, a * 0.85);
}
`

const DEPTH_HELPERS = /* glsl */ `
uniform float uTanHalf;
uniform float uAspect;
uniform float uCamZ;
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
`

export const RAIN_VERT = /* glsl */ `
${DEPTH_HELPERS}
uniform float uTime;
uniform float uSpeed;
uniform float uSlant;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vFade;

void main() {
  float z = mix(-7.0, 3.2, aSeed.z);
  float dist = uCamZ - z;
  float halfH = uTanHalf * dist * 1.1;
  float halfW = halfH * uAspect * 1.25;
  float speed = uSpeed * (0.75 + 0.5 * aSeed.w);

  float spanY = 2.0 * halfH;
  float spanX = 2.0 * halfW;
  float y = halfH - mod(aSeed.y * spanY + uTime * speed, spanY);
  float x = -halfW + mod(aSeed.x * spanX + uTime * speed * uSlant, spanX);

  vec2 dir = normalize(vec2(uSlant, -1.0));
  vec2 perp = vec2(-dir.y, dir.x);
  float len = (0.25 + speed * 0.03) * (0.7 + 0.6 * aSeed.w);
  float width = 0.0045 * dist;
  vec2 offset = dir * position.y * len + perp * position.x * width;

  vUv = uv;
  vFade = mix(0.75, 0.22, aSeed.z < 0.5 ? 0.0 : (aSeed.z - 0.5) * 2.0) * (1.0 - smoothstep(4.0, 13.0, dist)) + 0.15;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(x + offset.x, y + offset.y, z, 1.0);
}
`

export const RAIN_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uFlash;
varying vec2 vUv;
varying float vFade;
void main() {
  float tail = smoothstep(0.0, 1.0, vUv.y);
  float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float a = tail * core * vFade * uOpacity;
  gl_FragColor = vec4(vec3(0.74, 0.82, 0.96) + uFlash * 0.6, a);
}
`

export const SPLASH_VERT = /* glsl */ `
${DEPTH_HELPERS}
uniform float uTime;
uniform float uRate;
attribute vec4 aSeed;
varying vec2 vUv;
varying float vPhase;

void main() {
  float cycle = uTime * uRate * (0.7 + aSeed.w * 0.6) + aSeed.y;
  float k = floor(cycle);
  vPhase = fract(cycle);
  float z = mix(-2.5, 2.6, hash1(k * 1.7 + aSeed.z * 53.0));
  float dist = uCamZ - z;
  float halfW = uTanHalf * dist * uAspect;
  float x = (hash1(k + aSeed.x * 101.0) * 2.0 - 1.0) * halfW;
  float y = -uTanHalf * dist + 0.04 * dist;
  float size = (0.05 + vPhase * 0.16) * dist * 0.35;
  vUv = uv;
  vec3 p = vec3(x + position.x * size, y + position.y * size * 0.32, z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

export const SPLASH_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying float vPhase;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = 1.0 - smoothstep(0.0, 0.16, abs(r - vPhase));
  float a = ring * (1.0 - vPhase) * uOpacity * 0.75;
  gl_FragColor = vec4(0.8, 0.88, 1.0, a);
}
`

export const SNOW_VERT = /* glsl */ `
${DEPTH_HELPERS}
uniform float uTime;
uniform float uSpeed;
uniform float uDrift;
uniform float uSize;
uniform float uPixelRatio;
attribute float aRand;
varying float vBlur;
varying float vRand;

void main() {
  vec3 seed = position;
  float z = mix(-8.0, 3.4, seed.z);
  float dist = uCamZ - z;
  float halfH = uTanHalf * dist * 1.1;
  float halfW = halfH * uAspect * 1.25;
  float speed = uSpeed * (0.6 + 0.8 * aRand);
  float spanY = 2.0 * halfH;
  float spanX = 2.0 * halfW;
  float y = halfH - mod(seed.y * spanY + uTime * speed, spanY);
  float x = -halfW + mod(seed.x * spanX + uTime * uDrift + sin(uTime * (0.6 + aRand) + aRand * 30.0) * 0.35, spanX);

  // depth of field around a focal distance of 5 units
  vBlur = clamp(abs(dist - 5.0) / 5.5, 0.0, 1.0);
  vRand = aRand;
  vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
  gl_PointSize = uSize * uPixelRatio * (0.6 + aRand * 0.8) * (1.0 + vBlur * 1.6) * (6.0 / dist);
  gl_Position = projectionMatrix * mv;
}
`

export const SNOW_FRAG = /* glsl */ `
uniform float uOpacity;
varying float vBlur;
varying float vRand;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float edge = mix(0.55, 0.0, vBlur);
  float a = (1.0 - smoothstep(edge, 1.0, r)) * mix(0.95, 0.28, vBlur) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.94, 0.97, 1.0), a);
}
`
