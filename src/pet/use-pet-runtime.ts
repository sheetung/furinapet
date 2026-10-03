import { bindPetEvents } from './events';
import { ListenerScope } from './listener-scope';
import { permitsExecution } from './execution-policy';
import { bindExecutionPolicy } from '../pet-brain/runtime';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { actionPlayback, ACTION_PRIORITY } from '../actions/coordinator';
import { listen } from "@tauri-apps/api/event";
import { characterRegistry, getCharacter, loadCharacterRegistry, type CharacterDefinition } from "../characters/registry";
import type { LookCell } from "../core/look-direction";
import { frameRows, motionPhase, type MotionReaction } from '../core/sprite-motion';
import { activityForMotion } from '../pet-brain/needs';
import { getCharacterArt } from '../characters/motion-assets';
import { animationClock } from '../animation/clock';
import { playClip } from '../animation/player';
import { InteractionController } from '../motion/interaction';
import { createBubbleLayoutPort, createInteractionPort, createWanderPort, desktopWrites, resetDesktop, motionAuthority } from '../platform/desktop-motion';
import { WindowResetController } from '../motion/window-reset';
import type { WorkArea } from '../core/wander-controller';
import { bubbles } from '../bubbles/controller';
import { BubbleLayoutController } from '../bubbles/layout-controller';
import { startWanderController } from '../motion/wander';
import { DockPolicyMemory } from '../motion/dock-policy';
import { requestSettling } from '../motion/settle-request';
import { PetBrain } from "../pet-brain";
import { planWanderGoal } from "../pet-brain/adapters/wander";
import { publishPetBrainSnapshot, executeReactionPlan } from "../pet-brain/runtime";
import type { AppSettings } from "../types";
export function usePetRuntime() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [characters, setCharacters] = useState<CharacterDefinition[]>(characterRegistry);
  const [reaction, setReaction] = useState<MotionReaction>("idle");
  const [animationEpoch, setAnimationEpoch] = useState(0);
  const [spriteCell, setSpriteCell] = useState<{ row: number; column: number; clipId?: string }>({ row: 0, column: 0 });
  const [look, setLook] = useState<LookCell | null>(null);
  const [bubble, setBubble] = useState(bubbles.snapshot());
  const [dragging, setDragging] = useState(false);
  const [bubblePlacement, setBubblePlacement] = useState<'above' | 'inside'>('above');
  useEffect(() => bubbles.subscribe(() => setBubble(bubbles.snapshot())), []);
  const reactionRef = useRef<MotionReaction>(reaction);
  const animationStartedAt = useRef(animationClock.now());
  const settingsRef = useRef(settings);
  const charactersRef = useRef(characters);
  const interactionRef = useRef<InteractionController | null>(null);
  const dockMemory = useRef(new DockPolicyMemory());
  const resetRef = useRef<WindowResetController | null>(null);
  const layoutRef = useRef<BubbleLayoutController | null>(null);
  if (!layoutRef.current) layoutRef.current = new BubbleLayoutController(createBubbleLayoutPort(), {
    authority: motionAuthority, queue: desktopWrites,
    dragging: () => interactionRef.current?.snapshot().dragging ?? false,
    cancelFall: () => interactionRef.current?.cancelFall(),
    placement: setBubblePlacement,
    report: error => console.warn('[pet] bubble layout failed', error),
  });
  const layout = layoutRef.current;
  const resizeForBubble = (expanded: boolean, scale: number) => layout.resize(expanded, scale);
  const brainRef = useRef<PetBrain | null>(null);
  if (!brainRef.current) brainRef.current = new PetBrain();
  if (!interactionRef.current) interactionRef.current = new InteractionController(createInteractionPort(), {
    authority: motionAuthority,
    settings: () => settingsRef.current,
    layoutBusy: () => layout.busy || !!resetRef.current?.busy,
    prepareRelease: () => resizeForBubble(!!bubbles.snapshot(), settingsRef.current?.scale ?? 1),
    pixelRatio: () => window.devicePixelRatio,
    now: () => animationClock.now(),
    schedule: (callback, delay) => animationClock.schedule(callback, delay),
    playback: actionPlayback,
    reaction: next => changeReaction(next, true),
    dragging: setDragging,
    dragStarted: () => dockMemory.current.beginDrag(),
    dragCompleted: moved => dockMemory.current.finishDrag(moved, Date.now()),
    clearLook: () => setLook(null),
    observeInteraction: () => {
      brainRef.current!.interrupt();
      brainRef.current!.observeUserInteraction(Date.now());
    },
    report: error => console.warn('[pet] interaction failed', error),
  });
  const interaction = interactionRef.current;
  if (!resetRef.current) resetRef.current = new WindowResetController({
    authority: motionAuthority,
    cancelMotion: () => {
      interaction.cancel();
      actionPlayback.stop();
      brainRef.current!.interrupt();
      layout.cancel();
      setLook(null);
      changeReaction('idle');
    },
    waitForDrag: () => interaction.waitForNativeDrag(),
    reset: resetDesktop,
  });
  useEffect(() => () => { interaction.cancel(); layout.cancel(); }, [interaction, layout]);
  useEffect(() => {
    const controller = resetRef.current!;
    const scope = new ListenerScope();
    const listener = listen<WorkArea>('pet-reset-position', scope.guard(event => {
      void controller.reset(event.payload).then(applied => {
        if (applied && scope.alive) return resizeForBubble(!!bubbles.snapshot(), settingsRef.current?.scale ?? 1);
      }).catch(error => console.warn('[pet] position reset failed', error));
    }));
    scope.add(listener, error => console.warn('[pet] reset listener failed', error));
    return () => { scope.dispose(); controller.cancel(); };
  }, []);


  useEffect(() => { reactionRef.current = reaction; }, [reaction]);
  useEffect(() => bindExecutionPolicy(priority => permitsExecution(settingsRef.current, priority)), []);
  useEffect(() => { charactersRef.current = characters; }, [characters]);

  useEffect(() => {
    let cancel = () => {};
    const tick = () => {
      const current = settingsRef.current;
      if (current) {
        const character = getCharacter(current.selectedCharacterId, charactersRef.current);
        const motion = motionPhase(reactionRef.current, animationClock.now() - animationStartedAt.current) === 'complete'
          ? 'idle' : reactionRef.current;
        brainRef.current!.blackboard.observeActivity(`${character.source}:${character.id}`,
          activityForMotion(motion, current.petVisible && character.id === 'furina' && character.source === 'built-in'), Date.now());
      }
      cancel = animationClock.schedule(tick, 250);
    };
    tick();
    return () => cancel();
  }, []);

  useEffect(() => {
    const scope = new ListenerScope();
    let revision = 0;
    const reload = () => {
      const current = ++revision;
      void loadCharacterRegistry().then(value => {
        if (scope.alive && current === revision) {
          charactersRef.current = value;
          setCharacters(value);
        }
      }).catch(error => console.warn('[pet] character registry failed', error));
    };
    reload();
    if ("__TAURI_INTERNALS__" in window) scope.add(listen('characters-changed', scope.guard(reload)),
      error => console.warn('[pet] character listener failed', error));
    return () => scope.dispose();
  }, [settings?.selectedCharacterId]);

  function changeReaction(next: MotionReaction, restart = false, startedAt = animationClock.now()) {
    if (reactionRef.current !== next || restart) animationStartedAt.current = startedAt;
    if (reactionRef.current !== next) {
      reactionRef.current = next;
      setReaction(next);
    } else if (restart) {
      setAnimationEpoch((value) => value + 1);
    }
  }

  useEffect(() => bindPetEvents({
    settingsRef, charactersRef, brainRef, interaction, setSettings: applySettings, setLook, changeReaction,
  }), []);

  function applySettings(next: AppSettings) {
    const previous = settingsRef.current;
    settingsRef.current = next;
    if (previous?.petVisible !== next.petVisible || previous?.selectedCharacterId !== next.selectedCharacterId) {
      interaction.cancel();
      layout.cancel();
      actionPlayback.stop();
      brainRef.current?.interrupt();
      actionPlayback.block('hidden', !next.petVisible);
      bubbles.setVisible(next.petVisible);
      setLook(null);
      changeReaction('idle');
    } else if (!next.autonomousBehavior && actionPlayback.snapshot().priority === ACTION_PRIORITY.background) {
      actionPlayback.stop();
      brainRef.current?.interrupt();
    }
    setSettings(next);
  }

  useLayoutEffect(() => {
    if (look) return;
    const character = getCharacter(settings?.selectedCharacterId ?? 'furina', charactersRef.current);
    const clip = getCharacterArt(character)?.clips[reaction] ?? frameRows[reaction];
    return playClip(clip, animationStartedAt.current, setSpriteCell);
  }, [reaction, animationEpoch, look?.index, settings?.selectedCharacterId]);

  useEffect(() => {
    if (!settings?.petVisible || dragging) return;
    void resizeForBubble(!!bubble, settings.scale);
  }, [!!bubble, settings?.scale, settings?.petVisible, settings?.selectedCharacterId]);

  useEffect(() => startWanderController(createWanderPort(), {
    dockMemory: dockMemory.current,
    dockSitting: () => !!getCharacterArt(getCharacter(settingsRef.current?.selectedCharacterId ?? 'furina', charactersRef.current)),
    authority: motionAuthority,
    settings: () => settingsRef.current,
    profile: () => getCharacter(settingsRef.current?.selectedCharacterId ?? 'furina', charactersRef.current).wanderProfile!,
    reaction: () => reactionRef.current,
    playback: actionPlayback,
    layoutEpoch: () => layout.revision,
    layoutBusy: () => layout.busy || !!resetRef.current?.busy,
    motion: () => interaction.snapshot(),
    now: () => animationClock.now(),
    wallNow: () => Date.now(),
    pixelRatio: () => window.devicePixelRatio,
    schedule: (callback, delay) => animationClock.schedule(callback, delay),
    observeCursor: observation => brainRef.current!.blackboard.observeCursor(observation),
    needsRest: () => brainRef.current!.blackboard.getNeeds().recovering,
    plan: input => {
      const goal = planWanderGoal(brainRef.current!, input,
        plan => {
          // Keep genuine idle available for gaze rather than decorating it with a gesture.
          if (plan.goal === 'idle' && brainRef.current!.blackboard.cursorAttention(input.now) > 0) return;
          void executeReactionPlan(plan, ACTION_PRIORITY.background);
        });
      publishPetBrainSnapshot();
      return goal;
    },
    changeReaction,
    setLook: next => setLook(previous => previous?.index === next?.index ? previous : next),
    settle: settleWithGravity,
  }), []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window) || !settings?.gravityEnabled) return;
    return requestSettling({
      schedule: (callback, delay) => animationClock.schedule(callback, delay),
      enabled: () => !!settingsRef.current?.petVisible && !!settingsRef.current.gravityEnabled,
      falling: () => interaction.snapshot().falling,
      settle: () => interaction.settle(),
    });
  }, [settings, !!bubble, dragging]);

  async function settleWithGravity() { await interaction.settle(); }

  return { settings, characters, reaction, spriteCell, look, bubble, bubblePlacement, interaction };
}
