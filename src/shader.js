import * as THREE from 'three';

// 4x4 Bayer Dithering Matrix in GLSL
const bayerDitherGLSL = `
float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int index = x + y * 4;
    
    if (index == 0) return 0.0/16.0;
    if (index == 1) return 8.0/16.0;
    if (index == 2) return 2.0/16.0;
    if (index == 3) return 10.0/16.0;
    if (index == 4) return 12.0/16.0;
    if (index == 5) return 4.0/16.0;
    if (index == 6) return 14.0/16.0;
    if (index == 7) return 6.0/16.0;
    if (index == 8) return 3.0/16.0;
    if (index == 9) return 11.0/16.0;
    if (index == 10) return 1.0/16.0;
    if (index == 11) return 9.0/16.0;
    if (index == 12) return 15.0/16.0;
    if (index == 13) return 7.0/16.0;
    if (index == 14) return 13.0/16.0;
    return 5.0/16.0;
}
`;

/**
 * 1. Dithered-Specular Metalheart Material
 * High-gloss liquid mercury texture with Bayer dither pattern.
 */
export const createMetalheartMaterial = (colorScale = new THREE.Vector3(1.0, 1.0, 1.0)) => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLightPos: { value: new THREE.Vector3(0.0, 10.0, -10.0) },
      uColorScale: { value: colorScale }, // Adjust color tone (e.g. silver, blueish, chrome)
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uLightPos;
      uniform vec3 uColorScale;
      
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      
      ${bayerDitherGLSL}
      
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N);
        
        // Emulated light source vector in view space
        vec3 lightDir = normalize(vec3(0.0, 1.0, 1.0));
        
        // Diffuse
        float diff = max(dot(N, lightDir), 0.0);
        
        // Blinding specular highlight (high gloss)
        float spec = pow(max(dot(R, lightDir), 0.0), 32.0);
        
        // Procedural liquid metal environment reflection (sine waves based on reflection coordinates)
        vec3 worldR = reflect(normalize(vWorldPosition - cameraPosition), normalize(vWorldNormal));
        float env = sin(worldR.y * 6.0 + uTime * 1.5) * cos(worldR.x * 6.0 + uTime * 1.5) * 0.5 + 0.5;
        
        // Combine lighting contributions
        float intensity = 0.4 * env + 0.55 * spec + 0.15 * diff;
        
        // Bayer dither lookup (pixelated size = 3px)
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        
        // Map intensity into quantized bands with dither threshold
        float steps = 5.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        quantized = clamp(quantized, 0.0, 1.0);
        
        // Sleek sterile chrome/mercury palette
        vec3 shadowColor = vec3(0.03, 0.03, 0.05);
        vec3 midColor = vec3(0.3, 0.33, 0.4);
        vec3 reflectionColor = vec3(0.7, 0.75, 0.85);
        vec3 specColor = vec3(1.0, 1.0, 1.0);
        
        vec3 finalColor;
        if (quantized < 0.25) {
          finalColor = mix(shadowColor, midColor, quantized * 4.0);
        } else if (quantized < 0.6) {
          finalColor = mix(midColor, reflectionColor, (quantized - 0.25) * 2.85);
        } else {
          finalColor = mix(reflectionColor, specColor, (quantized - 0.6) * 2.5);
        }
        
        // Apply color tint modifier
        finalColor *= uColorScale;
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
};

/**
 * 2. Blood Shader Material (Vertex Distorting Red Fluid)
 */
export const createBloodMaterial = () => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      // Simple 3D noise/wave displacement
      float wave(vec3 pos, float time) {
        return sin(pos.x * 4.0 + time * 2.0) * 
               cos(pos.y * 4.0 + time * 1.5) * 
               sin(pos.z * 4.0 + time * 2.5) * 0.12;
      }
      
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec3 displaced = position + normal * wave(position, uTime);
        vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      ${bayerDitherGLSL}
      
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N);
        vec3 lightDir = normalize(vec3(0.0, 1.0, 0.5));
        
        float diff = max(dot(N, lightDir), 0.0);
        float spec = pow(max(dot(R, lightDir), 0.0), 16.0);
        
        float intensity = 0.5 * diff + 0.5 * spec;
        
        // Bayer dither (pixelated size = 3px)
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        
        float steps = 4.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        quantized = clamp(quantized, 0.0, 1.0);
        
        // Deep viscous blood red palette
        vec3 darkBlood = vec3(0.08, 0.0, 0.0);
        vec3 crimson = vec3(0.55, 0.0, 0.02);
        vec3 neonRed = vec3(1.0, 0.0, 0.2);
        vec3 highlight = vec3(1.0, 0.65, 0.7);
        
        vec3 finalColor;
        if (quantized < 0.3) {
          finalColor = mix(darkBlood, crimson, quantized * 3.33);
        } else if (quantized < 0.75) {
          finalColor = mix(crimson, neonRed, (quantized - 0.3) * 2.22);
        } else {
          finalColor = mix(neonRed, highlight, (quantized - 0.75) * 4.0);
        }
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
};

/**
 * 3. Void Shader Material (Spinning Inward-Pulling Torus)
 */
export const createVoidMaterial = () => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      ${bayerDitherGLSL}
      
      void main() {
        // Animate UV coordinate pulling inward
        // vUv.x represents loop coordinate around torus, vUv.y represents tube circumference.
        // We simulate a vortex pulling inward using vUv.y shifted by time
        float vortex = fract(vUv.y - uTime * 0.8);
        
        // Add normal fresnel glow
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        float fresnel = 1.0 - max(dot(N, V), 0.0);
        
        // Intensity mapping
        float intensity = mix(vortex, fresnel, 0.4);
        
        // Dither pattern lookup
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        
        float steps = 4.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        quantized = clamp(quantized, 0.0, 1.0);
        
        // Purple Void color ramp
        vec3 coreColor = vec3(0.01, 0.0, 0.02);
        vec3 purple = vec3(0.3, 0.0, 0.6);
        vec3 neonViolet = vec3(0.7, 0.0, 1.0);
        vec3 highlights = vec3(1.0, 0.8, 1.0);
        
        vec3 finalColor;
        if (quantized < 0.25) {
          finalColor = mix(coreColor, purple, quantized * 4.0);
        } else if (quantized < 0.7) {
          finalColor = mix(purple, neonViolet, (quantized - 0.25) * 2.22);
        } else {
          finalColor = mix(neonViolet, highlights, (quantized - 0.7) * 3.33);
        }
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
};

/**
 * 4. Lotus Shader Material (Iridescent Translucent Neon Pink Glass)
 */
export const createLotusMaterial = () => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false, // Prevents translucent glass sorting artifacts
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      ${bayerDitherGLSL}
      
      // Iridescent cosine palette generator
      vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
        return a + b*cos( 6.28318*(c*t+d) );
      }
      
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N);
        
        float fresnel = 1.0 - max(dot(N, V), 0.0);
        
        // Shifting iridescence biased towards neon pink/magenta
        vec3 a = vec3(0.9, 0.1, 0.65);
        vec3 b = vec3(0.2, 0.15, 0.35);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.0, 0.33, 0.67);
        
        vec3 irisColor = palette(fresnel + uTime * 0.18, a, b, c, d);
        
        // High-gloss specular highlight
        vec3 lightDir = normalize(vec3(0.0, 1.0, 0.5));
        float spec = pow(max(dot(R, lightDir), 0.0), 32.0);
        
        vec3 finalColor = irisColor + vec3(spec * 0.8);
        
        // Apply retro Bayer dither matrix
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        float intensity = clamp(fresnel + spec * 0.4, 0.0, 1.0);
        
        float steps = 5.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        
        // Mix iridescence with specular dither
        finalColor = mix(finalColor * 0.7, finalColor, quantized);
        
        // Translucent glass alpha
        float alpha = 0.85;
        
        gl_FragColor = vec4(finalColor, alpha);
      }
    `,
  });
};

/**
 * 5. Cloud Shader Material (Misty Translucent Iridescent Light Gray Glass)
 */
export const createCloudMaterial = () => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      ${bayerDitherGLSL}
      
      vec3 palette( in float t, in vec3 a, in vec3 b, in vec3 c, in vec3 d ) {
        return a + b*cos( 6.28318*(c*t+d) );
      }
      
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N);
        
        float fresnel = 1.0 - max(dot(N, V), 0.0);
        
        // Ethereal light gray iridescence
        vec3 a = vec3(0.75, 0.75, 0.78);
        vec3 b = vec3(0.15, 0.15, 0.15);
        vec3 c = vec3(1.0, 1.0, 1.0);
        vec3 d = vec3(0.0, 0.1, 0.2);
        
        vec3 irisColor = palette(fresnel + uTime * 0.1, a, b, c, d);
        
        vec3 lightDir = normalize(vec3(0.0, 1.0, 0.5));
        float spec = pow(max(dot(R, lightDir), 0.0), 32.0);
        
        vec3 finalColor = irisColor + vec3(spec * 0.9);
        
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        float intensity = clamp(fresnel + spec * 0.5, 0.0, 1.0);
        
        float steps = 4.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        
        finalColor = mix(finalColor * 0.7, finalColor, quantized);
        
        gl_FragColor = vec4(finalColor, 0.65); // Misty translucent light gray
      }
    `,
  });
};

/**
 * 6. Decay Shader Material (Toxic Translucent Neon Green Glass)
 */
export const createDecayMaterial = () => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      
      ${bayerDitherGLSL}
      
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N);
        
        float fresnel = 1.0 - max(dot(N, V), 0.0);
        
        vec3 lightDir = normalize(vec3(0.0, 1.0, 0.5));
        float spec = pow(max(dot(R, lightDir), 0.0), 16.0);
        
        // Toxic neon green glossy glass sheen
        vec3 darkGreen = vec3(0.0, 0.08, 0.01);
        vec3 toxicGreen = vec3(0.0, 1.0, 0.4);
        vec3 highlight = vec3(0.7, 1.0, 0.85);
        
        vec3 finalColor = mix(darkGreen, toxicGreen, fresnel) + vec3(spec * 0.75);
        
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        float intensity = clamp(fresnel + spec * 0.5, 0.0, 1.0);
        
        float steps = 4.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        
        finalColor = mix(finalColor * 0.6, finalColor, quantized);
        
        gl_FragColor = vec4(finalColor, 0.85); // Toxic translucent green
      }
    `,
  });
};

/**
 * 7. Echo Shader Material (Polished Black Chrome with Bayer Dither)
 */
export const createEchoMaterial = () => {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      
      ${bayerDitherGLSL}
      
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(vViewPosition);
        vec3 R = reflect(-V, N);
        
        // Light source vector in view space
        vec3 lightDir = normalize(vec3(0.3, 1.0, 0.8));
        
        // Diffuse
        float diff = max(dot(N, lightDir), 0.0);
        
        // Blinding specular highlight (high gloss)
        float spec = pow(max(dot(R, lightDir), 0.0), 32.0);
        
        // Procedural liquid metal environment reflection
        vec3 worldR = reflect(normalize(vWorldPosition - cameraPosition), normalize(vWorldNormal));
        float env = sin(worldR.y * 5.0 + uTime * 0.8) * cos(worldR.x * 5.0 + uTime * 0.8) * 0.5 + 0.5;
        
        // Combine lighting contributions
        float intensity = 0.3 * env + 0.55 * spec + 0.15 * diff;
        
        // Bayer dither lookup (pixelated size = 2.5px)
        float thresh = bayer4(gl_FragCoord.xy / 2.5);
        
        // Quantize intensity into 4 bands with dither threshold
        float steps = 4.0;
        float rawValue = intensity * steps;
        float frac = fract(rawValue);
        float quantized = floor(rawValue) / steps;
        if (frac > thresh) {
          quantized += 1.0 / steps;
        }
        quantized = clamp(quantized, 0.0, 1.0);
        
        // Polished Black Chrome Palette (pure black shadow, charcoal midtones, dark/light silver highlights)
        vec3 shadowColor = vec3(0.0, 0.0, 0.0);
        vec3 midColor = vec3(0.08, 0.08, 0.09);
        vec3 reflectionColor = vec3(0.28, 0.28, 0.31);
        vec3 specColor = vec3(0.85, 0.85, 0.88);
        
        vec3 finalColor;
        if (quantized < 0.25) {
          finalColor = mix(shadowColor, midColor, quantized * 4.0);
        } else if (quantized < 0.6) {
          finalColor = mix(midColor, reflectionColor, (quantized - 0.25) * 2.85);
        } else {
          finalColor = mix(reflectionColor, specColor, (quantized - 0.6) * 2.5);
        }
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide
  });
};


