import { Cerebellum, IDLE_INTENT, type MotionSenses } from "./Cerebellum";
import { JointMixer } from "./JointMixer";
import { defaultJointLimits } from "./limits";
import { measureArms } from "./rig/metrics";
import { AimIK } from "./solvers/AimIK";
import { Procedural } from "./solvers/Procedural";
import { TwoBoneIK } from "./solvers/TwoBoneIK";
import { ARM_CHAINS, type MotionIntent, type MotionTarget, type SkeletonRig } from "./types";

/** Motion runs at a fixed rate so springs and oscillators are frame-rate independent. */
export const FIXED_STEP = 1 / 120;
/** Beyond this the frame is treated as a stall and the backlog is dropped. */
const MAX_SUBSTEPS = 8;

export interface MotionDiagnostics {
  intent: MotionIntent;
  gazeYaw: number;
  gazePitch: number;
  handWeights: { left: number; right: number };
  overreach: { left: number; right: number };
  substeps: number;
}

/**
 * The "Motion Controller" box: it owns the fixed-step clock and the order the
 * stages run in. That order is the contract, and it matches the pipeline exactly —
 * intent, then the three solvers writing into one mixer, then a single resolve, and
 * only then the rig's own constraint and spring pass.
 *
 * Nothing between `Cerebellum` and `rig.update` touches a bone directly.
 */
export class MotionController {
  private readonly mixer = new JointMixer(defaultJointLimits);
  private readonly cerebellum = new Cerebellum();
  private readonly aim = new AimIK();
  private readonly leftArm = new TwoBoneIK();
  private readonly rightArm = new TwoBoneIK();
  private readonly procedural = new Procedural();
  private rig: SkeletonRig | null = null;
  private accumulator = 0;
  private lastSubsteps = 0;
  private motion: MotionTarget | null = null;

  setRig(rig: SkeletonRig | null) {
    this.rig = rig;
    this.mixer.reset();
    this.accumulator = 0;
    if (rig) this.cerebellum.setMetrics({ height: rig.height, arms: measureArms(rig) });
  }

  setIntent(intent: MotionIntent) {
    this.cerebellum.setIntent(intent);
  }

  /** Advance the pipeline by one rendered frame. */
  update(frameDelta: number, senses: MotionSenses) {
    const rig = this.rig;
    if (!rig) return;

    this.accumulator += Math.min(Math.max(frameDelta, 0), 0.25);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
      this.substep(rig, senses);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps >= MAX_SUBSTEPS) this.accumulator = 0;
    this.lastSubsteps = steps;

    // Spring bones and node constraints consume the pose we just wrote, and they
    // need the real elapsed time rather than the fixed step.
    rig.update(frameDelta);
  }

  private substep(rig: SkeletonRig, senses: MotionSenses) {
    // Solvers read world transforms; refresh them so a substep sees the previous one.
    rig.root.updateMatrixWorld(true);

    const motion = this.cerebellum.step(FIXED_STEP, senses);
    this.motion = motion;
    this.procedural.step(FIXED_STEP, motion);

    this.aim.solve(rig, motion, this.mixer);

    if (motion.hands.left.weight > 0.01) {
      this.leftArm.solve(rig, LEFT_ARM, motion.hands.left, this.mixer);
    }
    if (motion.hands.right.weight > 0.01) {
      this.rightArm.solve(rig, RIGHT_ARM, motion.hands.right, this.mixer);
    }

    this.procedural.solve(rig, motion, this.mixer);
    this.mixer.flush(rig, FIXED_STEP);
  }

  /**
   * Runs the pipeline forward without rendering.
   *
   * A freshly loaded rig sits in its rest pose, which for most humanoids is a
   * T-pose. Without this the pet is visibly wrong for the third of a second the
   * springs need to settle. It also makes screenshots reproducible: the same
   * pre-warm always yields the same pose.
   */
  prewarm(seconds: number, senses: MotionSenses) {
    const steps = Math.min(600, Math.round(Math.max(0, seconds) / FIXED_STEP));
    for (let index = 0; index < steps; index += 1) {
      const rig = this.rig;
      if (!rig) return;
      this.substep(rig, senses);
    }
    this.rig?.update(FIXED_STEP);
  }

  /** Allocation-free read for the render loop's frame-rate decision. */
  get intentKind(): MotionIntent["kind"] {
    return this.cerebellum.activeIntent.kind;
  }

  diagnostics(): MotionDiagnostics {    const angles = this.aim.angles;
    return {
      intent: this.cerebellum.activeIntent ?? IDLE_INTENT,
      gazeYaw: angles.yaw,
      gazePitch: angles.pitch,
      handWeights: {
        left: this.motion?.hands.left.weight ?? 0,
        right: this.motion?.hands.right.weight ?? 0,
      },
      overreach: { left: this.leftArm.overreach, right: this.rightArm.overreach },
      substeps: this.lastSubsteps,
    };
  }
}

function chainFor(side: "left" | "right") {
  const [upper, lower, end] = ARM_CHAINS[side];
  return { upper, lower, end };
}

const LEFT_ARM = chainFor("left");
const RIGHT_ARM = chainFor("right");

export type { MotionSenses };
