import { listen, type Event } from '@tauri-apps/api/event';
import { ROUTINE_EVENT, getCharacterActions, type RoutineStep } from '../actions/catalog';
import { actionPlayback, ACTION_PRIORITY } from '../actions/coordinator';
import { desktop } from '../api';
import { getCharacter, type CharacterDefinition } from '../characters/registry';
import { resolveCharacterStep } from '../characters/action-resolver';
import { resolveMotion, type MotionReaction } from '../core/sprite-motion';
import { motionAuthority, desktopWrites } from '../platform/desktop-motion';
import { bubbles, BUBBLE_EVENT, type BubbleRequest } from '../bubbles/controller';
import type { InteractionController } from '../motion/interaction';
import type { PetBrain } from '../pet-brain';
import type { AppSettings, ReactionEvent } from '../types';
import { ListenerScope } from './listener-scope';
import { permitsExecution } from './execution-policy';

export function bindPetEvents({ settingsRef, charactersRef, brainRef, interaction, setSettings, setLook, changeReaction }: {
  settingsRef: { current: AppSettings | null };
  charactersRef: { current: CharacterDefinition[] };
  brainRef: { current: PetBrain | null };
  interaction: InteractionController;
  setSettings(value: AppSettings): void;
  setLook(value: null): void;
  changeReaction(next: MotionReaction, restart?: boolean, startedAt?: number): void;
}) {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const scope = new ListenerScope();
    const scopedListen = <T>(name: string, handler: (event: Event<T>) => void) => listen<T>(name, scope.guard(handler));
    let settingsChanged = false;
    const report = (error: unknown) => console.warn('[pet] event bridge failed', error);
    void desktop.getSettings().then(value => {
      if (scope.alive && !settingsChanged) setSettings(value);
    }).catch(report);
    const clearResolver = actionPlayback.setResolver(step => resolveCharacterStep(step,
      getCharacter(settingsRef.current?.selectedCharacterId ?? 'furina', charactersRef.current)));
    const applyReaction = (payload:RoutineStep) => {
      motionAuthority.cancel('wander', 'gravity');
      desktopWrites.invalidate();
      interaction.cancelFall();
      setLook(null);
      const character = getCharacter(settingsRef.current?.selectedCharacterId ?? 'furina', charactersRef.current);
      changeReaction(resolveMotion(payload, character.id, character.source), true, payload.startedAt);
      if (payload.message?.trim()) bubbles.show({ id: 'action-hint', text: payload.message });
    };
    const unsubscribe = actionPlayback.subscribe(applyReaction);
    const registrations = [
      scopedListen<BubbleRequest & { dismiss?: boolean }>(BUBBLE_EVENT, event => {
        if (event.payload?.dismiss) bubbles.dismiss(event.payload.id);
        else bubbles.show(event.payload);
      }),
      scopedListen<unknown>(ROUTINE_EVENT, (event) => {
        if(event.payload==='stop'){actionPlayback.stop();brainRef.current?.interrupt();return;}
        if(!settingsRef.current?.petVisible)return;
        const character = getCharacter(settingsRef.current.selectedCharacterId, charactersRef.current);
        const routine = getCharacterActions(character).routines.find(item => item.id === event.payload);
        if (routine && actionPlayback.canStart(ACTION_PRIORITY.user)) {
          brainRef.current?.observeUserInteraction(Date.now());
          void actionPlayback.request({ actionId: routine.id, source: 'user', steps: routine.steps });
        }
      }),
      scopedListen<AppSettings>("settings-changed", (event) => { settingsChanged = true; setSettings(event.payload); }),
      scopedListen<ReactionEvent>("pet-reaction", (event) => {
        if (!permitsExecution(settingsRef.current, event.payload.manual ? ACTION_PRIORITY.user : ACTION_PRIORITY.background)) return;
        if (event.payload.manual && actionPlayback.canStart(ACTION_PRIORITY.user)) {
          brainRef.current?.observeUserInteraction(Date.now());
        }
        void actionPlayback.request({ actionId: `reaction:${event.payload.reaction}`,
          source: event.payload.manual ? 'user' : 'background',
          steps: [{ ...event.payload, durationMs: event.payload.durationMs ?? 2600 }] });
      }),
    ];
    for (const registration of registrations) scope.add(registration, report);
    return () => { scope.dispose(); unsubscribe(); actionPlayback.stop(); clearResolver(); };
}
