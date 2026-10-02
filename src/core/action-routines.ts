import type { Reaction } from '../types';
import type { GestureMotion } from './sprite-motion';

export const ROUTINE_EVENT = 'pet-action-routine';
export interface RoutineStep { reaction: Reaction; durationMs: number; message?: string; motion?: GestureMotion }
export const routines = [
  {id:'welcome',label:'欢迎回来',icon:'👋',description:'先注意到你，再挥手问好',steps:[
    {reaction:'review',durationMs:850},
    {reaction:'waving',durationMs:1700,message:'欢迎回来，今天过得怎么样？'},
    {reaction:'idle',durationMs:1200},
  ]},
  {id:'encourage',label:'鼓励加油',icon:'✨',description:'认真倾听，再为你打气',steps:[
    {reaction:'review',durationMs:1200,message:'先做眼前这一小步就好。'},
    {reaction:'idle',durationMs:450},
    {reaction:'jumping',durationMs:1000,message:'加油，我为你喝彩！'},
    {reaction:'waving',durationMs:1000},
  ]},
  {id:'comfort',label:'安慰一下',icon:'💙',description:'温和回应，安静陪一会儿',steps:[
    {reaction:'waiting',durationMs:1800,message:'不顺利也没关系，先缓一缓。'},
    {reaction:'waving',durationMs:1000,message:'我在这里陪着你。'},
    {reaction:'idle',durationMs:2400},
  ]},
  {id:'focus',label:'一起思考',icon:'🔍',description:'观察、停顿，再安静等待',steps:[
    {reaction:'review',durationMs:2100,message:'把问题拆小一点，先看第一步。'},
    {reaction:'idle',durationMs:700},
    {reaction:'review',durationMs:1400},
    {reaction:'waiting',durationMs:1800,message:'你慢慢想，我不打扰。'},
  ]},
  {id:'break',label:'休息一下',icon:'☕',description:'招呼你停一停，放松后再继续',steps:[
    {reaction:'waving',durationMs:1100,message:'休息一下，看看远处吧。'},
    {reaction:'waiting',durationMs:3500,message:'放松肩膀，喝口水。'},
    {reaction:'idle',durationMs:1600},
  ]},
  {id:'double-blink',label:'眨眨眼',icon:'😉',description:'轻轻闭眼、睁眼，再眨一下',steps:[
    {reaction:'idle',motion:'double-blink',durationMs:1530},
  ]},
  {id:'curious',label:'歪头观察',icon:'🧐',description:'托腮、侧看、歪头，再回正',steps:[
    {reaction:'review',motion:'curious',durationMs:2700},
  ]},
  {id:'doze',label:'闭眼小憩',icon:'💤',description:'站立闭眼休息，随后睁眼；不是躺卧睡眠新图',steps:[
    {reaction:'idle',motion:'doze',durationMs:5800},
    {reaction:'idle',motion:'double-blink',durationMs:1530},
  ]},
  {id:'celebrate',label:'开心庆祝',icon:'🎉',description:'轻跳、停顿、挥手致意',steps:[
    {reaction:'jumping',durationMs:840,message:'太棒了，值得庆祝！'},
    {reaction:'idle',durationMs:350},
    {reaction:'waving',durationMs:1180},
    {reaction:'idle',motion:'double-blink',durationMs:1530},
  ]},
] satisfies {id:string;label:string;icon:string;description:string;steps:RoutineStep[]}[];
