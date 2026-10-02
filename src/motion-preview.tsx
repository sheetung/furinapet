import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MotionReaction } from './core/sprite-motion';
import { sampleClip, clipPhase } from './animation/clip';
import { animationClock } from './animation/clock';
import { replacementStyle } from './core/motion-art';
import { furinaArt } from './characters/motion-assets';
import original from '../characters/furina/spritesheet.webp';
import './motion-preview.css';
import './pet.css';
import { motionCatalog } from './actions/catalog';

function Sprite({ row, column, clipId, refreshed }: { row: number; column: number; clipId?: string; refreshed: boolean }) {
  const frame = refreshed ? furinaArt.frame(row, column, clipId) : null;
  return <div className="preview-sprite" role="img" aria-label={`${refreshed ? '新版' : '旧版'} 第 ${column + 1} 帧`}
    style={frame ? undefined : { backgroundImage: `url("${original}")`, backgroundPosition: `${-column * 192}px ${-row * 208}px` }}>
    {frame && <div className="preview-art" style={replacementStyle(frame, furinaArt.assets[frame.asset])} />}
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
    let last = animationClock.now();
    let cancel = () => {};
    const tick = () => {
      const now = animationClock.now();
      const delta = now - last;
      last = now;
      setElapsed(value => value + delta);
      cancel = animationClock.schedule(tick, 0);
    };
    cancel = animationClock.schedule(tick, 0);
    return () => cancel();
  }, [playing]);
  const spec = furinaArt.clips[action];
  const cell = sampleClip(spec, elapsed);
  return <main className={dark ? 'dark' : ''}>
    <h1>芙宁娜 · 旧版动作替换</h1>
    <p>实际尺寸 192 × 208；与桌宠共用帧采样和裁切。单次动作结束后回到待机。</p>
    <nav><label>动作 <select value={action} onChange={e => { setAction(e.target.value as MotionReaction); setElapsed(0); }}>
      {motionCatalog.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label><button onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button>
    <button onClick={() => setElapsed(0)}>重播</button><button onClick={() => setDark(!dark)}>切换明暗背景</button></nav>
    <section className="comparison"><article><h2>{spec.clipId ? '待机对照（无旧版对应动作）' : '旧图集'}</h2><Sprite row={spec.clipId ? 0 : cell.row} column={spec.clipId ? 0 : cell.column} refreshed={false} /></article>
    <article><h2>替换图集</h2><Sprite {...cell} refreshed /></article></section>
    <p>当前：行 {cell.row}，帧 {cell.column + 1} · {{ motion: '运动段', hold: '停顿段', complete: '已结束' }[clipPhase(spec, elapsed)]}</p>
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
        <Sprite row={spec.row} column={column} clipId={spec.clipId} refreshed /><span>步骤 {index + 1} · {spec.durations[index]} ms</span></button>;
    })}</section>
    <p>本页只验证图像和播放，不模拟原生窗口拖拽、重力或鼠标穿透。</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
