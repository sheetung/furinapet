import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { commandForPlan, commandForReaction, type RigMessage } from './rigged-bridge';

export class GlbBody {
  readonly mixer:THREE.AnimationMixer;
  readonly presentation=new THREE.Group();
  readonly faces:THREE.SkinnedMesh[]=[];
  readonly bones=new Map<string,THREE.Bone>();
  private actions=new Map<string,THREE.AnimationAction>();
  private rest=new Map<THREE.Bone,THREE.Quaternion>();
  private command=commandForPlan({actions:[],durationMs:1000,confidence:1});
  private id=0;
  private remaining=0;
  private current='';
  private blinkTime=0;
  private reflex=false;
  private secondary=new Map<string,{position:number;velocity:number}>();
  private legacyReaction='idle';
  constructor(readonly gltf:GLTF) {
    this.mixer=new THREE.AnimationMixer(gltf.scene);
    gltf.scene.traverse(o=>{
      if ((o as THREE.Bone).isBone) {const b=o as THREE.Bone;this.bones.set(b.name,b);this.rest.set(b,b.quaternion.clone());}
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).morphTargetDictionary) this.faces.push(o as THREE.SkinnedMesh);
    });
    for(const clip of gltf.animations) this.actions.set(clip.name,this.mixer.clipAction(clip));
    for(const clip of ['idle','wave','recoil','blink','walk','jump','cheer','think']) if(!this.actions.has(clip)) throw new Error(`Missing GLB clip: ${clip}`);
    for(const bone of ['head','motion_root','eye_left','eye_right']) if(!this.bones.has(bone)) throw new Error(`Missing bone: ${bone}`);
    for(const name of ['happy','surprised','annoyed','tired','blink']) {
      if(!this.faces.some(f=>f.morphTargetDictionary?.[name]!==undefined)) throw new Error(`Missing morph: ${name}`);
    }
    this.play('idle');
    this.presentation.add(gltf.scene);
  }
  // Capability gaps degrade the motion, not the identity of the loaded body.
  get usesFallback(){return false;}
  get diagnostics(){return {clip:this.current,motion:this.command.motion,remainingMs:Math.round(this.remaining*1000),unsupported:[...this.command.unsupported],bones:this.bones.size};}
  private play(name:string) {
    if(this.current===name) return;
    this.mixer.stopAllAction();this.current=name;
    const action=this.actions.get(name)!;
    const loop=['idle','walk','think'].includes(name);
    action.reset();action.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);
    action.clampWhenFinished=!loop;action.play();
  }
  receive(message:RigMessage) {
    if(message.type==='cancel') {if(message.id===this.id)this.clearPlan();return;}
    if(message.plan.source==='shadow') return;
    if(this.remaining>0 && this.reflex && message.plan.source!=='reflex') return;
    this.reflex=message.plan.source==='reflex';
    this.id=message.id;this.command=commandForPlan(message.plan);this.remaining=this.command.durationMs/1000;
    this.current='';this.play(this.command.clip);
  }
  reaction(reaction:string) {
    this.legacyReaction=reaction;
    if(this.remaining>0) return;
    this.command=commandForReaction(reaction);
    this.play(this.command.clip);
  }
  private clearPlan() {
    this.remaining=0;this.reflex=false;this.id=0;
    this.reaction(this.legacyReaction);
  }
  update(dt:number, pointer={x:0,y:0}) {
    const elapsed=Number.isFinite(dt)?Math.max(0,dt):0;
    dt=Math.min(elapsed,.05);
    this.blinkTime+=dt;
    // Deadline follows elapsed time; only animation integration is frame-clamped.
    if(this.remaining>0) {this.remaining=Math.max(0,this.remaining-elapsed);if(this.remaining===0)this.clearPlan();}
    for(const [bone,q] of this.rest) bone.quaternion.copy(q);
    this.mixer.update(dt);
    // Movement now comes from the exported limb/root tracks, not wrapper bobbing.
    this.presentation.position.set(0,0,0);
    this.presentation.rotation.set(0,0,0);
    const locomotion=commandForReaction(this.legacyReaction).motion;
    if(locomotion==='walk' && !this.reflex && this.command.clip==='idle')this.play('walk');
    const active=this.remaining>0 && !this.usesFallback;
    if(active) {
      this.bones.get('motion_root')!.rotateZ(this.command.lean);
      // Independent eye patches have intentionally small, bounded aim range.
      for(const name of ['eye_left','eye_right']) {
        const b=this.bones.get(name)!;
        b.rotation.z+=(Number.isFinite(pointer.x)?THREE.MathUtils.clamp(pointer.x,-1,1):0)*this.command.look*.015;
      }
    }
    // Damped secondary offsets layered on the authored pose. Fixed small steps
    // and hard limits keep delayed frames from destabilizing hair/coat meshes.
    for(const name of ['hair_back','coat_left','coat_right']){
      const bone=this.bones.get(name);if(!bone)continue;
      const spring=this.secondary.get(name)??{position:0,velocity:0};
      const target=THREE.MathUtils.clamp(-this.bones.get('chest')!.rotation.z*.35-this.command.lean*.3,-.06,.06);
      const steps=Math.max(1,Math.ceil(dt/.008));const h=dt/steps;
      for(let i=0;i<steps;i++){
        spring.velocity+=(80*(target-spring.position)-14*spring.velocity)*h;
        spring.position=THREE.MathUtils.clamp(spring.position+spring.velocity*h,-.08,.08);
      }
      bone.rotateZ(spring.position);this.secondary.set(name,spring);
    }
    for(const [name,limit] of Object.entries({head:.25,chest:.2,arm_left:1.1,arm_right:1.1,arm_hand_left:.5,arm_hand_right:.5,leg_left:.3,leg_right:.3,knee_left:.4,knee_right:.4,hair_back:.18,coat_left:.2,coat_right:.2})){
      const bone=this.bones.get(name);if(bone)bone.rotation.z=THREE.MathUtils.clamp(bone.rotation.z,-limit,limit);
    }
    const phase=this.blinkTime%4.2;
    const blink=phase<.20?Math.sin(phase/.20*Math.PI):0;
    for(const face of this.faces) {
      face.morphTargetInfluences!.fill(0);
      const expression=face.morphTargetDictionary![this.command.expression];
      if(expression!==undefined) face.morphTargetInfluences![expression]=this.command.intensity;
      const index=face.morphTargetDictionary!.blink;
      if(index!==undefined) face.morphTargetInfluences![index]=blink;
    }
  }
  dispose(){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.gltf.scene);}
}

export function disposeGlb(scene:THREE.Object3D) {
  const textures=new Set<THREE.Texture>();const materials=new Set<THREE.Material>();const geometries=new Set<THREE.BufferGeometry>();
  const skeletons=new Set<THREE.Skeleton>();
  scene.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;geometries.add(m.geometry);
    if((m as THREE.SkinnedMesh).isSkinnedMesh)skeletons.add((m as THREE.SkinnedMesh).skeleton);
    for(const material of Array.isArray(m.material)?m.material:[m.material]) {materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}});
  textures.forEach(t=>t.dispose());materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());
  skeletons.forEach(s=>s.dispose());
}
