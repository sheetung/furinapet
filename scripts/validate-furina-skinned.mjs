import fs from 'node:fs';
import crypto from 'node:crypto';
import validator from '../tmp/gltf-validation/node_modules/gltf-validator/index.js';

// Install the pinned, official validator without changing application dependencies:
// npm install --prefix tmp/gltf-validation --ignore-scripts gltf-validator@2.0.0-dev.3.10
const directory = new URL('../characters/furina/model/', import.meta.url);
const bytes = fs.readFileSync(new URL('furina.skinned.glb', directory));
const report = await validator.validateBytes(new Uint8Array(bytes), { uri: 'furina.skinned.glb', maxIssues: 1000 });
report.glbSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
fs.writeFileSync(new URL('qa/khronos-validation.json', directory), JSON.stringify(report, null, 2)+'\n');
const gltf = JSON.parse(bytes.subarray(20, 20+bytes.readUInt32LE(12)).toString());
const contractErrors = [];
const expectedMorphs = ['happy','surprised','annoyed','tired','blink'];
const expectedClips = ['idle','wave','recoil','blink','walk','jump','cheer','think'];
for (const name of expectedClips) {
  if (!gltf.animations?.some(a=>a.name===name)) contractErrors.push(`Missing clip: ${name}`);
}
for (const name of ['head','eye_left_surface','eye_right_surface','eye_left_lid','eye_right_lid']) {
  const mesh = gltf.meshes.find(m=>m.name===name);
  if (!mesh || expectedMorphs.some(n=>!mesh.extras?.targetNames?.includes(n))) {
    contractErrors.push(`Incomplete morph contract: ${name}`);
  }
}
const head = gltf.meshes.find(m=>m.name==='head');
const blinkIndex = head?.extras?.targetNames?.indexOf('blink');
if (blinkIndex >= 0) for (const primitive of head.primitives) {
  const accessor = gltf.accessors[primitive.targets[blinkIndex].POSITION];
  if (!accessor.min || !accessor.max || [...accessor.min,...accessor.max].some(v=>v!==0)) {
    contractErrors.push('Blink must not move head/hair vertices');
  }
}
const blinkNodes = new Set(gltf.animations?.find(a=>a.name==='blink')?.channels
  .filter(c=>c.target.path==='weights').map(c=>gltf.nodes[c.target.node].name));
for (const name of ['eye_left_surface','eye_right_surface','eye_left_lid','eye_right_lid']) {
  if (!blinkNodes.has(name)) contractErrors.push(`Blink clip missing ${name}`);
}
const summary = {
  glbSha256: report.glbSha256,
  errors: report.issues.numErrors, warnings: report.issues.numWarnings,
  skins: gltf.skins?.length ?? 0,
  joints: gltf.skins?.[0]?.joints.length ?? 0,
  meshes: gltf.meshes.length,
  clips: gltf.animations?.map(a=>a.name) ?? [],
  morphs: [...new Set(gltf.meshes.flatMap(m=>m.extras?.targetNames ?? []))],
  morphMeshes: gltf.meshes.filter(m=>m.extras?.targetNames?.length).map(m=>m.name),
  productionReady: false,
  contractErrors,
};
fs.writeFileSync(new URL('qa/skinned-validation.json', directory), JSON.stringify(summary, null, 2)+'\n');
console.log(JSON.stringify(summary, null, 2));
if (summary.errors || contractErrors.length || summary.skins !== 1 || summary.clips.length !== expectedClips.length || summary.morphs.length !== 5) process.exitCode = 1;
