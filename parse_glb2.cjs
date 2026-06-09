const fs = require('fs');
function getGlbKeys(path) {
  const buffer = fs.readFileSync(path);
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonString = buffer.toString('utf8', 20, 20 + jsonChunkLength);
  const json = JSON.parse(jsonString);
  console.log(path, 'Keys:', Object.keys(json));
  if (json.nodes) console.log(path, 'Nodes count:', json.nodes.length);
  if (json.skins) console.log(path, 'Skins:', json.skins.length);
}
getGlbKeys('public/models/wizard_ps2_final.glb');
getGlbKeys('public/models/gem_platform.glb');
