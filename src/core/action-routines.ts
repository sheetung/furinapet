import { normalizeStep, type ActionStep } from './action-step';

export const ROUTINE_EVENT = 'pet-action-routine';
export type RoutineStep = ActionStep;
export interface ActionRoutine { id: string; label: string; icon: string; description: string; steps: RoutineStep[] }

/** A gesture always gets its complete frame sequence; extra time remains a neutral hold. */
export const completeStep = normalizeStep;

const definitions: ActionRoutine[] = [
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
  {id:'greeting',label:'低头致意',icon:'🎩',description:'抬手、低头致意，再收手回正',steps:[
    {reaction:'waving',motion:'greeting',durationMs:2270},
  ]},
  {id:'sitting',label:'坐下晃腿',icon:'🪑',description:'坐下交替晃腿，闭眼休息后起身',steps:[
    {reaction:'waiting',motion:'sitting',durationMs:4610},
  ]},
  {id:'stretch-yawn',label:'伸懒腰打哈欠',icon:'🥱',description:'双臂伸展，再掩嘴打哈欠',steps:[
    {reaction:'idle',motion:'stretch-yawn',durationMs:3600},
  ]},
  {id:'tea',label:'品茶时光',icon:'🫖',description:'举杯、闭眼轻饮、放回杯碟；茶具出入过渡待精修',steps:[
    {reaction:'waiting',motion:'tea',durationMs:4150},
  ]},
  {id:'cake',label:'享用蛋糕',icon:'🍰',description:'举叉、尝一口、满足地放下叉子',steps:[
    {reaction:'waiting',motion:'cake',durationMs:0},
  ]},
  {id:'proud',label:'叉腰得意',icon:'✨',description:'双手叉腰，闭眼得意，再偷偷看你',steps:[
    {reaction:'review',motion:'proud',durationMs:0},
  ]},
];

export const routines = definitions.map(routine => ({ ...routine, steps: routine.steps.map(completeStep) }));
