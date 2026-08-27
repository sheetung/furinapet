/**
 * Development-only contact sheet: one stage per pose, side by side.
 *
 * Companion to `motion-preview.html`. That page is for poking at one character
 * interactively; this one renders every routine at once so a change can be eyeballed
 * across the whole set — and so a single screenshot documents the current state.
 *
 * Run `pnpm dev` and open http://localhost:1420/motion-sheet.html
 * Params: `?rig=vrm&model=/models/pet.vrm`, `?size=200`
 */
import { motionIntentForReaction } from "../src/pet-brain/adapters/motion";
import { PetStage3D, type StageSenseSample } from "../src/render/PetStage3D";
import type { MotionReaction } from "../src/types";

interface Cell {
  reaction: MotionReaction;
  note: string;
  /** Screen-space cursor offset used to drive Aim IK, in cell heights. */
  gaze?: [number, number];
  velocity?: number;
}

const CELLS: Cell[] = [
  { reaction: "idle", note: "呼吸 + 重心偏移" },
  { reaction: "idle", note: "注视右上", gaze: [0.75, -0.55] },
  { reaction: "idle", note: "注视左下", gaze: [-0.8, 0.3] },
  { reaction: "waving", note: "greet：两骨 IK 挥手" },
  { reaction: "jumping", note: "cheer：双手举起 + 上下浮动" },
  { reaction: "review", note: "observe：注视权重拉满", gaze: [0.5, -0.2] },
  { reaction: "waiting", note: "slump 轻度：颓丧 0.3" },
  { reaction: "failed", note: "slump 重度：颓丧 0.7" },
  { reaction: "run-right", note: "locomote：手臂反相摆动", velocity: 160 },
];

const params = new URLSearchParams(window.location.search);
const rig = params.get("rig") === "vrm" ? "vrm" : "primitive";
const model = params.get("model") ?? undefined;
const size = Number(params.get("size") ?? 200);
const height = Math.round(size * 208 / 192);

document.getElementById("title")!.textContent =
  `rig=${rig}${model ? ` model=${model}` : ""} — 每格独立 stage，各自预热 0.7 s 后渲染`;

const sheet = document.getElementById("sheet")!;

for (const cell of CELLS) {
  const figure = document.createElement("figure");
  const container = document.createElement("div");
  container.className = "cell";
  container.style.width = `${size}px`;
  container.style.height = `${height}px`;
  const caption = document.createElement("figcaption");
  caption.innerHTML = `<b>${cell.reaction}</b><br>${cell.note}`;
  figure.append(container, caption);
  sheet.append(figure);

  const senses: StageSenseSample = {
    gaze: cell.gaze
      ? { offsetX: cell.gaze[0] * height, offsetY: cell.gaze[1] * height, focalPixels: height }
      : null,
    velocityPxPerSecond: cell.velocity ?? 0,
    pixelsPerMetre: height / 1.5,
    grounded: true,
  };

  new PetStage3D({
    container,
    rig,
    vrmUrl: model,
    initialIntent: motionIntentForReaction(cell.reaction),
    readSenses: () => senses,
    onRigFallback: (reason) => { caption.innerHTML += `<br><span style="color:#f0b26a">${reason}</span>`; },
  });
}
