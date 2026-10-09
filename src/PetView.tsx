import { usePetRuntime } from './pet/use-pet-runtime';
import { desktop } from './api';
import { getCharacter } from './characters/registry';
import { mapLookDirection } from './core/look-direction';
import { replacementStyle } from './core/motion-art';
import { getCharacterArt } from './characters/motion-assets';
import { useLoadedAssets } from './characters/use-loaded-assets';
import { bubbles } from './bubbles/controller';
import fallbackAtlas from '../characters/furina/spritesheet.webp';
import './pet.css';

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;

export function PetView() {
  const { settings, characters, reaction, spriteCell, look, bubble, bubblePlacement, interaction } = usePetRuntime();
  const activeCharacter = getCharacter(settings?.selectedCharacterId ?? 'furina', characters);
  const characterArt = getCharacterArt(activeCharacter);
  const loadedAssets = useLoadedAssets([activeCharacter.spriteSheetUrl, fallbackAtlas,
    ...Object.values(characterArt?.assets ?? {})]);
  if (!settings) return null;
  const displayedLook = look
    ? mapLookDirection(look, activeCharacter.lookDirectionOrder)
    : null;
  const column = displayedLook ? displayedLook.column : spriteCell.column;
  const row = displayedLook ? displayedLook.row : spriteCell.row;
  const candidate = characterArt?.frame(row, column, displayedLook ? undefined : spriteCell.clipId,
    displayedLook ? 'gaze' : reaction);
  const replacementUrl = candidate ? characterArt?.assets[candidate.asset] : undefined;
  const replacement = candidate && replacementUrl && loadedAssets.has(replacementUrl) ? candidate : null;
  const atlas = loadedAssets.has(activeCharacter.spriteSheetUrl) ? activeCharacter.spriteSheetUrl : fallbackAtlas;
  const fallbackPose = !displayedLook && !!spriteCell.clipId && !replacement;
  const style = {
    backgroundPosition: `${-(fallbackPose ? 0 : column) * CELL_WIDTH}px ${-(fallbackPose ? 0 : row) * CELL_HEIGHT}px`,
    backgroundImage: replacement ? 'none' : `url("${atlas}")`,
    transform: `scale(${settings.scale})`,
  } as React.CSSProperties;
  const stageStyle = { "--pet-height": `${CELL_HEIGHT * settings.scale}px` } as React.CSSProperties;

  return (
    <div
      className={`pet-stage ${settings.petVisible ? 'pet-visible' : 'pet-hiding'}`}
      style={stageStyle}
      onPointerDown={(event) => void interaction.beginDrag(event.button)}
      onContextMenu={(event) => { event.preventDefault(); void desktop.showControlCenter(); }}
    >
      {bubble && <div className={`pet-bubble ${bubblePlacement === 'inside' ? 'bubble-inside' : ''}`} role="status" onPointerDown={event => event.stopPropagation()}>
        <button className="bubble-close" aria-label="关闭气泡" onClick={() => bubbles.dismiss(bubble.id)}>×</button>
        {bubble.text}
      </div>}
      <div className={`pet-body ${reaction === 'dragged' ? 'pet-dragged' : ''}`}>
      <div className="sprite" style={style} role="img" aria-label={`${activeCharacter.name}：${reaction}`}>
        {replacement && replacementUrl && <div className="sprite-art" style={replacementStyle(replacement, replacementUrl)} />}
      </div>
      </div>
    </div>
  );
}
