// Final colour grade and sharpening, run on the display-ready (sRGB) image
// after OutputPass. It is also the upscaler: the 3D render can be smaller than
// the native-resolution canvas (js/quality.js), and this pass draws it to the
// screen with sharpening.
//
// ACES tone mapping alone leaves daylight scenes flat and milky: the sky,
// asphalt and concrete all crowd the middle of the range. This pass
//   * sharpens with a 4-tap unsharp mask that backs off on edges which are
//     already hard (so it lifts texture detail without white halos),
//   * applies an S-curve around mid-grey for contrast, keeping pure black and
//     white fixed,
//   * adds saturation, weighted toward muted colours (vibrance), so liveries
//     and hoardings pop without skin-tone-style clipping on already-vivid paint,
//   * and a light vignette to pull the eye to the centre of the frame.
import { ShaderPass } from '../lib/postprocessing/ShaderPass.js';

// Per render look (main.js RENDER_LOOK keys fall back to `day` / `night`).
export const GRADE_LOOKS = Object.freeze({
  day: Object.freeze({ sharpen: 0.55, contrast: 0.22, vibrance: 0.28, vignette: 0.20 }),
  dusk: Object.freeze({ sharpen: 0.50, contrast: 0.18, vibrance: 0.22, vignette: 0.22 }),
  night: Object.freeze({ sharpen: 0.45, contrast: 0.12, vibrance: 0.15, vignette: 0.24 }),
});

const GradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    sharpen: { value: GRADE_LOOKS.day.sharpen },
    contrast: { value: GRADE_LOOKS.day.contrast },
    vibrance: { value: GRADE_LOOKS.day.vibrance },
    vignette: { value: GRADE_LOOKS.day.vignette },
    upscale: { value: 0 },          // 0 = native render, 1 = heavily upscaled
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float sharpen;
    uniform float contrast;
    uniform float vibrance;
    uniform float vignette;
    uniform float upscale;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec2 texel = 1.0 / vec2(textureSize(tDiffuse, 0));
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;

      // unsharp mask, attenuated where local contrast is already high
      vec3 n = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
      vec3 s = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
      vec3 e = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
      vec3 w = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
      vec3 blur = (n + s + e + w) * 0.25;
      float edge = max(max(luma(abs(n - s)), luma(abs(e - w))), 0.0);
      // This pass also upscales a reduced-resolution render to the screen:
      // the neighbours are one *source* texel away, and the sharpening rises
      // with the upscale factor to restore the detail bilinear filtering softens.
      float amount = sharpen * (1.0 + upscale * 0.9) * (1.0 - smoothstep(0.08, 0.35, edge));
      c = clamp(c + (c - blur) * amount * 2.0, 0.0, 1.0);

      // S-curve contrast around mid-grey; 0 and 1 stay put
      vec3 curve = c * c * (3.0 - 2.0 * c);
      c = mix(c, curve, contrast);

      // vibrance: boost saturation most where it is lowest
      float l = luma(c);
      float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
      c = mix(vec3(l), c, 1.0 + vibrance * (1.0 - sat));

      // vignette
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }`,
};

export function createColorGradePass() {
  const pass = new ShaderPass(GradeShader);
  pass.setLook = (key) => {
    const look = GRADE_LOOKS[key]
      || (String(key).startsWith('night') ? GRADE_LOOKS.night : GRADE_LOOKS.day);
    for (const k of ['sharpen', 'contrast', 'vibrance', 'vignette']) pass.uniforms[k].value = look[k];
  };
  return pass;
}
