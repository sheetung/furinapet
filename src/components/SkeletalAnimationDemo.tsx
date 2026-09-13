/**
 * S4 Full Skeletal Animation Demo
 *
 * End-to-end visual test: MotorPlan → SkeletalMotionBackend → AnimationPlayer → Skeleton → Renderer
 * Shows the complete S1-S4 pipeline with interactive controls.
 */

import { useEffect, useRef, useState } from "react";
import { Skeleton, type BoneConfig } from "../neuro/motion/skeleton";
import { SkeletonRenderer } from "../neuro/motion/skeleton-renderer";
import { SkeletalMotionBackend } from "../neuro/motion/skeletal-motion-backend";
import type { MotorPlan, MotorPrimitive } from "../neuro/contracts/motor-plan";

// Import the production Furina cutout textures.
import bodyImg from "../assets/skeleton-parts/body.png";
import headImg from "../assets/skeleton-parts/head.png";
import hairBackImg from "../assets/skeleton-parts/hair_back.png";
import armLeftImg from "../assets/skeleton-parts/arm_left.png";
import armRightImg from "../assets/skeleton-parts/arm_right.png";
import legLeftImg from "../assets/skeleton-parts/leg_left.png";
import legRightImg from "../assets/skeleton-parts/leg_right.png";
import coatLeftImg from "../assets/skeleton-parts/coat_left.png";
import coatRightImg from "../assets/skeleton-parts/coat_right.png";

// Furina's compact rigid-cutout rig. Artwork overlaps at every joint so small
// rotations never expose a gap.
const DEMO_SKELETON: BoneConfig = {
  name: "root",
  position: [0, -55],
  children: {
    motion_root: {
      name: "motion_root",
      position: [0, 0],
      children: {
        body: {
          name: "body",
          position: [0, 65],
          mesh: { texture: bodyImg, width: 88, height: 132, zIndex: 0 },
          children: {
            coat_left: {
              name: "coat_left",
              position: [-30, -18],
              anchor: [0, -48],
              mesh: { texture: coatLeftImg, width: 83, height: 125, zIndex: -4 },
            },
            coat_right: {
              name: "coat_right",
              position: [30, -18],
              anchor: [0, -48],
              mesh: { texture: coatRightImg, width: 83, height: 125, zIndex: -4 },
            },
            leg_left: {
              name: "leg_left",
              position: [-18, -48],
              anchor: [0, -48],
              mesh: { texture: legLeftImg, width: 49, height: 122, zIndex: -1 },
            },
            leg_right: {
              name: "leg_right",
              position: [18, -48],
              anchor: [0, -48],
              mesh: { texture: legRightImg, width: 49, height: 122, zIndex: -1 },
            },
            head: {
              name: "head",
              position: [0, 66],
              anchor: [0, 54],
              mesh: { texture: headImg, width: 147, height: 160, zIndex: 5 },
              children: {
                hair_back: {
                  name: "hair_back",
                  position: [0, 0],
                  anchor: [0, 14],
                  mesh: { texture: hairBackImg, width: 151, height: 90, zIndex: -5 },
                },
              },
            },
            arm_left: {
              name: "arm_left",
              position: [-46, 24],
              anchor: [0, -42],
              mesh: { texture: armLeftImg, width: 88, height: 116, zIndex: 3 },
            },
            arm_right: {
              name: "arm_right",
              position: [46, 24],
              anchor: [0, -42],
              mesh: { texture: armRightImg, width: 91, height: 116, zIndex: 3 },
            },
          },
        },
      },
    },
  },
};

// Preset MotorPlans for demo
const PRESETS: Record<string, MotorPlan> = {
  idle: {
    actions: [{ type: "idleStyle", style: "normal", weight: 1 }],
    durationMs: 2000,
    confidence: 1,
  },
  lookAt: {
    actions: [{ type: "lookAt", target: "pointer", weight: 1 }],
    durationMs: 400,
    confidence: 1,
  },
  recoil: {
    actions: [{ type: "recoil", from: "pointer", strength: 1 }],
    durationMs: 300,
    confidence: 1,
  },
  wave: {
    actions: [{ type: "gesture", gesture: "wave", weight: 1 }],
    durationMs: 800,
    confidence: 1,
  },
  step: {
    actions: [{ type: "step", direction: "left", distance: 10 }],
    durationMs: 500,
    confidence: 1,
  },
};

export function SkeletalAnimationDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const backendRef = useRef<SkeletalMotionBackend | null>(null);
  const rendererRef = useRef<SkeletonRenderer | null>(null);
  const [currentAction, setCurrentAction] = useState<string>("idle");
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create skeleton
    const skeleton = new Skeleton(DEMO_SKELETON);

    // Create backend (S4 integration)
    const backend = new SkeletalMotionBackend({ skeleton });
    backendRef.current = backend;

    // Create renderer (S1)
    const renderer = new SkeletonRenderer(containerRef.current, {
      width: 400,
      height: 400,
      backgroundColor: 0x202020,
      zoom: 0.9,
    });
    rendererRef.current = renderer;

    // Load skeleton meshes
    renderer.loadSkeleton(skeleton);

    // Animation loop: backend.update() → renderer.update()
    let animId: number;
    let lastTime = performance.now();

    const loop = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      backend.update(dt);
      renderer.update(skeleton);
      renderer.render();

      setIsAnimating(backend.isAnimating());
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);

    // Start with idle
    backend.resolveMotorPlan(PRESETS.idle);

    return () => {
      cancelAnimationFrame(animId);
      backend.dispose();
      renderer.dispose();
    };
  }, []);

  const triggerAction = (name: string) => {
    if (!backendRef.current) return;
    const plan = PRESETS[name];
    if (!plan) return;

    setCurrentAction(name);
    backendRef.current.resolveMotorPlan(plan);
  };

  return (
    <div style={{ padding: "20px", background: "#1a1a1a", color: "#fff", fontFamily: "monospace" }}>
      <h2>S1-S4 骨骼动画系统集成 Demo</h2>
      <p style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
        MotorPlan → SkeletalMotionBackend → AnimationPlayer → Skeleton → Three.js Renderer
      </p>

      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
        <div>
          <div
            ref={containerRef}
            style={{ border: "1px solid #444", display: "inline-block", background: "#202020" }}
          />
          <div style={{ marginTop: "10px", fontSize: "11px", color: "#666" }}>
            状态: {isAnimating ? "▶ 动画播放中" : "⏸ 空闲"}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: "14px", marginBottom: "10px" }}>Motor Plan 触发器</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {Object.keys(PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => triggerAction(name)}
                style={{
                  padding: "8px 12px",
                  background: currentAction === name ? "#4a90e2" : "#333",
                  color: "#fff",
                  border: "1px solid #555",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                {name}
              </button>
            ))}
          </div>

          <div style={{ marginTop: "20px", fontSize: "11px", color: "#888" }}>
            <h4 style={{ fontSize: "12px", marginBottom: "8px" }}>骨骼层级:</h4>
            <div style={{ paddingLeft: "10px", lineHeight: "1.6" }}>
              root → motion_root → body → head → hair_back<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ arm_left, arm_right<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ leg_left, leg_right<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ coat_left, coat_right
            </div>
          </div>

          <div style={{ marginTop: "20px", fontSize: "11px", color: "#888" }}>
            <h4 style={{ fontSize: "12px", marginBottom: "8px" }}>系统架构:</h4>
            <div style={{ paddingLeft: "10px", lineHeight: "1.6" }}>
              <strong>S1:</strong> skeleton.ts + skeleton-renderer.ts<br />
              <strong>S2:</strong> animation.ts (Pose/tween/constraints)<br />
              <strong>S3:</strong> advanced-animation.ts (IK/spring)<br />
              <strong>S4:</strong> skeletal-motion-backend.ts (LMC 集成)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
