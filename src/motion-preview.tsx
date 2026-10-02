import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { frameRows, sampleMotion, type MotionReaction } from './core/sprite-motion';
import { replacementFrame, replacementStyle } from './core/motion-art';
import { motionAssets } from './characters/motion-assets';
import original from '../characters/furina/spritesheet.webp';
import './motion-preview.css';
import './pet.css';
import { routines } from './core/action-routines';

const actions = { idle: '待机', waving: '挥手', jumping: '开心跳', review: '思考', airborne: '持续上移', falling: '持续下落', 'double-blink': '眨眨眼', curious: '歪头观察', doze: '闭眼小憩', greeting: '低头致意', sitting: '坐下晃腿', 'stretch-yawn': '伸懒腰打哈欠', tea: '品茶时光' };
function Sprite({ row, column, refreshed }: { row: number; column: number; refreshed: boolean }) {
  const frame = refreshed ? replacementFrame('furina', 'built-in', row, column) : null;
  return <div className="preview-sprite" role="img" aria-label={`${refreshed ? '新版' : '旧版'} 第 ${column + 1} 帧`}
    style={frame ? undefined : { backgroundImage: `url("${original}")`, backgroundPosition: `${-column * 192}px ${-row * 208}px` }}>
    {frame && <div className="preview-art" style={replacementStyle(frame, motionAssets[frame.asset])} />}
  </div>;
}
function Preview() {
  const [visible, setVisible] = useState(true);
  const [action, setAction] = useState<MotionReaction>('idle');
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setElapsed(value => value + delta);
    }, 30);
    return () => clearInterval(timer);
  }, [playing]);
  const spec = frameRows[action];
  const cell = sampleMotion(action, elapsed);
  return <main className={dark ? 'dark' : ''}>
    <h1>芙宁娜 · 旧版动作替换</h1>
    <p>实际尺寸 192 × 208；与桌宠共用帧采样和裁切。单次动作结束后回到待机。</p>
    <nav><label>动作 <select value={action} onChange={e => { setAction(e.target.value as MotionReaction); setElapsed(0); }}>
      {Object.entries({ ...actions, ...Object.fromEntries(routines.filter(r => r.steps.length === 1 && r.steps[0].motion).map(r => [r.steps[0].motion!, r.label])) }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label><button onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button>
    <button onClick={() => setElapsed(0)}>重播</button><button onClick={() => setDark(!dark)}>切换明暗背景</button></nav>
    <section className="comparison"><article><h2>{spec.row >= 11 ? '待机对照（无旧版对应动作）' : '旧图集'}</h2><Sprite row={spec.row >= 11 ? 0 : cell.row} column={spec.row >= 11 ? 0 : cell.column} refreshed={false} /></article>
    <article><h2>替换图集</h2><Sprite {...cell} refreshed /></article></section>
    <p>当前：行 {cell.row}，帧 {cell.column + 1}{cell.nextMs === null ? '（已结束）' : ''}</p>
    <h2>拖拽与显隐过渡</h2>
    <button onClick={() => setVisible(value => !value)}>{visible ? '预览隐藏' : '预览显示'}</button>
    <button onClick={() => { setAction('dragged'); setElapsed(0); setPlaying(true); }}>预览被拖拽</button>
    <div style={{ width: 192, height: 208, position: 'relative', overflow: 'hidden' }}>
      <div className={visible ? 'pet-visible' : 'pet-hiding'} style={{ position: 'absolute', inset: 0 }}>
        <div className={`pet-body ${action === 'dragged' ? 'pet-dragged' : ''}`}><Sprite {...cell} refreshed /></div>
      </div>
    </div>
    <h2>逐帧检查</h2><section className="frames">{spec.durations.map((_, index) => {
      const column = spec.columns?.[index] ?? index;
      return <button className="frame" key={index} onClick={() => { setPlaying(false); setElapsed(spec.durations.slice(0, index).reduce((a, b) => a + b, 0)); }}>
        <Sprite row={spec.row} column={column} refreshed /><span>步骤 {index + 1} · {spec.durations[index]} ms</span></button>;
    })}</section>
    <p>本页只验证图像和播放，不模拟原生窗口拖拽、重力或鼠标穿透。</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
