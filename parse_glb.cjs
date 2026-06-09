const fs = require('fs');
function getGlbAnimations(path) {
  const buffer = fs.readFileSync(path);
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546C67) { console.log('Not a GLB'); return; }
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.readUInt32LE(16);
  if (jsonChunkType !== 0x4E4F534A) { console.log('No JSON chunk'); return; }
  const jsonString = buffer.toString('utf8', 20, 20 + jsonChunkLength);
  const json = JSON.parse(jsonString);
  if (json.animations) {
    console.log(path, 'Animations:', json.animations.map(a => a.name));
  } else {
    console.log(path, 'No animations');
  }
}
getGlbAnimations('public/models/wizard_ps2_final.glb');
getGlbAnimations('public/models/gem_platform.glb');
