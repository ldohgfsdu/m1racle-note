import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Windows product override: every representation contains the full mother mark + Note.
// Electron creates Windows HICONs from the intrinsic (1x) bitmap. A 16px base
// produced a 16px large HICON even when larger scale representations existed.
// Use a 64px base so taskbars downsample instead of enlarging the small artwork.
export function createNoteIcon(nativeImage,assets,theme){
  if(!['day','night'].includes(theme))throw new Error('Unknown Note icon theme');
  const icon=nativeImage.createEmpty();
  for(const size of [16,24,32,48,64,128,256]){
    const png=readFileSync(join(assets,`icon-${size}-${theme}.png`));
    icon.addRepresentation({scaleFactor:size/64,dataURL:`data:image/png;base64,${png.toString('base64')}`});
  }
  if(icon.isEmpty()||icon.getScaleFactors().length!==7)throw new Error(`Cannot load Note ${theme} icon representations`);
  return icon;
}
