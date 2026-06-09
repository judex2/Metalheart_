import fs from 'fs';
let content = fs.readFileSync('src/main.js', 'utf8');

// 1. Setup groups and animation states
const groupsCode = `// ----------------------------------------------------
// PROCEDURAL ENEMY MANNEQUIN & PLAYER CHARACTER (GLB)
// ----------------------------------------------------
const opponentGroup = new THREE.Group();
opponentGroup.position.set(0, -0.3, -9);
scene.add(opponentGroup);

const playerCharacterGroup = new THREE.Group();
playerCharacterGroup.position.set(0, -0.3, 0); // Player standing at z=0, slightly back
scene.add(playerCharacterGroup);

// Move camera back to see the player (3rd person)
camera.position.set(0, 1.5, 6);

// Animation states
const animStates = {
  player: { castTimer: 0, hitTimer: 0, initialZ: 0 },
  opponent: { castTimer: 0, hitTimer: 0, initialZ: -9 }
};

// Async GLB Loader
const loader = new GLTFLoader();
const loadGLB = (url) => new Promise((resolve) => loader.load(url, resolve));

async function loadModels() {
  try {
    const wizardGLB = await loadGLB('models/wizard_ps2_final.glb');
    const platformGLB = await loadGLB('models/gem_platform.glb');
    
    // Setup Player
    const pWiz = wizardGLB.scene.clone();
    pWiz.scale.set(0.6, 0.6, 0.6);
    pWiz.rotation.y = Math.PI; // Face opponent
    playerCharacterGroup.add(pWiz);
    
    const pPlat = platformGLB.scene.clone();
    pPlat.scale.set(1.5, 1.5, 1.5);
    pPlat.position.y = -0.5;
    playerCharacterGroup.add(pPlat);
    
    // Setup Opponent
    const oWiz = wizardGLB.scene.clone();
    oWiz.scale.set(0.6, 0.6, 0.6);
    // Face player
    opponentGroup.add(oWiz);
    
    const oPlat = platformGLB.scene.clone();
    oPlat.scale.set(1.5, 1.5, 1.5);
    oPlat.position.y = -0.5;
    opponentGroup.add(oPlat);
    
    console.log('Models loaded successfully.');
  } catch (err) {
    console.error('Failed to load models:', err);
  }
}
loadModels();
`;

content = content.replace(/const opponentGroup = new THREE\.Group\(\);[\s\S]*?scene\.add\(opponentGroup\);/, groupsCode);

// 2. Hook triggers
content = content.replace(/function triggerOpponentHitVFX\(\) \{/, 'function triggerOpponentHitVFX() {\n  animStates.opponent.hitTimer = 0.5;');
content = content.replace(/function triggerPlayerCameraHitVFX\(\) \{/, 'function triggerPlayerCameraHitVFX() {\n  animStates.player.hitTimer = 0.5;');
content = content.replace(/function spawnProjectileVFX\(startVector, endVector, color, isHeavy, pAction, oAction\) \{/, 'function spawnProjectileVFX(startVector, endVector, color, isHeavy, pAction, oAction) {\n  if (startVector === "SELF") animStates.player.castTimer = 0.4;\n  if (startVector === "PROJECTILE") animStates.opponent.castTimer = 0.4;');

// 3. Add procedural articulation in animate()
const animLogic = `
  // Procedural Articulation
  const dt = 0.016;
  
  // Player Anim
  if (animStates.player.hitTimer > 0) {
    animStates.player.hitTimer -= dt;
    playerCharacterGroup.position.z = THREE.MathUtils.lerp(playerCharacterGroup.position.z, animStates.player.initialZ + 1.0, 0.2);
    playerCharacterGroup.rotation.x = THREE.MathUtils.lerp(playerCharacterGroup.rotation.x, -0.2, 0.2);
  } else if (animStates.player.castTimer > 0) {
    animStates.player.castTimer -= dt;
    playerCharacterGroup.position.z = THREE.MathUtils.lerp(playerCharacterGroup.position.z, animStates.player.initialZ - 0.8, 0.3);
    playerCharacterGroup.rotation.x = THREE.MathUtils.lerp(playerCharacterGroup.rotation.x, 0.1, 0.3);
  } else {
    playerCharacterGroup.position.z = THREE.MathUtils.lerp(playerCharacterGroup.position.z, animStates.player.initialZ, 0.1);
    playerCharacterGroup.rotation.x = THREE.MathUtils.lerp(playerCharacterGroup.rotation.x, 0, 0.1);
  }
  
  // Opponent Anim
  if (animStates.opponent.hitTimer > 0) {
    animStates.opponent.hitTimer -= dt;
    opponentGroup.position.z = THREE.MathUtils.lerp(opponentGroup.position.z, animStates.opponent.initialZ - 1.0, 0.2);
    opponentGroup.rotation.x = THREE.MathUtils.lerp(opponentGroup.rotation.x, 0.2, 0.2);
  } else if (animStates.opponent.castTimer > 0) {
    animStates.opponent.castTimer -= dt;
    opponentGroup.position.z = THREE.MathUtils.lerp(opponentGroup.position.z, animStates.opponent.initialZ + 0.8, 0.3);
    opponentGroup.rotation.x = THREE.MathUtils.lerp(opponentGroup.rotation.x, -0.1, 0.3);
  } else {
    opponentGroup.position.z = THREE.MathUtils.lerp(opponentGroup.position.z, animStates.opponent.initialZ, 0.1);
    opponentGroup.rotation.x = THREE.MathUtils.lerp(opponentGroup.rotation.x, 0, 0.1);
  }
  
  opponentGroup.rotation.y = Math.sin(time * 0.8) * 0.06; // Idle sway
`;

content = content.replace(/opponentGroup\.rotation\.y = Math\.sin\(time \* 0\.8\) \* 0\.06;/, animLogic);

// 4. Update the hardcoded camera fallback in animate
content = content.replace(/camera\.position\.set\(0, 1, 5\);/, 'camera.position.set(0, 1.5, 6);');

fs.writeFileSync('src/main.js', content, 'utf8');
