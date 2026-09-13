import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {Texture} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GlbBody,disposeGlb} from '../src/neuro/motion/glb-body';
import {commandForPlan,deliverRigPlan,subscribeRigPlans,type RigMessage} from '../src/neuro/motion/rigged-bridge';
import type {MotorPlan} from '../src/neuro/contracts/motor-plan';

const plan=(actions:MotorPlan['actions'],source:MotorPlan['source']='rule'):MotorPlan=>({actions,durationMs:1000,confidence:1,source});
async function loadBody(){
  const bytes=readFileSync(new URL('../characters/furina/model/furina.skinned.glb',import.meta.url));
  const loader=new GLTFLoader();
  // Headless test decodes real geometry/skins/animation; browser QA checks PNGs.
  loader.register(parser=>{parser.loadTexture=async()=>new Texture();return {name:'headless-textures'};});
  const gltf=await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  return new GlbBody(gltf);
}
describe('GLB project integration',()=>{
  it('permits packaged GLB and embedded image fetches in native CSP',()=>{
    const config=JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
    const connect=config.app.security.csp.split(';').find((s:string)=>s.trim().startsWith('connect-src'));
    expect(connect).toContain("'self'");expect(connect).toContain('blob:');
  });
  it('maps concurrent expression and gesture, with recoil priority',()=>{
    const result=commandForPlan(plan([{type:'gesture',gesture:'wave',weight:1},{type:'expression',expression:'happy',intensity:2},{type:'recoil',from:'pointer',strength:1}]));
    expect(result).toMatchObject({clip:'recoil',expression:'happy',intensity:1,unsupported:[]});
  });
  it('reports unsupported locomotion and anatomy instead of pretending to handle it',()=>{
    expect(commandForPlan(plan([{type:'step',direction:'left',distance:1},{type:'earPose',pose:'back',weight:1}])).unsupported).toEqual(['step','earPose']);
  });
  it('delivers abort and detaches listeners',()=>{
    const events:RigMessage[]=[];const unsubscribe=subscribeRigPlans(e=>events.push(e));const abort=new AbortController();
    const finish=deliverRigPlan(plan([]),abort.signal);abort.abort();finish();unsubscribe();deliverRigPlan(plan([]));
    expect(events[0].type).toBe('plan');expect(events[1]).toMatchObject({type:'cancel',id:events[0].id});
    finish();expect(events).toHaveLength(2);
  });
  it('loads the real exported skin and drives all independent face primitives',async()=>{
    const body=await loadBody();
    body.receive({type:'plan',id:1,plan:plan([{type:'gesture',gesture:'wave',weight:1},{type:'expression',expression:'happy',intensity:.7}])});
    body.update(.05);
    expect(body.diagnostics.clip).toBe('wave');expect(body.faces.length).toBeGreaterThanOrEqual(5);
    for(const face of body.faces)expect(face.morphTargetInfluences![face.morphTargetDictionary!.happy]).toBe(.7);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('expires plans, ignores stale cancellation and protects reflexes',async()=>{
    const body=await loadBody();
    body.receive({type:'plan',id:2,plan:plan([{type:'recoil',from:'pointer',strength:1}],'reflex')});
    body.receive({type:'plan',id:3,plan:plan([{type:'gesture',gesture:'wave',weight:1}])});
    body.receive({type:'cancel',id:1});expect(body.diagnostics.clip).toBe('recoil');
    for(let i=0;i<25;i++)body.update(.05);expect(body.diagnostics.clip).toBe('idle');
    body.reaction('run-left');expect(body.usesFallback).toBe(false);
    body.reaction('idle');expect(body.usesFallback).toBe(false);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('keeps the same body for unsupported plans and ignores shadow output',async()=>{
    const body=await loadBody();body.receive({type:'plan',id:1,plan:plan([{type:'gesture',gesture:'wave',weight:1}],'shadow')});
    expect(body.diagnostics.clip).toBe('idle');
    body.receive({type:'plan',id:2,plan:plan([{type:'step',direction:'left',distance:1}])});expect(body.usesFallback).toBe(false);
    expect(body.diagnostics.unsupported).toEqual(['step']);
    body.receive({type:'cancel',id:2});expect(body.usesFallback).toBe(false);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('gives explicit expressions priority regardless of idleStyle ordering',()=>{
    const expression={type:'expression',expression:'happy',intensity:.3} as const;
    const idle={type:'idleStyle',style:'sleepy',weight:.8} as const;
    for(const actions of [[expression,idle],[idle,expression]])
      expect(commandForPlan(plan(actions))).toMatchObject({expression:'happy',intensity:.3});
    expect(commandForPlan(plan([idle]))).toMatchObject({expression:'tired',intensity:.8});
  });
  it('does not misinterpret depth lean as rightward lean',()=>{
    for(const direction of ['forward','back'] as const)
      expect(commandForPlan(plan([{type:'lean',direction,weight:1}]))).toMatchObject({lean:0,unsupported:[`lean:${direction}`]});
  });
  it('resets expression intensity after cancellation and restores latest legacy reaction',async()=>{
    const body=await loadBody();
    body.receive({type:'plan',id:1,plan:plan([{type:'expression',expression:'happy',intensity:.2}])});
    body.reaction('waiting');body.receive({type:'cancel',id:1});body.update(0);
    for(const face of body.faces){
      expect(face.morphTargetInfluences![face.morphTargetDictionary!.happy]).toBe(0);
      expect(face.morphTargetInfluences![face.morphTargetDictionary!.tired]).toBe(1);
    }
    body.reaction('run-left');expect(body.usesFallback).toBe(false);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('expires across suspended frames without advancing animation by the whole gap',async()=>{
    const body=await loadBody();
    body.receive({type:'plan',id:1,plan:plan([{type:'gesture',gesture:'wave',weight:1}],'reflex')});
    body.update(Number.NaN);expect(body.diagnostics.remainingMs).toBe(1000);
    body.update(30);expect(body.diagnostics.remainingMs).toBe(0);expect(body.diagnostics.clip).toBe('idle');
    expect(body.mixer.time).toBeLessThanOrEqual(.05);
    body.receive({type:'plan',id:2,plan:plan([{type:'gesture',gesture:'wave',weight:1}])});
    expect(body.diagnostics.clip).toBe('wave');
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('disposes each shared skin exactly once',async()=>{
    const body=await loadBody();
    const skeletons=new Set(body.faces.map(face=>face.skeleton));
    const spies=[...skeletons].map(s=>vi.spyOn(s,'dispose'));
    body.dispose();disposeGlb(body.gltf.scene);
    for(const spy of spies)expect(spy).toHaveBeenCalledTimes(1);
  });
  it('keeps GLB identity across every legacy reaction with bounded visual motion',async()=>{
    const body=await loadBody();const scene=body.gltf.scene;
    for(const reaction of ['idle','waving','jumping','failed','waiting','running','review','run-left','run-right']){
      body.reaction(reaction);body.update(.05);
      expect(body.usesFallback).toBe(false);
      expect(body.presentation.children[0]).toBe(scene);
      expect(body.presentation.position.x).toBe(0);
      expect(body.presentation.position.y).toBeGreaterThanOrEqual(0);
      expect(body.presentation.position.y).toBeLessThanOrEqual(.1);
    }
    body.reaction('jumping');body.update(.05);expect(body.diagnostics.clip).toBe('jump');
    expect(body.presentation.position.y).toBe(0);
    body.reaction('idle');body.update(0);expect(body.presentation.position.y).toBe(0);
    expect(body.presentation.rotation.z).toBe(0);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('preserves supported gesture and expression despite missing anatomy',async()=>{
    const body=await loadBody();
    body.receive({type:'plan',id:1,plan:plan([{type:'gesture',gesture:'wave',weight:1},{type:'expression',expression:'happy',intensity:.7},{type:'earPose',pose:'back',weight:1}])});
    body.update(.05);expect(body.usesFallback).toBe(false);
    expect(body.diagnostics).toMatchObject({clip:'wave',unsupported:['earPose']});
    for(const face of body.faces)expect(face.morphTargetInfluences![face.morphTargetDictionary!.happy]).toBe(.7);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('uses same-model cheer and reports unknown reactions without swapping art',async()=>{
    const body=await loadBody();
    body.receive({type:'plan',id:1,plan:plan([{type:'gesture',gesture:'cheer',weight:1}])});
    body.update(.05);expect(body.diagnostics.motion).toBe('bounce');
    expect(body.diagnostics.clip).toBe('cheer');
    expect(Math.abs(body.bones.get('arm_right')!.rotation.z)).toBeGreaterThan(0);
    body.receive({type:'cancel',id:1});body.reaction('unknown');
    expect(body.usesFallback).toBe(false);expect(body.diagnostics.unsupported).toEqual(['reaction:unknown']);
    body.dispose();disposeGlb(body.gltf.scene);
  });
  it('animates real knees and arms during walking, loops and stays within joint limits',async()=>{
    const body=await loadBody();body.reaction('run-right');
    const knee=body.bones.get('knee_left')!;const initial=knee.quaternion.clone();
    for(let i=0;i<5;i++)body.update(.05);
    expect(body.diagnostics.clip).toBe('walk');expect(knee.quaternion.angleTo(initial)).toBeGreaterThan(.01);
    expect(Math.abs(body.bones.get('arm_left')!.rotation.z)).toBeGreaterThan(.01);
    for(let i=0;i<240;i++){
      body.update(.05);
      expect(Math.abs(knee.rotation.z)).toBeLessThanOrEqual(.4);
      for(const name of ['hair_back','coat_left','coat_right'])expect(Math.abs(body.bones.get(name)!.rotation.z)).toBeLessThanOrEqual(.2);
    }
    expect(body.diagnostics.clip).toBe('walk');
    body.reaction('idle');body.update(.05);expect(Math.abs(knee.rotation.z)).toBeLessThan(.001);
    body.dispose();disposeGlb(body.gltf.scene);
  });
});
