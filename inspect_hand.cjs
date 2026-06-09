const fs = require('fs');

const buffer = fs.readFileSync('public/models/hand.glb');
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonString = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const json = JSON.parse(jsonString);

console.log('=== HAND.GLB SKELETON INSPECTION ===\n');

// List all nodes with their indices and properties
console.log('--- ALL NODES ---');
json.nodes.forEach((node, i) => {
  const info = { index: i, name: node.name };
  if (node.children) info.children = node.children;
  if (node.skin !== undefined) info.skin = node.skin;
  if (node.mesh !== undefined) info.mesh = node.mesh;
  if (node.rotation) info.rotation = node.rotation;
  if (node.translation) info.translation = node.translation;
  if (node.scale) info.scale = node.scale;
  console.log(JSON.stringify(info));
});

// List skins (skeleton info)
if (json.skins) {
  console.log('\n--- SKINS (SKELETONS) ---');
  json.skins.forEach((skin, i) => {
    console.log(`Skin ${i}: ${skin.name || 'unnamed'}`);
    console.log(`  Skeleton root: ${skin.skeleton}`);
    console.log(`  Joints (${skin.joints.length}): ${skin.joints.map(j => `${j}:${json.nodes[j].name}`).join(', ')}`);
  });
}

// Build parent map
const parentMap = {};
json.nodes.forEach((node, i) => {
  if (node.children) {
    node.children.forEach(c => { parentMap[c] = i; });
  }
});

// Print hierarchy
console.log('\n--- BONE HIERARCHY ---');
function printTree(nodeIdx, depth = 0) {
  const node = json.nodes[nodeIdx];
  const prefix = '  '.repeat(depth);
  const rot = node.rotation ? ` rot=[${node.rotation.map(v => v.toFixed(3)).join(',')}]` : '';
  const trans = node.translation ? ` pos=[${node.translation.map(v => v.toFixed(4)).join(',')}]` : '';
  console.log(`${prefix}[${nodeIdx}] ${node.name || 'unnamed'}${rot}${trans}`);
  if (node.children) {
    node.children.forEach(c => printTree(c, depth + 1));
  }
}

// Find root nodes (nodes with no parent)
const roots = [];
json.nodes.forEach((_, i) => {
  if (parentMap[i] === undefined) roots.push(i);
});
roots.forEach(r => printTree(r));

// Count meshes and skinned meshes
console.log('\n--- MESHES ---');
json.meshes.forEach((mesh, i) => {
  console.log(`Mesh ${i}: ${mesh.name || 'unnamed'}, primitives: ${mesh.primitives.length}`);
  mesh.primitives.forEach((prim, j) => {
    const attrs = Object.keys(prim.attributes);
    console.log(`  Prim ${j}: attrs=[${attrs.join(',')}]`);
  });
});
