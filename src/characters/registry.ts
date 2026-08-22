import type { Reaction } from "../types";

interface CharacterManifest {
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
  reactionMessages?: Partial<Record<Reaction, string>>;
}

export interface CharacterDefinition extends CharacterManifest {
  avatarUrl: string;
  thumbnailUrl: string;
  spriteSheetUrl: string;
}

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

function buildCharacter(manifestPath: string, manifest: CharacterManifest): CharacterDefinition {
  const directoryId = manifestPath.split("/").at(-2);
  if (!directoryId || manifest.id !== directoryId) {
    throw new Error(`角色 id 必须与目录名一致：${manifestPath}`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(manifest.id)) {
    throw new Error(`角色 id 仅支持小写字母、数字和连字符：${manifest.id}`);
  }
  if (!manifest.name.trim() || !manifest.description.trim()) {
    throw new Error(`角色名称和描述不能为空：${manifest.id}`);
  }
  if (
    manifest.spriteVersionNumber !== 2
    || manifest.cellWidth !== 192
    || manifest.cellHeight !== 208
    || manifest.columns !== 8
    || manifest.rows !== 11
  ) {
    throw new Error(`角色必须使用 8x11、192x208 单元格的 v2 图集：${manifest.id}`);
  }

  return {
    ...manifest,
    reactionMessages: manifest.reactionMessages ?? {},
    avatarUrl: companionAsset(manifestPath, "avatar.png", avatars),
    thumbnailUrl: companionAsset(manifestPath, "thumbnail.png", thumbnails),
    spriteSheetUrl: companionAsset(manifestPath, "spritesheet.webp", spriteSheets),
  };
}

export const characterRegistry = Object.entries(manifests)
  .map(([path, manifest]) => buildCharacter(path, manifest))
  .sort((left, right) => (left.order ?? 100) - (right.order ?? 100) || left.name.localeCompare(right.name));

if (characterRegistry.length === 0) throw new Error("至少需要注册一个角色。");

const defaults = characterRegistry.filter((character) => character.isDefault);
if (defaults.length !== 1) throw new Error("必须且只能有一个默认角色。");

export const defaultCharacter = defaults[0];

export function getCharacter(characterId: string | undefined): CharacterDefinition {
  return characterRegistry.find((character) => character.id === characterId) ?? defaultCharacter;
}
