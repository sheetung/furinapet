import { clampWeight, type MotorPlan } from '../contracts/motor-plan';

export interface RigCommand {
  motion: 'none' | 'bounce' | 'walk' | 'think';
  clip: 'idle' | 'wave' | 'recoil' | 'walk' | 'jump' | 'cheer' | 'think';
  expression: 'neutral' | 'happy' | 'surprised' | 'annoyed' | 'tired';
  intensity: number;
  lean: number;
  look: number;
  durationMs: number;
  unsupported: string[];
}

export function commandForPlan(plan: MotorPlan): RigCommand {
  const result: RigCommand = {motion:'none',clip:'idle', expression:'neutral', intensity:1,
    lean:0, look:0, durationMs:Number.isFinite(plan.durationMs) ? Math.max(100,Math.min(30000,plan.durationMs)) : 1000,
    unsupported:[]};
  for (const action of plan.actions) {
    switch (action.type) {
      case 'recoil': result.clip='recoil'; break;
      case 'gesture':
        if (action.gesture==='wave') { if (result.clip!=='recoil') result.clip='wave'; }
        else if(action.gesture==='cheer') {
          result.motion='bounce';if(result.clip!=='recoil')result.clip='cheer';
          if(!plan.actions.some(a=>a.type==='expression'))result.expression='happy';
        }
        else result.unsupported.push(`gesture:${action.gesture}`);
        break;
      case 'expression':
        if (action.expression==='sad') result.unsupported.push('expression:sad');
        else { result.expression=action.expression; result.intensity=clampWeight(action.intensity); }
        break;
      case 'idleStyle':
        if (!plan.actions.some(a=>a.type==='expression')) {
          result.expression=action.style==='sleepy'?'tired':action.style==='sulk'?'annoyed':'neutral';
          result.intensity=clampWeight(action.weight);
        }
        break;
      case 'lean':
        if(action.direction==='forward'||action.direction==='back') result.unsupported.push(`lean:${action.direction}`);
        else result.lean=(action.direction==='left'?-1:1)*clampWeight(action.weight)*.06;
        break;
      case 'turn': result.lean=(action.direction==='left'?-1:1)*clampWeight(action.weight)*.04; break;
      case 'lookAt': result.look=clampWeight(action.weight); break;
      case 'lookAway': result.look=-clampWeight(action.weight); break;
      default: result.unsupported.push(action.type);
    }
  }
  // Window locomotion stays in PetView, never in model-local coordinates.
  if (plan.locomotion) result.unsupported.push(`locomotion:${plan.locomotion}`);
  return result;
}

/** Approximate missing authored clips on the same body, never swap character art. */
export function commandForReaction(reaction:string):RigCommand {
  const result=commandForPlan({actions:[],durationMs:1000,confidence:1});
  switch(reaction){
    case 'idle':break;
    case 'waving':result.clip='wave';break;
    case 'failed':result.clip='recoil';result.expression='annoyed';break;
    case 'waiting':result.expression='tired';break;
    case 'jumping':result.clip='jump';result.motion='bounce';result.expression='happy';break;
    case 'running':case 'run-left':case 'run-right':result.clip='walk';result.motion='walk';break;
    case 'review':result.clip='think';result.motion='think';break;
    default:result.unsupported.push(`reaction:${reaction}`);
  }
  return result;
}

export type RigMessage = {type:'plan'; id:number; plan:MotorPlan} | {type:'cancel'; id:number};
const listeners = new Set<(message:RigMessage)=>void>();
let sequence=0;
export function subscribeRigPlans(listener:(message:RigMessage)=>void):()=>void {
  listeners.add(listener); return ()=>{listeners.delete(listener);};
}
/** Pet-window-local fanout. It does not suppress the existing desktop reaction. */
export function deliverRigPlan(plan:MotorPlan, signal?:AbortSignal):()=>void {
  if (signal?.aborted) return ()=>{};
  const id=++sequence;
  const dispatch=(message:RigMessage)=>listeners.forEach(listener=>{
    try { listener(message); } catch (error) { console.warn('[rigged-body]',error); }
  });
  dispatch({type:'plan',id,plan});
  let finished=false;
  const cancel=()=>{
    if(finished)return;
    finished=true;signal?.removeEventListener('abort',cancel);dispatch({type:'cancel',id});
  };
  signal?.addEventListener('abort',cancel,{once:true});
  return cancel;
}
