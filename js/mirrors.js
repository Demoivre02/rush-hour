// Live rear-view mirrors.
//
// Each mirror is a real render of the scene from a rear-facing camera mounted
// on the car, drawn into an off-screen target and then composited into the
// corner of the frame through a quad whose UVs are flipped in X. The flip is
// the whole point: a camera pointing backwards puts a car that is physically on
// your LEFT on the RIGHT of the image, which is exactly backwards from what a
// mirror shows and would make you defend the wrong side.
//
// Doing the flip in UV space rather than by negating the projection matrix
// keeps triangle winding intact, so back-face culling still works and the
// world does not turn inside out.
import * as THREE from 'three';

const MIRROR_LAYOUT = Object.freeze({
  // Fractions of the viewport. Two mirrors sit inboard of the top corners,
  // roughly where wing mirrors fall in a driver's field of view.
  width: 0.19, height: 0.115, top: 0.035, inset: 0.055,
});

export const MIRROR_QUALITY = Object.freeze({
  off: Object.freeze({ enabled: false, scale: 0, everyNthFrame: 1 }),
  low: Object.freeze({ enabled: true, scale: 0.5, everyNthFrame: 3 }),
  medium: Object.freeze({ enabled: true, scale: 0.75, everyNthFrame: 2 }),
  high: Object.freeze({ enabled: true, scale: 1, everyNthFrame: 1 }),
});

export function mirrorQuality(tier) {
  return MIRROR_QUALITY[tier] || MIRROR_QUALITY.medium;
}

// Screen rectangles in pixels for a given drawing-buffer size.
export function mirrorRects(width, height, layout = MIRROR_LAYOUT) {
  const w = Math.max(24, Math.round(width * layout.width));
  const h = Math.max(16, Math.round(height * layout.height));
  const top = Math.round(height * layout.top);
  const inset = Math.round(width * layout.inset);
  // WebGL viewport origin is bottom-left.
  const y = height - top - h;
  return [
    { side: -1, x: inset, y, w, h },
    { side: 1, x: width - inset - w, y, w, h },
  ];
}

export class MirrorViews {
  constructor(renderer, { fov = 62, quality = 'medium' } = {}) {
    this.renderer = renderer;
    this.enabled = true;
    this.quality = mirrorQuality(quality);
    this._frame = 0;
    this._size = new THREE.Vector2();

    this.cameras = [
      new THREE.PerspectiveCamera(fov, 2, 0.4, 900),
      new THREE.PerspectiveCamera(fov, 2, 0.4, 900),
    ];
    this.targets = this.cameras.map(() => new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    }));

    // Composite scene: one unit quad per mirror, UVs mirrored in X.
    this.compositeScene = new THREE.Scene();
    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quads = this.targets.map((target) => {
      const geometry = new THREE.PlaneGeometry(2, 2);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      uv.needsUpdate = true;
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map: target.texture, depthTest: false, depthWrite: false, toneMapped: false,
      }));
      mesh.frustumCulled = false;
      return mesh;
    });

    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  setQuality(tier) { this.quality = mirrorQuality(tier); }
  setEnabled(on) { this.enabled = !!on; }

  /**
   * Aim both mirrors from the car's pose.
   * @param {{x:number,z:number,y:number,heading:number}} pose
   */
  aim(pose) {
    const { x, y, z, heading } = pose;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    // right-hand lateral axis for this heading
    this._right.set(fz, 0, -fx);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const cam = this.cameras[i];
      cam.position.set(
        x + this._right.x * side * 0.62 - fx * 0.15,
        y + 0.78,
        z + this._right.z * side * 0.62 - fz * 0.15,
      );
      // Look back and slightly outboard, the way a wing mirror is angled.
      this._look.set(
        cam.position.x - fx * 40 + this._right.x * side * 7,
        y + 0.62,
        cam.position.z - fz * 40 + this._right.z * side * 7,
      );
      cam.lookAt(this._look);
    }
  }

  /**
   * Render both mirrors and composite them. Call after the main scene render.
   * Returns true when the mirrors drew this frame.
   */
  render(scene) {
    if (!this.enabled || !this.quality.enabled) return false;
    this._frame++;
    const renderer = this.renderer;
    renderer.getDrawingBufferSize(this._size);
    const rects = mirrorRects(this._size.x, this._size.y);
    const scale = this.quality.scale;

    // Re-render the mirror contents only every Nth frame on lower tiers; the
    // composite still draws every frame, so the mirrors never flicker.
    const refresh = this._frame % this.quality.everyNthFrame === 0;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;

    if (refresh) {
      for (let i = 0; i < 2; i++) {
        const rect = rects[i];
        const tw = Math.max(16, Math.round(rect.w * scale));
        const th = Math.max(12, Math.round(rect.h * scale));
        const target = this.targets[i];
        if (target.width !== tw || target.height !== th) target.setSize(tw, th);
        const cam = this.cameras[i];
        if (cam.aspect !== tw / th) { cam.aspect = tw / th; cam.updateProjectionMatrix(); }
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, cam);
      }
      renderer.setRenderTarget(previousTarget);
    }

    renderer.autoClear = false;
    renderer.setScissorTest(true);
    for (let i = 0; i < 2; i++) {
      const rect = rects[i];
      renderer.setViewport(rect.x, rect.y, rect.w, rect.h);
      renderer.setScissor(rect.x, rect.y, rect.w, rect.h);
      this.compositeScene.clear();
      this.compositeScene.add(this.quads[i]);
      renderer.render(this.compositeScene, this.compositeCamera);
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this._size.x, this._size.y);
    renderer.setScissor(0, 0, this._size.x, this._size.y);
    renderer.autoClear = previousAutoClear;
    return true;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    for (const q of this.quads) { q.geometry.dispose(); q.material.dispose(); }
  }
}
