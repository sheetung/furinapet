export type Reaction = "idle" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

/** A reaction plus the two locomotion-only states the sprite sheet adds. */
export type MotionReaction = Reaction | "run-left" | "run-right";

export interface AppSettings {
  selectedCharacterId: string;
  petVisible: boolean;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  scale: number;
  lookAtCursor: boolean;
  autonomousMovement: boolean;
  wanderWeight: number;
  dockWeight: number;
  wanderSpeed: number;
  gravityEnabled: boolean;
  windowDocking: boolean;
}

export type SettingsPatch = Partial<AppSettings>;

export interface DashboardSnapshot {
  appName: string;
  version: string;
  engine: string;
  featureCount: number;
  settings: AppSettings;
}

export interface FeatureDescriptor {
  id: string;
  name: string;
  description: string;
}

export interface ReactionEvent {
  reaction: Reaction;
  message?: string;
  durationMs?: number;
}
