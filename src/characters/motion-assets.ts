import { replacementFrame } from '../../characters/furina/art';
import type { MotionArtFrame } from '../core/motion-art';
import type { MotionReaction } from '../core/sprite-motion';
import { furinaClips } from '../../characters/furina/clips';
import type { AnimationClip } from '../animation/clip';

const sheets = import.meta.glob<string>('../../characters/furina/animations/standard/*.png', {
  eager: true, import: 'default', query: '?url',
});
const assets = Object.fromEntries(Object.entries(sheets).map(([path, url]) => [
  path.substring(path.lastIndexOf('/') + 1, path.length - 4), url,
]));

export interface CharacterArt {
  clips: Readonly<Record<MotionReaction, AnimationClip>>;
  assets: Readonly<Record<string, string>>;
  frame(row: number, column: number, clipId?: string, motion?: MotionReaction | 'gaze'): MotionArtFrame | null;
}

export const furinaArt: CharacterArt = {
  clips: furinaClips,
  assets,
  frame: (row, column, clipId, motion) => replacementFrame('furina', 'built-in', row, column, clipId, motion),
};

export function getCharacterArt(character: { id: string; source?: string }): CharacterArt | null {
  return character.id === 'furina' && character.source === 'built-in' ? furinaArt : null;
}
