import { cursorPosition, currentMonitor, getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import type { BubbleLayoutPort } from '../bubbles/layout-controller';
import type { WanderPort } from '../motion/wander';
import type { InteractionPort } from '../motion/interaction';
import { desktop } from '../api';
import type { GravityPort } from '../motion/gravity';
import { MotionWriteQueue } from '../motion/write-queue';
import { MotionAuthority } from '../motion/authority';
import { resetTarget } from '../motion/window-reset';
import type { WorkArea } from '../core/wander-controller';
export const desktopWrites = new MotionWriteQueue();
export const motionAuthority = new MotionAuthority();
export function createBubbleLayoutPort(): BubbleLayoutPort {
  return {
    read: async () => {
      const petWindow = getCurrentWindow();
      const [factor, position, size] = await Promise.all([
        petWindow.scaleFactor(), petWindow.outerPosition(), petWindow.outerSize(),
      ]);
      let top = position.y;
      try {
        top = (await desktop.getWorkAreaAt(Math.round(position.x + size.width / 2), Math.round(position.y + size.height / 2))).y;
      } catch {
        const monitor = await currentMonitor();
        if (monitor) top = monitor.position.y;
      }
      return { ...position, ...size, factor, workAreaTop: top };
    },
    apply: async next => {
      const petWindow = getCurrentWindow();
      await petWindow.setSize(new PhysicalSize(next.width, next.height));
      await petWindow.setPosition(new PhysicalPosition(next.x, next.y));
    },
  };
}
export async function resetDesktop(area: WorkArea, valid: () => boolean) {
  await desktopWrites.enqueue(async () => {
    const window = getCurrentWindow();
    const size = await window.outerSize();
    if (!valid()) return;
    const point = resetTarget(area, size);
    await window.setPosition(new PhysicalPosition(point.x, point.y));
  }, valid, 'layout');
}
export function createInteractionPort(): InteractionPort {
  return {
    position: () => getCurrentWindow().outerPosition(),
    startDragging: () => getCurrentWindow().startDragging(),
    waitForRelease: () => desktop.waitForDragRelease().then(() => {}),
    drain: () => desktopWrites.drain(),
    invalidate: () => desktopWrites.invalidate(),
    gravity: createGravityPort,
  };
}
export function createWanderPort(): WanderPort {
  const window = getCurrentWindow();
  return {
    position: () => window.outerPosition(),
    size: () => window.outerSize(),
    surfaces: () => desktop.listDockSurfaces(),
    cursor: () => cursorPosition(),
    move: moveDesktop,
    workArea: async (position, size) => {
      try {
        return await desktop.getWorkAreaAt(Math.round(position.x + size.width / 2), Math.round(position.y + size.height / 2));
      } catch {
        const monitor = await currentMonitor();
        return monitor
          ? { ...monitor.position, ...monitor.size }
          : { ...position, ...size };
      }
    },
  };
}
export function moveDesktop(point: { x: number; y: number }, valid: () => boolean) {
  const target = { ...point };
  return desktopWrites.enqueue(() => getCurrentWindow().setPosition(new PhysicalPosition(target.x, target.y)), valid);
}

export function createGravityPort(valid: () => boolean = () => true): GravityPort {
  const window = getCurrentWindow();
  return {
    position: () => window.outerPosition(),
    size: () => window.outerSize(),
    move: async point => { await moveDesktop(point, valid); },
    workArea: async (position, size) => {
      try {
        return await desktop.getWorkAreaAt(Math.round(position.x + size.width / 2), Math.round(position.y + size.height / 2));
      } catch {
        const monitor = await currentMonitor();
        if (!monitor) throw new Error('No desktop work area available');
        return { x: monitor.position.x, y: monitor.position.y, width: monitor.size.width, height: monitor.size.height };
      }
    },
  };
}
