/**
 * Development-only bench for the motion pipeline.
 *
 * Not part of the Tauri build — `motion-preview.html` is not a Vite input, so it is
 * only reachable from `pnpm dev`. It exists because the interesting failures in a
 * motion system (a joint that pops, an elbow that snaps straight, a spring that
 * buzzes) are visible in a second and awkward to assert in a unit test.
 *
 * Run `pnpm dev` and open http://localhost:1420/motion-preview.html
 */
import { PetStage3D, type StageSenseSample } from "../src/render/PetStage3D";
import { motionIntentForReaction } from "../src/pet-brain/adapters/motion";
import type { MotionReaction } from "../src/types";

const REACTIONS: MotionReaction[] = [
  "idle", "waving", "jumping", "review", "running", "waiting", "failed", "run-left", "run-right",
];

const stageElement = document.getElementById("stage")!;
const controls = document.getElementById("controls")!;
const diagnostics = document.getElementById("diagnostics")!;
const status = document.getElementById("status")!;

const senses: StageSenseSample = {
  gaze: null,
  velocityPxPerSecond: 0,
  pixelsPerMetre: 416 / 1.5,
  grounded: true,
};

const params = new URLSearchParams(window.location.search);
const initial = params.get("reaction") as MotionReaction | null;
const startReaction = initial && REACTIONS.includes(initial) ? initial : "idle";

const stage = new PetStage3D({
  container: stageElement,
  rig: params.get("rig") === "vrm" ? "vrm" : "primitive",
  vrmUrl: params.get("model") ?? undefined,
  initialIntent: motionIntentForReaction(startReaction),
  readSenses: () => senses,
  onRigFallback: (reason) => { status.textContent = `rig fallback → primitive: ${reason}`; },
});
if (startReaction === "run-left") senses.velocityPxPerSecond = -160;
if (startReaction === "run-right") senses.velocityPxPerSecond = 160;

stageElement.addEventListener("pointermove", (event) => {
  const rect = stageElement.getBoundingClientRect();
  senses.gaze = {
    offsetX: event.clientX - (rect.left + rect.width / 2),
    offsetY: event.clientY - (rect.bottom - rect.height * 0.9),
    focalPixels: rect.height,
  };
});
stageElement.addEventListener("pointerleave", () => { senses.gaze = null; });

for (const reaction of REACTIONS) {
  const button = document.createElement("button");
  button.textContent = reaction;
  button.addEventListener("click", () => {
    stage.setIntent(motionIntentForReaction(reaction));
    senses.velocityPxPerSecond = reaction === "run-left" ? -160 : reaction === "run-right" ? 160 : 0;
  });
  controls.append(button);
}

window.setInterval(() => {
  const report = stage.diagnostics();
  diagnostics.textContent = [
    `intent      ${report.intent.kind} @ ${report.intent.intensity.toFixed(2)}`,
    `gaze        yaw ${(report.gazeYaw * 180 / Math.PI).toFixed(1)}°  pitch ${(report.gazePitch * 180 / Math.PI).toFixed(1)}°`,
    `hand weight L ${report.handWeights.left.toFixed(2)}  R ${report.handWeights.right.toFixed(2)}`,
    `overreach   L ${report.overreach.left.toFixed(3)}  R ${report.overreach.right.toFixed(3)}`,
    `substeps    ${report.substeps}`,
  ].join("\n");
}, 200);

// Surfaces WebGL context loss, which is otherwise a silently blank pet.
document.querySelector("canvas")?.addEventListener("webglcontextlost", () => {
  status.textContent = "WebGL context lost";
});
