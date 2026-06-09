import fs from 'fs';
let content = fs.readFileSync('src/main.js', 'utf8');

const importGLTF = `import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';\n`;
if (!content.includes('GLTFLoader')) {
  content = importGLTF + content;
}

// remove createMannequin
content = content.replace(/function createMannequin\(\) \{[\s\S]*?createMannequin\(\);/m, '// Procedural Mannequin Replaced by GLB Models');

fs.writeFileSync('src/main.js', content, 'utf8');
