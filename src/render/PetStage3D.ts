import * as THREE from "three";
import { MotionController } from "../motion/MotionController";
import type { MotionSenses } from "../motion/Cerebellum";
import { PrimitiveRig } from "../motion/rig/PrimitiveRig";
import { VrmRig } from "../motion/rig/VrmRig";
import type { MotionIntent, SkeletonRig } from "../motion/types";

/** Rendered frames per second while the pet is idle and nothing is tracking. */
const IDLE_FPS = 30;
const ACTIVE_FPS = 60;
/** Gaze points are placed on a sphere this many body-heights from the head. */
const GAZE_RADIUS = 1.25;
/** Simulated seconds run before the first frame, so the rest pose never shows. */
const PREWARM_SECONDS = 0.7;

export type StageRigKind = "primitive" | "vrm";

/** One frame's worth of observations, pulled by the loop instead of pushed by React. */
export interface StageSenseSample {
  /** Screen-space offset from the pet to the cursor, or null when out of range. */
  gaze: { offsetX: number; offsetY: number; focalPixels: number } | null;
  velocityPxPerSecond: number;
  pixelsPerMetre: number;
  grounded: boolean;
}

export interface PetStage3DOptions {
  container: HTMLElement;
  rig: StageRigKind;
  vrmUrl?: string;
  /** Applied before the pre-warm, so the first visible frame is already correct. */
  initialIntent?: MotionIntent;
  /**
   * Pulled once per rendered frame. A pull avoids pushing cursor and velocity
   * through React state, which would re-render the tree dozens of times a second
   * for values only the render loop consumes.
   */
  readSenses?: () => StageSenseSample;
  /** Reported when a VRM fails to load and the primitive rig is used instead. */
  onRigFallback?: (reason: string) => void;
}

const gazePoint = new THREE.Vector3();
const headWorld = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/**
 * Owns the WebGL side: canvas, camera, lights, the rAF clock and the rig.
 *
 * Deliberately not a React component. A desktop pet's render loop outlives every
 * re-render, and letting React own it is how you end up with two loops after a
 * fast refresh.
 */
export class PetStage3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly controller = new MotionController();
  private readonly eyeTarget = new THREE.Object3D();
  private readonly senses: MotionSenses = { gaze: null, velocity: 0, grounded: true };
  private rig: SkeletonRig | null = null;
  private frame = 0;
  private lastFrameAt = 0;
  private targetFps = IDLE_FPS;
  private active = true;
  private disposed = false;
  private readonly container: HTMLElement;
  private readonly readSenses?: () => StageSenseSample;

  constructor(options: PetStage3DOptions) {
    this.container = options.container;
    this.readSenses = options.readSenses;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.container.appendChild(this.renderer.domElement);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.6, 1.4, 1.2);
    const fill = new THREE.HemisphereLight(0xdfeeff, 0x4a5b78, 1.1);
    this.scene.add(key, fill, this.eyeTarget);

    void this.mountRig(options);
    this.resize();
    this.loop(performance.now());
  }

  private async mountRig(options: PetStage3DOptions) {
    let rig: SkeletonRig | null = null;
    if (options.rig === "vrm" && options.vrmUrl) {
      try {
        rig = await VrmRig.load(options.vrmUrl);
      } catch (error) {
        options.onRigFallback?.(error instanceof Error ? error.message : "VRM 模型加载失败。");
      }
    }
    if (this.disposed) {
      rig?.dispose();
      return;
    }
    if (!rig) rig = new PrimitiveRig();

    this.rig = rig;
    this.scene.add(rig.root);
    rig.setEyeTarget?.(this.eyeTarget);
    this.controller.setRig(rig);
    this.frameCamera();
    if (options.initialIntent) this.controller.setIntent(options.initialIntent);
    // Settle the springs before the first frame so the pet never flashes its
    // T-pose rest pose on launch or after a model swap.
    this.sample();
    this.controller.prewarm(PREWARM_SECONDS, this.senses);
  }

  /** Fits the character to the window with a little headroom above and below. */
  private frameCamera() {
    const height = this.rig?.height ?? 1.5;
    const { clientWidth, clientHeight } = this.container;
    const aspect = clientHeight > 0 ? clientWidth / clientHeight : 1;
    const viewHeight = height * 1.14;
    const viewWidth = viewHeight * aspect;

    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight;
    this.camera.bottom = 0;
    this.camera.near = -10;
    this.camera.far = 10;
    this.camera.position.set(0, 0, 4);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth <= 0 || clientHeight <= 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.frameCamera();
  }

  setIntent(intent: MotionIntent) {
    this.controller.setIntent(intent);
  }

  /**
   * Places the gaze goal from a screen-space offset between the pet and the cursor.
   *
   * `focalPixels` is the pet's on-screen height, so sensitivity stays the same at
   * any window scale: a cursor one body-height to the right always reads as the
   * same yaw.
   */
  setGazeFromScreen(offsetX: number, offsetY: number, focalPixels: number) {
    const rig = this.rig;
    if (!rig) return;
    const focal = Math.max(1, focalPixels);
    const yaw = Math.atan2(offsetX, focal);
    const pitch = Math.atan2(-offsetY, focal);
    const radius = rig.height * GAZE_RADIUS;

    const head = rig.getBone("head");
    if (head) {
      head.getWorldPosition(headWorld);
      rig.root.worldToLocal(headWorld);
    } else {
      headWorld.set(0, rig.height * 0.92, 0);
    }

    gazePoint.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(radius).add(headWorld);
    this.senses.gaze = gazePoint;

    // Eye bones live in world space, so the VRM look-at target does too.
    this.eyeTarget.position.copy(gazePoint);
    rig.root.localToWorld(this.eyeTarget.position);
  }

  clearGaze() {
    this.senses.gaze = null;
  }

  /** Signed horizontal speed in px/s, converted to the rig's metric scale. */
  setVelocity(pixelsPerSecond: number, pixelsPerMetre: number) {
    this.senses.velocity = pixelsPerMetre > 0 ? pixelsPerSecond / pixelsPerMetre : 0;
  }

  setGrounded(grounded: boolean) {
    this.senses.grounded = grounded;
  }

  /** Pauses the loop entirely; used when the pet window is hidden. */
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.lastFrameAt = performance.now();
      this.loop(this.lastFrameAt);
    } else if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  /** True when the character's silhouette is under the given client-space point. */
  hitTest(clientX: number, clientY: number): boolean {
    const rig = this.rig;
    if (!rig) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, this.camera);
    return raycaster.intersectObject(rig.root, true).length > 0;
  }

  diagnostics() {
    return this.controller.diagnostics();
  }

  dispose() {
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.controller.setRig(null);
    if (this.rig) {
      this.scene.remove(this.rig.root);
      this.rig.dispose();
      this.rig = null;
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private sample() {
    const sample = this.readSenses?.();
    if (!sample) return;
    if (sample.gaze) this.setGazeFromScreen(sample.gaze.offsetX, sample.gaze.offsetY, sample.gaze.focalPixels);
    else this.clearGaze();
    this.setVelocity(sample.velocityPxPerSecond, sample.pixelsPerMetre);
    this.setGrounded(sample.grounded);
  }

  private loop = (now: number) => {    if (this.disposed || !this.active) return;
    this.frame = requestAnimationFrame(this.loop);

    const elapsed = now - this.lastFrameAt;
    const budget = 1000 / this.targetFps - 1;
    if (this.lastFrameAt !== 0 && elapsed < budget) return;
    this.lastFrameAt = now;

    if (this.rig) {
      this.sample();
      this.controller.update(Math.min(0.25, elapsed / 1000), this.senses);
      this.renderer.render(this.scene, this.camera);
    }

    // A pet sits on screen all day. Idling at 60 fps for a breathing loop is the
    // single largest thing this window can waste, so drop the rate when nothing
    // is tracking the cursor and the character is not doing anything.
    const intent = this.controller.intentKind;
    this.targetFps = this.senses.gaze || intent !== "idle" ? ACTIVE_FPS : IDLE_FPS;
  };
}

