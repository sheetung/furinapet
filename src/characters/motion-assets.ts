import idle from '../../characters/furina/animations/idle-v2.png';
import waving from '../../characters/furina/animations/waving-v2.png';
import jumping from '../../characters/furina/animations/jumping-v2.png';
import review from '../../characters/furina/animations/review-v2.png';

import greeting from '../../characters/furina/animations/drafts/greeting-v1.png';
import sitting from '../../characters/furina/animations/sitting-stool-v2.png';
import dockSitting from '../../characters/furina/animations/dock-sitting-v1.png';
import stretch from '../../characters/furina/animations/drafts/stretch-yawn-v1.png';
import tea from '../../characters/furina/animations/drafts/tea-v1.png';

import cake from '../../characters/furina/animations/drafts/cake-v1.png';
import proud from '../../characters/furina/animations/drafts/proud-v1.png';
import { replacementFrame } from '../../characters/furina/art';
import type { MotionArtFrame } from '../core/motion-art';
import { furinaClips } from '../../characters/furina/clips';
import type { AnimationClip } from '../animation/clip';
import type { MotionReaction } from '../core/sprite-motion';

export interface CharacterArt {
  clips: Readonly<Record<MotionReaction, AnimationClip>>;
  assets: Readonly<Record<string, string>>;
  frame(row: number, column: number, clipId?: string): MotionArtFrame | null;
}

export const furinaArt: CharacterArt = {
  clips: furinaClips,
  assets: { idle, waving, jumping, review, greeting, sitting, stretch, tea, cake, proud, 'dock-sitting': dockSitting },
  frame: (row, column, clipId) => replacementFrame('furina', 'built-in', row, column, clipId),
};

export function getCharacterArt(character: { id: string; source?: string }): CharacterArt | null {
  return character.id === 'furina' && character.source === 'built-in' ? furinaArt : null;
}
