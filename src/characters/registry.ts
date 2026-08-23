import type { Reaction } from "../types";
import { normalizeWanderProfile, type WanderProfile } from "../core/wander-controller";

export interface CharacterManifest {
  id: string;
  name: string;
  description: string;
  isDefault?: boolean;
  order?: number;
  spriteVersionNumber: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  packageVersion?: string;
  lookDirectionOrder?: "clockwise" | "counterclockwise";
  wanderProfile?: WanderProfile;
  reactionMessages?: Partial<Record<Reaction, string>>;
}

export interface CharacterDefinition extends CharacterManifest {
  avatarUrl: string;
  thumbnailUrl: string;
  spriteSheetUrl: string;
  source?: "built-in" | "imported" | "online";
}

interface StoredCharacter {
  id: string;
  manifest: CharacterManifest;
  avatar: Blob;
  thumbnail: Blob;
  spriteSheet: Blob;
}

interface OnlineCatalog {
  schemaVersion: number;
  characters: string[];
}

const DATABASE_NAME = "furinapet-characters";
const STORE_NAME = "characters";
const DATABASE_VERSION = 1;
const ONLINE_ROOT = "https://raw.githubusercontent.com/sheetung/furinapet/main/online-characters";
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const LEGACY_COUNTERCLOCKWISE_LOOK_IDS = new Set(["xiao-yi"]);
const REQUIRED_FILES = ["character.json", "avatar.png", "thumbnail.png", "spritesheet.webp"] as const;
const REACTIONS: readonly Reaction[] = ["idle", "waving", "jumping", "failed", "waiting", "running", "review"];

const manifests = import.meta.glob<CharacterManifest>("../../characters/*/character.json", {
  eager: true,
  import: "default",
});
const avatars = import.meta.glob<string>("../../characters/*/avatar.png", {
  eager: true,
  import: "default",
  query: "?url",
});
const thumbnails = import.meta.glob<string>("../../characters/*/thumbnail.png", {
  eager: true,
  import: "default",
  query: "?url",
});
const spriteSheets = import.meta.glob<string>("../../characters/*/spritesheet.webp", {
  eager: true,
  import: "default",
  query: "?url",
});

function companionAsset(manifestPath: string, fileName: string, assets: Record<string, string>): string {
  const assetPath = manifestPath.replace(/character\.json$/, fileName);
  const asset = assets[assetPath];
  if (!asset) throw new Error(`角色资源缺失：${assetPath}`);
  return asset;
}

function validateManifest(value: unknown, directoryId?: string): CharacterManifest {
  if (!value || typeof value !== "object") throw new Error("character.json 内容无效。");
  const source = value as Partial<CharacterManifest>;
  if (typeof source.id !== "string" || !ID_PATTERN.test(source.id)) {
    throw new Error("角色 id 仅支持小写字母、数字和连字符，长度不能超过 48 位。");
  }
  if (directoryId && source.id !== directoryId) throw new Error(`角色 id 必须与文件夹名一致：${directoryId}`);
  if (typeof source.name !== "string" || !source.name.trim() || source.name.trim().length > 40) {
    throw new Error("角色名称不能为空且不能超过 40 个字符。");
  }
  if (typeof source.description !== "string" || !source.description.trim() || source.description.trim().length > 240) {
    throw new Error("角色描述不能为空且不能超过 240 个字符。");
  }
  if (
    source.spriteVersionNumber !== 2
    || source.cellWidth !== 192
    || source.cellHeight !== 208
    || source.columns !== 8
    || source.rows !== 11
  ) {
    throw new Error("角色必须使用 8x11、192x208 单元格的 v2 图集。");
  }
  if (source.reactionMessages !== undefined && (!source.reactionMessages || typeof source.reactionMessages !== "object")) {
    throw new Error("reactionMessages 必须是对象。");
  }
  if (source.lookDirectionOrder !== undefined && source.lookDirectionOrder !== "clockwise" && source.lookDirectionOrder !== "counterclockwise") {
    throw new Error("lookDirectionOrder 仅支持 clockwise 或 counterclockwise。");
  }
  if (source.packageVersion !== undefined && (typeof source.packageVersion !== "string" || !PACKAGE_VERSION_PATTERN.test(source.packageVersion))) {
    throw new Error("packageVersion 必须使用 x.y.z 格式。");
  }

  const reactionMessages: Partial<Record<Reaction, string>> = {};
  for (const reaction of REACTIONS) {
    const message = source.reactionMessages?.[reaction];
    if (message === undefined) continue;
    if (typeof message !== "string" || message.length > 240) throw new Error(`${reaction} 的互动文字不能超过 240 个字符。`);
    reactionMessages[reaction] = message;
  }

  return {
    id: source.id,
    name: source.name.trim(),
    description: source.description.trim(),
    isDefault: source.isDefault === true,
    order: typeof source.order === "number" && Number.isFinite(source.order) ? source.order : 100,
    spriteVersionNumber: 2,
    cellWidth: 192,
    cellHeight: 208,
    columns: 8,
    rows: 11,
    packageVersion: source.packageVersion ?? "1.0.0",
    lookDirectionOrder: source.lookDirectionOrder
      ?? (LEGACY_COUNTERCLOCKWISE_LOOK_IDS.has(source.id) ? "counterclockwise" : "clockwise"),
    wanderProfile: normalizeWanderProfile(source.wanderProfile),
    reactionMessages,
  };
}

function compareCharacters(left: CharacterDefinition, right: CharacterDefinition): number {
  return (left.order ?? 100) - (right.order ?? 100) || left.name.localeCompare(right.name);
}

function buildCharacter(manifestPath: string, rawManifest: CharacterManifest): CharacterDefinition {
  const directoryId = manifestPath.split("/").at(-2);
  if (!directoryId) throw new Error(`无法识别角色目录：${manifestPath}`);
  const manifest = validateManifest(rawManifest, directoryId);
  return {
    ...manifest,
    source: "built-in",
    avatarUrl: companionAsset(manifestPath, "avatar.png", avatars),
    thumbnailUrl: companionAsset(manifestPath, "thumbnail.png", thumbnails),
    spriteSheetUrl: companionAsset(manifestPath, "spritesheet.webp", spriteSheets),
  };
}

export const characterRegistry = Object.entries(manifests)
  .map(([path, manifest]) => buildCharacter(path, manifest))
  .sort(compareCharacters);

if (characterRegistry.length === 0) throw new Error("至少需要注册一个角色。");
const defaults = characterRegistry.filter((character) => character.isDefault);
if (defaults.length !== 1) throw new Error("必须且只能有一个默认角色。");
export const defaultCharacter = defaults[0];

let importedObjectUrls: string[] = [];

function openCharacterDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("无法打开本地角色存储。"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("本地角色存储操作失败。"));
  });
}

async function storedCharacters(): Promise<StoredCharacter[]> {
  const database = await openCharacterDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    return await requestResult(transaction.objectStore(STORE_NAME).getAll()) as StoredCharacter[];
  } finally {
    database.close();
  }
}

function importedDefinition(stored: StoredCharacter): CharacterDefinition {
  const manifest = validateManifest(stored.manifest, stored.id);
  const urls = [
    URL.createObjectURL(stored.avatar),
    URL.createObjectURL(stored.thumbnail),
    URL.createObjectURL(stored.spriteSheet),
  ];
  importedObjectUrls.push(...urls);
  return {
    ...manifest,
    isDefault: false,
    source: "imported",
    avatarUrl: urls[0],
    thumbnailUrl: urls[1],
    spriteSheetUrl: urls[2],
  };
}

export async function loadCharacterRegistry(): Promise<CharacterDefinition[]> {
  importedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  importedObjectUrls = [];
  const stored = await storedCharacters();
  const builtInIds = new Set(characterRegistry.map((character) => character.id));
  return [...characterRegistry, ...stored.filter((character) => !builtInIds.has(character.id)).map(importedDefinition)]
    .sort(compareCharacters);
}

export function getCharacter(characterId: string | undefined, registry: readonly CharacterDefinition[] = characterRegistry): CharacterDefinition {
  return registry.find((character) => character.id === characterId) ?? defaultCharacter;
}

function normalizedPath(file: File): string {
  return (file.webkitRelativePath || file.name).replaceAll("\\", "/");
}

function selectFolderFiles(files: readonly File[]): { directoryId: string; files: Map<string, File> } {
  const manifestFiles = files.filter((file) => {
    const path = normalizedPath(file).toLowerCase();
    return path.endsWith("/character.json") || path === "character.json";
  });
  if (manifestFiles.length !== 1) throw new Error("请选择只包含一个 character.json 的角色文件夹。");
  const manifestPath = normalizedPath(manifestFiles[0]);
  const slash = manifestPath.lastIndexOf("/");
  const prefix = slash >= 0 ? manifestPath.slice(0, slash + 1) : "";
  const directoryId = slash >= 0 ? manifestPath.slice(0, slash).split("/").at(-1) ?? "" : "";
  const selected = new Map<string, File>();
  for (const fileName of REQUIRED_FILES) {
    const expected = `${prefix}${fileName}`.toLowerCase();
    const match = files.find((file) => normalizedPath(file).toLowerCase() === expected);
    if (!match) throw new Error(`角色包缺少 ${fileName}。`);
    selected.set(fileName, match);
  }
  return { directoryId, files: selected };
}

async function imageSize(blob: Blob, fileName: string): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch {
    throw new Error(`${fileName} 不是可读取的图片。`);
  }
}

async function validateAssets(avatar: Blob, thumbnail: Blob, spriteSheet: Blob): Promise<void> {
  if (avatar.size > 2 * 1024 * 1024 || thumbnail.size > 4 * 1024 * 1024 || spriteSheet.size > 20 * 1024 * 1024) {
    throw new Error("角色图片过大：头像 2 MB、预览图 4 MB、图集 20 MB 以内。");
  }
  const [avatarSize, thumbnailSize, atlasSize] = await Promise.all([
    imageSize(avatar, "avatar.png"),
    imageSize(thumbnail, "thumbnail.png"),
    imageSize(spriteSheet, "spritesheet.webp"),
  ]);
  if (avatarSize.width < 32 || avatarSize.height < 32 || thumbnailSize.width < 32 || thumbnailSize.height < 32) {
    throw new Error("头像和预览图尺寸不能小于 32x32。");
  }
  if (atlasSize.width !== 1536 || atlasSize.height !== 2288) {
    throw new Error(`v2 图集必须为 1536x2288，当前为 ${atlasSize.width}x${atlasSize.height}。`);
  }
}

async function saveCharacter(manifest: CharacterManifest, avatar: Blob, thumbnail: Blob, spriteSheet: Blob, replace = false): Promise<void> {
  if (characterRegistry.some((character) => character.id === manifest.id)) throw new Error(`内置角色 ${manifest.id} 不能被覆盖。`);
  const installed = (await storedCharacters()).some((character) => character.id === manifest.id);
  if (!replace && installed) throw new Error(`角色 ${manifest.name} 已经安装。`);
  if (replace && !installed) throw new Error(`角色 ${manifest.name} 尚未安装。`);
  await validateAssets(avatar, thumbnail, spriteSheet);

  const stored: StoredCharacter = {
    id: manifest.id,
    manifest: { ...manifest, isDefault: false },
    avatar: new Blob([await avatar.arrayBuffer()], { type: "image/png" }),
    thumbnail: new Blob([await thumbnail.arrayBuffer()], { type: "image/png" }),
    spriteSheet: new Blob([await spriteSheet.arrayBuffer()], { type: "image/webp" }),
  };
  const database = await openCharacterDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    await requestResult(replace ? store.put(stored) : store.add(stored));
  } finally {
    database.close();
  }
}

export async function importCharacterFolder(input: FileList | readonly File[]): Promise<CharacterManifest> {
  const selected = selectFolderFiles(Array.from(input));
  const manifestFile = selected.files.get("character.json")!;
  if (manifestFile.size > 64 * 1024) throw new Error("character.json 不能超过 64 KB。");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await manifestFile.text());
  } catch {
    throw new Error("character.json 不是有效的 JSON 文件。");
  }
  const manifest = validateManifest(rawManifest, selected.directoryId || undefined);
  await saveCharacter(
    manifest,
    selected.files.get("avatar.png")!,
    selected.files.get("thumbnail.png")!,
    selected.files.get("spritesheet.webp")!,
  );
  return manifest;
}

async function fetchRequired(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error("无法连接 GitHub 在线角色库。");
  }
  if (!response.ok) throw new Error(`在线角色资源获取失败：HTTP ${response.status}`);
  return response;
}

async function onlineCharacter(characterId: string): Promise<CharacterDefinition> {
  if (!ID_PATTERN.test(characterId)) throw new Error(`在线角色 id 无效：${characterId}`);
  const root = `${ONLINE_ROOT}/${characterId}`;
  const response = await fetchRequired(`${root}/character.json`);
  const text = await response.text();
  if (new TextEncoder().encode(text).length > 64 * 1024) throw new Error("在线 character.json 不能超过 64 KB。");
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(text);
  } catch {
    throw new Error(`在线角色 ${characterId} 的 character.json 无效。`);
  }
  const manifest = validateManifest(rawManifest, characterId);
  return {
    ...manifest,
    isDefault: false,
    source: "online",
    avatarUrl: `${root}/avatar.png`,
    thumbnailUrl: `${root}/thumbnail.png`,
    spriteSheetUrl: `${root}/spritesheet.webp`,
  };
}

export async function loadOnlineCharacters(): Promise<CharacterDefinition[]> {
  const response = await fetchRequired(`${ONLINE_ROOT}/catalog.json?time=${Date.now()}`);
  const catalog = await response.json() as Partial<OnlineCatalog>;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.characters) || !catalog.characters.every((id) => typeof id === "string" && ID_PATTERN.test(id))) {
    throw new Error("在线角色目录格式无效。");
  }
  return Promise.all([...new Set(catalog.characters)].map(onlineCharacter));
}

export async function installOnlineCharacter(character: CharacterDefinition): Promise<CharacterManifest> {
  if (character.source !== "online") throw new Error("这不是在线角色。");
  const [avatar, thumbnail, spriteSheet] = await Promise.all([
    fetchRequired(character.avatarUrl).then((response) => response.blob()),
    fetchRequired(character.thumbnailUrl).then((response) => response.blob()),
    fetchRequired(character.spriteSheetUrl).then((response) => response.blob()),
  ]);
  const manifest = validateManifest(character, character.id);
  await saveCharacter(manifest, avatar, thumbnail, spriteSheet);
  return manifest;
}

function versionParts(version: string | undefined): number[] {
  return (version ?? "1.0.0").split(".").map((part) => Number(part));
}

export function hasCharacterUpdate(installed: CharacterDefinition, online: CharacterDefinition): boolean {
  const current = versionParts(installed.packageVersion);
  const latest = versionParts(online.packageVersion);
  for (let index = 0; index < 3; index += 1) {
    if (latest[index] !== current[index]) return latest[index] > current[index];
  }
  return false;
}

export async function updateOnlineCharacter(character: CharacterDefinition): Promise<CharacterManifest> {
  if (character.source !== "online") throw new Error("这不是在线角色。");
  const [avatar, thumbnail, spriteSheet] = await Promise.all([
    fetchRequired(character.avatarUrl).then((response) => response.blob()),
    fetchRequired(character.thumbnailUrl).then((response) => response.blob()),
    fetchRequired(character.spriteSheetUrl).then((response) => response.blob()),
  ]);
  const manifest = validateManifest(character, character.id);
  await saveCharacter(manifest, avatar, thumbnail, spriteSheet, true);
  return manifest;
}
