import type { MotionArtFrame } from '../../src/core/motion-art';
import type { MotionReaction } from '../../src/core/sprite-motion';
import { furinaClips } from './clips';
import { standardSheetFrameCounts } from './standard-sheets';

type SheetId = keyof typeof standardSheetFrameCounts;
const rowSheets: Partial<Record<number, SheetId>> = {
  0: 'idle', 1: 'run-right', 2: 'run-left', 3: 'waving', 4: 'jumping',
  5: 'failed', 6: 'waiting', 7: 'running', 8: 'review',
};

/** All built-in art is baked into 192x208 cells on a 4x4 sheet. */
export function replacementFrame(characterId: string, source: string | undefined,
  row: number, column: number, clipId?: string, motion?: MotionReaction | 'gaze'): MotionArtFrame | null {
  if (characterId !== 'furina' || source !== 'built-in' || !Number.isInteger(column) || column < 0) return null;
  let sheet: string | undefined;
  let index = column;
  if ((row === 9 || row === 10) && clipId === undefined) {
    if (column >= 8) return null;
    sheet = 'gaze';
    index += (row - 9) * 8;
  } else {
    sheet = clipId === 'stretch' ? 'stretch-yawn' : clipId ?? rowSheets[row];
    if (motion && motion !== 'gaze') {
      const clip = furinaClips[motion];
      // Neutral completion frames belong to idle, even after an extension clip.
      if (clip.row === row && clip.clipId === clipId) sheet = motion;
    }
  }
  if (!sheet || !Object.hasOwn(standardSheetFrameCounts, sheet)) return null;
  const id = sheet as SheetId;
  if (index >= standardSheetFrameCounts[id]) return null;
  const baseline = id === 'dock-sitting' ? 158 : 200;
  return { asset: id, atlasWidth: 768, atlasHeight: 832,
    x: (index % 4) * 192, y: Math.floor(index / 4) * 208, width: 192, height: 208,
    anchorX: 96, anchorY: baseline, targetY: baseline, scale: 1 };
}
