import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import modelUrl from '../characters/furina/model/furina.skinned.glb?url';
import { updateSpring } from './neuro/motion/advanced-animation';

// Development-only entry: deliberately not imported by the shipped pet.
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<style>
*{box-sizing:border-box}body{margin:0;background:#111d31;color:#eaf5ff;font:15px system-ui}
main{display:grid;grid-template-columns:330px 1fr;min-height:100vh}aside{padding:32px;background:#17263d}
h1{font-size:26px}p{line-height:1.7;color:#adc3dc}button,select{padding:9px;margin:4px;border:1px solid #6280a7;border-radius:6px;background:#233955;color:white}
label{display:block;margin:20px 0}pre{white-space:pre-wrap;font:12px monospace;color:#addbc8}#stage{height:100vh;min-height:600px}
canvas{display:block;width:100%;height:100%}.note{color:#f0c478}@media(max-width:700px){main{grid-template-columns:1fr}#stage{height:700px}}
</style>
<main><aside><h1>Furina · GLB 验收台</h1><p>读取 Blender 导出的真实蒙皮模型。表情是形变试作，尚未通过最终美术验收。</p>
<div id="clips"></div><button id="pause">暂停</button><button id="rest">静止姿态</button>
<label>表情 <select id="expression"><option>neutral</option></select></label>
<label>表情强度 <input id="strength" type="range" min="0" max="1" step="0.01" value="1"></label>
<label><input id="spring" type="checkbox"> 衣摆 / 后发弹簧测试</label><button id="impulse">轻推衣摆</button>
<label>背景 <select id="background"><option value="#111d31">深蓝</option><option value="#eeeeee">浅灰</option><option value="#a35479">高对比紫</option></select></label>
<p class="note">正面 2.5D 切片模型；大角度动作的遮挡补绘仍待验收。不是完整三维角色。</p>
<pre id="status">正在加载 GLB…</pre></aside><div id="stage"></div></main>`;
const stage = document.querySelector<HTMLDivElement>('#stage')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor('#111d31');
stage.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 2.3, -.1, .01, 30);
camera.position.set(0, 1.1, 6);
camera.lookAt(0, 1.1, 0);
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.left = -1.2*w/h; camera.right = 1.2*w/h;
  camera.top = 1.2; camera.bottom = -1.2;
  camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(stage); resize();
const status = document.querySelector<HTMLPreElement>('#status')!;
const expression = document.querySelector<HTMLSelectElement>('#expression')!;
const strength = document.querySelector<HTMLInputElement>('#strength')!;
const spring = document.querySelector<HTMLInputElement>('#spring')!;
const background = document.querySelector<HTMLSelectElement>('#background')!;
background.onchange = () => renderer.setClearColor(background.value);
let paused = false;
document.querySelector<HTMLButtonElement>('#pause')!.onclick = (e) => {
  paused = !paused; (e.currentTarget as HTMLButtonElement).textContent = paused ? '继续播放' : '暂停';
};
try {
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  scene.add(gltf.scene);
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  const faces = meshes.filter(m => m.morphTargetDictionary?.blink !== undefined);
  const names = [...new Set(faces.flatMap(m => Object.keys(m.morphTargetDictionary ?? {})))];
  for (const name of names) expression.add(new Option(name, name));
  const mixer = new THREE.AnimationMixer(gltf.scene);
  let active = 'idle';
  const actions = new Map(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
  const play = (name: string) => {
    mixer.stopAllAction(); meshes.forEach(m => m.pose());
    active = name; actions.get(name)?.reset().play();
  };
  for (const clip of gltf.animations) {
    const button = document.createElement('button'); button.textContent = clip.name;
    button.onclick = () => play(clip.name); document.querySelector('#clips')!.append(button);
  }
  document.querySelector<HTMLButtonElement>('#rest')!.onclick = () => play('rest');
  play('idle');
  const bones = meshes[0].skeleton.bones;
  const swinging = bones.filter(b => ['coat_left', 'coat_right', 'hair_back'].includes(b.name));
  const springBase = new Map(swinging.map(b => [b, b.quaternion.clone()]));
  const springStates = swinging.map(() => ({position:0, velocity:0}));
  document.querySelector<HTMLButtonElement>('#impulse')!.onclick = () => {
    spring.checked = true;
    springStates.forEach((state,i) => { state.velocity += i%2 ? -.3 : .3; });
  };
  let time = 0, previous = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now-previous)/1000, .05); previous = now;
    for (const bone of swinging) bone.quaternion.copy(springBase.get(bone)!);
    if (!paused) { time += dt; mixer.update(dt); }
    for (const face of faces) {
      if (face.morphTargetInfluences && (active !== 'blink' || expression.value !== 'neutral')) {
        face.morphTargetInfluences.fill(0);
        const index = face.morphTargetDictionary?.[expression.value];
        if (index !== undefined) face.morphTargetInfluences[index] = Number(strength.value);
      }
    }
    for (const [index, bone] of swinging.entries()) {
      // Restore before each procedural offset: never accumulate rotations.
      if (active === 'rest' || active === 'blink') bone.quaternion.copy(springBase.get(bone)!);
      springBase.set(bone, bone.quaternion.clone());
      if (spring.checked) {
        if (!paused) {
          const steps = Math.max(1, Math.ceil(dt*120));
          for (let step=0;step<steps;step++) {
            springStates[index] = updateSpring(springStates[index], 0,
              {stiffness:18, damping:2.4, mass:.35}, dt/steps);
          }
          springStates[index].position = THREE.MathUtils.clamp(springStates[index].position,-.08,.08);
        }
        bone.rotateZ(springStates[index].position);
      } else { springStates[index] = {position:0, velocity:0}; }
    }
    renderer.render(scene, camera);
    status.textContent = JSON.stringify({loaded: true, skinnedMeshes: meshes.length,
      bones: bones.length, clips: gltf.animations.map(c=>c.name), morphs: names,
      active, expression: expression.value, spring: spring.checked, paused,
      springOffsets: springStates.map(s=>Number(s.position.toFixed(5))),
      drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles}, null, 2);
  });
} catch (error) { status.textContent = `加载失败：${String(error)}`; }
