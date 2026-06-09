import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createElementMesh, updateElementMesh, applySterileWhiteMaterial } from './elementConstructs';
import { CombatEngine } from './combatEngine';
import { AudioManager } from './audioManager';
import { createMetalheartMaterial } from './shader';
import './style.css';

const audioManager = new AudioManager();

// ----------------------------------------------------
// NETWORKING STATE
// ----------------------------------------------------
let peer = null;
let conn = null;
let isHost = false;
let isNetworkGameStarted = false;
let opponentActionReceived = null;
let localActionCommitted = null;

// ----------------------------------------------------
// STATE DEFINITIONS
// ----------------------------------------------------
const state = {
  currentCombo: [], // Max length 3
  targetVector: null, // "PROJECTILE" or "SELF"
  loadout: [], // Locked from pregame menu
  pregameActive: true, // Pregame menu blocks actions
  gameOverActive: false, // Blocks play when death occurs
  gameOverScreenShown: false,
  lastLoadoutChangeTurn: -10, // tracks grimoire element shifts (cooldown is 3 turns)
  lastCastArray: [], // tracks last combo casted to prevent recast spamming
  handMode: 'GLB', // 'GLB' or 'PROCEDURAL'
  
  // Round Clock (Extended to 45s)
  roundTimer: 45.0,
  
  // Opponent AI active cueing
  opponentPlannedAction: null,
  opponentQueuedCombo: [],
  opponentSparks: [],

  // Game state
  combatEngine: new CombatEngine(),
  
  // Inflight turn resolution
  turnInProgress: false,
  pendingPlayerCombo: [],
  pendingPlayerTarget: null,
  pendingOpponentAction: null,
  
  // Visual timers
  noShakeTimer: 0, // Incompatibility UX shake countdown (seconds)
  shakeIntensity: 0, // Screen hit shake
  
  // VFX references
  activeProjectiles: [], 
  impactParticles: [], 
  elementMeshes: [], 
};

// ----------------------------------------------------
// THREE.JS VIEWPORT SETUP
// ----------------------------------------------------
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080808);

// Camera
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1, 5);
scene.add(camera);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// Blinding light in skybox
const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
dirLight.position.set(5, 15, -5);
scene.add(dirLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientLight);

// ==========================================
// THE AMBIENT SKYBOX & ENVIRONMENT MAP (AURORA CYBERSPACE)
// ==========================================
const textureLoader = new THREE.TextureLoader();
let skyboxTexture = null;
textureLoader.load('/bg_skybox.png', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = texture;
  scene.environment = texture; // This makes platforms naturally reflect the blue/purple aurora lighting!
  skyboxTexture = texture;
});

// ==========================================
// PROCEDURAL ASSET GENERATION HELPERS
// ==========================================

function createCrystallinePlatform(colorHex = 0x00f0ff) {
  const group = new THREE.Group();
  
  // Base geometry: low-poly Cylinder with 8 radial segments compressed on Y-axis
  const radius = 1.6;
  const height = 0.35;
  const geo = new THREE.CylinderGeometry(radius, radius * 1.15, height, 8, 2);
  
  // Perturb vertices along all axes to create a sharp, hand-carved crystalline facet shape
  const posAttr = geo.attributes.position;
  const tempV = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    tempV.fromBufferAttribute(posAttr, i);
    // Perturb X and Z randomly, but only slightly for Y to keep top standing surface stable
    tempV.x += (Math.random() - 0.5) * 0.16;
    tempV.y += (Math.random() - 0.5) * 0.05;
    tempV.z += (Math.random() - 0.5) * 0.16;
    posAttr.setXYZ(i, tempV.x, tempV.y, tempV.z);
  }
  geo.computeVertexNormals();
  
  // HIGHLY OPTIMIZED retro metal-crystal material (NO transmission refraction bottleneck!)
  const crystalMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.2,
    metalness: 0.8, // specular reflection effect
    emissive: colorHex,
    emissiveIntensity: 0.25,
    flatShading: true, // Faceted low-poly look
    side: THREE.DoubleSide
  });
  
  const mesh = new THREE.Mesh(geo, crystalMat);
  group.add(mesh);
  
  // Holographic tech wireframe outline
  const wireGeo = geo.clone();
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    wireframe: true,
    transparent: true,
    opacity: 0.25
  });
  const wireMesh = new THREE.Mesh(wireGeo, wireMat);
  wireMesh.scale.set(1.02, 1.02, 1.02); // Avoid z-fighting
  group.add(wireMesh);
  
  return group;
}

function createProceduralPlayerHand() {
  const handGroup = new THREE.Group();
  
  // Hyper-polished reflective liquid chrome material for visual continuity!
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe6dfcc, // warm beige tint matching hand GLTF
    roughness: 0.0,
    metalness: 1.0,
    flatShading: true
  });
  
  // 1. Forearm: Cylinder angling from bottom-right forward to wrist (9 faces max)
  const armGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.8, 9);
  armGeo.rotateX(Math.PI / 2);
  const armMesh = new THREE.Mesh(armGeo, chromeMat);
  armMesh.position.set(0.0, -0.05, 0.4);
  handGroup.add(armMesh);
  
  // 2. Wrist Joint: Sphere connecting forearm to palm
  const wristGeo = new THREE.SphereGeometry(0.14, 9, 9);
  const wristMesh = new THREE.Mesh(wristGeo, chromeMat);
  wristMesh.position.set(0.0, 0.0, -0.4);
  handGroup.add(wristMesh);
  
  // 3. Palm Matrix: Low-poly, angular BoxGeometry
  const palmGeo = new THREE.BoxGeometry(0.3, 0.08, 0.35);
  const palmMesh = new THREE.Mesh(palmGeo, chromeMat);
  palmMesh.position.set(0.0, 0.0, -0.6);
  handGroup.add(palmMesh);
  
  // 4. Casting Fingers
  const fingerConfigs = [
    { basePos: [0.12, -0.01, -0.65], baseRot: [0.1, -0.2, -0.5], tipRot: [0.1, 0.0, 0.2], baseLen: 0.12, tipLen: 0.1, rad: 0.03 },
    { basePos: [0.07, 0.02, -0.77], baseRot: [-0.15, 0.05, -0.02], tipRot: [-0.2, 0.0, 0.0], baseLen: 0.18, tipLen: 0.15, rad: 0.025 },
    { basePos: [0.01, 0.02, -0.79], baseRot: [-0.1, 0.01, 0.0], tipRot: [-0.22, 0.0, 0.0], baseLen: 0.2, tipLen: 0.16, rad: 0.025 },
    { basePos: [-0.05, 0.02, -0.77], baseRot: [-0.08, -0.03, 0.02], tipRot: [-0.2, 0.0, 0.0], baseLen: 0.18, tipLen: 0.15, rad: 0.024 },
    { basePos: [-0.11, 0.01, -0.73], baseRot: [-0.05, -0.08, 0.05], tipRot: [-0.18, 0.0, 0.0], baseLen: 0.15, tipLen: 0.12, rad: 0.021 }
  ];
  
  fingerConfigs.forEach(cfg => {
    const baseGeo = new THREE.CylinderGeometry(cfg.rad * 0.85, cfg.rad, cfg.baseLen, 9);
    baseGeo.rotateX(-Math.PI / 2);
    baseGeo.translate(0, 0, -cfg.baseLen / 2);
    const baseMesh = new THREE.Mesh(baseGeo, chromeMat);
    baseMesh.position.set(cfg.basePos[0], cfg.basePos[1], cfg.basePos[2]);
    baseMesh.rotation.set(cfg.baseRot[0], cfg.baseRot[1], cfg.baseRot[2]);
    handGroup.add(baseMesh);
    
    const tipGeo = new THREE.CylinderGeometry(cfg.rad * 0.5, cfg.rad * 0.85, cfg.tipLen, 9);
    tipGeo.rotateX(-Math.PI / 2);
    tipGeo.translate(0, 0, -cfg.tipLen / 2);
    const tipMesh = new THREE.Mesh(tipGeo, chromeMat);
    tipMesh.position.set(0, 0, -cfg.baseLen);
    tipMesh.rotation.set(cfg.tipRot[0], cfg.tipRot[1], cfg.tipRot[2]);
    baseMesh.add(tipMesh);
  });
  
  const meshesToOverlay = [];
  handGroup.traverse((child) => {
    if (child.isMesh) {
      meshesToOverlay.push(child);
    }
  });
  
  meshesToOverlay.forEach(mesh => {
    const wireGeo = mesh.geometry.clone();
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x222222,
      wireframe: true,
      transparent: true,
      opacity: 0.45
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    wireMesh.position.set(0, 0, 0);
    wireMesh.rotation.set(0, 0, 0);
    wireMesh.scale.set(1.02, 1.02, 1.02);
    wireMesh.userData.isWireframe = true;
    mesh.add(wireMesh);
  });
  
  const tempBox = new THREE.Box3().setFromObject(handGroup);
  const center = new THREE.Vector3();
  tempBox.getCenter(center);
  const size = new THREE.Vector3();
  tempBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  
  let targetScale = 1.3;
  if (maxDim > 0) {
    targetScale = 1.3 / maxDim; // scaled up for CS:GO perspective depth
  }
  
  handGroup.scale.set(targetScale, targetScale, targetScale);
  handGroup.position.copy(center).multiplyScalar(-targetScale);
  
  // Point palm upwards and fingers forward to perfectly align with GLTF viewmodel
  handGroup.rotation.set(Math.PI * 0.95, 0, Math.PI * 0.1);
  
  const containerGroup = new THREE.Group();
  containerGroup.add(handGroup);
  
  return containerGroup;
}

function createProceduralWizard() {
  const wizardGroup = new THREE.Group();
  
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.05,
    emissive: 0x333333, // slight self-glow so details stand out in shadows
    flatShading: true
  });
  
  const greyMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.7,
    metalness: 0.05,
    flatShading: true
  });
  
  // 1. Cloak/Robe: Tapered cylinder with low poly count (8)
  const bodyGeo = new THREE.CylinderGeometry(0.3, 0.95, 2.2, 8, 3);
  // Perturb body vertices for draped robe folds
  const posAttr = bodyGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    let x = posAttr.getX(i);
    let y = posAttr.getY(i);
    let z = posAttr.getZ(i);
    const factor = (1 - (y + 1.1) / 2.2) * 0.16;
    x += (Math.random() - 0.5) * factor;
    z += (Math.random() - 0.5) * factor;
    posAttr.setXYZ(i, x, y, z);
  }
  bodyGeo.computeVertexNormals();
  const bodyMesh = new THREE.Mesh(bodyGeo, whiteMat);
  bodyMesh.position.y = 1.1;
  wizardGroup.add(bodyMesh);
  
  // 2. Torus Collar (shoulders)
  const collarGeo = new THREE.TorusGeometry(0.4, 0.12, 6, 8);
  const collarMesh = new THREE.Mesh(collarGeo, whiteMat);
  collarMesh.rotation.x = Math.PI / 2;
  collarMesh.position.set(0, 2.1, 0);
  wizardGroup.add(collarMesh);
  
  // 3. The Hood (Sphere shell)
  const hoodGeo = new THREE.SphereGeometry(0.55, 8, 8);
  const hoodMesh = new THREE.Mesh(hoodGeo, whiteMat);
  hoodMesh.position.set(0, 2.5, 0);
  hoodMesh.scale.set(1.0, 1.1, 1.1);
  wizardGroup.add(hoodMesh);
  
  // 4. Dark Void Face: Recessed flat black circle facing forward inside the hood
  const voidFaceGeo = new THREE.CircleGeometry(0.32, 8);
  const voidFaceMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    side: THREE.DoubleSide
  });
  const voidFaceMesh = new THREE.Mesh(voidFaceGeo, voidFaceMat);
  // Shift slightly forward (+Z) and inside hood
  voidFaceMesh.position.set(0, 2.5, 0.28);
  voidFaceMesh.rotation.x = -0.1;
  wizardGroup.add(voidFaceMesh);
  
  // 5. Left Sleeve: Angled draped cylinder
  const sleeveLGeo = new THREE.CylinderGeometry(0.18, 0.35, 1.2, 6);
  const sleeveL = new THREE.Mesh(sleeveLGeo, whiteMat);
  sleeveL.position.set(-0.45, 1.6, 0.15);
  sleeveL.rotation.set(0.4, 0, 0.4); // Angle downwards & forwards
  wizardGroup.add(sleeveL);
  
  // Left Hand: Grey dodecahedron glove
  const handLGeo = new THREE.DodecahedronGeometry(0.1, 0);
  const handL = new THREE.Mesh(handLGeo, greyMat);
  handL.position.set(-0.68, 1.1, 0.35);
  wizardGroup.add(handL);
  
  // 6. Right Sleeve: Angled draped cylinder
  const sleeveRGeo = new THREE.CylinderGeometry(0.18, 0.35, 1.2, 6);
  const sleeveR = new THREE.Mesh(sleeveRGeo, whiteMat);
  sleeveR.position.set(0.45, 1.6, 0.15);
  sleeveR.rotation.set(0.4, 0, -0.4); // Angle downwards & forwards
  wizardGroup.add(sleeveR);
  
  // Right Hand: Grey dodecahedron glove
  const handRGeo = new THREE.DodecahedronGeometry(0.1, 0);
  const handR = new THREE.Mesh(handRGeo, greyMat);
  handR.position.set(0.68, 1.1, 0.35);
  wizardGroup.add(handR);
  
  wizardGroup.scale.set(1.0, 1.0, 1.0);
  return wizardGroup;
}

// ==========================================
// CYBER CRYSTALLINE DISK PLATFORMS
// ==========================================
const platformGroup = new THREE.Group();
scene.add(platformGroup);

const playerPlatform = createCrystallinePlatform(0x00f0ff);
playerPlatform.position.set(0, -1.2, 4.5);
platformGroup.add(playerPlatform);

const opponentPlatform = createCrystallinePlatform(0x8b5cf6);
opponentPlatform.position.set(0, -1.2, -9.0);
platformGroup.add(opponentPlatform);

// Drifting neon wireframe background grids
const backgroundGridsGroup = new THREE.Group();
scene.add(backgroundGridsGroup);

const gridHelper1 = new THREE.GridHelper(100, 16, 0x00f0ff, 0x0088aa);
gridHelper1.position.set(0, -6, -30);
gridHelper1.rotation.x = Math.PI / 6;
gridHelper1.material.opacity = 0.08;
gridHelper1.material.transparent = true;
backgroundGridsGroup.add(gridHelper1);

const gridHelper2 = new THREE.GridHelper(100, 16, 0x00f0ff, 0x0088aa);
gridHelper2.position.set(0, 10, -45);
gridHelper2.rotation.x = Math.PI / 2;
gridHelper2.rotation.z = Math.PI / 4;
gridHelper2.material.opacity = 0.06;
gridHelper2.material.transparent = true;
backgroundGridsGroup.add(gridHelper2);

// ==========================================
// PARALLAX SHARD ELEMENTS (Orbiting Far Shards)
// ==========================================
const farShards = [];
const farShardsGroup = new THREE.Group();
scene.add(farShardsGroup);

const farShardGeo = new THREE.ConeGeometry(0.3, 2.0, 4);
const farShardMat = new THREE.MeshPhysicalMaterial({
  color: 0x8b5cf6,
  transmission: 0.7,
  roughness: 0.2,
  metalness: 0.1,
  transparent: true,
  opacity: 0.8
});

for (let i = 0; i < 12; i++) {
  const mesh = new THREE.Mesh(farShardGeo, farShardMat);
  const radius = 22 + Math.random() * 15;
  const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.5;
  const x = Math.cos(angle) * radius;
  const y = -5 + Math.random() * 18;
  const z = -10 - Math.random() * 30;
  
  mesh.position.set(x, y, z);
  mesh.scale.set(
    0.6 + Math.random() * 0.8,
    1.2 + Math.random() * 2.0,
    0.6 + Math.random() * 0.8
  );
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  
  farShardsGroup.add(mesh);
  farShards.push({
    mesh: mesh,
    angle: angle,
    radius: radius,
    speed: 0.02 + Math.random() * 0.03,
    rotSpeedX: 0.05 + Math.random() * 0.08,
    rotSpeedY: 0.05 + Math.random() * 0.08,
    rotSpeedZ: 0.05 + Math.random() * 0.08,
    baseY: y
  });
}

// Exponential tech fog
scene.fog = new THREE.FogExp2(0x080808, 0.015);

// Distant Brutalist Monoliths removed
const monoliths = [];

// ----------------------------------------------------
// OPPONENT CHARACTER & PLAYER VIEWMODEL SETUP
// ----------------------------------------------------
const opponentGroup = new THREE.Group();
opponentGroup.position.set(0, -1.025, -9); // Stand grounded exactly on top of the crystalline platform
scene.add(opponentGroup);

// Charles Totem Groups
const playerCharlesTotemGroup = new THREE.Group();
playerCharlesTotemGroup.position.set(2, -0.5, -4); // near the player view
scene.add(playerCharlesTotemGroup);

const opponentCharlesTotemGroup = new THREE.Group();
opponentCharlesTotemGroup.position.set(2, -0.5, -8); // next to opponent
scene.add(opponentCharlesTotemGroup);

// Delayed Strike groups
const playerDelayedStrikeGroup = new THREE.Group();
playerDelayedStrikeGroup.position.set(0, -0.2, 4.5); // centered on player platform
scene.add(playerDelayedStrikeGroup);

const opponentDelayedStrikeGroup = new THREE.Group();
opponentDelayedStrikeGroup.position.set(0, -0.2, -9.0); // centered on opponent platform
scene.add(opponentDelayedStrikeGroup);

const oWiz = createProceduralWizard();
opponentGroup.add(oWiz);

// Asynchronously load player.glb as the opponent character model.
// Falls back to procedural wizard while loading, hot-swaps instantly upon load.
const opponentGltfLoader = new GLTFLoader();
opponentGltfLoader.load('models/player.glb', (gltf) => {
  const opponentModel = gltf.scene;
  
  const blackGlossMat = new THREE.MeshStandardMaterial({
    color: 0x181818,
    roughness: 0.05,
    metalness: 0.25,
    emissive: 0x0a0a0a,
    transparent: false,
    opacity: 1.0,
    flatShading: true
  });
  
  opponentModel.traverse((child) => {
    if (child.isMesh) {
      child.geometry.center();
      child.material = blackGlossMat;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  
  // Scale and center the GLTF model to fit the platform
  const box = new THREE.Box3().setFromObject(opponentModel);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  const targetHeight = 3.8; // Scaled up even more for presence
  const scaleVal = isFinite(maxDim) && maxDim > 0 ? targetHeight / maxDim : 0.4;
  opponentModel.scale.set(scaleVal, scaleVal, scaleVal);
  
  // Rotate the model to face the player camera (0 instead of Math.PI so it faces the player)
  opponentModel.rotation.y = 0.0;
  
  // Ground the model on top of the platform center
  const scaledBox = new THREE.Box3().setFromObject(opponentModel);
  const scaledSize = new THREE.Vector3();
  scaledBox.getSize(scaledSize);
  const halfHeight = isFinite(scaledSize.y) ? scaledSize.y / 2 : 1.9;
  opponentModel.position.set(0, halfHeight, 0);
  
  // Clean swap: remove fallback procedural wizard
  opponentGroup.remove(oWiz);
  opponentGroup.add(opponentModel);
  
  console.log("player.glb opponent model loaded, scaled, and swapped successfully.");
}, undefined, (err) => {
  console.error("Failed to load player.glb, procedural fallback active:", err);
});

const playerCharacterGroup = new THREE.Group();
playerCharacterGroup.position.set(0, -0.3, 0);
// scene.add(playerCharacterGroup); // Hidden for 1st person camera view

// Lock camera in fixed first-person view
camera.position.set(0, 1, 5);

// Animation states
const animStates = {
  player: { castTimer: 0, hitTimer: 0, initialZ: 0 },
  opponent: { castTimer: 0, hitTimer: 0, initialZ: -9 }
};

// Swirling digital cloud envelope that wraps the opponent on opponent's smokescreen cast
const opponentCloudGroup = new THREE.Group();
opponentCloudGroup.position.set(0, -1.025, -9); // Grounded wraps height
scene.add(opponentCloudGroup);

const cloudSphereGeo = new THREE.DodecahedronGeometry(0.7, 0); // low-poly faceted blocky dodecahedron
const cloudMat = new THREE.MeshStandardMaterial({
  color: 0x5a6369, // retro digital dark gray vapor
  roughness: 0.9,
  metalness: 0.1,
  flatShading: true,
  transparent: true,
  opacity: 0.95 // blocky and solid to mask the wizard
});

const cloudParts = [];
for (let i = 0; i < 7; i++) {
  const mesh = new THREE.Mesh(cloudSphereGeo, cloudMat);
  mesh.position.set(
    (Math.random() - 0.5) * 0.9,
    0.7 + (Math.random() - 0.5) * 1.2, // wraps torso and head height of wizard
    (Math.random() - 0.5) * 0.9
  );
  mesh.scale.setScalar(0.7 + Math.random() * 0.7);
  opponentCloudGroup.add(mesh);
  cloudParts.push(mesh);
}
opponentCloudGroup.visible = false; // hidden by default

// ----------------------------------------------------
// PLAYER PALM (Only hand_low_poly.glb is used as player hand)
// ----------------------------------------------------
const playerHandGroup = new THREE.Group();
camera.add(playerHandGroup); // Attached directly to camera container for first-person stability!

let customPlayerHand = null;
let proceduralPlayerHand = null;
let gltfPlayerHand = null;
const handColorMeshes = [];

// Localized particle vapors for cloud/decay status VFX
const playerStatusVaporGroup = new THREE.Group();
const opponentStatusVaporGroup = new THREE.Group();
camera.add(playerStatusVaporGroup);
playerStatusVaporGroup.position.set(0, 0, -1.2); 
opponentGroup.add(opponentStatusVaporGroup);
opponentStatusVaporGroup.position.set(0, 1.0, 0);

const playerStatusVapors = [];
const opponentStatusVapors = [];

function initStatusVapors() {
  const geom = new THREE.IcosahedronGeometry(0.04, 0); 
  for (let i = 0; i < 15; i++) {
    // Player
    const matP = new THREE.MeshBasicMaterial({
      color: 0x9900ff,
      transparent: true,
      opacity: 0.75,
      wireframe: Math.random() < 0.3
    });
    const meshP = new THREE.Mesh(geom, matP);
    meshP.position.set(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.0,
      (Math.random() - 0.5) * 0.8
    );
    meshP.userData = {
      speed: 1.5 + Math.random() * 2.0,
      angle: Math.random() * Math.PI * 2,
      radius: 0.3 + Math.random() * 0.5,
      yOffset: meshP.position.y
    };
    playerStatusVaporGroup.add(meshP);
    playerStatusVapors.push(meshP);
    
    // Opponent
    const matO = new THREE.MeshBasicMaterial({
      color: 0x9900ff,
      transparent: true,
      opacity: 0.75,
      wireframe: Math.random() < 0.3
    });
    const meshO = new THREE.Mesh(geom, matO);
    meshO.position.set(
      (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 1.2
    );
    meshO.userData = {
      speed: 1.5 + Math.random() * 2.0,
      angle: Math.random() * Math.PI * 2,
      radius: 0.4 + Math.random() * 0.6,
      yOffset: meshO.position.y
    };
    opponentStatusVaporGroup.add(meshO);
    opponentStatusVapors.push(meshO);
  }
  playerStatusVaporGroup.visible = false;
  opponentStatusVaporGroup.visible = false;
}
initStatusVapors();

function updateStatusVaporParticles(time, deltaTime) {
  const pStatuses = state.combatEngine.playerStatuses;
  const oStatuses = state.combatEngine.opponentStatuses;
  
  const pDecay = pStatuses.some(s => s.type === 'DECAY');
  const pPulse = pStatuses.some(s => s.type === 'PULSE');
  const pCloud = pStatuses.some(s => s.type === 'CLOUD');
  
  const oDecay = oStatuses.some(s => s.type === 'DECAY');
  const oPulse = oStatuses.some(s => s.type === 'PULSE');
  const oCloud = oStatuses.some(s => s.type === 'CLOUD');
  
  if (pDecay || pPulse || pCloud) {
    playerStatusVaporGroup.visible = true;
    let targetColor = 0x9900ff;
    if (pDecay) targetColor = 0x00ff44;
    else if (pCloud) targetColor = 0xdddddd; // misty gray swirling cloud
    
    playerStatusVapors.forEach(v => {
      v.material.color.setHex(targetColor);
      v.userData.angle += v.userData.speed * deltaTime;
      v.position.x = Math.cos(v.userData.angle) * v.userData.radius;
      v.position.z = Math.sin(v.userData.angle) * v.userData.radius;
      v.position.y = v.userData.yOffset + Math.sin(time * 2.0 + v.userData.angle) * 0.1;
      v.rotation.x += 0.5 * deltaTime;
      v.rotation.y += 1.0 * deltaTime;
    });
  } else {
    playerStatusVaporGroup.visible = false;
  }
  
  if (oDecay || oPulse || oCloud) {
    opponentStatusVaporGroup.visible = true;
    let targetColor = 0x9900ff;
    if (oDecay) targetColor = 0x00ff44;
    else if (oCloud) targetColor = 0xdddddd; // misty gray swirling cloud
    
    opponentStatusVapors.forEach(v => {
      v.material.color.setHex(targetColor);
      v.userData.angle += v.userData.speed * deltaTime;
      v.position.x = Math.cos(v.userData.angle) * v.userData.radius;
      v.position.z = Math.sin(v.userData.angle) * v.userData.radius;
      v.position.y = v.userData.yOffset + Math.sin(time * 2.0 + v.userData.angle) * 0.1;
      v.rotation.x += 0.5 * deltaTime;
      v.rotation.y += 1.0 * deltaTime;
    });
  } else {
    opponentStatusVaporGroup.visible = false;
  }
}

// Pre-initialize with the procedural hand immediately, so it is never invisible!
proceduralPlayerHand = createProceduralPlayerHand();
customPlayerHand = proceduralPlayerHand; // Default to procedural initially
playerHandGroup.add(proceduralPlayerHand);

// Gather meshes for color lerping on the initial procedural hand
handColorMeshes.length = 0;
proceduralPlayerHand.traverse((child) => {
  if (child.isMesh && !child.userData.isWireframe && child.material && (child.material.type === 'MeshStandardMaterial' || child.material.type === 'MeshPhysicalMaterial')) {
    handColorMeshes.push(child);
  }
});

// ----------------------------------------------------
// HAND CALIBRATION DEFAULTS
// ----------------------------------------------------
window.handConfig = {
  localRotX: 0.3400,
  localRotY: -2.4700,
  localRotZ: 0.0000,
  posX: 1.4000,
  posY: -0.8000,
  posZ: -2.2500,
  rotX: 0.9500,
  rotY: 2.6916,
  rotZ: -0.4000,
  spellPosX: 1.1500,
  spellPosY: -0.1000,
  spellPosZ: -1.9500
};

// Load the GLTF hand asset asynchronously
const gltfLoader = new GLTFLoader();

function processLoadedHand(loadedHand, modelPath) {
  // PURPLE GLASSY CHROME MATERIAL DESCRIPTION
  const purpleGlassyChromeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x4a0e4e,          // Deep royal purple base
    metalness: 0.9,          // High metalness for that chrome reflection
    roughness: 0.1,          // Super smooth, glossy finish
    clearcoat: 1.0,          // Extra glassy outer shell layer
    clearcoatRoughness: 0.0, // Flawless glass shine
    transmission: 0.55,      // Increased depth/translucency
    thickness: 0.5,          // Refraction thickness for the glass edge
    flatShading: true        // Preserves your awesome PS1 low-poly faceted look!
  });

  const meshesToOverlay = [];
  loadedHand.traverse((child) => {
    if (child.isMesh && !child.userData.isWireframe) {
      child.castShadow = true;
      child.receiveShadow = true;
      meshesToOverlay.push(child);
      
      // Assign custom purple glassy chrome material
      child.material = purpleGlassyChromeMaterial;
    }
  });
  
  // Center the loaded GLTF model inside the container group
  const tempBox = new THREE.Box3().setFromObject(loadedHand);
  const center = new THREE.Vector3();
  tempBox.getCenter(center);
  
  const size = new THREE.Vector3();
  tempBox.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  
  // Scale for CS:GO first-person perspective depth
  let targetScale = 0.01;
  if (isFinite(maxDim) && maxDim > 0) {
    targetScale = 1.3 / maxDim;
  }
  loadedHand.scale.set(targetScale, targetScale, targetScale);
  
  if (isFinite(center.x) && isFinite(center.y) && isFinite(center.z)) {
    loadedHand.position.copy(center).multiplyScalar(-targetScale);
  } else {
    loadedHand.position.set(0, 0, 0); 
  }
  
  // Save dynamic reference for calibration panel
  window.loadedHandRef = loadedHand;

  // Orient hand model using dynamic handConfig
  loadedHand.rotation.set(window.handConfig.localRotX, window.handConfig.localRotY, window.handConfig.localRotZ); 
  
  // Nest inside a container group for viewmodel rotation transforms
  const containerGroup = new THREE.Group();
  containerGroup.add(loadedHand);
  
  gltfPlayerHand = containerGroup;
  
  // Clean swap: swap to custom GLTF hand if the current active state is GLB!
  if (state.handMode === 'GLB') {
    if (customPlayerHand) {
      playerHandGroup.remove(customPlayerHand);
    }
    customPlayerHand = containerGroup;
    playerHandGroup.add(containerGroup);
    
    // Clear and cache the loaded hand standard meshes for color lerping!
    handColorMeshes.length = 0;
    loadedHand.traverse((child) => {
      if (child.isMesh && child.material && (child.material.type === 'MeshStandardMaterial' || child.material.type === 'MeshPhysicalMaterial')) {
        handColorMeshes.push(child);
      }
    });
  }
  
  console.log(`GLTF Hand model (${modelPath}) loaded successfully.`);
}

gltfLoader.load('models/playerhand.glb', (gltf) => {
  processLoadedHand(gltf.scene, 'models/playerhand.glb');
}, undefined, (err) => {
  console.warn("Failed to load models/playerhand.glb, using procedural fallback hand. Error:", err);
});

// Load the GLTF Lotus model asynchronously to cache it
gltfLoader.load('models/lotus.gltf', (gltf) => {
  window.cachedLotusModel = gltf.scene;
  console.log("GLTF Lotus model loaded and cached successfully.");
}, undefined, (err) => {
  console.warn("Failed to load models/lotus.gltf, keeping procedural fallback lotus. Error:", err);
});

// Load the OBJ Charles model asynchronously
const objLoader = new OBJLoader();
objLoader.load('models/charles.obj', (object) => {
  const charlesMat = new THREE.MeshStandardMaterial({
    color: 0xffaa00, // yellow/orangish tint
    emissive: 0x331100,
    roughness: 0.2,
    metalness: 0.8,
    flatShading: true
  });
  object.traverse((child) => {
    if (child.isMesh) {
      child.material = charlesMat;
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  
  // Scale down to match standard sizing
  object.scale.set(0.4, 0.4, 0.4);
  window.cachedCharlesModel = object;
  console.log("OBJ Charles model loaded successfully.");
}, undefined, (err) => {
  console.warn("Failed to load models/charles.obj. Error:", err);
});

// Load the OBJ Echo model asynchronously
objLoader.load('models/echo_solo.obj', (object) => {
  window.cachedEchoModel = object;
  console.log("OBJ Echo model loaded successfully.");
}, undefined, (err) => {
  console.warn("Failed to load models/echo_solo.obj. Error:", err);
});

// Load and cache the GLTF Smokescreen Cloud model
let cachedCloudModel = null;
gltfLoader.load('models/cloud.gltf', (gltf) => {
  cachedCloudModel = gltf.scene;
  console.log("GLTF Smokescreen Cloud model loaded successfully.");
  rebuildOpponentCloudGroup();
}, undefined, (err) => {
  console.warn("Failed to load models/cloud.gltf, keeping procedural fallback. Error:", err);
});

function rebuildOpponentCloudGroup() {
  if (!cachedCloudModel) return;
  
  // Clear existing children from opponentCloudGroup
  while (opponentCloudGroup.children.length > 0) {
    opponentCloudGroup.remove(opponentCloudGroup.children[0]);
  }
  cloudParts.length = 0;
  
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0x5a6369, // retro digital dark gray vapor
    roughness: 0.9,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
    opacity: 0.95
  });
  
  // Create 7 clustered instances of the loaded cloud model
  for (let i = 0; i < 7; i++) {
    const instance = cachedCloudModel.clone();
    
    // Recolor/retexture the meshes inside the clone
    instance.traverse((child) => {
      if (child.isMesh) {
        child.material = cloudMat;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    
    // Scale and position in a blocky cluster around the wizard torso/head
    instance.position.set(
      (Math.random() - 0.5) * 0.9,
      0.7 + (Math.random() - 0.5) * 1.2,
      (Math.random() - 0.5) * 0.9
    );
    
    // Bounding box scale
    const tempBox = new THREE.Box3().setFromObject(instance);
    const size = new THREE.Vector3();
    tempBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const baseScale = maxDim > 0 ? 0.75 / maxDim : 0.2;
    const finalScale = baseScale * (0.7 + Math.random() * 0.7);
    instance.scale.set(finalScale, finalScale, finalScale);
    
    opponentCloudGroup.add(instance);
    cloudParts.push(instance);
  }
}

// Lotus Overgrowth Fingertip Thorns
const thornGeo = new THREE.ConeGeometry(0.02, 0.08, 4);
const thornMat = new THREE.MeshBasicMaterial({ color: 0xff007f, wireframe: true });
const fingertipThorns = [];
for (let i = 0; i < 5; i++) {
  const mesh = new THREE.Mesh(thornGeo, thornMat);
  mesh.visible = false;
  playerHandGroup.add(mesh);
  fingertipThorns.push(mesh);
}

function updatePlayerPalm(time) {
  if (!customPlayerHand) return;

  // 1. DYNAMIC COLOR SCALE LERPING FOR ACTIVE STATUS EFFECTS
  let targetColor = new THREE.Vector3(1.0, 1.0, 1.0); // Normal chrome silver
  let handBaseColor = new THREE.Color(0x4a0e4e); // Default deep royal purple base matching the glassy chrome material
  
  const hasBlood = state.currentCombo.includes('BLOOD');
  const isBloodRegen = state.combatEngine.playerStatuses.some(s => s.type === 'BLOOD');
  const isDecaying = state.combatEngine.playerStatuses.some(s => s.type === 'DECAY');
  const isOvergrown = state.combatEngine.playerOvergrowthTurns > 0;
  
  if (isOvergrown) {
    handBaseColor.setHex(0xff00ff); // Bright Neon Pink Overgrowth!
  } else if (isDecaying) {
    handBaseColor.setHex(0x11ff33); // Green Acidic Decay!
  } else if (hasBlood || isBloodRegen) {
    handBaseColor.setHex(0xff1122); // Dark Crimson Blood!
  }
  
  handColorMeshes.forEach((child) => {
    child.material.color.lerp(handBaseColor, 0.08);
  });

  // 2. DECELERATE JITTER IF DECAY INFLICTED
  let jitterOffset = new THREE.Vector3();
  if (isDecaying && Math.random() < 0.25) {
    jitterOffset.set(
      (Math.random() - 0.5) * 0.04,
      (Math.random() - 0.5) * 0.04,
      (Math.random() - 0.5) * 0.04
    );
  }

  // 3. COMPUTE SKELETAL COORDINATES
  playerHandGroup.visible = true;

  // Strict baseline viewmodel offsets relative to first-person camera container upon setup!
  const baseHandX = window.handConfig.posX + jitterOffset.x;
  let baseHandY = window.handConfig.posY + Math.sin(time * 2.0) * 0.025 + jitterOffset.y; // minor screen idle bobbing
  let baseHandZ = window.handConfig.posZ + jitterOffset.z;

  // Baseline Rotation Euler angles: open-palm tactical gesture facing forward/up towards the opponent
  let targetRotX = window.handConfig.rotX;
  let targetRotY = window.handConfig.rotY;
  let targetRotZ = window.handConfig.rotZ;

  if (animStates.player.hitTimer > 0) {
    // Recoil flinch: shift backward and upward
    baseHandZ += 0.25;
    baseHandY += 0.15;
    targetRotX = 0.15;
    targetRotZ = -0.05;
  } else if (animStates.player.castTimer > 0) {
    // Cast thrust: thrust forward along Z
    baseHandZ -= 0.35;
    baseHandY -= 0.08;
    targetRotX = 0.65;
    targetRotY = Math.PI - 0.15;
  }

  customPlayerHand.position.set(baseHandX, baseHandY, baseHandZ);
  customPlayerHand.quaternion.setFromEuler(new THREE.Euler(targetRotX, targetRotY, targetRotZ));

  // 5. LOTUS OVERGROWTH THORNS FEEDBACK
  fingertipThorns.forEach(m => { m.visible = false; });
}

function getPalmCentroid() {
  if (customPlayerHand) {
    const worldPos = new THREE.Vector3();
    customPlayerHand.getWorldPosition(worldPos);
    return worldPos;
  }
  return new THREE.Vector3(1.45, 0.25, 2.2); // Safe fallback (camera.position + offsets)
}

// ----------------------------------------------------
// PROCEDURAL GEOMETRY CLUSTERING (ORBITAL ARCHITECTURE)
// ----------------------------------------------------
function syncElementMeshes() {
  state.elementMeshes.forEach(mesh => {
    applySterileWhiteMaterial(mesh, false);
    scene.remove(mesh);
  });
  state.elementMeshes = [];

  state.currentCombo.forEach((elName) => {
    const mesh = createElementMesh(elName);
    scene.add(mesh);
    state.elementMeshes.push(mesh);
  });
}

function updateElementPositions(time) {
  if (state.elementMeshes.length === 0) return;

  const count = state.elementMeshes.length;
  const hasLotus = state.currentCombo.includes('LOTUS');
  
  state.elementMeshes.forEach((mesh, idx) => {
    let offset = new THREE.Vector3();
    
    // Spacious floating orbits above the hand viewmodel to avoid clipping
    if (count === 1) {
      offset.set(0, Math.sin(time * 3.0) * 0.05, 0);
    } else if (count === 2) {
      const r = 0.42;
      const angle = time * 2.2 + idx * Math.PI;
      offset.set(Math.cos(angle) * r, Math.sin(time * 3.0 + idx) * 0.05, Math.sin(angle) * r);
    } else if (count === 3) {
      const r = 0.48;
      const angle = time * 2.5 + (idx * Math.PI * 2) / 3;
      offset.set(Math.cos(angle) * r, Math.sin(time * 3.5 + idx) * 0.06, Math.sin(angle) * r);
    }

    // Contaminate adjacent meshes with pink emissive bleed
    mesh.traverse(child => {
      if (child.material && child.material.uniforms && child.material.uniforms.uColorScale) {
        const baseColor = child.userData.baseColorScale || new THREE.Vector3(1, 1, 1);
        if (hasLotus && mesh.userData.type !== 'LOTUS') {
          // Lerp towards hot pink
          child.material.uniforms.uColorScale.value.lerp(new THREE.Vector3(1.2, 0.05, 0.7), 0.08);
        } else {
          // Lerp back to base color scale
          child.material.uniforms.uColorScale.value.lerp(baseColor, 0.08);
        }
      }
    });

    // High frequency horizontal jitter if "No" Shake UX rejection is active
    if (state.noShakeTimer > 0) {
      offset.x += Math.sin(time * 75.0) * 0.12;
      applySterileWhiteMaterial(mesh, true);
    } else {
      applySterileWhiteMaterial(mesh, false);
    }
    
    // Float spell elements at spacious front position in camera local space, translating back to world coordinates
    const localTarget = new THREE.Vector3(
      window.handConfig.spellPosX, 
      window.handConfig.spellPosY, 
      window.handConfig.spellPosZ
    ).add(offset);
    
    const targetPos = localTarget.clone().applyMatrix4(camera.matrixWorld);
    mesh.position.lerp(targetPos, 0.18);
    
    updateElementMesh(mesh, time);
  });
}

// ----------------------------------------------------
// SYNCHRONIZED PROJECTILE VFX & VOID COLLISION INTERCEPTS
// ----------------------------------------------------
function spawnProjectileVFX(combo, targetVector, sender) {
  const projGroup = new THREE.Group();
  
  if (sender === 'PLAYER') {
    animStates.player.castTimer = 0.45;
    if (targetVector === 'SELF') {
      audioManager.playSelfCast();
    } else if (targetVector === 'PROJECTILE') {
      audioManager.playProjection();
    }
  } else {
    animStates.opponent.castTimer = 0.45;
    if (targetVector === 'PROJECTILE') {
      audioManager.playProjection();
    }
  }
  
  combo.forEach((el, idx) => {
    const mesh = createElementMesh(el);
    mesh.scale.set(0.65, 0.65, 0.65);
    
    const angle = (idx / combo.length) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, 0);
    projGroup.add(mesh);
  });

  let startPos = new THREE.Vector3();
  let targetPos = new THREE.Vector3();

  if (sender === 'PLAYER') {
    const localStart = new THREE.Vector3(
      window.handConfig.spellPosX, 
      window.handConfig.spellPosY, 
      window.handConfig.spellPosZ
    );
    startPos.copy(localStart.applyMatrix4(camera.matrixWorld));
    if (targetVector === 'PROJECTILE') {
      targetPos.set(0, -0.1, -9.0); // Opponent Chest
    } else {
      targetPos.set(0, 1.0, 3.8); // Camera/Chest self
    }
  } else { // OPPONENT
    startPos.set(0, -0.1, -9.0); // Opponent Chest
    if (targetVector === 'PROJECTILE') {
      const localTarget = new THREE.Vector3(
        window.handConfig.spellPosX, 
        window.handConfig.spellPosY, 
        window.handConfig.spellPosZ
      );
      targetPos.copy(localTarget.applyMatrix4(camera.matrixWorld));
    } else {
      targetPos.set(0, -0.1, -8.2); // Opponent Self Cast
    }
  }

  projGroup.position.copy(startPos);
  scene.add(projGroup);
  
  state.activeProjectiles.push({
    group: projGroup,
    sender: sender,
    target: targetVector,
    startPos: startPos.clone(),
    targetPos: targetPos.clone(),
    isVoid: combo.includes('VOID') && targetVector === 'PROJECTILE',
    speed: 0.024, // ~40 frames
    t: 0
  });
}

function updateProjectiles(time) {
  const remaining = [];
  
  // 1. Resolve mid-air Void projectile intercepts (Unordered intersection check)
  for (let i = 0; i < state.activeProjectiles.length; i++) {
    for (let j = i + 1; j < state.activeProjectiles.length; j++) {
      const pA = state.activeProjectiles[i];
      const pB = state.activeProjectiles[j];
      
      if (pA.sender !== pB.sender && pA.target === 'PROJECTILE' && pB.target === 'PROJECTILE') {
        if (pA.isVoid || pB.isVoid) {
          const distVal = pA.group.position.distanceTo(pB.group.position);
          const crossed = (pA.sender === 'PLAYER' && pA.group.position.z < pB.group.position.z) ||
                          (pB.sender === 'PLAYER' && pB.group.position.z < pA.group.position.z);
          
          if (distVal < 1.2 || crossed) {
            const mid = new THREE.Vector3().addVectors(pA.group.position, pB.group.position).multiplyScalar(0.5);
            triggerVoidCancellationVFX(mid);
            
            scene.remove(pA.group);
            scene.remove(pB.group);
            
            pA.t = 1.0; pA.speed = 0; pA.cancelled = true;
            pB.t = 1.0; pB.speed = 0; pB.cancelled = true;
          }
        }
      }
    }
  }

  // 2. Move projectiles
  state.activeProjectiles.forEach(proj => {
    if (proj.t < 1.0) {
      proj.t += proj.speed;
      proj.t = Math.min(1.0, proj.t);
      
      proj.group.position.lerpVectors(proj.startPos, proj.targetPos, proj.t);
      proj.group.rotation.z += 0.06;
      
      proj.group.children.forEach(child => {
        updateElementMesh(child, time);
      });
      
      if (proj.t >= 1.0 && !proj.cancelled) {
        scene.remove(proj.group);
        
        // Trigger impact VFX
        if (proj.sender === 'PLAYER') {
          if (proj.target === 'PROJECTILE') {
            triggerOpponentHitVFX();
          }
        } else { // OPPONENT
          if (proj.target === 'PROJECTILE') {
            triggerPlayerCameraHitVFX();
            state.shakeIntensity = 0.28; 
          }
        }
      } else {
        remaining.push(proj);
      }
    }
  });

  state.activeProjectiles = remaining;
}

// Spark burst at the midpoint for Void interceptions
function triggerVoidCancellationVFX(pos) {
  const particleCount = 40;
  const positions = [];
  const velocities = [];
  const geo = new THREE.BufferGeometry();

  for (let i = 0; i < particleCount; i++) {
    positions.push(pos.x, pos.y, pos.z);
    velocities.push(
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.2
    );
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xbd00ff, 
    size: 0.14,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  state.impactParticles.push({
    system: points,
    velocities: velocities,
    age: 0,
    maxAge: 25
  });
}

// ----------------------------------------------------
// PARTICLE EXPLOSIONS (MANNEQUIN & CAMERA SCREENS)
// ----------------------------------------------------
function triggerOpponentHitVFX() {
  animStates.opponent.hitTimer = 0.5;
  const particleCount = 50;
  const positions = [];
  const velocities = [];
  const geo = new THREE.BufferGeometry();
  
  for (let i = 0; i < particleCount; i++) {
    positions.push(0, -0.1, -9.0);
    velocities.push(
      (Math.random() - 0.5) * 0.35,
      (Math.random() - 0.5) * 0.35 + 0.12,
      (Math.random() - 0.5) * 0.35
    );
  }
  
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: Math.random() > 0.5 ? 0x00f0ff : 0xff0055,
    size: 0.16,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });
  
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  
  state.impactParticles.push({
    system: points,
    velocities: velocities,
    age: 0,
    maxAge: 35 
  });
}

function triggerPlayerCameraHitVFX() {
  animStates.player.hitTimer = 0.5;
  const particleCount = 45;
  const positions = [];
  const velocities = [];
  const geo = new THREE.BufferGeometry();
  
  for (let i = 0; i < particleCount; i++) {
    positions.push(
      (Math.random() - 0.5) * 1.5,
      0.8 + (Math.random() - 0.5) * 1.2,
      3.2
    );
    velocities.push(
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.05
    );
  }
  
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xff0055, 
    size: 0.22, 
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });
  
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  
  state.impactParticles.push({
    system: points,
    velocities: velocities,
    age: 0,
    maxAge: 25
  });
}

function updateImpactParticles() {
  const remaining = [];
  
  state.impactParticles.forEach(part => {
    part.age++;
    const posAttr = part.system.geometry.attributes.position;
    const vels = part.velocities;
    
    for (let i = 0; i < posAttr.count; i++) {
      const idx = i * 3;
      posAttr.array[idx] += vels[idx];
      posAttr.array[idx + 1] += vels[idx + 1];
      posAttr.array[idx + 2] += vels[idx + 2];
      
      vels[idx + 1] -= 0.004; 
    }
    posAttr.needsUpdate = true;
    
    part.system.material.opacity = 1.0 - (part.age / part.maxAge);
    
    if (part.age >= part.maxAge) {
      scene.remove(part.system);
    } else {
      remaining.push(part);
    }
  });
  
  state.impactParticles = remaining;
}

// ----------------------------------------------------
// HUD & COMBAT OVERLAYS SYNCHRONIZER
// ----------------------------------------------------
function updateHUD() {
  const pHP = state.combatEngine.playerHP;
  const oHP = state.combatEngine.opponentHP;

  document.getElementById('player-hp-text').textContent = `${pHP} / 10 HP`;
  document.getElementById('opponent-hp-text').textContent = `${oHP} / 10 HP`;

  const pHpBar = document.getElementById('player-hp-bar');
  const oHpBar = document.getElementById('opponent-hp-bar');

  pHpBar.innerHTML = '';
  oHpBar.innerHTML = '';

  for (let i = 0; i < 10; i++) {
    const pSeg = document.createElement('div');
    pSeg.className = `hp-segment ${i < pHP ? 'player-active' : ''}`;
    pHpBar.appendChild(pSeg);

    const oSeg = document.createElement('div');
    oSeg.className = `hp-segment ${i < oHP ? 'opponent-active' : ''}`;
    oHpBar.appendChild(oSeg);
  }

  // HP Panel borders glowing from barriers
  const playerHPContainer = document.getElementById('player-hp-bar').parentElement.parentElement;
  if (state.combatEngine.playerBarrier) {
    playerHPContainer.className = `pointer-events-auto flex flex-col gap-3 bg-dark-panel/90 border p-4 w-80 font-mono ${state.combatEngine.playerBarrier.type === 'CHROME' ? 'brutalist-border-white' : 'brutalist-border-cyan'}`;
  } else {
    playerHPContainer.className = 'pointer-events-auto flex flex-col gap-3 bg-dark-panel/90 border border-dark-border p-4 brutalist-border-white w-80 font-mono';
  }

  const opponentHPContainer = document.getElementById('opponent-hp-bar').parentElement.parentElement;
  if (state.combatEngine.opponentBarrier) {
    opponentHPContainer.className = `pointer-events-auto flex flex-col gap-3 bg-dark-panel/90 border p-4 w-80 font-mono ${state.combatEngine.opponentBarrier.type === 'CHROME' ? 'brutalist-border-white' : 'brutalist-border-purple'}`;
  } else {
    opponentHPContainer.className = 'pointer-events-auto flex flex-col gap-3 bg-dark-panel/90 border border-dark-border p-4 brutalist-border-white w-80 font-mono';
  }

  // Draw active status tag lists
  const pStatusesDiv = document.getElementById('player-statuses');
  pStatusesDiv.innerHTML = '';
  
  if (state.combatEngine.playerBarrier) {
    const p = document.createElement('span');
    p.className = `px-2 py-0.5 font-bold border rounded-xs text-[9px] ${state.combatEngine.playerBarrier.type === 'CHROME' ? 'border-neon-silver text-neon-silver bg-zinc-800/80' : 'border-neon-blue text-neon-blue bg-zinc-800/80'}`;
    p.textContent = `${state.combatEngine.playerBarrier.type} BARRIER (${state.combatEngine.playerBarrier.turnsLeft}T)`;
    pStatusesDiv.appendChild(p);
  }

  if (state.combatEngine.playerArmorBuffer > 0) {
    const p = document.createElement('span');
    p.className = 'px-2 py-0.5 font-bold border border-zinc-400 text-zinc-400 bg-zinc-800 rounded-xs text-[9px]';
    p.textContent = `PHYS ARMOR (${state.combatEngine.playerArmorBuffer})`;
    pStatusesDiv.appendChild(p);
  }

  if (state.combatEngine.playerSonicAnvilActive) {
    const p = document.createElement('span');
    p.className = 'px-2 py-0.5 font-bold border border-teal-500 text-teal-400 bg-zinc-900 rounded-xs text-[9px]';
    p.textContent = 'SONIC ANVIL (1T)';
    pStatusesDiv.appendChild(p);
  }

  if (state.combatEngine.playerHarmonicCleanseActive) {
    const p = document.createElement('span');
    p.className = 'px-2 py-0.5 font-bold border border-teal-500 text-teal-400 bg-zinc-900 rounded-xs text-[9px]';
    p.textContent = 'HARMONIC CLEANSE (1T)';
    pStatusesDiv.appendChild(p);
  }

  if (state.combatEngine.playerInternalResonanceTurns > 0) {
    const p = document.createElement('span');
    p.className = 'px-2 py-0.5 font-bold border border-red-500 text-red-400 bg-zinc-900 rounded-xs text-[9px]';
    p.textContent = `PIERCING BLOOD (${state.combatEngine.playerInternalResonanceTurns}T)`;
    pStatusesDiv.appendChild(p);
  }

  if (state.combatEngine.playerStallTurns > 0) {
    const p = document.createElement('span');
    p.className = 'px-2 py-0.5 font-bold border border-yellow-500 text-yellow-400 bg-zinc-900 rounded-xs text-[9px]';
    p.textContent = `STALLED (${state.combatEngine.playerStallTurns}T)`;
    pStatusesDiv.appendChild(p);
  }

  if (state.combatEngine.playerEchoCooldown > 0) {
    const p = document.createElement('span');
    p.className = 'px-2 py-0.5 font-bold border border-teal-500 text-teal-400 bg-zinc-900 rounded-xs text-[9px] animate-pulse';
    p.textContent = `ECHO COOLDOWN (${state.combatEngine.playerEchoCooldown}T)`;
    pStatusesDiv.appendChild(p);
  }

  state.combatEngine.playerStatuses.forEach(s => {
    const p = document.createElement('span');
    p.className = `px-2 py-0.5 font-bold border border-neon-red text-neon-red bg-zinc-900 rounded-xs text-[9px]`;
    p.textContent = `${s.name} (${s.turnsLeft}T)`;
    pStatusesDiv.appendChild(p);
  });

  const oStatusesDiv = document.getElementById('opponent-statuses');
  oStatusesDiv.innerHTML = '';

  if (state.combatEngine.opponentBarrier) {
    const o = document.createElement('span');
    o.className = `px-2 py-0.5 font-bold border rounded-xs text-[9px] ${state.combatEngine.opponentBarrier.type === 'CHROME' ? 'border-neon-silver text-neon-silver bg-zinc-800/80' : 'border-neon-blue text-neon-blue bg-zinc-800/80'}`;
    o.textContent = `${state.combatEngine.opponentBarrier.type} BARRIER (${state.combatEngine.opponentBarrier.turnsLeft}T)`;
    oStatusesDiv.appendChild(o);
  }

  if (state.combatEngine.opponentArmorBuffer > 0) {
    const o = document.createElement('span');
    o.className = 'px-2 py-0.5 font-bold border border-zinc-400 text-zinc-400 bg-zinc-800 rounded-xs text-[9px]';
    o.textContent = `PHYS ARMOR (${state.combatEngine.opponentArmorBuffer})`;
    oStatusesDiv.appendChild(o);
  }

  if (state.combatEngine.opponentSonicAnvilActive) {
    const o = document.createElement('span');
    o.className = 'px-2 py-0.5 font-bold border border-teal-500 text-teal-400 bg-zinc-900 rounded-xs text-[9px]';
    o.textContent = 'SONIC ANVIL (1T)';
    oStatusesDiv.appendChild(o);
  }

  if (state.combatEngine.opponentHarmonicCleanseActive) {
    const o = document.createElement('span');
    o.className = 'px-2 py-0.5 font-bold border border-teal-500 text-teal-400 bg-zinc-900 rounded-xs text-[9px]';
    o.textContent = 'HARMONIC CLEANSE (1T)';
    oStatusesDiv.appendChild(o);
  }

  if (state.combatEngine.opponentInternalResonanceTurns > 0) {
    const o = document.createElement('span');
    o.className = 'px-2 py-0.5 font-bold border border-red-500 text-red-400 bg-zinc-900 rounded-xs text-[9px]';
    o.textContent = `PIERCING BLOOD (${state.combatEngine.opponentInternalResonanceTurns}T)`;
    oStatusesDiv.appendChild(o);
  }

  if (state.combatEngine.opponentStallTurns > 0) {
    const o = document.createElement('span');
    o.className = 'px-2 py-0.5 font-bold border border-yellow-500 text-yellow-400 bg-zinc-900 rounded-xs text-[9px]';
    o.textContent = `STALLED (${state.combatEngine.opponentStallTurns}T)`;
    oStatusesDiv.appendChild(o);
  }

  if (state.combatEngine.opponentEchoCooldown > 0) {
    const o = document.createElement('span');
    o.className = 'px-2 py-0.5 font-bold border border-teal-500 text-teal-400 bg-zinc-900 rounded-xs text-[9px] animate-pulse';
    o.textContent = `ECHO COOLDOWN (${state.combatEngine.opponentEchoCooldown}T)`;
    oStatusesDiv.appendChild(o);
  }

  state.combatEngine.opponentStatuses.forEach(s => {
    const o = document.createElement('span');
    o.className = `px-2 py-0.5 font-bold border border-neon-red text-neon-red bg-zinc-900 rounded-xs text-[9px]`;
    o.textContent = `${s.name} (${s.turnsLeft}T)`;
    oStatusesDiv.appendChild(o);
  });

  // Sync combo slots UI
  for (let i = 0; i < 3; i++) {
    const slotText = document.getElementById(`slot-${i}-text`);
    const slotDiv = document.getElementById(`spell-slot-${i}`);
    
    if (i < state.currentCombo.length) {
      const element = state.currentCombo[i];
      slotText.textContent = element;
      
      if (element === 'PULSE') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-white uppercase glow-text-cyan leading-none mt-0.5";
      } else if (element === 'BLOOD') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-neon-red uppercase leading-none mt-0.5";
      } else if (element === 'CHROME') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-slate-300 uppercase leading-none mt-0.5";
      } else if (element === 'MIRROR') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-neon-blue uppercase leading-none mt-0.5";
      } else if (element === 'DECAY') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-neon-green uppercase leading-none mt-0.5";
      } else if (element === 'VOID') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-neon-purple uppercase leading-none mt-0.5";
      } else if (element === 'CLOUD') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-zinc-500 uppercase leading-none mt-0.5";
      } else if (element === 'LOTUS') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-pink-500 uppercase glow-text-pink leading-none mt-0.5";
      } else if (element === 'ECHO') {
        slotDiv.className = "w-20 h-9 border-2 border-white bg-zinc-900/90 flex flex-col justify-center items-center rounded-sm";
        slotText.className = "text-[10px] font-bold text-teal-400 uppercase glow-text-teal leading-none mt-0.5";
      }
    } else {
      slotText.textContent = "-EMPTY-";
      slotText.className = "text-[10px] font-bold text-zinc-600 uppercase leading-none mt-0.5";
      slotDiv.className = "w-20 h-9 border border-white/30 bg-zinc-950 flex flex-col justify-center items-center rounded-sm";
    }
  }

  // Target Vector
  const vectorText = document.getElementById('target-vector-text');
  if (vectorText) {
    if (state.targetVector) {
      vectorText.textContent = state.targetVector;
      if (state.targetVector === 'SELF') {
        vectorText.className = "text-sm font-bold text-neon-blue glow-text-cyan";
      } else {
        vectorText.className = "text-sm font-bold text-neon-red glow-text-red";
      }
    } else {
      vectorText.textContent = "NOT LOCKED";
      vectorText.className = "text-sm font-bold text-zinc-500";
    }
  }

  // Update Console Logs
  const consoleLog = document.getElementById('log-console');
  consoleLog.innerHTML = '';
  
  state.combatEngine.logs.slice().reverse().forEach(log => {
    const div = document.createElement('div');
    div.className = "leading-relaxed pb-0.5 border-b border-zinc-900";
    
    if (log.startsWith('---')) {
      div.className += " text-white font-bold tracking-wider py-1 border-t border-zinc-800";
    } else if (log.startsWith('PLAYER')) {
      div.className += " text-neon-blue";
    } else if (log.startsWith('OPPONENT')) {
      div.className += " text-neon-red";
    } else if (log.includes('[SHIELD]')) {
      div.className += " text-yellow-300";
    } else if (log.includes('[REFLECT]')) {
      div.className += " text-cyan-300 font-bold";
    } else if (log.includes('[SHATTER]')) {
      div.className += " text-neon-purple font-bold italic";
    } else if (log.startsWith('>> Player')) {
      div.className += " text-emerald-400";
    } else if (log.startsWith('>> Opponent')) {
      div.className += " text-rose-400";
    } else if (log.startsWith('VICTORY')) {
      div.className += " text-neon-green font-bold text-xs uppercase animate-bounce";
    } else if (log.startsWith('DEFEAT')) {
      div.className += " text-neon-red font-bold text-xs uppercase";
    }
    
    div.textContent = log;
    consoleLog.appendChild(div);
  });
  consoleLog.scrollTop = consoleLog.scrollHeight;

  // VISUAL OVERLAY HARNESS (BLIND / SMOKESCREEN)
  const blindOverlay = document.getElementById('blind-overlay');
  if (state.combatEngine.playerBlindTurns > 0) {
    blindOverlay.style.opacity = '1.0';
    blindOverlay.style.pointerEvents = 'auto';
  } else {
    blindOverlay.style.opacity = '0.0';
    blindOverlay.style.pointerEvents = 'none';
  }

  const smokescreenOverlay = document.getElementById('smokescreen-overlay');
  if (state.combatEngine.playerSmokescreenTurns > 0) {
    smokescreenOverlay.style.opacity = '1.0';
    smokescreenOverlay.style.pointerEvents = 'none'; // Keep visual only, all UI stays active
  } else {
    smokescreenOverlay.style.opacity = '0.0';
    smokescreenOverlay.style.pointerEvents = 'none';
  }

  // Handle opponent smokescreen cloud envelopment: make opponent invisible, show rotating low-poly cloud
  const isOpponentCloudActive = state.combatEngine.opponentSmokescreenTurns > 0;
  if (isOpponentCloudActive) {
    opponentGroup.visible = false;      // Enveloped and completely hidden from view!
    opponentCloudGroup.visible = true;  // Surrounded in swirling digital clouds!
  } else {
    opponentGroup.visible = true;       // Mannequin is perfectly visible!
    opponentCloudGroup.visible = false; // Hide cloud cluster!
  }

  // Handle Charles Totem rendering
  if (state.combatEngine.playerCharlesTotemTurns > 0) {
    if (playerCharlesTotemGroup.children.length === 0 && window.cachedCharlesModel) {
      playerCharlesTotemGroup.add(window.cachedCharlesModel.clone());
    }
    playerCharlesTotemGroup.visible = true;
  } else {
    playerCharlesTotemGroup.visible = false;
    while(playerCharlesTotemGroup.children.length > 0) {
      playerCharlesTotemGroup.remove(playerCharlesTotemGroup.children[0]);
    }
  }

  if (state.combatEngine.opponentCharlesTotemTurns > 0) {
    if (opponentCharlesTotemGroup.children.length === 0 && window.cachedCharlesModel) {
      opponentCharlesTotemGroup.add(window.cachedCharlesModel.clone());
    }
    opponentCharlesTotemGroup.visible = true;
  } else {
    opponentCharlesTotemGroup.visible = false;
    while(opponentCharlesTotemGroup.children.length > 0) {
      opponentCharlesTotemGroup.remove(opponentCharlesTotemGroup.children[0]);
    }
  }

  // Apply Overgrowth hotkeys border lockdowns
  const isOvergrown = state.combatEngine.playerOvergrowthTurns > 0;
  const keyBtn1 = document.getElementById('key-btn-1');
  const keyBtn4 = document.getElementById('key-btn-4');
  
  if (isOvergrown) {
    keyBtn1.classList.add('overgrowth-active');
    keyBtn4.classList.add('overgrowth-active');
    keyBtn1.style.opacity = '0.25';
    keyBtn4.style.opacity = '0.25';
    keyBtn1.style.pointerEvents = 'none';
    keyBtn4.style.pointerEvents = 'none';
    const overlay = document.getElementById('overgrowth-overlay');
    if(overlay) overlay.style.opacity = '1.0';
  } else {
    keyBtn1.classList.remove('overgrowth-active');
    keyBtn4.classList.remove('overgrowth-active');
    keyBtn1.style.opacity = '1.0';
    keyBtn4.style.opacity = '1.0';
    keyBtn1.style.pointerEvents = 'auto';
    keyBtn4.style.pointerEvents = 'auto';
    const overlay = document.getElementById('overgrowth-overlay');
    if(overlay) overlay.style.opacity = '0.0';
  }

  // Update dynamic grimoire adaptation selections cooldown lockout
  const cooldownLabel = document.getElementById('loadout-cooldown-text');
  if (cooldownLabel) {
    const turnsPassed = state.combatEngine.turnNumber - state.lastLoadoutChangeTurn;
    
    if (turnsPassed < 3) {
      const turnsLeft = 3 - turnsPassed;
      cooldownLabel.textContent = `LOCKED (${turnsLeft} TURNS LEFT)`;
      cooldownLabel.className = "text-red-500 font-bold tracking-widest animate-pulse";
      
      // Disable HUD select dropdown elements
      for (let i = 0; i < 4; i++) {
        const select = document.getElementById(`loadout-select-${i}`);
        if (select) {
          select.disabled = true;
          select.style.cursor = 'not-allowed';
          select.style.opacity = '0.55';
        }
      }
    } else {
      cooldownLabel.textContent = "ADAPTATION READY";
      cooldownLabel.className = "text-neon-green font-bold tracking-widest";
      
      // Enable HUD select dropdown elements
      for (let i = 0; i < 4; i++) {
        const select = document.getElementById(`loadout-select-${i}`);
        if (select) {
          select.disabled = false;
          select.style.cursor = 'pointer';
          select.style.opacity = '1.0';
        }
      }
    }
  }
}

function resolveCombatTurn() {
  // Save executed player combo in recast prevention matrix
  state.lastCastArray = [...state.pendingPlayerCombo];

  try {
    const result = state.combatEngine.resolveTurn(
      state.pendingPlayerCombo, 
      state.pendingPlayerTarget, 
      state.pendingOpponentAction
    );
  } catch (error) {
    console.error("Combat Engine Turn Resolution Failed! Applying Safe Fallback. Error:", error);
    if (isNaN(state.combatEngine.playerHP) || !isFinite(state.combatEngine.playerHP)) {
      state.combatEngine.playerHP = 10;
    }
    if (isNaN(state.combatEngine.opponentHP) || !isFinite(state.combatEngine.opponentHP)) {
      state.combatEngine.opponentHP = 10;
    }
  } finally {
    // Clear inflight records
    state.currentCombo = [];
    state.targetVector = null;
    state.pendingPlayerCombo = [];
    state.pendingPlayerTarget = null;
    state.pendingOpponentAction = null;
    
    // Reset countdown back to 45.0s
    state.roundTimer = 45.0;
    state.turnInProgress = false;
    
    // Pre-generate opponent's planned action for the next round
    state.opponentPlannedAction = state.combatEngine.generateOpponentAction();
    state.opponentQueuedCombo = [];

    syncElementMeshes();
    updateHUD();

    // Check game over
    const pHP = state.combatEngine.playerHP;
    const oHP = state.combatEngine.opponentHP;
    if (pHP <= 0 || oHP <= 0) {
      state.turnInProgress = false; // Prevent resolveCombatTurn loop
      showGameOverScreen(pHP, oHP);
    }
  }
}

// ----------------------------------------------------
// DUAL COMBAT INTERACTION TRIGGERS (GESTURE & KEYBOARD)
// ----------------------------------------------------
function queueElement(elementName) {
  if (state.pregameActive || state.turnInProgress || state.gameOverActive) {
    return; 
  }

  // Echo cooldown lockout check: block equipping Echo if cooldown is active
  if (elementName === 'ECHO' && state.combatEngine.playerEchoCooldown > 0) {
    state.noShakeTimer = 0.35;
    state.combatEngine.logs.unshift(">> REJECTION: ECHO IS ON COOLDOWN.");
    updateHUD();
    return;
  }

  if (state.currentCombo.length >= 3) {
    return;
  }

  // 1. INCOMPATIBILITY CHECKS
  const tempCombo = [...state.currentCombo, elementName];
  
  const hasPulse = tempCombo.includes('PULSE');
  const hasChrome = tempCombo.includes('CHROME');
  const hasMirror = tempCombo.includes('MIRROR');
  const hasBlood = tempCombo.includes('BLOOD');
  const hasDecay = tempCombo.includes('DECAY');
  const hasCloud = tempCombo.includes('CLOUD');
  const hasVoid = tempCombo.includes('VOID');
  const hasLotus = tempCombo.includes('LOTUS');
  const hasEcho = tempCombo.includes('ECHO');

  // Echo cannot be combined with Void, Decay, or Mirror
  if (hasEcho && (hasVoid || hasDecay || hasMirror)) {
    state.noShakeTimer = 0.35;
    state.combatEngine.logs.unshift(">> REJECTION: COMBINATION_CONTRADICTION - ILLEGAL ECHO PAIRING DETECTED.");
    updateHUD();
    return;
  }

  let isIllegal = false;
  if (hasChrome && hasMirror) isIllegal = true;
  if (hasBlood && hasDecay) isIllegal = true;
  if (hasChrome && hasCloud) isIllegal = true;
  if (hasMirror && hasCloud) isIllegal = true;
  if (hasCloud && hasPulse) isIllegal = true;
  
  // Void can only be combined with Pulse
  if (hasVoid && tempCombo.length > 1 && !hasPulse) isIllegal = true; 
  if (hasVoid && hasPulse && tempCombo.length > 2) isIllegal = true; // Void+Pulse only

  if (hasLotus && hasVoid) isIllegal = true;
  if (hasLotus && hasDecay) isIllegal = true; 

  if (isIllegal) {
    state.noShakeTimer = 0.35; 
    state.combatEngine.logs.unshift(">> REJECTION: INCOMPATIBLE ELEMENTS DETECTED IN PALM.");
    updateHUD();
    return; 
  }

  // Add valid input
  state.currentCombo.push(elementName);
  triggerSparksOnAdd(elementName);
  
  syncElementMeshes();
  updateHUD();
}

function popElement() {
  if (state.pregameActive || state.turnInProgress || state.gameOverActive) return;
  if (state.currentCombo.length > 0) {
    state.currentCombo.pop();
    syncElementMeshes();
    updateHUD();
  }
}

function triggerSparksOnAdd(elName) {
  const pos = getPalmCentroid();
  const particleCount = 15;
  const positions = [];
  const velocities = [];
  const geo = new THREE.BufferGeometry();

  for (let i = 0; i < particleCount; i++) {
    positions.push(pos.x, pos.y, pos.z);
    velocities.push(
      (Math.random() - 0.5) * 0.12,
      (Math.random() - 0.5) * 0.12 + 0.08,
      (Math.random() - 0.5) * 0.12
    );
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  let color = 0xffffff;
  if (elName === 'BLOOD') color = 0xff0055;
  if (elName === 'VOID') color = 0xbd00ff;
  if (elName === 'CHROME') color = 0xe2e8f0;
  if (elName === 'DECAY') color = 0x00ff66;
  if (elName === 'MIRROR') color = 0x00f0ff;
  if (elName === 'CLOUD') color = 0x888888;
  if (elName === 'LOTUS') color = 0xff007f;
  if (elName === 'ECHO') color = 0x00ffcc;

  const mat = new THREE.PointsMaterial({
    color: color,
    size: 0.08,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geo, mat);
  scene.add(points);

  state.impactParticles.push({
    system: points,
    velocities: velocities,
    age: 0,
    maxAge: 15
  });
}

function combosEqual(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, index) => val === sortedB[index]);
}

function executeActiveCombo(vector) {
  if (state.pregameActive || state.turnInProgress || state.gameOverActive) return;
  
  // Recast Prevention check (Anti-Spam Matrix)
  if (combosEqual(state.currentCombo, state.lastCastArray)) {
    state.noShakeTimer = 0.35; // trigger horizontal "No" shake UX response
    state.combatEngine.logs.unshift(">> REJECTION: RECAST OF LAST ROUND'S COMBINATION PROHIBITED.");
    updateHUD();
    return;
  }
  
  if (vector === 'SELF') {
    const panel = document.getElementById('unified-dashboard-panel');
    if (panel) {
      panel.style.borderColor = '#bd00ff';
      panel.style.boxShadow = '0 0 20px #bd00ff, inset 0 0 10px #bd00ff';
      setTimeout(() => {
        panel.style.borderColor = '';
        panel.style.boxShadow = '';
      }, 300);
    }
  }
  
  state.targetVector = vector;
  state.turnInProgress = true;
  
  state.pendingPlayerCombo = [...state.currentCombo];
  state.pendingPlayerTarget = vector;
  
  // Align dynamic opponent planned combo and immediately flush the queue
  state.pendingOpponentAction = state.opponentPlannedAction || state.combatEngine.generateOpponentAction();
  state.opponentQueuedCombo = [...state.pendingOpponentAction.combo];

  state.currentCombo = [];
  syncElementMeshes();
  updateHUD();

  if (state.pendingPlayerCombo.length > 0) {
    spawnProjectileVFX(state.pendingPlayerCombo, state.pendingPlayerTarget, 'PLAYER');
  }
  
  if (state.pendingOpponentAction.combo.length > 0) {
    spawnProjectileVFX(state.pendingOpponentAction.combo, state.pendingOpponentAction.target, 'OPPONENT');
  }

  if (state.pendingPlayerCombo.length === 0 && state.pendingOpponentAction.combo.length === 0) {
    resolveCombatTurn();
  }
}

function executeForfeitTurn() {
  if (state.pregameActive || state.turnInProgress || state.gameOverActive) return;

  state.turnInProgress = true;
  state.combatEngine.logs.unshift("PLAYER FORFEITED ACTION PHASE (CLOCK HIT ZERO).");

  state.pendingPlayerCombo = [];
  state.pendingPlayerTarget = 'PROJECTILE';
  
  // Align dynamic opponent planned combo and immediately flush the queue
  state.pendingOpponentAction = state.opponentPlannedAction || state.combatEngine.generateOpponentAction();
  state.opponentQueuedCombo = [...state.pendingOpponentAction.combo];

  state.currentCombo = [];
  syncElementMeshes();
  updateHUD();

  if (state.pendingOpponentAction.combo.length > 0) {
    spawnProjectileVFX(state.pendingOpponentAction.combo, state.pendingOpponentAction.target, 'OPPONENT');
  } else {
    resolveCombatTurn();
  }
}

// ----------------------------------------------------
// DUAL LISTENERS: KEYBOARD FALLBACKS
// ----------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (state.pregameActive || state.gameOverActive) return; 
  
  const key = e.key;
  const isOvergrown = state.combatEngine.playerOvergrowthTurns > 0;

  if (key === '1' && !isOvergrown) queueElement(state.loadout[0]);
  if (key === '2') queueElement(state.loadout[1]);
  if (key === '3') queueElement(state.loadout[2]);
  if (key === '4' && !isOvergrown) queueElement(state.loadout[3]);

  if (key === 'Backspace' || key === 'Delete') {
    popElement();
  }

  if (key === ' ' || key === 'Enter') {
    e.preventDefault();
    if (state.currentCombo.length > 0) {
      let target = 'PROJECTILE';
      if (state.combatEngine.playerForceSelfCastNextTurn) {
        target = 'SELF';
      } else if (key === 'Enter') {
        target = 'SELF';
      }
      executeActiveCombo(target);
    }
  }
});

// ----------------------------------------------------
// PRE-GAME SELECTION SCREEN HARNESS
// ----------------------------------------------------
const pregameSelected = new Set();
const pregameBtns = document.querySelectorAll('.pregame-btn');
const pregameCountSpan = document.getElementById('pregame-selected-count');
const pregameLockBtn = document.getElementById('pregame-lock-btn');

pregameBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const el = btn.getAttribute('data-element');
    
    if (pregameSelected.has(el)) {
      pregameSelected.delete(el);
      btn.className = "pregame-btn p-3 border-2 border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800 text-center rounded-sm transition-all flex flex-col items-center";
    } else {
      if (pregameSelected.size >= 4) return; 
      pregameSelected.add(el);
      btn.className = "pregame-btn p-3 border-2 border-white bg-neon-blue text-zinc-950 font-bold text-center rounded-sm transition-all flex flex-col items-center";
    }
    
    pregameCountSpan.textContent = `${pregameSelected.size} / 4`;
    
    if (pregameSelected.size === 4) {
      pregameLockBtn.disabled = false;
      pregameLockBtn.className = "px-6 py-2 bg-white text-zinc-950 border border-white font-bold uppercase hover:bg-zinc-200 cursor-pointer transition-all";
    } else {
      pregameLockBtn.disabled = true;
      pregameLockBtn.className = "px-6 py-2 bg-zinc-800 border border-zinc-600 text-zinc-500 font-bold uppercase cursor-not-allowed hover:bg-zinc-700 transition-all";
    }
  });
});

// Dropdown System Manual open/close trigger
const manualToggleBtn = document.getElementById('manual-toggle-btn');
const manualDropdownPanel = document.getElementById('manual-dropdown-panel');
if (manualToggleBtn && manualDropdownPanel) {
  manualToggleBtn.addEventListener('click', () => {
    const isHidden = manualDropdownPanel.classList.toggle('hidden');
    manualDropdownPanel.style.display = isHidden ? 'none' : 'flex';
    manualToggleBtn.textContent = isHidden ? 'Show Combat Manual [▼]' : 'Hide Combat Manual [▲]';
  });
}

function startGameplay() {
  // Cross-fade immediately to a random battle theme track when locking loadouts
  const tracks = ['battle1', 'battle2', 'battle3', 'battle4', 'battle5', 'battle6'];
  const battleTrack = tracks[Math.floor(Math.random() * tracks.length)];
  audioManager.playTrack(battleTrack);

  const pMenu = document.getElementById('pregame-screen');
  pMenu.style.transition = 'opacity 500ms ease';
  pMenu.style.opacity = '0.0';
  
  setTimeout(() => {
    pMenu.style.display = 'none';
    const HUD = document.getElementById('gameplay-hud');
    HUD.style.opacity = '1.0';
    
    state.pregameActive = false;
    state.roundTimer = 45.0; // Reset round clock to 45.0s
    
    // Set first round planned action
    state.opponentPlannedAction = state.combatEngine.generateOpponentAction();
    state.opponentQueuedCombo = [];

    state.combatEngine.logs.unshift("LOADOUT LOCKED. SYSTEM INITIATED. COMMENCE COMBAT.");
    updateHUD();
  }, 500);
}

pregameLockBtn.addEventListener('click', () => {
  if (pregameSelected.size !== 4) return;
  
  state.loadout = Array.from(pregameSelected);
  state.lastLoadoutChangeTurn = -10; // reset grimoire swap cooldown
  
  for (let i = 0; i < 4; i++) {
    const el = state.loadout[i];
    const select = document.getElementById(`loadout-select-${i}`);
    select.value = el; // Set pre-game choice value in HUD selects
    document.getElementById(`key-label-${i+1}`).textContent = el;
  }

  // Register dynamic grimoire adaptation listeners (allow 1 change every 3 turns)
  for (let i = 0; i < 4; i++) {
    const select = document.getElementById(`loadout-select-${i}`);
    select.addEventListener('change', (e) => {
      if (state.pregameActive || state.gameOverActive || state.turnInProgress) {
        select.value = state.loadout[i];
        return;
      }

      const turnsPassed = state.combatEngine.turnNumber - state.lastLoadoutChangeTurn;
      if (turnsPassed < 3) {
        // Cooldown lockout
        state.combatEngine.logs.unshift(`>> ADAPTATION REJECTED: grimoire cooldown active (${3 - turnsPassed} turns left).`);
        select.value = state.loadout[i]; // revert
        updateHUD();
        return;
      }

      const oldEl = state.loadout[i];
      const newEl = e.target.value;

      state.loadout[i] = newEl;
      document.getElementById(`key-label-${i+1}`).textContent = newEl;
      state.lastLoadoutChangeTurn = state.combatEngine.turnNumber;

      // Trigger spark flash
      triggerSparksOnAdd(newEl);

      state.combatEngine.logs.unshift(`>> GRIMOIRE SWAP: Slot ${i+1} adapted [${oldEl} → ${newEl}].`);
      updateHUD();
    });
  }

  startGameplay();
});



document.getElementById('key-btn-1').addEventListener('click', () => queueElement(state.loadout[0]));
document.getElementById('key-btn-2').addEventListener('click', () => queueElement(state.loadout[1]));
document.getElementById('key-btn-3').addEventListener('click', () => queueElement(state.loadout[2]));
document.getElementById('key-btn-4').addEventListener('click', () => queueElement(state.loadout[3]));
document.getElementById('key-btn-backspace').addEventListener('click', () => popElement());
document.getElementById('key-btn-space').addEventListener('click', () => {
  if (state.currentCombo.length > 0) {
    executeActiveCombo('PROJECTILE');
  }
});
document.getElementById('key-btn-enter').addEventListener('click', () => {
  if (state.currentCombo.length > 0) {
    executeActiveCombo('SELF');
  }
});

// ----------------------------------------------------
// GAME OVER OVERLAY UTILITIES & RESET BINDINGS
// ----------------------------------------------------
function showGameOverScreen(pHP, oHP) {
  if (state.gameOverScreenShown) return;
  state.gameOverScreenShown = true;
  state.gameOverActive = true;
  
  const goScreen = document.getElementById('gameover-screen');
  const goTitle = document.getElementById('gameover-title');
  const goSubtitle = document.getElementById('gameover-subtitle');
  const goDetails = document.getElementById('gameover-details');
  
  if (pHP <= 0 && oHP <= 0) {
    goTitle.textContent = "MUTUAL_DEATH_";
    goTitle.className = "menu-title draw text-4xl glitch-text mb-2 uppercase";
    goSubtitle.textContent = "BOTH COMBATANTS HAVE FALLEN IN THE SYSTEM MATRIX";
  } else if (pHP <= 0) {
    goTitle.textContent = "DEFEAT_";
    goTitle.className = "menu-title defeat text-4xl glitch-text mb-2 uppercase";
    goSubtitle.textContent = "METALHEART MATRIX SHATTERED";
  } else {
    goTitle.textContent = "VICTORY_";
    goTitle.className = "menu-title victory text-4xl glitch-text mb-2 uppercase";
    goSubtitle.textContent = "ARENA CONQUERED - MESH SHATTERED";
  }
  
  goDetails.innerHTML = `
    <div>ROUND REACHED: <span class="text-white font-bold">${state.combatEngine.turnNumber}</span></div>
    <div>PLAYER FINAL HP: <span class="text-neon-blue font-bold">${pHP} / 10</span></div>
    <div>OPPONENT FINAL HP: <span class="text-neon-red font-bold">${oHP} / 10</span></div>
    <div class="mt-2 text-[9px] text-zinc-500">TRIAL CONCLUDED. CORE SEGMENT DEALLOCATED.</div>
  `;
  
  goScreen.style.display = 'flex';
  goScreen.style.opacity = '0.0';
  goScreen.style.transition = 'opacity 500ms ease';
  
  // Bring logs panel to front
  const logsPanel = document.getElementById('logs-panel');
  logsPanel.style.position = 'relative';
  logsPanel.style.zIndex = '70';
  
  setTimeout(() => {
    goScreen.style.opacity = '1.0';
  }, 50);
}

document.getElementById('gameover-retry-btn').addEventListener('click', () => {
  const goScreen = document.getElementById('gameover-screen');
  goScreen.style.transition = 'opacity 400ms ease';
  goScreen.style.opacity = '0.0';
  
  // Fade back to menu BGM track immediately
  const menuTracks = ['menu1', 'menu2', 'menu3'];
  audioManager.playTrack(menuTracks[Math.floor(Math.random() * menuTracks.length)]);

  setTimeout(() => {
    goScreen.style.display = 'none';
    
    // Reset all game state variables
    state.gameOverActive = false;
    state.gameOverScreenShown = false;
    state.pregameActive = true;
    state.currentCombo = [];
    state.targetVector = null;
    state.lastCastArray = []; // reset recast prevention matrix
    state.roundTimer = 45.0; // Recalibrate round timer baseline
    state.lastLoadoutChangeTurn = -10; // reset grimoire swap cooldown
    
    // Reset logs panel z-index
    const logsPanel = document.getElementById('logs-panel');
    logsPanel.style.position = '';
    logsPanel.style.zIndex = '';
    
    // Purge AI queued/spark segments
    state.opponentPlannedAction = null;
    state.opponentQueuedCombo = [];
    state.opponentSparks.forEach(s => scene.remove(s.system));
    state.opponentSparks = [];

    // Reset the combat engine
    state.combatEngine.reset();
    
    // Re-show pregame selector screen
    const pMenu = document.getElementById('pregame-screen');
    pMenu.style.display = 'flex';
    pMenu.style.opacity = '1.0';
    
    // Hide gameplay HUD
    const HUD = document.getElementById('gameplay-hud');
    HUD.style.opacity = '0.0';
    
    // Reset pregame buttons selected state
    pregameSelected.clear();
    pregameBtns.forEach(btn => {
      btn.className = "pregame-btn p-3 border-2 border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800 text-center rounded-sm transition-all flex flex-col items-center";
    });
    pregameCountSpan.textContent = "0 / 4";
    pregameLockBtn.disabled = true;
    pregameLockBtn.className = "px-6 py-2 bg-zinc-800 border border-zinc-600 text-zinc-500 font-bold uppercase cursor-not-allowed hover:bg-zinc-700 transition-all";
    
    syncElementMeshes();
    updateHUD();
  }, 400);
});

// Bind Mute HUD toggle button
const muteBtn = document.getElementById('toggle-mute-btn');
muteBtn.addEventListener('click', () => {
  const isMuted = audioManager.toggleMute();
  muteBtn.textContent = isMuted ? "Mute: On" : "Mute: Off";
  muteBtn.className = isMuted ? 
    "pointer-events-auto px-2 py-0.5 bg-red-950/40 border border-red-800 text-red-400 font-mono text-[9px] active:bg-red-950 uppercase" : 
    "pointer-events-auto px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-white font-mono text-[9px] border border-zinc-600 active:bg-zinc-900 uppercase";
});

// Unlock Web Audio context on window click
window.addEventListener('click', () => {
  audioManager.unlock();
  if (state.pregameActive) {
    const menuTracks = ['menu1', 'menu2', 'menu3'];
    audioManager.playTrack(menuTracks[Math.floor(Math.random() * menuTracks.length)]);
  }
}, { once: true });

// ----------------------------------------------------
// DYNAMIC AI QUEUEING & SPARK EMITTERS
// ----------------------------------------------------
function updateOpponentAIQueue() {
  if (state.pregameActive || state.turnInProgress || state.gameOverActive || !state.opponentPlannedAction) return;
  
  const plannedCombo = state.opponentPlannedAction.combo;
  const currentLen = state.opponentQueuedCombo.length;
  
  if (plannedCombo.length === 0) return;
  
  let targetLen = 0;
  if (plannedCombo.length === 1) {
    if (state.roundTimer < 32.0) targetLen = 1;
  } else if (plannedCombo.length === 2) {
    if (state.roundTimer < 36.0) targetLen = 1;
    if (state.roundTimer < 18.0) targetLen = 2;
  } else if (plannedCombo.length === 3) {
    if (state.roundTimer < 38.0) targetLen = 1;
    if (state.roundTimer < 25.0) targetLen = 2;
    if (state.roundTimer < 12.0) targetLen = 3;
  }
  
  while (state.opponentQueuedCombo.length < targetLen) {
    state.opponentQueuedCombo.push(plannedCombo[state.opponentQueuedCombo.length]);
  }
}

function updateOpponentSparks(time, deltaTime) {
  if (Math.random() < 0.15 && !state.pregameActive && !state.gameOverActive) {
    const combo = state.opponentQueuedCombo;
    let colorHex = 0x222222; // default faint ambient spark
    
    if (combo.length > 0) {
      const el = combo[Math.floor(Math.random() * combo.length)];
      if (el === 'BLOOD') colorHex = 0xff0055;
      else if (el === 'VOID') colorHex = 0xbd00ff;
      else if (el === 'CHROME') colorHex = 0xe2e8f0;
      else if (el === 'DECAY') colorHex = 0x00ff66;
      else if (el === 'MIRROR') colorHex = 0x00f0ff;
      else if (el === 'CLOUD') colorHex = 0x888888;
      else if (el === 'PULSE') colorHex = 0xffffff;
      else if (el === 'LOTUS') colorHex = 0xff007f;
    }
    
    const geo = new THREE.BufferGeometry();
    const pos = [
      (Math.random() - 0.5) * 1.5, // width offset
      0.2 + (Math.random() - 0.5) * 1.6, // vertical mannequin bounds
      -9.0 + (Math.random() - 0.5) * 0.5 // depth offset around mannequin
    ];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    
    const mat = new THREE.PointsMaterial({
      color: colorHex,
      size: 0.08 + Math.random() * 0.08,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending
    });
    
    const point = new THREE.Points(geo, mat);
    scene.add(point);
    
    state.opponentSparks.push({
      system: point,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.12,
        0.3 + Math.random() * 0.4, // rising drift speed
        (Math.random() - 0.5) * 0.12
      ),
      age: 0,
      maxAge: 30 + Math.floor(Math.random() * 25)
    });
  }
  
  const remaining = [];
  state.opponentSparks.forEach(spark => {
    spark.age++;
    const posAttr = spark.system.geometry.attributes.position;
    posAttr.array[0] += spark.velocity.x * deltaTime;
    posAttr.array[1] += spark.velocity.y * deltaTime;
    posAttr.array[2] += spark.velocity.z * deltaTime;
    posAttr.needsUpdate = true;
    
    spark.system.material.opacity = (1.0 - (spark.age / spark.maxAge)) * 0.7;
    
    if (spark.age >= spark.maxAge) {
      scene.remove(spark.system);
    } else {
      remaining.push(spark);
    }
  });
  state.opponentSparks = remaining;
}



// ----------------------------------------------------
// SYSTEM TICK & ANIMATION LOOP
// ----------------------------------------------------
const clock = new THREE.Clock();
const targetDelta = 1 / 60;
let timeAccumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  timeAccumulator += delta;

  if (timeAccumulator < targetDelta) return;

  const time = clock.getElapsedTime();
  const deltaTime = timeAccumulator;
  timeAccumulator = timeAccumulator % targetDelta;

  // Cap delta time to prevent massive physics leaps during lag spikes
  const safeDelta = Math.min(deltaTime, 0.1);
  
  // 1. Decelerate incompatibility shake timer
  if (state.noShakeTimer > 0) {
    state.noShakeTimer -= safeDelta;
  }
  
  // 2. Play 45s Countdown Clock
  if (!state.pregameActive && !state.turnInProgress && !state.gameOverActive) {
    state.roundTimer -= safeDelta;
    if (state.roundTimer <= 0) {
      state.roundTimer = 0;
      executeForfeitTurn();
    }
    document.getElementById('round-timer-hud').textContent = `${state.roundTimer.toFixed(1)}s`;
    
    // Pulse round clock visual red when low on time (extended to 10s alert)
    if (state.roundTimer < 10.0) {
      document.getElementById('round-timer-hud').className = "text-base font-bold text-neon-red glow-text-red tracking-wider animate-pulse";
    } else {
      document.getElementById('round-timer-hud').className = "text-base font-bold text-neon-blue glow-text-cyan tracking-wider";
    }
  }

  // 3. Play Camera Screen Hit Shake
  if (state.shakeIntensity > 0) {
    camera.position.x = (Math.random() - 0.5) * state.shakeIntensity;
    camera.position.y = 1.0 + (Math.random() - 0.5) * state.shakeIntensity;
    state.shakeIntensity *= 0.90; 
    if (state.shakeIntensity < 0.01) {
      state.shakeIntensity = 0;
      camera.position.set(0, 1, 5);
    }
  }

  // 4. Update player palm kinematics
  updatePlayerPalm(time);
  
  // 5. Update floating combo shapes
  updateElementPositions(time);

  // Update dynamic opponent AI elements queue and sparks emitters
  updateOpponentAIQueue();
  updateOpponentSparks(time, safeDelta);

  // Swirl and update active status vapor cloud particles
  updateStatusVaporParticles(time, safeDelta);

  // 6. Translate active projectiles in flight
  updateProjectiles(time);

  // 7. Update impact particles
  updateImpactParticles();

  // Update Distant Monoliths Floating Heights
  monoliths.forEach(mono => {
    mono.mesh.position.y = mono.baseY + Math.sin(time * mono.speed + mono.phase) * 1.8;
    mono.mesh.rotation.y = time * 0.02;
  });

  // Update drifting wireframe background grids
  gridHelper1.position.z += Math.sin(time * 0.2) * 0.005;
  gridHelper1.position.x += Math.cos(time * 0.1) * 0.005;
  gridHelper2.rotation.y = time * 0.015;
  gridHelper2.position.y += Math.sin(time * 0.3) * 0.003;

  // Swirl the opponent smokescreen cloud parts if active
  if (opponentCloudGroup.visible) {
    opponentCloudGroup.rotation.y += 0.5 * deltaTime;
    cloudParts.forEach((part, idx) => {
      part.rotation.x += 0.25 * deltaTime * (idx + 1);
      part.rotation.y += 0.15 * deltaTime * (idx + 1);
    });
  }

  // Update far orbiting shards
  farShards.forEach(s => {
    s.angle += s.speed * deltaTime;
    s.mesh.position.x = Math.cos(s.angle) * s.radius;
    s.mesh.position.y = s.baseY + Math.sin(time * 0.5 + s.angle) * 0.8;
    s.mesh.rotation.x += s.rotSpeedX * deltaTime;
    s.mesh.rotation.y += s.rotSpeedY * deltaTime;
    s.mesh.rotation.z += s.rotSpeedZ * deltaTime;
  });

  // Pulse Blindness 3D Blinding Fog & Background Warp
  if (state.combatEngine.playerBlindTurns > 0) {
    scene.background = new THREE.Color(0xffffff);
    if (scene.fog) {
      scene.fog.color.setHex(0xffffff);
      scene.fog.density = 0.09; // dense whiteout fog
    }
  } else {
    scene.background = skyboxTexture || new THREE.Color(0x080808);
    if (scene.fog) {
      scene.fog.color.setHex(0x080808);
      scene.fog.density = 0.015; // normal dark tech fog
    }
  }

  
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

  // Rotate Charles Totems
  if (playerCharlesTotemGroup.visible) {
    playerCharlesTotemGroup.rotation.y += 0.5 * dt;
  }
  if (opponentCharlesTotemGroup.visible) {
    opponentCharlesTotemGroup.rotation.y += 0.5 * dt;
  }

  // Handle Delayed Strike wireframe cone rendering
  const hasPlayerDelayedStrike = state.combatEngine.playerStatuses.some(s => s.id === 'delayed_strike');
  if (hasPlayerDelayedStrike) {
    if (playerDelayedStrikeGroup.children.length === 0) {
      let mesh;
      const wireframeMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true });
      if (window.cachedEchoModel) {
        mesh = window.cachedEchoModel.clone();
        mesh.traverse((child) => {
          if (child.isMesh) {
            child.material = wireframeMat;
          }
        });
        mesh.scale.set(0.65, 0.65, 0.65);
      } else {
        const geometry = new THREE.ConeGeometry(0.5, 1.0, 12, 1, true);
        mesh = new THREE.Mesh(geometry, wireframeMat);
      }
      playerDelayedStrikeGroup.add(mesh);
    }
    playerDelayedStrikeGroup.visible = true;
    playerDelayedStrikeGroup.rotation.y += 0.25 * dt; // Spin 75% slower
  } else {
    playerDelayedStrikeGroup.visible = false;
    while(playerDelayedStrikeGroup.children.length > 0) {
      playerDelayedStrikeGroup.remove(playerDelayedStrikeGroup.children[0]);
    }
  }

  const hasOpponentDelayedStrike = state.combatEngine.opponentStatuses.some(s => s.id === 'delayed_strike');
  if (hasOpponentDelayedStrike) {
    if (opponentDelayedStrikeGroup.children.length === 0) {
      let mesh;
      const wireframeMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4, wireframe: true }); // matching teal color
      if (window.cachedEchoModel) {
        mesh = window.cachedEchoModel.clone();
        mesh.traverse((child) => {
          if (child.isMesh) {
            child.material = wireframeMat;
          }
        });
        mesh.scale.set(0.65, 0.65, 0.65);
      } else {
        const geometry = new THREE.ConeGeometry(0.5, 1.0, 12, 1, true);
        mesh = new THREE.Mesh(geometry, wireframeMat);
      }
      opponentDelayedStrikeGroup.add(mesh);
    }
    opponentDelayedStrikeGroup.visible = true;
    opponentDelayedStrikeGroup.rotation.y += 0.25 * dt; // Spin 75% slower
  } else {
    opponentDelayedStrikeGroup.visible = false;
    while(opponentDelayedStrikeGroup.children.length > 0) {
      opponentDelayedStrikeGroup.remove(opponentDelayedStrikeGroup.children[0]);
    }
  }


  // 8. Resolve turn math after flight renders complete
  if (state.turnInProgress && state.activeProjectiles.length === 0) {
    resolveCombatTurn();
  }

  renderer.render(scene, camera);
}

// ----------------------------------------------------
// WINDOW RESIZE BINDING
// ----------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ----------------------------------------------------
// MULTIPLAYER NETWORKING LOGIC (PEERJS)
// ----------------------------------------------------
const hostBtn = document.getElementById('host-game-btn');
const joinBtn = document.getElementById('join-game-btn');
const joinInput = document.getElementById('join-code-input');
const statusPanel = document.getElementById('network-status-panel');
const statusText = document.getElementById('network-status-text');
const roomCodeDisplay = document.getElementById('room-code-display');
const roomCodeVal = document.getElementById('room-code-val');

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function handleConnection(connection) {
  conn = connection;
  conn.on('open', () => {
    statusText.textContent = "CONNECTION ESTABLISHED! STARTING...";
    statusText.className = "text-neon-green font-bold animate-pulse";
    isNetworkGameStarted = true;
    setTimeout(startGameplay, 1000);
  });
  
  conn.on('data', (data) => {
    if (data.type === 'ACTION_COMMIT') {
      opponentActionReceived = data.action;
      checkTurnResolution();
    } else if (data.type === 'TURN_RESOLUTION') {
      applyTurnResolution(data);
    } else if (data.type === 'REMATCH_REQUEST') {
      handleRematchRequest();
    } else if (data.type === 'REMATCH_START') {
      executeRematch();
    } else if (data.type === 'BACK_TO_LOBBY') {
      window.location.reload();
    }
  });
}

if (hostBtn && joinBtn) {
  hostBtn.addEventListener('click', () => {
    isHost = true;
    const code = generateRoomCode();
    statusPanel.classList.remove('hidden');
    statusText.textContent = "INITIALIZING HOST...";
    
    peer = new Peer('METALHEART_' + code);
    peer.on('open', (id) => {
      statusText.textContent = "AWAITING GUEST CONNECTION...";
      roomCodeDisplay.classList.remove('hidden');
      roomCodeVal.textContent = code;
    });
    
    peer.on('connection', (connection) => {
      handleConnection(connection);
    });
  });

  joinBtn.addEventListener('click', () => {
    isHost = false;
    const code = joinInput.value.toUpperCase();
    if (code.length !== 4) {
      joinInput.style.borderColor = '#ef4444';
      return;
    }
    joinInput.style.borderColor = '#bd00ff';
    statusPanel.classList.remove('hidden');
    statusText.textContent = "CONNECTING TO HOST...";
    
    peer = new Peer();
    peer.on('open', (id) => {
      const connection = peer.connect('METALHEART_' + code);
      handleConnection(connection);
    });
  });
}

// Initialize HUD
updateHUD();

// Start Animation loop
animate();
