export type Reaction = "idle" | "waving" | "jumping" | "failed" | "waiting" | "running" | "review";

export interface AppSettings {
  petVisible: boolean;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  scale: number;
  lookAtCursor: boolean;
  autoWander: boolean;
  wanderProbability: number;
  wanderSpeed: number;
  gravityEnabled: boolean;
  reducedMotion: boolean;
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
