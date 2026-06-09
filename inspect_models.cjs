const fs = require('fs');

function inspect(path) {
  const buffer = fs.readFileSync(path);
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonString = buffer.toString('utf8', 20, 20 + jsonChunkLength);
  const json = JSON.parse(jsonString);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${path}  (${buffer.length} bytes)`);
  console.log(`${'='.repeat(60)}`);

  // Nodes
  console.log('\n--- NODES ---');
  json.nodes.forEach((n, i) => {
    const info = { i, name: n.name };
    if (n.children) info.ch = n.children;
    if (n.skin !== undefined) info.skin = n.skin;
    if (n.mesh !== undefined) info.mesh = n.mesh;
    if (n.rotation) info.rot = n.rotation.map(v => +v.toFixed(4));
    if (n.translation) info.pos = n.translation.map(v => +v.toFixed(4));
    if (n.scale) info.scl = n.scale.map(v => +v.toFixed(4));
    console.log(JSON.stringify(info));
  });

  // Skins
  if (json.skins && json.skins.length) {
    console.log('\n--- SKINS ---');
    json.skins.forEach((skin, i) => {
      console.log(`Skin ${i}: ${skin.name || 'unnamed'}, skeleton=${skin.skeleton}`);
      console.log(`  Joints (${skin.joints.length}): ${skin.joints.map(j => `${j}:${json.nodes[j].name}`).join(', ')}`);
    });
  }

  // Meshes
  console.log('\n--- MESHES ---');
  json.meshes.forEach((m, i) => {
    const attrs = m.primitives.map(p => Object.keys(p.attributes).join(','));
    console.log(`Mesh ${i}: ${m.name || 'unnamed'}, prims=${m.primitives.length}, attrs=[${attrs.join(' | ')}]`);
  });

  // Hierarchy
  const parentMap = {};
  json.nodes.forEach((n, i) => { if (n.children) n.children.forEach(c => parentMap[c] = i); });
  const roots = json.nodes.map((_, i) => i).filter(i => parentMap[i] === undefined);
  
  console.log('\n--- HIERARCHY ---');
  function tree(idx, d=0) {
    const n = json.nodes[idx];
    const pre = '  '.repeat(d);
    const tags = [];
    if (n.mesh !== undefined) tags.push('MESH');
    if (n.skin !== undefined) tags.push('SKIN');
    console.log(`${pre}[${idx}] ${n.name || '(unnamed)'} ${tags.join(' ')}`);
    if (n.children) n.children.forEach(c => tree(c, d+1));
  }
  roots.forEach(r => tree(r));

  // Animations
  if (json.animations && json.animations.length) {
    console.log(`\n--- ANIMATIONS (${json.animations.length}) ---`);
    json.animations.forEach((a, i) => console.log(`  ${i}: ${a.name}, channels=${a.channels.length}`));
  }
}

inspect('public/models/player.glb');
inspect('public/models/playerhand.glb');
