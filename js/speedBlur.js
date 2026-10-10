// Speed blur: the radial motion blur racing games use to sell speed. The frame
// is smeared toward the vanishing point in proportion to speed, strongest at
// the screen edges (verges, barriers, buildings) and zero over the player's
// car and the road just ahead, which stay sharp. Runs on the display-ready
// image after OutputPass; main.js sets `strength` every frame.
import { ShaderPass } from '../lib/postprocessing/ShaderPass.js';

const SpeedBlurShader = {
  name: 'SpeedBlurShader',
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0 },         // 0..1
    focus: { value: [0.5, 0.56] },  // vanishing point, roughly the horizon ahead
    carCentre: { value: [0.5, 0.3] },
    aspect: { value: 16 / 9 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 focus;
    uniform vec2 carCentre;
    uniform float aspect;
    varying vec2 vUv;

    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      if (strength < 0.001) { gl_FragColor = src; return; }
      vec2 toFocus = focus - vUv;
      // grows toward the screen edges...
      float edge = smoothstep(0.12, 0.62, length(toFocus * vec2(aspect, 1.0)));
      // ...and is cut out over the car (an ellipse around it)
      vec2 c = (vUv - carCentre) * vec2(aspect * 1.35, 1.9);
      float car = smoothstep(0.32, 0.55, length(c));
      float amount = strength * edge * car;
      if (amount < 0.002) { gl_FragColor = src; return; }
      // 14 taps, each pixel's set offset by a per-pixel jitter (interleaved
      // gradient noise) so the samples blend into one continuous streak; a
      // few widely spaced taps read as ghost copies, which looked like lag.
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      vec2 stepUv = toFocus * amount * 0.06 / 14.0;
      vec3 sum = src.rgb;
      float w = 1.0;
      for (int i = 1; i <= 14; i++) {
        float fi = float(i) - jitter;
        float wi = 1.0 - fi / 15.0;
        wi *= wi;                                   // most weight near the pixel
        sum += texture2D(tDiffuse, vUv + stepUv * fi).rgb * wi;
        w += wi;
      }
      gl_FragColor = vec4(sum / w, src.a);
    }`,
};

export function createSpeedBlurPass() {
  const pass = new ShaderPass(SpeedBlurShader);
  pass.uniforms.focus.value = [0.5, 0.56];
  pass.uniforms.carCentre.value = [0.5, 0.3];
  return pass;
}
