import fs from 'fs';
let content = fs.readFileSync('src/main.js', 'utf8');

// Put camera back to 1st person
content = content.replace(/camera\.position\.set\(0, 1\.5, 6\);/g, 'camera.position.set(0, 1, 5);');

// Hide player character since it's first person
content = content.replace(/scene\.add\(playerCharacterGroup\);/g, '// scene.add(playerCharacterGroup); // Hidden for 1st person view');

fs.writeFileSync('src/main.js', content, 'utf8');
