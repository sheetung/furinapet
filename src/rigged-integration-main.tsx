import {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PetBody} from './components/PetBody';
import {deliverRigPlan} from './neuro/motion/rigged-bridge';
import type {MotorPlan} from './neuro/contracts/motor-plan';
import spriteUrl from '../characters/furina/spritesheet.webp?url';
import './pet.css';
function Harness(){
  const [enabled,setEnabled]=useState(true);const [broken,setBroken]=useState(false);const [reaction,setReaction]=useState('idle');
  const [last,setLast]=useState('等待指令');const abort=useRef<AbortController|null>(null);
  const send=(actions:MotorPlan['actions'],source:MotorPlan['source']='rule')=>{
    abort.current?.abort();abort.current=new AbortController();
    const plan={actions,source,durationMs:15000,confidence:1};deliverRigPlan(plan,abort.current.signal);setLast(JSON.stringify(plan,null,2));
  };
  return <main style={{font:'16px system-ui',color:'#e5edff',background:'#17263d',minHeight:'100vh',padding:24}}>
    <h1>Furina 项目对接验证</h1><p>使用与 PetView 相同的 PetBody、GLB 控制器和 MotorPlan 通道；不调用原生窗口移动。</p>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用 GLB</label>
    <label><input type="checkbox" checked={broken} onChange={e=>setBroken(e.target.checked)}/>模拟加载失败</label>
    <div><button onClick={()=>send([{type:'gesture',gesture:'wave',weight:1},{type:'expression',expression:'happy',intensity:.8}])}>挥手＋开心</button>
    <button onClick={()=>send([{type:'recoil',from:'pointer',strength:1}],'reflex')}>反射后缩</button>
    <button onClick={()=>send([{type:'step',direction:'left',distance:1}])}>缺失动作保留 GLB</button>
    <button onClick={()=>{abort.current?.abort();setLast('已取消');}}>取消动作</button>
    <button onClick={()=>setReaction(reaction==='idle'?'waving':'idle')}>旧版 reaction 通道</button></div>
    <div>{['idle','jumping','run-left','run-right','review'].map(value=><button key={value} onClick={()=>{abort.current?.abort();setReaction(value);}}>{value}</button>)}</div>
    <div style={{position:'relative',height:440,width:460,background:'#293e59',marginTop:20}}>
      <PetBody key={`${enabled}-${broken}`} enabled={enabled} reaction={reaction} scale={2} assetUrl={broken?'/missing-model.glb':undefined}
        fallback={<div className="sprite" aria-label="旧版精灵回退" style={{backgroundImage:`url(${spriteUrl})`,backgroundPosition:'0 0',transform:'scale(2)'}}/>}/>
    </div><pre>{last}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
