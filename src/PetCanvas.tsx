import { useEffect, useRef } from "react";
import { motionIntentForReaction } from "./pet-brain/adapters/motion";
import { PetStage3D, type StageRigKind, type StageSenseSample } from "./render/PetStage3D";
import type { MotionReaction } from "./types";

export interface PetCanvasProps {
  rig: StageRigKind;
  vrmUrl?: string;
  /** The same reaction string the sprite backend renders, so both stay in step. */
  reaction: MotionReaction;
  /** Read once per rendered frame; keep it cheap and side-effect free. */
  readSenses: () => StageSenseSample;
  onRigFallback?: (reason: string) => void;
  label: string;
}

/**
 * Thin React shell around `PetStage3D`.
 *
 * The stage is created once per rig and torn down explicitly. Only `reaction`
 * flows through props; cursor, velocity and grounding are pulled by the render
 * loop through `readSenses`, so a moving cursor never re-renders React.
 */
export function PetCanvas({ rig, vrmUrl, reaction, readSenses, onRigFallback, label }: PetCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<PetStage3D | null>(null);
  const sensesRef = useRef(readSenses);
  const fallbackRef = useRef(onRigFallback);
  const reactionRef = useRef(reaction);

  sensesRef.current = readSenses;
  fallbackRef.current = onRigFallback;
  reactionRef.current = reaction;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stage = new PetStage3D({
      container,
      rig,
      vrmUrl,
      initialIntent: motionIntentForReaction(reactionRef.current),
      readSenses: () => sensesRef.current(),
      onRigFallback: (reason) => fallbackRef.current?.(reason),
    });
    stageRef.current = stage;

    const observer = new ResizeObserver(() => stage.resize());
    observer.observe(container);
    const onVisibility = () => stage.setActive(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      stageRef.current = null;
      stage.dispose();
    };
  }, [rig, vrmUrl]);

  useEffect(() => {
    stageRef.current?.setIntent(motionIntentForReaction(reaction));
  }, [reaction]);

  return <div className="pet-canvas" ref={containerRef} role="img" aria-label={label} />;
}

export default PetCanvas;
