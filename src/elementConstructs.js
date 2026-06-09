import * as THREE from 'three';
import { createMetalheartMaterial, createBloodMaterial, createVoidMaterial, createLotusMaterial, createCloudMaterial, createDecayMaterial, createEchoMaterial } from './shader';



/**
 * Creates a 3D construct for a given element type.
 * @param {string} type - The element type: 'MIRROR', 'BLOOD', 'PULSE', 'CHROME', 'DECAY', 'VOID', 'CLOUD'
 * @returns {THREE.Object3D} The mesh or group representing the element
 */
export function createElementMesh(type) {
  const group = new THREE.Group();
  group.name = `element_${type}`;
  
  // Custom userData to store update parameters
  group.userData = {
    type: type,
    creationTime: performance.now(),
    particles: null, // Used for DECAY sparks
    pulseLines: null, // Used for PULSE static lines
    cloudSpheres: [], // Used for CLOUD spheres
  };

  switch (type) {
    case 'MIRROR': {
      // Mirror (Blue): A thin, multi-faceted crystal prism (3-4 sided Cylinder)
      // cylinder: radiusTop, radiusBottom, height, radialSegments
      const geometry = new THREE.CylinderGeometry(0.35, 0.35, 0.9, 4);
      const material = createMetalheartMaterial(new THREE.Vector3(0.4, 0.75, 1.0));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.baseColorScale = new THREE.Vector3(0.4, 0.75, 1.0); // Save base color scale
      mesh.rotation.x = Math.PI / 4;
      mesh.rotation.y = Math.PI / 4;
      group.add(mesh);
      break;
    }
    
    case 'BLOOD': {
      // Blood (Red): A smooth orb warping over time
      const geometry = new THREE.SphereGeometry(0.45, 32, 32);
      const material = createBloodMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      break;
    }
    
    case 'PULSE': {
      // Pulse (White): A blinding white emissive core + crackling line segments
      // Core:
      const coreGeo = new THREE.SphereGeometry(0.2, 16, 16);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      group.add(core);

      // Crackling Lines:
      const lineCount = 15;
      const positions = [];
      for (let i = 0; i < lineCount; i++) {
        // Line start (near core)
        positions.push(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1
        );
        // Line end (extending out)
        const dir = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5
        ).normalize().multiplyScalar(0.5 + Math.random() * 0.3);
        positions.push(dir.x, dir.y, dir.z);
      }
      
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
      const lines = new THREE.LineSegments(lineGeo, lineMat);
      
      group.userData.pulseLines = lines;
      group.add(lines);
      break;
    }
    
    case 'CHROME': {
      // Chrome (Silver): An irregular, jagged rock (low detail Icosahedron)
      const geometry = new THREE.IcosahedronGeometry(0.45, 0);
      const material = createMetalheartMaterial(new THREE.Vector3(1.0, 1.0, 1.0));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.baseColorScale = new THREE.Vector3(1.0, 1.0, 1.0); // Save base color scale
      group.add(mesh);
      break;
    }
    
    case 'DECAY': {
      // Decay (Green): Sharp, low-poly pyramid geometry using toxic green glossy material
      const geometry = new THREE.ConeGeometry(0.28, 0.55, 4); // 4 radial segments = pyramid
      const material = createDecayMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);

      // Green Sparks Particle System:
      const particleCount = 35;
      const partGeo = new THREE.BufferGeometry();
      const positions = [];
      const velocities = [];
      const lifespans = [];

      for (let i = 0; i < particleCount; i++) {
        // Spawn at center
        positions.push(0, 0, 0);
        // Random velocity outward
        velocities.push(
          (Math.random() - 0.5) * 0.04,
          (Math.random() - 0.5) * 0.04 + 0.02, // slight upward drift
          (Math.random() - 0.5) * 0.04
        );
        lifespans.push(Math.random()); // percentage of life (0.0 to 1.0)
      }

      partGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      
      const partMat = new THREE.PointsMaterial({
        color: 0x00ff44,
        size: 0.06,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
      });
      
      const particles = new THREE.Points(partGeo, partMat);
      group.userData.particles = {
        system: particles,
        velocities: velocities,
        lifespans: lifespans,
        count: particleCount
      };
      group.add(particles);
      break;
    }
    
    case 'VOID': {
      // Void (Purple): Spinning torus with inward pulling dark purple gradient
      const geometry = new THREE.TorusGeometry(0.35, 0.1, 16, 64);
      const material = createVoidMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      group.add(mesh);
      break;
    }
    
    case 'CLOUD': {
      // Cloud (Gray): Clustered icosahedron geometries styled like BLOOD, using misty iridescent gray material
      const sphereGeo = new THREE.IcosahedronGeometry(0.15, 0); // sharp faceted edges
      const sphereMat = createCloudMaterial();
      
      const offsets = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.2, 0.1, -0.1),
        new THREE.Vector3(-0.2, -0.1, 0.1),
        new THREE.Vector3(-0.15, 0.15, -0.15),
        new THREE.Vector3(0.15, -0.15, 0.15)
      ];

      offsets.forEach((offset, idx) => {
        const sm = new THREE.Mesh(sphereGeo, sphereMat);
        sm.position.copy(offset);
        group.userData.cloudSpheres.push({
          mesh: sm,
          baseOffset: offset,
          speed: 1.0 + idx * 0.5,
          phase: Math.random() * Math.PI * 2
        });
        group.add(sm);
      });
      break;
    }
    
    case 'LOTUS': {
      let mesh;
      const material = createLotusMaterial();
      
      if (window.cachedLotusModel) {
        mesh = window.cachedLotusModel.clone();
        mesh.traverse((child) => {
          if (child.material) {
            child.material = material;
          }
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        mesh.scale.set(0.42, 0.42, 0.42);
      } else {
        const geometry = new THREE.IcosahedronGeometry(0.42, 0);
        mesh = new THREE.Mesh(geometry, material);
      }
      
      mesh.userData.baseColorScale = new THREE.Vector3(1.0, 0.0, 0.5);
      group.add(mesh);
      break;
    }
    
    case 'ECHO': {
      let mesh;
      const material = createEchoMaterial();
      
      if (window.cachedEchoModel) {
        mesh = window.cachedEchoModel.clone();
        mesh.traverse((child) => {
          if (child.material) {
            child.material = material;
          }
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        mesh.scale.set(0.45, 0.45, 0.45);
      } else {
        // Fallback to simple open-ended cone geometry
        const geometry = new THREE.ConeGeometry(0.35, 0.7, 12, 1, true);
        mesh = new THREE.Mesh(geometry, material);
      }
      
      mesh.userData.baseColorScale = new THREE.Vector3(0.0, 0.95, 0.85); // electric teal tint
      group.add(mesh);

      // Electric Teal/Cyan small spinning particles coming off the top:
      const particleCount = 20;
      const partGeo = new THREE.BufferGeometry();
      const positions = [];
      const velocities = [];
      const lifespans = [];

      for (let i = 0; i < particleCount; i++) {
        // Spawn randomly in a circle around the top of the cone (y ~ 0.28 to 0.35)
        const theta = Math.random() * Math.PI * 2;
        const r = 0.15 + Math.random() * 0.1;
        const px = Math.cos(theta) * r;
        const py = 0.28 + (Math.random() - 0.5) * 0.04;
        const pz = Math.sin(theta) * r;
        
        positions.push(px, py, pz);

        // Circular tangent velocity: (-sin, cos) in XZ + upward/outward drift
        const speed = 0.015 + Math.random() * 0.01;
        const upSpeed = 0.008 + Math.random() * 0.008;
        const outSpeed = 0.005 + Math.random() * 0.005;
        
        velocities.push(
          -Math.sin(theta) * speed + Math.cos(theta) * outSpeed,
          upSpeed,
          Math.cos(theta) * speed + Math.sin(theta) * outSpeed
        );

        lifespans.push(Math.random()); // starts at a random age
      }

      partGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      
      const partMat = new THREE.PointsMaterial({
        color: 0x000000, // Black particles
        size: 0.035,
        transparent: true,
        opacity: 0.9 // Higher opacity for visibility
      });
      
      const particles = new THREE.Points(partGeo, partMat);
      group.userData.particles = {
        system: particles,
        velocities: velocities,
        lifespans: lifespans,
        count: particleCount
      };
      group.add(particles);
      break;
    }
  }

  return group;
}

/**
 * Updates animations for a given construct mesh.
 * @param {THREE.Object3D} group - The construct group
 * @param {number} time - Current elapsed time in seconds
 */
export function updateElementMesh(group, time) {
  const type = group.userData.type;

  // 1. Overall floating / bobbing idle loop above hand palm
  const bobHeight = Math.sin(time * 3.5 + group.userData.creationTime * 0.001) * 0.15;
  group.position.y += bobHeight * 0.02; // slow accumulation or set relative offsets in main.js
  
  // Apply rotation to main mesh child
  group.children.forEach(child => {
    if (child.isMesh && type !== 'BLOOD') {
      child.rotation.y += 0.02;
      child.rotation.z += 0.01;
    }
  });

  // 2. Element-specific Shader Uniform updates
  group.traverse(child => {
    if (child.material && child.material.uniforms && child.material.uniforms.uTime) {
      child.material.uniforms.uTime.value = time;
    }
  });

  // 3. Custom animation logic per element type
  switch (type) {
    case 'PULSE': {
      // Crackle the pulse line vertices
      const lines = group.userData.pulseLines;
      if (lines) {
        const posAttr = lines.geometry.attributes.position;
        const count = posAttr.count;
        for (let i = 0; i < count; i++) {
          if (i % 2 !== 0) { // Only jitter the outer vertices of the line segments
            const index = i * 3;
            // Generate a fresh random vector and smooth it
            const baseDir = new THREE.Vector3(
              posAttr.array[index],
              posAttr.array[index + 1],
              posAttr.array[index + 2]
            ).normalize();
            
            // Jitter magnitude
            const magnitude = 0.45 + Math.sin(time * 20.0 + i) * 0.2;
            const newPos = baseDir.multiplyScalar(magnitude);
            
            posAttr.array[index] = newPos.x;
            posAttr.array[index + 1] = newPos.y;
            posAttr.array[index + 2] = newPos.z;
          }
        }
        posAttr.needsUpdate = true;
      }
      break;
    }

    case 'DECAY': {
      // Spin the Pyramid in multiple dimensions
      const mesh = group.children[0];
      if (mesh) {
        mesh.rotation.x = time * 1.5;
        mesh.rotation.y = time * 2.2;
      }
      
      // Animate decaying green spark particles
      const parts = group.userData.particles;
      if (parts) {
        const posAttr = parts.system.geometry.attributes.position;
        const velocities = parts.velocities;
        const lifespans = parts.lifespans;
        const count = parts.count;

        for (let i = 0; i < count; i++) {
          lifespans[i] += 0.015; // age the particle
          
          if (lifespans[i] >= 1.0) {
            // Respawn at core center
            posAttr.setXYZ(i, 0, 0, 0);
            lifespans[i] = 0.0;
          } else {
            // Move particle along its velocity vector
            const px = posAttr.getX(i) + velocities[i * 3];
            const py = posAttr.getY(i) + velocities[i * 3 + 1];
            const pz = posAttr.getZ(i) + velocities[i * 3 + 2];
            posAttr.setXYZ(i, px, py, pz);
          }
        }
        posAttr.needsUpdate = true;
      }
      break;
    }

    case 'CLOUD': {
      // Make spheres drift around each other in a micro-cloud
      const spheres = group.userData.cloudSpheres;
      spheres.forEach(item => {
        const t = time * item.speed + item.phase;
        item.mesh.position.x = item.baseOffset.x + Math.sin(t) * 0.12;
        item.mesh.position.y = item.baseOffset.y + Math.cos(t * 1.5) * 0.12;
        item.mesh.position.z = item.baseOffset.z + Math.sin(t * 0.8) * 0.12;
      });
      break;
    }
    
    case 'VOID': {
      // Spin the torus in multiple dimensions
      const torus = group.children[0];
      if (torus) {
        torus.rotation.x = time * 1.5;
        torus.rotation.y = time * 2.2;
      }
      break;
    }
    
    case 'LOTUS': {
      // Rotate and breathe the pink glass geometric bud
      const mesh = group.children[0];
      if (mesh) {
        mesh.rotation.y = time * 2.0;
        mesh.rotation.z = time * 1.0;
        const scaleVal = 1.0 + Math.sin(time * 4.0) * 0.05;
        if (window.cachedLotusModel) {
          const s = scaleVal * 0.42;
          mesh.scale.set(s, s, s);
        } else {
          mesh.scale.set(scaleVal, scaleVal, scaleVal);
        }
      }
      break;
    }
    
    case 'ECHO': {
      const mesh = group.children[0];
      if (mesh) {
        // Spin 75% slower (originally time * 12.0)
        mesh.rotation.y = time * 3.0;
      }
      
      // Update the small teal particles spinning off the top
      const parts = group.userData.particles;
      if (parts) {
        const posAttr = parts.system.geometry.attributes.position;
        const velocities = parts.velocities;
        const lifespans = parts.lifespans;
        const count = parts.count;

        for (let i = 0; i < count; i++) {
          lifespans[i] += 0.015; // age the particle
          
          if (lifespans[i] >= 1.0) {
            // Respawn at a circular ring near the top of the cone
            const theta = Math.random() * Math.PI * 2;
            const r = 0.15 + Math.random() * 0.1;
            const px = Math.cos(theta) * r;
            const py = 0.28 + (Math.random() - 0.5) * 0.04;
            const pz = Math.sin(theta) * r;
            posAttr.setXYZ(i, px, py, pz);
            lifespans[i] = 0.0;
            
            // Recalculate tangent spin velocity
            const speed = 0.015 + Math.random() * 0.01;
            const upSpeed = 0.008 + Math.random() * 0.008;
            const outSpeed = 0.005 + Math.random() * 0.005;
            
            velocities[i * 3] = -Math.sin(theta) * speed + Math.cos(theta) * outSpeed;
            velocities[i * 3 + 1] = upSpeed;
            velocities[i * 3 + 2] = Math.cos(theta) * speed + Math.sin(theta) * outSpeed;
          } else {
            // Move particle along its velocity vector
            const px = posAttr.getX(i) + velocities[i * 3];
            const py = posAttr.getY(i) + velocities[i * 3 + 1];
            const pz = posAttr.getZ(i) + velocities[i * 3 + 2];
            posAttr.setXYZ(i, px, py, pz);
          }
        }
        posAttr.needsUpdate = true;
      }
      break;
    }
  }
}

// Flat solid white material overlay for "No" Shake flash feedback
const flatWhiteMeshMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const flatWhiteLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
const flatWhitePointsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });

/**
 * Toggles a flat, harsh sterile white outline flash on a given construct group.
 * @param {THREE.Object3D} group - The construct group
 * @param {boolean} active - Enable or disable flat white overlay
 */
export function applySterileWhiteMaterial(group, active) {
  group.traverse(child => {
    if (child.isMesh || child.isLine || child.isPoints) {
      if (active) {
        // Save original material if not already done
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }
        
        // Swap to flat white based on primitive type
        if (child.isLine) {
          child.material = flatWhiteLineMat;
        } else if (child.isPoints) {
          child.material = flatWhitePointsMat;
        } else {
          child.material = flatWhiteMeshMat;
        }
      } else {
        // Restore original material
        if (child.userData.originalMaterial) {
          child.material = child.userData.originalMaterial;
          child.userData.originalMaterial = null;
        }
      }
    }
  });
}
