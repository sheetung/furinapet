import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { load } from './load-ts.mjs';
const { furinaClips } = await load('../characters/furina/clips.ts');
const { clipDuration, sampleClip } = await load('../src/animation/clip.ts');
const { GestureSelector } = await load('../src/pet-brain/adapters/gesture-selector.ts');
const { activityForStep } = await load('../src/actions/activity.ts');
const { routines } = await load('../src/actions/catalog.ts');
const { performNeedRecovery } = await load('../src/pet-brain/recovery.ts');
const { resolveCharacterStep } = await load('../src/characters/action-resolver.ts');

// Decode the actual exported RGBA pixels, not recipe metadata, to verify seam boundaries.
async function pixels(name) {
  const bytes = await readFile(new URL(`../characters/furina/animations/standard/${name}.png`, import.meta.url));
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * 4, out = Buffer.alloc(stride * height);
  const paeth = (a,b,c) => { const p=a+b-c, da=Math.abs(p-a), db=Math.abs(p-b), dc=Math.abs(p-c); return da<=db&&da<=dc?a:db<=dc?b:c; };
  for (let y=0;y<height;y++) {
    const filter=raw[y*(stride+1)];
    for(let x=0;x<stride;x++) {
      const index=y*stride+x, a=x>=4?out[index-4]:0, b=y?out[index-stride]:0, c=y&&x>=4?out[index-stride-4]:0;
      const predictors=[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)];
      assert.ok(filter<5);
      out[index]=(raw[y*(stride+1)+x+1]+predictors[filter])&255;
    }
  }
  return index => {
    const cell=Buffer.alloc(192*208*4), left=index%4*192, top=Math.floor(index/4)*208;
    for(let y=0;y<208;y++)out.copy(cell,y*192*4,((top+y)*width+left)*4,((top+y)*width+left+192)*4);
    return cell;
  };
}

test('new animation boundaries match authored neutral/tea pixels exactly', async () => {
  const [idle,tea,breathing,nod,enter,exit,sip]=await Promise.all(['idle','tea','breathing','nod','tea-enter','tea-exit','tea-sip'].map(pixels));
  for(const action of [breathing,nod]) { assert.deepEqual(action(0),idle(0)); assert.deepEqual(action(5),idle(0)); }
  assert.deepEqual(enter(0),idle(0)); assert.deepEqual(enter(5),tea(0));
  assert.deepEqual(exit(0),tea(5)); assert.deepEqual(exit(5),idle(0));
  for(let i=1;i<5;i++)assert.deepEqual(exit(i),enter(5-i),'pickup and putdown share the same spatial path');
  for(let i=0;i<6;i++)assert.deepEqual(sip(i),tea(i),'drinking retains existing art');
});

test('quiet sheets keep fixed feet, transparent unused cells and full-body bounds', async () => {
  for(const name of ['breathing','nod','tea-enter','tea-exit','tea-sip']) {
    const cell=await pixels(name);
    for(let i=0;i<6;i++) {
      const data=cell(i); let bottom=0;
      for(let y=0;y<208;y++)for(let x=0;x<192;x++)if(data[(y*192+x)*4+3]>128)bottom=Math.max(bottom,y+1);
      assert.ok(bottom>=198&&bottom<=201,`${name} frame${i} foot baseline ${bottom}`);
      for(let y=0;y<208;y++)for(const x of [0,191])assert.equal(data[(y*192+x)*4+3],0,'no cropped side edges');
    }
    for(let i=6;i<16;i++)assert.ok(cell(i).every(byte=>byte===0));
  }
});

test('breathing and sip loop; nod and putdown return neutral; pickup holds the cup', () => {
  for(const name of ['breathing','tea-sip'])assert.ok(sampleClip(furinaClips[name],60000).nextMs>0);
  for(const name of ['nod','tea-exit'])assert.deepEqual(sampleClip(furinaClips[name],clipDuration(furinaClips[name])),{row:0,column:0,nextMs:null});
  assert.equal(sampleClip(furinaClips['tea-enter'],10000).column,5);
  assert.equal(sampleClip(furinaClips['tea-enter'],10000).clipId,'tea-enter');
});

test('calm click nod cooldown only starts after successful playback', () => {
  const selector=new GestureSelector(),action={type:'respond',intensity:'soft'};
  const nod=selector.select(action,'idle',.78,0);
  assert.equal(nod.motion,'nod'); assert.equal(nod.activity,'observe');
  assert.equal(selector.select(action,'idle',.78,100).motion,'nod');
  selector.recordPerformed(nod,100);
  assert.equal(selector.select(action,'idle',.78,30000).motion,undefined);
  assert.equal(selector.select(action,'idle',.78,30100).motion,'nod');
  assert.equal(selector.select({type:'respond',intensity:'normal'},'idle',.78,60000).motion,undefined);
});

test('manual tea separates prop transitions from drinking and keeps imported pet fallback', () => {
  const steps=routines.find(item=>item.id==='tea').steps;
  assert.deepEqual(steps.map(step=>step.motion),['tea-enter','tea-sip','tea-exit']);
  assert.deepEqual(steps.map(activityForStep),['idle','tea','idle']);
  assert.equal(activityForStep({reaction:'idle',motion:'breathing',durationMs:4600}),'idle');
  for(const step of steps)assert.equal(resolveCharacterStep(step,{id:'furina',source:'local'}).motion,undefined);
});

test('thirst recovery picks up only once, loops drinking until satisfied, then puts down', async () => {
  const controller=new AbortController(), seen=[]; let thirst=.95,sips=0;
  await performNeedRecovery({signal:controller.signal,wait:async()=>{},perform:async step=>{
    seen.push(step);
    if(step.motion==='tea-sip'){ sips++;thirst-=.4; assert.equal(step.durationMs%4150,0); }
  }},'thirsty',()=>({thirst}));
  assert.equal(sips,2);
  assert.deepEqual(seen.map(step=>step.motion),['tea-enter','tea-sip','tea-sip','tea-exit']);
  assert.deepEqual(seen.map(step=>step.activity),['idle','tea','tea','idle']);
});

test('cancel at any tea phase never plays a late sip or putdown', async () => {
  for(const phase of ['tea-enter','tea-sip','tea-exit']) {
    const controller=new AbortController(), seen=[]; let thirst=.8;
    await performNeedRecovery({signal:controller.signal,wait:async()=>{},perform:async step=>{
      seen.push(step.motion); if(step.motion==='tea-sip')thirst=.2; if(step.motion===phase)controller.abort();
    }},'thirsty',()=>({thirst}));
    assert.equal(seen.at(-1),phase);
  }
});
