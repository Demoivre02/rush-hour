// Geometry sanity for the road-car meshes: the structural rules js/car.js
// documents (nothing below y=0, wheels present, sane size) must hold for
// every body type in the roster.
const ctxStub = () => ({ fillStyle:'', strokeStyle:'', font:'', textAlign:'', textBaseline:'', lineWidth:1, lineJoin:'',
  fillRect(){},clearRect(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},quadraticCurveTo(){},
  closePath(){},arcTo(){},fillText(){},strokeText(){},createLinearGradient:()=>({addColorStop(){}}),
  createRadialGradient:()=>({addColorStop(){}}),measureText:()=>({width:10}),save(){},restore(){},translate(){},
  scale(){},rotate(){},ellipse(){},bezierCurveTo(){},setTransform(){},drawImage(){} });
globalThis.document = { createElement: (t) => t === 'canvas' ? { width:0,height:0,getContext:ctxStub } : { style:{} } };
import * as THREE from 'three';
const { buildRoadCarMesh, ROAD_BODIES } = await import('../js/roadCar.js');
const { CAR_ROSTER } = await import('../js/carRoster.js');

let bad = 0;
const seen = new Set();
const rows = [];
for (const car of CAR_ROSTER) {
  const h = buildRoadCarMesh(car, { num: 1, code: 'AAA' });
  const box = new THREE.Box3().setFromObject(h.group);
  const tris = (() => { let n = 0; h.group.traverse(o => { if (o.isMesh && o.geometry?.index) n += o.geometry.index.count / 3; }); return Math.round(n); })();
  let meshes = 0; h.group.traverse(o => { if (o.isMesh) meshes++; });
  const problems = [];
  if (box.min.y < -1e-6) problems.push(`dips below ground (${box.min.y.toFixed(3)})`);
  if (!h.wheels.fl || !h.wheels.rr) problems.push('missing wheels');
  const L = box.max.z - box.min.z, W = box.max.x - box.min.x, H = box.max.y - box.min.y;
  if (L < 3 || L > 6.5) problems.push(`length ${L.toFixed(2)}`);
  if (W < 1.4 || W > 2.6) problems.push(`width ${W.toFixed(2)}`);
  if (H < 0.9 || H > 2.2) problems.push(`height ${H.toFixed(2)}`);
  if (meshes > 80) problems.push(`${meshes} meshes > 80 budget`);
  if (problems.length) { bad++; console.log(`  FAIL ${car.id}: ${problems.join('; ')}`); }
  if (!seen.has(car.body)) {
    seen.add(car.body);
    rows.push(`  ${car.body.padEnd(9)} ${L.toFixed(2)}x${W.toFixed(2)}x${H.toFixed(2)}m  ${String(meshes).padStart(2)} meshes  ${String(tris).padStart(4)} tris  (${car.name})`);
  }
}
console.log('one example per body type:');
rows.sort().forEach(r => console.log(r));
console.log(`\n${CAR_ROSTER.length} cars built, ${Object.keys(ROAD_BODIES).length} body types, ${bad} failures`);
process.exit(bad ? 1 : 0);
