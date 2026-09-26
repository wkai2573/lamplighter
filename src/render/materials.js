import * as THREE from 'three';

// Uniforms shared by every animated material.
export const GLOBAL = {
  uTime: { value: 0 },
  uWind: { value: 0.3 },
  uPlayer: { value: new THREE.Vector3(0, -100, 0) },
  uLantern: { value: new THREE.Vector3(0, -100, 0) },
  uLanternR: { value: 6 },
};

// Replaces project_vertex so the wind offset is applied in world space (after instancing).
// kind: 'tree' sways by height², 'grass' also bends away from the player.
export function windify(mat, { kind = 'tree', amp = 1 } = {}) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    sh.uniforms.uTime = GLOBAL.uTime;
    sh.uniforms.uWind = GLOBAL.uWind;
    sh.uniforms.uPlayer = GLOBAL.uPlayer;
    sh.vertexShader = 'uniform float uTime; uniform float uWind; uniform vec3 uPlayer;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      /* glsl */ `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 wp = modelMatrix * mvPosition;
      vec3 root = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #ifdef USE_INSTANCING
        root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      float hgt = max(wp.y - root.y, 0.0);
      float ph = uTime * 1.25 + root.x * 0.23 + root.z * 0.11;
      float gust = 0.35 + uWind * 1.2;
      ${kind === 'grass' ? /* glsl */ `
        float hh = hgt * hgt * 2.2;
        float s = sin(ph * 2.1 + wp.x * 1.7) * 0.5 + sin(ph * 3.7 + wp.z * 2.3) * 0.25;
        wp.x += (s * 0.35 + uWind * 0.45) * hh * ${amp.toFixed(3)};
        vec2 away = wp.xz - uPlayer.xz;
        float pd = length(away);
        float push = (1.0 - smoothstep(0.15, 0.9, pd)) * step(abs(wp.y - uPlayer.y), 1.6);
        wp.xz += normalize(away + 1e-4) * push * hh * 0.55;
        wp.y -= push * hh * 0.25;
      ` : /* glsl */ `
        float hh = hgt * hgt * 0.0016 * ${amp.toFixed(3)};
        float s = sin(ph) * 0.6 + sin(ph * 2.13 + 1.3) * 0.3 + sin(ph * 5.1 + wp.y * 0.5) * 0.08;
        wp.x += (s * gust * 0.8 + uWind * 1.1) * hh;
        wp.z += cos(ph * 0.73) * gust * hh * 0.35;
      `}
      mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      `
    );
  };
  const key = mat.customProgramCacheKey?.() ?? '';
  mat.customProgramCacheKey = () => key + 'wind' + kind + amp;
  return mat;
}
