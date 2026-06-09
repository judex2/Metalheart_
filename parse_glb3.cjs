const fs = require('fs');
function getGlbNodeNames(path) {
  const buffer = fs.readFileSync(path);
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonString = buffer.toString('utf8', 20, 20 + jsonChunkLength);
  const json = JSON.parse(jsonString);
  console.log(path, 'Nodes:', json.nodes.map(n => n.name));
}
getGlbNodeNames('public/models/wizard_ps2_final.glb');
