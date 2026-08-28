/**
 * S1 Skeleton Demo Component
 *
 * Visual test for the 2D skeletal animation system.
 * Shows a simple skeleton with colored rectangles and animates them.
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Skeleton, type BoneConfig } from "../neuro/motion/skeleton";
import { SkeletonRenderer } from "../neuro/motion/skeleton-renderer";

// Simple test skeleton with colored rectangles
const DEMO_SKELETON: BoneConfig = {
  name: "root",
  position: [0, -50],
  children: {
    body: {
      name: "body",
      position: [0, 50],
      mesh: { texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", width: 40, height: 60 },
      children: {
        head: {
          name: "head",
          position: [0, 40],
          anchor: [0, -10],
          mesh: { texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", width: 35, height: 35 },
        },
        arm_left: {
          name: "arm_left",
          position: [-25, 25],
          anchor: [0, 15],
          mesh: { texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", width: 15, height: 40 },
        },
        arm_right: {
          name: "arm_right",
          position: [25, 25],
          anchor: [0, 15],
          mesh: { texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", width: 15, height: 40 },
        },
        leg_left: {
          name: "leg_left",
          position: [-12, -10],
          anchor: [0, 20],
          mesh: { texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", width: 18, height: 45 },
        },
        leg_right: {
          name: "leg_right",
          position: [12, -10],
          anchor: [0, 20],
          mesh: { texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", width: 18, height: 45 },
        },
      },
    },
  },
};

export function SkeletonDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SkeletonRenderer | null>(null);
  const skeletonRef = useRef<Skeleton | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Create skeleton
    const skeleton = new Skeleton(DEMO_SKELETON);
    skeletonRef.current = skeleton;

    // Create renderer
    const renderer = new SkeletonRenderer(containerRef.current, {
      width: 400,
      height: 400,
      backgroundColor: 0x202020,
      zoom: 1.5,
    });
    rendererRef.current = renderer;

    // Load skeleton meshes
    renderer.loadSkeleton(skeleton);

    // Simple animation: swing arms and head
    let time = 0;
    const stopLoop = renderer.startLoop(skeleton);

    const animate = () => {
      time += 0.02;
      skeleton.applyPose({
        head: Math.sin(time) * 0.2,
        arm_left: Math.sin(time * 2) * 0.5,
        arm_right: -Math.sin(time * 2) * 0.5,
        leg_left: Math.sin(time * 1.5) * 0.3,
        leg_right: -Math.sin(time * 1.5) * 0.3,
      });
      requestAnimationFrame(animate);
    };
    animate();

    return () => {
      stopLoop();
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ padding: "20px", background: "#1a1a1a", color: "#fff" }}>
      <h2>S1 Skeleton Demo</h2>
      <p>Simple 2D skeletal animation test with Three.js</p>
      <div ref={containerRef} style={{ border: "1px solid #444", display: "inline-block" }} />
      <div style={{ marginTop: "10px", fontSize: "12px", color: "#888" }}>
        <p>Bones: root → body → (head, arm_L, arm_R, leg_L, leg_R)</p>
        <p>Animation: sine wave rotation on all limbs</p>
      </div>
    </div>
  );
}
