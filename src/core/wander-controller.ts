export type MovementStyle = "grounded" | "floating";

export interface WanderProfile {
  movementStyle: MovementStyle;
  activity: number;
  curiosity: number;
  preferredSpeed: number;
  windowDockChance: number;
  shortMoveChance: number;
  pauseMinMs: number;
  pauseMaxMs: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface WanderBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  groundY: number;
}

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSurface {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetSize {
  width: number;
  height: number;
}

export type DockEdge = "top" | "bottom-inside" | "left" | "right";

export interface DockPlacement extends Point {
  edge: DockEdge;
}

export const DEFAULT_WANDER_PROFILE: WanderProfile = {
  movementStyle: "grounded",
  activity: 0.65,
  curiosity: 0.65,
  preferredSpeed: 1,
  windowDockChance: 0.25,
  shortMoveChance: 0.6,
  pauseMinMs: 900,
  pauseMaxMs: 2600,
};

function finiteNumber(source: Record<string, unknown>, key: keyof WanderProfile, minimum: number, maximum: number, fallback: number): number {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`wanderProfile.${key} 必须在 ${minimum} 到 ${maximum} 之间。`);
  }
  return value;
}

export function normalizeWanderProfile(value: unknown): WanderProfile {
  if (value === undefined) return { ...DEFAULT_WANDER_PROFILE };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("wanderProfile 必须是对象。");
  const source = value as Record<string, unknown>;
  const movementStyle = source.movementStyle ?? DEFAULT_WANDER_PROFILE.movementStyle;
  if (movementStyle !== "grounded" && movementStyle !== "floating") {
    throw new Error("wanderProfile.movementStyle 仅支持 grounded 或 floating。");
  }
  const pauseMinMs = finiteNumber(source, "pauseMinMs", 500, 20000, DEFAULT_WANDER_PROFILE.pauseMinMs);
  const pauseMaxMs = finiteNumber(source, "pauseMaxMs", 500, 30000, DEFAULT_WANDER_PROFILE.pauseMaxMs);
  if (pauseMaxMs < pauseMinMs) throw new Error("wanderProfile.pauseMaxMs 不能小于 pauseMinMs。");
  return {
    movementStyle,
    activity: finiteNumber(source, "activity", 0, 1, DEFAULT_WANDER_PROFILE.activity),
    curiosity: finiteNumber(source, "curiosity", 0, 1, DEFAULT_WANDER_PROFILE.curiosity),
    preferredSpeed: finiteNumber(source, "preferredSpeed", 0.6, 1.5, DEFAULT_WANDER_PROFILE.preferredSpeed),
    windowDockChance: finiteNumber(source, "windowDockChance", 0, 0.5, DEFAULT_WANDER_PROFILE.windowDockChance),
    shortMoveChance: finiteNumber(source, "shortMoveChance", 0.3, 0.85, DEFAULT_WANDER_PROFILE.shortMoveChance),
    pauseMinMs,
    pauseMaxMs,
  };
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const MIN_WANDER_DISPLACEMENT = 56;

export function nextDecisionDelay(profile: WanderProfile, random = Math.random): number {
  const activityFactor = 1.2 - profile.activity * 0.45;
  return Math.round((7000 + random() * 9000) * activityFactor);
}

export function pauseDuration(profile: WanderProfile, random = Math.random): number {
  return Math.round(profile.pauseMinMs + random() * (profile.pauseMaxMs - profile.pauseMinMs));
}

function distanceBand(profile: WanderProfile, random: () => number): [number, number] {
  const value = random();
  if (value < profile.shortMoveChance) return [0.08, 0.28];
  if (value < 0.92) return [0.28, 0.58];
  return [0.58, 0.9];
}

function farthestValidTarget(current: Point, bounds: WanderBounds, grounded: boolean): Point {
  const candidates: Point[] = grounded
    ? [
        { x: bounds.minX, y: bounds.groundY },
        { x: bounds.maxX, y: bounds.groundY },
      ]
    : [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.maxX, y: bounds.maxY },
      ];
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.hypot(best.x - current.x, best.y - current.y);
    const candidateDistance = Math.hypot(candidate.x - current.x, candidate.y - current.y);
    return candidateDistance > bestDistance ? candidate : best;
  });
}

export function chooseWanderTarget(
  current: Point,
  bounds: WanderBounds,
  grounded: boolean,
  profile: WanderProfile,
  random = Math.random,
): Point {
  const spanX = Math.max(1, bounds.maxX - bounds.minX);
  const spanY = Math.max(1, bounds.maxY - bounds.minY);
  const diagonal = Math.hypot(spanX, grounded ? 0 : spanY);
  let best = { x: current.x, y: grounded ? bounds.groundY : current.y };
  let bestDistance = -1;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const [minimum, maximum] = distanceBand(profile, random);
    const distance = Math.max(MIN_WANDER_DISPLACEMENT, diagonal * (minimum + random() * (maximum - minimum)));
    const angle = grounded ? (random() < 0.5 ? Math.PI : 0) : random() * Math.PI * 2;
    const candidate = {
      x: clamp(current.x + Math.cos(angle) * distance, bounds.minX, bounds.maxX),
      y: grounded
        ? bounds.groundY
        : clamp(current.y + Math.sin(angle) * distance, bounds.minY, bounds.maxY),
    };
    const candidateDistance = Math.hypot(candidate.x - current.x, candidate.y - current.y);
    if (candidateDistance > bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }

  if (bestDistance < Math.min(MIN_WANDER_DISPLACEMENT, diagonal * 0.08)) {
    best = farthestValidTarget(current, bounds, grounded);
  }
  return { x: Math.round(best.x), y: Math.round(best.y) };
}

export function advanceSpeed(currentSpeed: number, distance: number, elapsedSeconds: number, speedMultiplier: number): number {
  const acceleration = 520;
  const deceleration = 680;
  const maximumSpeed = 110 * speedMultiplier;
  const brakingSpeed = Math.sqrt(Math.max(0, 2 * deceleration * distance));
  const desiredSpeed = Math.min(maximumSpeed, Math.max(28, brakingSpeed));
  return currentSpeed < desiredSpeed
    ? Math.min(desiredSpeed, currentSpeed + acceleration * elapsedSeconds)
    : Math.max(desiredSpeed, currentSpeed - deceleration * elapsedSeconds);
}

export function chooseDockPlacement(
  surface: WindowSurface,
  petSize: PetSize,
  workArea: WorkArea,
  edgeRoll = Math.random(),
  positionRatio = Math.random(),
  preferredEdge?: DockEdge,
): DockPlacement | null {
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;
  const surfaceRight = surface.x + surface.width;
  const surfaceBottom = surface.y + surface.height;
  const coversWorkArea = surface.width >= workArea.width * 0.94
    && surface.height >= workArea.height * 0.9
    && surface.x <= workArea.x + 8
    && surface.y <= workArea.y + 8;
  if (coversWorkArea || surface.width < 220 || surface.height < 120) return null;
  if (surfaceRight <= workArea.x || surface.x >= workRight || surfaceBottom <= workArea.y || surface.y >= workBottom) return null;

  const ratio = clamp(positionRatio, 0, 1);
  const placements: DockPlacement[] = [];
  const addHorizontal = (edge: DockEdge, y: number, leftInset: number, rightInset: number) => {
    const minimumX = Math.max(surface.x + leftInset, workArea.x + 8);
    const maximumX = Math.min(surfaceRight - petSize.width - rightInset, workRight - petSize.width - 8);
    if (maximumX >= minimumX && y >= workArea.y + 8 && y + petSize.height <= workBottom) {
      placements.push({ edge, x: Math.round(minimumX + ratio * (maximumX - minimumX)), y: Math.round(y) });
    }
  };
  const addVertical = (edge: DockEdge, x: number) => {
    const minimumY = Math.max(surface.y + 48, workArea.y + 8);
    const maximumY = Math.min(surfaceBottom - petSize.height - 24, workBottom - petSize.height - 8);
    if (maximumY >= minimumY && x >= workArea.x + 8 && x + petSize.width <= workRight - 8) {
      placements.push({ edge, x: Math.round(x), y: Math.round(minimumY + ratio * (maximumY - minimumY)) });
    }
  };

  addHorizontal("top", surface.y - petSize.height + 2, 56, 176);
  addHorizontal("bottom-inside", surfaceBottom - petSize.height - 8, 24, 24);
  addVertical("left", surface.x - petSize.width + 12);
  addVertical("right", surfaceRight - 12);
  if (placements.length === 0) return null;
  if (preferredEdge) return placements.find((placement) => placement.edge === preferredEdge) ?? null;

  const edgePreference: DockEdge[] = edgeRoll < 0.42
    ? ["top", "bottom-inside", "left", "right"]
    : edgeRoll < 0.74
      ? ["bottom-inside", "top", "left", "right"]
      : edgeRoll < 0.87
        ? ["left", "right", "top", "bottom-inside"]
        : ["right", "left", "top", "bottom-inside"];
  return edgePreference
    .map((edge) => placements.find((placement) => placement.edge === edge))
    .find((placement): placement is DockPlacement => placement !== undefined) ?? null;
}
