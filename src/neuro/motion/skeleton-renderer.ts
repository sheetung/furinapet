/**
 * Three.js Renderer for 2D Skeletal Animation
 *
 * Sets up an orthographic camera scene, creates meshes for each bone,
 * and updates them based on skeleton world transforms.
 */

import * as THREE from "three";
import type { Skeleton, Bone } from "./skeleton";

export interface SkeletonRendererOptions {
  width: number;
  height: number;
  backgroundColor?: number; // hex color, default transparent
  zoom?: number; // camera zoom level, default 1
}

export class SkeletonRenderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private textureLoader: THREE.TextureLoader;
  private boneMeshes: Map<string, THREE.Mesh> = new Map();

  constructor(
    private container: HTMLElement,
    private options: SkeletonRendererOptions,
  ) {
    // Scene
    this.scene = new THREE.Scene();
    if (options.backgroundColor !== undefined) {
      this.scene.background = new THREE.Color(options.backgroundColor);
    }

    // Orthographic camera (2D look)
    const { width, height, zoom = 1 } = options;
    const halfW = width / 2 / zoom;
    const halfH = height / 2 / zoom;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 1000);
    this.camera.position.z = 10;
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    // Texture loader
    this.textureLoader = new THREE.TextureLoader();
  }

  /** Create meshes for all bones that have mesh config */
  loadSkeleton(skeleton: Skeleton): void {
    for (const bone of skeleton.getAllBones()) {
      if (bone.meshConfig) {
        this.createBoneMesh(bone);
      }
    }
  }

  private createBoneMesh(bone: Bone): void {
    if (!bone.meshConfig) return;

    const { texture, width, height } = bone.meshConfig;

    const geometry = new THREE.PlaneGeometry(width, height);
    const tex = this.textureLoader.load(texture);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);

    // Apply anchor offset (pivot point for rotation)
    mesh.position.set(bone.anchor.x, bone.anchor.y, 0);

    // Store mesh reference
    bone.threeMesh = mesh;
    this.boneMeshes.set(bone.name, mesh);
    this.scene.add(mesh);
  }

  /** Update all mesh transforms from skeleton (call every frame) */
  update(skeleton: Skeleton): void {
    skeleton.update();

    for (const bone of skeleton.getAllBones()) {
      if (bone.threeMesh) {
        bone.threeMesh.position.set(bone.worldPosition.x, bone.worldPosition.y, 0);
        bone.threeMesh.rotation.z = bone.worldRotation;
        bone.threeMesh.scale.set(bone.worldScale.x, bone.worldScale.y, 1);
      }
    }
  }

  /** Render the scene */
  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Animation loop helper */
  startLoop(skeleton: Skeleton): () => void {
    let running = true;

    const animate = () => {
      if (!running) return;
      this.update(skeleton);
      this.render();
      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      running = false;
    };
  }

  /** Clean up resources */
  dispose(): void {
    for (const mesh of this.boneMeshes.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}
