// The garage showroom: the selected car on a slowly turning platform, lit like
// a car reveal (soft key light, cool blue rim lights, glossy dark floor).
// Loaded only when the garage screen opens; owns its own small renderer.
import * as THREE from 'three';
import { buildModelPreview } from './modelCars.js';

function showroomEnvironment(renderer) {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x0b1018, side: THREE.BackSide })));
  // light panels the paint reflects: a wide soft box overhead, blue strips at the sides
  const panel = (w, h, color, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(Math.PI / 2, ry, 0);
    room.add(m);
  };
  panel(14, 6, 0xffffff, 0, 9, 0);
  const strip = (x, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.2), new THREE.MeshBasicMaterial({ color: 0x3ac8ff, side: THREE.DoubleSide }));
    m.position.set(x, 2.5, z);
    m.rotation.y = ry;
    room.add(m);
  };
  strip(-12, 0, Math.PI / 2);
  strip(12, 0, Math.PI / 2);
  strip(0, -12, 0);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(room, 0.03).texture;
  pmrem.dispose();
  return tex;
}

// The team's F1 car, in the garage's chosen paint (or its livery).
async function formulaPreview(car) {
  const [CAR, { paintedTeam }] = await Promise.all([import('./car.js'), import('./garage.js')]);
  await CAR.preloadCarModel();
  const handle = CAR.buildCarMesh(paintedTeam(car.formulaTeam, car.paint), { num: 1, code: 'YOU' });
  handle.group.userData.dispose = () => CAR.releaseCarMesh(handle);
  return handle.group;
}

export class GarageView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.environment = showroomEnvironment(this.renderer);
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x101318, 0.5));
    const key = new THREE.SpotLight(0xffffff, 120, 30, Math.PI / 5, 0.6, 1.4);
    key.position.set(3, 8, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    this.scene.add(key);
    for (const [x, z] of [[-6, -3], [6, -3]]) {
      const rim = new THREE.PointLight(0x3ac8ff, 30, 14, 1.6);
      rim.position.set(x, 1.4, z);
      this.scene.add(rim);
    }

    // glossy dark floor with a soft blue ring around the platform
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64),
      // dim environment reflection: the overhead soft box otherwise shows up as
      // a bright streak on the glossy floor
      new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 0.45, metalness: 0.1, envMapIntensity: 0.15 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.15, 3.25, 96),
      new THREE.MeshBasicMaterial({ color: 0x2ec8ff, transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    this.scene.add(ring);

    this.platform = new THREE.Group();
    this.scene.add(this.platform);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(6.2, 1.9, 7.4);
    this.camera.lookAt(0, 0.55, 0);

    this.car = null;
    this._token = 0;
    this._running = true;
    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.resize();
    const tick = (t) => {
      if (!this._running) return;
      this.platform.rotation.y = t * 0.00022;
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const w = this.canvas.clientWidth || 640;
    const h = this.canvas.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Show `car` (a roster/garage car object). Later calls supersede earlier ones. */
  async setCar(car) {
    const token = ++this._token;
    const group = car?.formulaTeam ? await formulaPreview(car) : await buildModelPreview(car);
    if (token !== this._token || !this._running) { group?.userData.dispose?.(); return false; }
    if (this.car) {
      this.platform.remove(this.car);
      this.car.userData.dispose?.();
    }
    this.car = group;
    if (group) {
      group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.platform.add(group);
    }
    return !!group;
  }

  dispose() {
    this._running = false;
    removeEventListener('resize', this._resize);
    this.car?.userData.dispose?.();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
