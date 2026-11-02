// Бокс GTN в реальном времени. Прокрутка ведёт одну машину через всю работу: ворота, свет, мойка, полировка, керамика, плёнка.
// Отражения шестигранного потолка считаются в шейдере лучом, а не картой окружения, поэтому риски и капли видны как настоящие.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

const MODEL_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/';
const DRACO_BASE = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => { const t = clamp((p - a) / (b - a)); return t * t * (3 - 2 * t); };

// Размеры бокса в метрах.
const ROOM = { halfX: 6.4, back: -6.4, front: 6, h: 3.5 };
const HEX = 1.5; // ширина ячейки потолка
const CENTER_CELL = new THREE.Vector2(0.5 * HEX, 0.5 * Math.sqrt(3) * HEX);

const root = document.getElementById('bay');
const stage = root.querySelector('.bay__stage');
const canvas = root.querySelector('.bay__gl');
const phone = matchMedia('(max-width: 767px), (pointer: coarse)').matches;

const U = {
  uRoom: { value: new THREE.Vector4(ROOM.halfX, ROOM.back, ROOM.front, ROOM.h) },
  uHexS: { value: HEX },
  uTube: { value: 0.015 },
  uPower: { value: 20 },
  uWave: { value: 0 },
  uFlick: { value: 0 },
  uCell: { value: CENTER_CELL },
  uLit: { value: 0 },
  uStrip: { value: 0 },
  uDirt: { value: 1 },
  uFoamY: { value: 2 },
  uRinseY: { value: 2.4 },
  uPolish: { value: 4 },
  uHaze: { value: 1 },
  uDrops: { value: 0 },
  uRoll: { value: 0 },
  uFilm: { value: 4 },
  uFilmOn: { value: 0 },
  uSwirl: { value: null },
};

const GLSL_COMMON = /* glsl */`
  varying vec3 vW;
  uniform vec4 uRoom; uniform float uHexS, uTube, uPower, uWave, uFlick, uLit, uStrip; uniform vec2 uCell;
  uniform float uDirt, uFoamY, uRinseY, uPolish, uHaze, uDrops, uRoll, uFilm, uFilmOn; uniform sampler2D uSwirl;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 h22(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    float a = h21(i.xy + i.z*17.), b = h21(i.xy + vec2(1,0) + i.z*17.), c = h21(i.xy + vec2(0,1) + i.z*17.), d = h21(i.xy + vec2(1,1) + i.z*17.);
    float e = h21(i.xy + (i.z+1.)*17.), g = h21(i.xy + vec2(1,0) + (i.z+1.)*17.), j = h21(i.xy + vec2(0,1) + (i.z+1.)*17.), k = h21(i.xy + vec2(1,1) + (i.z+1.)*17.);
    return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(j,k,f.x),f.y), f.z); }
  float fbm(vec3 p){ return .5*vn(p) + .3*vn(p*2.1+3.) + .2*vn(p*4.3+7.); }
  const vec2 HS = vec2(1., 1.7320508);
  vec4 hexC(vec2 uv){ vec4 c = floor(vec4(uv, uv - vec2(.5, 1.)) / HS.xyxy) + .5;
    vec4 h = vec4(uv - c.xy*HS, uv - (c.zw+.5)*HS);
    return dot(h.xy,h.xy) < dot(h.zw,h.zw) ? vec4(h.xy, c.xy*HS) : vec4(h.zw, (c.zw+.5)*HS); }
  float hexD(vec2 p){ p = abs(p); return max(dot(p, HS*.5), p.x); }
  // Луч из точки на кузове до потолка: blur размывает линию, как риски размывают отражение в лаке.
  float ceilLight(vec3 p, vec3 rd, float blur){
    if (rd.y < .02) return 0.;
    float t = (uRoom.w - p.y) / rd.y;
    vec2 q = (p + rd*t).xz;
    float m = step(abs(q.x), uRoom.x) * step(uRoom.y, q.y) * step(q.y, uRoom.z);
    if (m < .5) return 0.;
    vec4 h = hexC(q / uHexS);
    float d = (.5 - hexD(h.xy)) * uHexS;
    float w = uTube + blur*(.35 + t*.25);
    float line = exp(-d*d / (w*w)) * clamp(uTube*1.4 / w, 0., 1.);
    float cell = length(h.zw*uHexS - uCell);
    float lit = smoothstep(uWave*11., uWave*11. - 1.2, cell);
    lit = max(lit, uFlick * step(cell, .05));
    return line * lit;
  }
  // Световые линии на боковых стенах дают длинный блик вдоль кузова.
  float wallLight(vec3 p, vec3 rd, float blur){
    if (abs(rd.x) < .05) return 0.;
    float t = (sign(rd.x)*uRoom.x - p.x) / rd.x;
    vec3 q = p + rd*t;
    float b = .05 + blur*2.;
    float y = exp(-pow((q.y - 2.35)/b, 2.)) * clamp(.05/b*1.6, 0., 1.);
    return y * step(uRoom.y, q.z) * step(q.z, uRoom.z) * uStrip;
  }
`;

// Лак: грязь, пена, риски, капли и плёнка живут в одном материале и меняются по прокрутке.
const paintPatch = (shader, kind) => {
  const isBody = kind === 'body';
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\n vW = (modelMatrix * vec4(transformed, 1.)).xyz;');
  let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${GLSL_COMMON}`);
  fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
    vec3 gN = inverseTransformDirection(normalize(vNormal), viewMatrix);
    float dirt = 0., foam = 0., foamSpec = 0., polished = 1.; vec3 dropN = vec3(0.); float dropM = 0.;
    ${isBody ? `
      if (uRinseY > -.49) {
        float rinse = smoothstep(uRinseY - .16, uRinseY + .16, vW.y + (fbm(vec3(vW.x*5., vW.y*.6, vW.z*5.)) - .5)*.5);
        if (rinse < .999) {
          dirt = uDirt * (1. - rinse) * (.45 + .55*fbm(vW*vec3(2.4, 5., 2.4))) * (1. + .9*smoothstep(.8, .25, vW.y));
          if (uFoamY < 1.99) {
            float fl = fbm(vec3(vW.x*6., vW.y*1.4, vW.z*6.));
            foam = smoothstep(uFoamY - .12, uFoamY + .12, vW.y + (fl - .5)*.7) * (1. - rinse);
            foam *= smoothstep(.26, .46, fbm(vW*vec3(7., 2.2, 7.)) + .06);
          }
        }
      }
      polished = smoothstep(uPolish - .1, uPolish + .1, vW.z);
      polished = max(polished, 1. - uHaze);
      if (uDrops > .001 && gN.y > .45 && vW.z > 0.) {
        float up = smoothstep(.45, .8, gN.y);
        vec2 q = vW.xz + vec2(0., uRoll);
        for (int k = 0; k < 2; k++) {
          float s = k == 0 ? 20. : 46.;
          vec2 g = q*s + float(k)*3.7; vec2 id = floor(g), f = fract(g);
          // Капля целиком внутри своей клетки: один проход вместо девяти держит частоту кадров на телефоне.
          vec2 o = .32 + .36*h22(id);
          float keep = step(h21(id + 9.), uDrops*.5);
          float r = (.1 + .2*h21(id + 3.)) * keep;
          vec2 c = o - f; float dd = length(c) / max(r, .001);
          if (dd < 1.) { dropM = max(dropM, up); dropN.xz += -c/max(r, .001) * up * .42; }
        }
      }
    ` : ''}
    dirt = clamp(dirt, 0., 1.);
    roughnessFactor = mix(roughnessFactor, .92, max(dirt*.9, foam));
  `);
  fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
    ${isBody ? `
      if (dropM > .0) normal = normalize(normal + (viewMatrix * vec4(dropN, 0.)).xyz);
    ` : ''}
  `);
  fs = fs.replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
    ${isBody ? 'clearcoatNormal = normal;' : ''}
  `);
  fs = fs.replace('#include <lights_physical_fragment>', `
    ${isBody ? `
      vec3 dustC = vec3(.075, .07, .062);
      diffuseColor.rgb = mix(diffuseColor.rgb, dustC, dirt*.8);
      if (foam > .01) {
        vec2 fUv = abs(gN.y) > .55 ? vW.xz : (abs(gN.x) > .5 ? vW.zy : vW.xy);
        float b1 = 1., b2 = 1.;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 n = vec2(float(x), float(y));
          vec2 g1 = fUv*85.; b1 = min(b1, length(n + h22(floor(g1) + n) - fract(g1)));
          vec2 g2 = fUv*210.; b2 = min(b2, length(n + h22(floor(g2) + n) - fract(g2)));
        }
        float bub = .55*smoothstep(.0, .75, b1) + .45*smoothstep(.0, .75, b2);
        foamSpec = smoothstep(.2, .03, b1) * foam;
        float lump = fbm(vW*vec3(26., 34., 26.));
        lump = smoothstep(.2, .75, lump);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(mix(1., .78, bub) * mix(.74, 1.1, lump)), foam);
      }
      metalnessFactor *= (1. - max(dirt*.8, foam));
    ` : ''}
    #include <lights_physical_fragment>
    ${isBody ? `
      material.clearcoat *= (1. - foam) * (1. - dirt*.85);
      material.clearcoatRoughness = mix(material.clearcoatRoughness, .5, 1. - polished);
    ` : ''}
  `);
  fs = fs.replace('#include <opaque_fragment>', `
    {
      vec3 nW = inverseTransformDirection(normal, viewMatrix);
      vec3 vD = normalize(vW - cameraPosition);
      vec3 rd = reflect(vD, nW);
      float ndv = clamp(dot(-vD, nW), 0., 1.);
      float F = F_CUSTOM + (1. - F_CUSTOM) * pow(1. - ndv, 5.);
      float blur = 0.;
      float scratch = 0.;
      ${isBody ? `
        blur = mix(.1, .0, polished) + dirt*.2;
        if (polished < .999) {
          vec2 sUv = abs(gN.y) > .55 ? vW.xz : (abs(gN.x) > .5 ? vW.zy : vW.xy);
          float sTex = texture2D(uSwirl, sUv*.28).r;
          scratch = (1. - polished) * sTex * (1. - dirt*.7);
          rd = normalize(rd + vec3(sTex - .5)*(1. - polished)*.05);
        }
      ` : ''}
      float L = ceilLight(vW, rd, blur) + wallLight(vW, rd, blur);
      ${isBody ? `
        if (scratch > .001) L += ceilLight(vW, rd, .42) * scratch * 1.5;
        L *= (1. - foam);
        // Край плёнки: тонкая светлая линия, за ней лак становится глубже.
        if (uFilmOn > .001) {
          float zone = smoothstep(.55, .85, vW.z);
          float e = exp(-pow((vW.z - uFilm)/.018, 2.)) * zone * uFilmOn;
          L += e*.05;
          outgoingLight += vec3(1.)*e*.5;
        }
      ` : ''}
      outgoingLight += vec3(1., 1., .985) * L * uPower * F;
      ${isBody ? 'outgoingLight += diffuseColor.rgb * foam * .3 * uLit + vec3(foamSpec) * .55 * uLit;' : ''}
    }
    #include <opaque_fragment>`);
  const f0 = { body: 0.05, glass: 0.07, trim: 0.05, metal: 0.55 }[kind];
  fs = fs.replaceAll('F_CUSTOM', f0.toFixed(2));
  shader.fragmentShader = fs;
};

const withPaint = (mat, kind) => {
  mat.onBeforeCompile = (s) => paintPatch(s, kind);
  mat.customProgramCacheKey = () => `gtn-${kind}`;
  return mat;
};

// Паутинка рисок: тонкие дуги вокруг случайных центров, как следы от неправильной полировки.
const makeSwirlTexture = () => {
  const size = phone ? 1024 : 2048;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, size, size);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < (phone ? 2200 : 7000); i++) {
    const x = Math.random() * size, y = Math.random() * size, r = (0.03 + Math.random() * 0.2) * size;
    const a = Math.random() * Math.PI * 2, l = 0.25 + Math.random() * 1.1;
    c.strokeStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.38})`;
    c.lineWidth = 0.5 + Math.random();
    c.beginPath(); c.arc(x, y, r, a, a + l); c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
};

// Профиль ламелей и надпись GTN на воротах.
const makeDoorTextures = (w, h) => {
  const px = 2048, py = Math.round((px * h) / w);
  const slats = 14;
  const map = document.createElement('canvas'); map.width = px; map.height = py;
  const c = map.getContext('2d');
  c.fillStyle = '#16181b'; c.fillRect(0, 0, px, py);
  const fontPx = py * 0.62;
  c.font = `800 ${fontPx}px 'TikTok Sans', Arial, sans-serif`;
  c.fontStretch = 'ultra-expanded';
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  const m = c.measureText('GTN');
  const scale = Math.min(1, (px * 0.86) / m.width);
  c.save();
  c.translate(px / 2, py * 0.56 + (m.actualBoundingBoxAscent * scale) / 2);
  c.scale(scale, scale);
  c.fillStyle = '#d9d9d6';
  c.fillText('GTN', 0, 0);
  c.restore();
  const bump = document.createElement('canvas'); bump.width = 8; bump.height = 512;
  const b = bump.getContext('2d');
  for (let y = 0; y < 512; y++) {
    const f = (y / 512 * slats) % 1;
    const v = f < 0.04 || f > 0.96 ? 0 : 150 + 90 * Math.sin(f * Math.PI);
    b.fillStyle = `rgb(${v},${v},${v})`; b.fillRect(0, y, 8, 1);
  }
  const mapT = new THREE.CanvasTexture(map); mapT.colorSpace = THREE.SRGBColorSpace; mapT.anisotropy = 8;
  const bumpT = new THREE.CanvasTexture(bump);
  return { mapT, bumpT };
};

const makeRibTexture = (repeat) => {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 4;
  const c = cv.getContext('2d');
  for (let x = 0; x < 64; x++) { const v = 90 + 165 * Math.abs(Math.sin((x / 64) * Math.PI)); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, 4); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, 1);
  return t;
};

// Камера: точки пути привязаны к прокрутке, между главами она плавно замирает.
const KEYS = [
  // p, позиция, цель, fov, насколько отступать на узком экране
  [0.00, [0.0, 1.05, 13.2], [0, 1.72, 6], 30, 2.6],
  [0.05, [0.0, 1.05, 13.0], [0, 1.72, 6], 30, 2.6],
  [0.15, [0.0, 0.95, 11.2], [0, 1.25, 4], 30, 2.2],
  [0.22, [0.2, 0.9, 8.6], [0, 0.85, 1], 32, 1.6],
  [0.30, [3.1, 0.82, 6.0], [0.05, 0.62, 0.3], 30, 1.0],
  [0.345, [4.15, 0.62, 2.1], [0.55, 0.62, 0.2], 30, 0.7],
  [0.43, [4.25, 0.72, -1.2], [0.5, 0.62, -0.4], 30, 0.7],
  [0.49, [1.9, 1.42, 4.05], [0.12, 0.72, 1.35], 26, 0.5],
  [0.59, [-1.75, 1.34, 3.95], [-0.05, 0.72, 1.1], 26, 0.5],
  [0.655, [0.72, 1.04, 3.0], [0.12, 0.78, 1.45], 24, 0.25],
  [0.72, [0.2, 0.98, 3.05], [-0.1, 0.8, 1.25], 24, 0.25],
  [0.79, [-2.5, 1.5, 4.3], [0.0, 0.62, 1.5], 28, 0.6],
  [0.87, [-3.4, 0.95, 5.3], [0.0, 0.7, 0.9], 30, 0.8],
  [1.00, [-4.5, 0.62, 4.7], [-0.4, 0.66, 0.25], 37, 0.9],
].map(([p, pos, look, fov, fit]) => ({ p, pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look), fov, fit }));

const posCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.pos), false, 'centripetal');
const lookCurve = new THREE.CatmullRomCurve3(KEYS.map((k) => k.look), false, 'centripetal');

const camAt = (p, out) => {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((p - a.p) / (b.p - a.p));
  const e = t * t * (3 - 2 * t);
  const u = (i + e) / (KEYS.length - 1);
  posCurve.getPoint(u, out.pos);
  lookCurve.getPoint(u, out.look);
  out.fov = THREE.MathUtils.lerp(a.fov, b.fov, e);
  out.fit = THREE.MathUtils.lerp(a.fit, b.fit, e);
};

const boot = async () => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let dpr = Math.min(devicePixelRatio || 1, phone ? 1.4 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030304);
  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 80);

  // Мягкий свет от потолка для окружения: острые шестигранники считает шейдер лака.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x050506);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.52, 1.56), side: THREE.DoubleSide }));
  top.rotation.x = Math.PI / 2; top.position.y = 4; envScene.add(top);
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.1), side: THREE.DoubleSide }));
  floorGlow.rotation.x = -Math.PI / 2; floorGlow.position.y = -1; envScene.add(floorGlow);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.04).texture;
  scene.environmentIntensity = 0;

  U.uSwirl.value = makeSwirlTexture();

  // Стены и потолок.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.35, roughness: 0.5, envMapIntensity: 0.07 });
  const rib = (rep) => { const m = wallMat.clone(); m.bumpMap = makeRibTexture(rep); m.bumpScale = 1.4; return m; };
  const box = (w, h, d, x, y, z, mat) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); scene.add(b); return b; };
  const W = ROOM.halfX, B = ROOM.back, F = ROOM.front, H = ROOM.h;
  box(0.3, H + 3, F - B, -W - 0.15, (H + 3) / 2, (F + B) / 2, rib(38));
  box(0.3, H + 3, F - B, W + 0.15, (H + 3) / 2, (F + B) / 2, rib(38));
  box(W * 2, H + 3, 0.3, 0, (H + 3) / 2, B - 0.15, rib(38));
  const DOOR_W = 7.4, DOOR_H = 3.1;
  const frontRib = rib(14);
  const side = (W * 2 - DOOR_W) / 2;
  box(side, 9, 0.3, -(DOOR_W / 2 + side / 2), 4.5, F + 0.15, frontRib);
  box(side, 9, 0.3, DOOR_W / 2 + side / 2, 4.5, F + 0.15, frontRib);
  box(DOOR_W, 9 - DOOR_H, 0.3, 0, DOOR_H + (9 - DOOR_H) / 2, F + 0.15, new THREE.MeshStandardMaterial({ color: 0x0a0b0c, metalness: 0.4, roughness: 0.6, envMapIntensity: 0.1 }));
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, F - B), new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0, roughness: 0.9, envMapIntensity: 0.05 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(0, H + 0.02, (F + B) / 2); scene.add(ceil);


  // Потолок: трубки на рёбрах шестигранников.
  const edges = new Map();
  const R = HEX / Math.sqrt(3);
  const addCell = (cx, cz) => {
    if (Math.abs(cx) > W + R || cz < B - R || cz > F + R) return;
    for (let k = 0; k < 6; k++) {
      const a0 = Math.PI / 6 + (k * Math.PI) / 3, a1 = a0 + Math.PI / 3;
      const ax = cx + R * Math.cos(a0), az = cz + R * Math.sin(a0), bx = cx + R * Math.cos(a1), bz = cz + R * Math.sin(a1);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (Math.abs(mx) > W - 0.1 || mz < B + 0.1 || mz > F - 0.1) continue;
      const key = `${Math.round(mx * 100)}:${Math.round(mz * 100)}`;
      if (!edges.has(key)) edges.set(key, { ax, az, bx, bz, mx, mz });
    }
  };
  for (let i = -8; i <= 8; i++) for (let j = -6; j <= 6; j++) {
    addCell((i + 0.5) * HEX, (j + 0.5) * Math.sqrt(3) * HEX);
    addCell((i + 1) * HEX, (j + 1) * Math.sqrt(3) * HEX);
  }
  const edgeList = [...edges.values()];
  const tube = new THREE.CylinderGeometry(0.028, 0.028, R * 0.97, 8);
  tube.rotateZ(Math.PI / 2);
  const tubes = new THREE.InstancedMesh(tube, new THREE.MeshBasicMaterial({ color: 0xffffff }), edgeList.length);
  const dummy = new THREE.Object3D();
  const dark = new THREE.Color(0.012, 0.012, 0.012);
  edgeList.forEach((e, i) => {
    dummy.position.set(e.mx, H - 0.03, e.mz);
    dummy.rotation.set(0, -Math.atan2(e.bz - e.az, e.bx - e.ax), 0);
    dummy.updateMatrix();
    tubes.setMatrixAt(i, dummy.matrix);
    tubes.setColorAt(i, dark);
    e.dist = Math.hypot(e.mx - CENTER_CELL.x, e.mz - CENTER_CELL.y);
    e.jit = Math.random();
    e.center = e.dist < R + 0.02;
  });
  scene.add(tubes);
  const lit = new THREE.Color(7.5, 7.5, 7.3);
  const tmp = new THREE.Color();
  let lastWave = -1, lastFlick = -1;
  const updateTubes = () => {
    const w = U.uWave.value, f = U.uFlick.value;
    if (w === lastWave && f === lastFlick) return;
    lastWave = w; lastFlick = f;
    edgeList.forEach((e, i) => {
      let a = clamp((w * 11 - e.dist + 0.6) / 0.6);
      // Трубка загорается рывком, как настоящая: коротко мигает и встаёт на полную яркость.
      if (a > 0 && a < 1) a *= e.jit > 0.5 ? 1 : 0.35;
      if (e.center) a = Math.max(a, f);
      tmp.copy(dark).lerp(lit, a);
      tubes.setColorAt(i, tmp);
    });
    tubes.instanceColor.needsUpdate = true;
  };

  // Ворота.
  await (document.fonts ? document.fonts.load("800 200px 'TikTok Sans'") : Promise.resolve());
  const { mapT, bumpT } = makeDoorTextures(DOOR_W, DOOR_H);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.06),
    new THREE.MeshStandardMaterial({ map: mapT, bumpMap: bumpT, bumpScale: 2.2, metalness: 0.5, roughness: 0.44, envMapIntensity: 0 })
  );
  door.position.set(0, DOOR_H / 2, F + 0.14);
  scene.add(door);
  const washL = new THREE.SpotLight(0xf1f2f5, 60, 8, 0.62, 0.9, 1.5);
  washL.position.set(-1.9, 4.6, F + 1.5); washL.target.position.set(-1.9, 0.9, F + 0.1);
  const washR = washL.clone(); washR.position.set(1.9, 4.6, F + 1.5); washR.target = new THREE.Object3D(); washR.target.position.set(1.9, 0.9, F + 0.1);
  scene.add(washL, washL.target, washR, washR.target);

  // Пол: зеркальный рендер с вытянутым размытием, плитка внутри и мокрый асфальт снаружи.
  const aoWhite = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); aoWhite.needsUpdate = true;
  const floor = new Reflector(new THREE.PlaneGeometry(60, 60), {
    textureWidth: Math.round(innerWidth * (phone ? 0.4 : 0.55)),
    textureHeight: Math.round(innerHeight * (phone ? 0.4 : 0.55)),
    clipBias: 0.001,
    multisample: 0,
    shader: {
      name: 'GTNFloor',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uAO: { value: null }, uLit: { value: 0 }, uFront: { value: F } },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vP;
        void main(){ vUvR = textureMatrix * vec4(position, 1.); vec4 w = modelMatrix * vec4(position, 1.); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, uAO; uniform float uLit, uFront; varying vec4 vUvR; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main(){
          bool inside = vP.z < uFront;
          vec3 V = normalize(cameraPosition - vP);
          float dist = length(cameraPosition - vP);
          float fres = pow(1. - clamp(V.y, 0., 1.), 3.5);
          vec2 t = vP.xz / 1.2; vec2 id = floor(t); vec2 f = abs(fract(t) - .5);
          float aa = fwidth(t.x) + fwidth(t.y);
          float grout = inside ? smoothstep(.492 - aa, .497 + aa, max(f.x, f.y)) : 0.;
          vec2 tilt = inside ? (vec2(h(id), h(id + 3.)) - .5) * .0035 : vec2(0.);
          vec2 uv = vUvR.xy / vUvR.w + tilt;
          float spread = inside ? .0022 : .0065;
          vec3 r = vec3(0.); float tw = 0.;
          for (int i = -6; i <= 6; i++) { float w = exp(-float(i*i) / 14.); r += texture2D(tDiffuse, uv + vec2(0., float(i)*spread)).rgb * w; tw += w; }
          r /= tw;
          vec3 base = inside ? vec3(.042, .043, .046) * (.75 + .25*h(id + 7.)) : vec3(.012);
          base *= inside ? uLit : 1.;
          vec3 c = base * (1. - grout*.85) + r * mix(.1, .85, fres) * (1. - grout*.8) * (inside ? 1. : .55);
          // Контактная тень машины.
          vec2 a = vec2(vP.x / 2.62 + .5, vP.z / 5.2 + .5);
          if (a.x > 0. && a.x < 1. && a.y > 0. && a.y < 1.) c *= mix(1., texture2D(uAO, a).r, .92);
          gl_FragColor = vec4(c, 1.);
        }`,
    },
  });
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 5);
  floor.material.uniforms.uAO.value = aoWhite;
  scene.add(floor);

  // Машину и её тяжёлые шейдеры готовим после первого кадра: ворота появляются сразу, а открываются, когда всё готово.
  const lamps = [];
  let carReady = false;
  const loadCar = async () => {
    const draco = new DRACOLoader().setDecoderPath(DRACO_BASE);
    const [gltf, aoTex] = await Promise.all([
      new GLTFLoader().setDRACOLoader(draco).loadAsync(`${MODEL_BASE}ferrari.glb`),
      new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(`${MODEL_BASE}ferrari_ao.png`),
    ]);
    const car = gltf.scene.children[0];
    const carRig = new THREE.Group(); carRig.rotation.y = Math.PI; carRig.add(car);
    const body = withPaint(new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.2, roughness: 0.5, envMapIntensity: 0.62, clearcoat: 1, clearcoatRoughness: 0.02 }), 'body');
    const metal = withPaint(new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 1, roughness: 0.32, envMapIntensity: 0.8 }), 'metal');
    const trim = withPaint(new THREE.MeshStandardMaterial({ color: 0x040405, metalness: 0.3, roughness: 0.45, envMapIntensity: 0.3 }), 'trim');
    const glass = withPaint(new THREE.MeshPhysicalMaterial({ color: 0x010203, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.9, envMapIntensity: 0.25 }), 'glass');
    car.getObjectByName('body').material = body;
    ['rim_fl', 'rim_fr', 'rim_rr', 'rim_rl'].forEach((n) => { car.getObjectByName(n).material = metal; });
    car.getObjectByName('trim').material = trim;
    car.getObjectByName('glass').material = glass;
    // Значки марки убираем: на сайте студии машина без чужих логотипов.
    car.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const m = o.material;
      if (m.name === 'Ferrari_Yellow') { m.color.setHex(0x101114); m.metalness = 0.6; m.roughness = 0.4; }
      if (m.name === 'metal_chrome') {
        m.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWc;').replace('#include <project_vertex>', '#include <project_vertex>\n vWc = (modelMatrix * vec4(transformed, 1.)).xyz;');
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWc;').replace('#include <opaque_fragment>', `
            if (abs(vWc.x) < .12 && abs(vWc.z) > 1.75) outgoingLight *= .03;
            #include <opaque_fragment>`);
        };
      }
      if (o.name === 'lights' || o.name === 'lights_red' || o.name === 'brakes') {
        const c = o.material.clone(); c.emissive = new THREE.Color(o.name === 'lights' ? 0xffffff : 0xff1a1f); c.emissiveIntensity = 0; o.material = c;
        lamps.push({ mat: c, max: o.name === 'lights' ? 5 : 3.2 });
      }
    });
    // Шейдеры собираем для того же буфера, куда потом идёт рендер, иначе браузер соберёт их заново и кадр зависнет.
    renderer.setRenderTarget(composer.renderTarget1);
    const compiling = renderer.compileAsync(carRig, camera, scene);
    renderer.setRenderTarget(null);
    await compiling;
    floor.material.uniforms.uAO.value = aoTex;
    scene.add(carRig);
    carReady = true;
  };

  // Лист плёнки.
  const filmGeo = new THREE.PlaneGeometry(1.95, 2.1, 48, 48); filmGeo.rotateX(-Math.PI / 2);
  const filmMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...U, uAmp: { value: 0 }, uT: { value: 0 }, uA: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uAmp, uT; varying vec3 vW; varying vec3 vN; varying vec2 vE;
      float H(vec2 p){ return sin(p.x*2.4 + uT*1.1)*.5 + sin(p.y*3.1 + uT*.8 + p.x)*.35 + sin((p.x+p.y)*6. + uT*1.5)*.12; }
      void main(){ vE = uv; vec3 p = position; p.y += H(p.xz)*uAmp;
        float e = .02; vec3 dx = vec3(e, (H(p.xz + vec2(e,0.)) - H(p.xz))*uAmp, 0.), dz = vec3(0., (H(p.xz + vec2(0.,e)) - H(p.xz))*uAmp, e);
        vN = normalize(mat3(modelMatrix) * cross(dz, dx));
        vec4 w = modelMatrix * vec4(p, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      varying vec3 vN; varying vec2 vE; uniform float uA;
      void main(){ vec3 n = normalize(vN); vec3 v = normalize(vW - cameraPosition); if (dot(n, v) > 0.) n = -n;
        vec3 rd = reflect(v, n); float F = .05 + .95*pow(1. - clamp(dot(-v, n), 0., 1.), 4.);
        float L = ceilLight(vW, rd, .004) + wallLight(vW, rd, .004);
        vec2 eD = min(vE, 1. - vE); float rim = smoothstep(.012, .0, min(eD.x, eD.y));
        vec3 c = vec3(1.) * L * uPower * F + vec3(.8, .86, .95) * (F*.35 + .05) + vec3(.9)*rim*.6;
        gl_FragColor = vec4(c, clamp(F*1.2 + L*.6 + .1 + rim*.7, 0., 1.) * uA); }`,
  });
  const film = new THREE.Mesh(filmGeo, filmMat);
  film.renderOrder = 3;
  scene.add(film);

  // Струя мойки и пыль в воздухе.
  const makePoints = (n, seedAttr, uniforms, vs, fs) => {
    const g = new THREE.BufferGeometry();
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute(seedAttr, new THREE.BufferAttribute(seeds, 4));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms, vertexShader: vs, fragmentShader: fs });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false;
    scene.add(pts);
    return m;
  };
  const SOFT = /* glsl */`varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(1.), vA * smoothstep(.5, .1, d)); }`;
  const sprayMat = makePoints(phone ? 900 : 2600, 'seed', { uT: { value: 0 }, uOn: { value: 0 }, uPx: { value: 1 } }, /* glsl */`
    attribute vec4 seed; uniform float uT, uOn, uPx; varying float vA;
    void main(){
      float life = fract(seed.x + uT*(.7 + seed.y*.7));
      vec3 o = vec3(2.5, 1.7, .6 + sin(uT*.5)*1.1);
      vec3 hit = vec3(.95, .55 + seed.z*.7, o.z - .6 + seed.w*1.2 + (seed.z - .5)*.6);
      vec3 p = mix(o, hit, life);
      p += (seed.yzw - .5) * life * .28;
      p.y -= life*life*.12;
      vA = uOn * (1. - life) * .13;
      vec4 mv = viewMatrix * vec4(p, 1.);
      gl_PointSize = uPx * (.5 + seed.w*.8) * (1. + life*1.2) * (4. / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`, SOFT);
  const moteMat = makePoints(phone ? 120 : 320, 'seed', { uT: { value: 0 }, uOn: { value: 0 }, uPx: { value: 1 } }, /* glsl */`
    attribute vec4 seed; uniform float uT, uOn, uPx; varying float vA;
    void main(){
      vec3 p = vec3(seed.x*12. - 6., seed.y*3.3 + .1, seed.z*11. - 5.);
      p.x += sin(uT*.13 + seed.w*6.3)*.4; p.y += sin(uT*.17 + seed.x*6.3)*.2; p.z += cos(uT*.11 + seed.y*6.3)*.4;
      vA = uOn * (.1 + seed.w*.25);
      vec4 mv = viewMatrix * vec4(p, 1.);
      gl_PointSize = uPx * (.6 + seed.y*1.1) * (4. / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`, SOFT);

  // Постобработка: свечение трубок, зерно и виньетка.
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: dpr > 1.2 ? 2 : 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.55, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse; uniform float uT; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uT) * 43758.5453); }
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
        vec2 q = vUv - .5; c *= 1. - dot(q, q)*.85;
        float l = dot(c, vec3(.3, .6, .1)); c = mix(c, c*vec3(.93, .97, 1.06), smoothstep(.5, .0, l));
        c += (h(vUv*vec2(1920., 1080.)) - .5) * .022;
        gl_FragColor = vec4(c, 1.); }`,
  });
  composer.addPass(finish);

  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sprayMat.uniforms.uPx.value = moteMat.uniforms.uPx.value = dpr * (h / 900);
  };
  size();
  addEventListener('resize', size);

  // Прокрутка и подписи.
  const chapters = [...root.querySelectorAll('[data-in]')].map((el) => ({
    el, a: +el.dataset.in, b: +el.dataset.out, fade: +(el.dataset.fade || 0.018), last: el.dataset.out === '1.1',
  }));
  const rail = [...root.querySelectorAll('[data-go]')];
  const readP = () => clamp(-root.getBoundingClientRect().top / Math.max(1, root.offsetHeight - innerHeight));
  let target_p = readP();
  let p = target_p;
  addEventListener('scroll', () => { target_p = readP(); }, { passive: true });
  addEventListener('resize', () => { target_p = readP(); });

  const applyOverlay = (pr) => {
    chapters.forEach((c) => {
      const inn = seg(pr, c.a - c.fade, c.a + c.fade);
      const out = c.last ? 0 : seg(pr, c.b - c.fade, c.b + c.fade);
      const a = inn * (1 - out);
      c.el.style.setProperty('--a', a.toFixed(3));
      c.el.style.setProperty('--y', ((1 - inn) * 100 - out * 100).toFixed(1));
      c.el.style.visibility = a < 0.002 ? 'hidden' : 'visible';
    });
    rail.forEach((r) => r.classList.toggle('is-on', pr >= +r.dataset.go - 0.005 && pr < +r.dataset.end - 0.005));
    const railA = seg(pr, 0.3, 0.325) * (1 - seg(pr, 0.875, 0.895));
    stage.style.setProperty('--rail', railA.toFixed(3));
    stage.style.setProperty('--rail-v', railA > 0.01 ? 'visible' : 'hidden');
    stage.style.setProperty('--scrim', seg(pr, 0.3, 0.33).toFixed(3));
  };

  // Указатель чуть двигает камеру, в финале машину можно покрутить.
  const ptr = { x: 0, y: 0, sx: 0, sy: 0, yaw: 0, syaw: 0, down: false, lx: 0 };
  addEventListener('pointermove', (e) => {
    ptr.x = (e.clientX / innerWidth - 0.5) * 2; ptr.y = (e.clientY / innerHeight - 0.5) * 2;
    if (ptr.down) { ptr.yaw += (e.clientX - ptr.lx) * 0.006; ptr.lx = e.clientX; }
  }, { passive: true });
  stage.addEventListener('pointerdown', (e) => { if (p > 0.88) { ptr.down = true; ptr.lx = e.clientX; stage.classList.add('is-grab'); } });
  addEventListener('pointerup', () => { ptr.down = false; stage.classList.remove('is-grab'); });

  const applyState = (pr, t) => {
    // Ворота.
    const open = seg(pr, 0.035, 0.15);
    door.position.y = DOOR_H / 2 + open * (DOOR_H + 0.3);
    door.visible = open < 0.995;
    const street = 1 - seg(pr, 0.1, 0.19);
    washL.intensity = washR.intensity = 60 * street;

    // Свет: одна ячейка мигает, потом волна расходится по потолку.
    const fl = seg(pr, 0.155, 0.158) - seg(pr, 0.16, 0.162) * 0.8 + seg(pr, 0.165, 0.167) - seg(pr, 0.169, 0.171) * 0.7 + seg(pr, 0.174, 0.178) * 0.6;
    U.uFlick.value = clamp(fl);
    U.uWave.value = seg(pr, 0.178, 0.25);
    U.uLit.value = seg(pr, 0.18, 0.26);
    U.uStrip.value = seg(pr, 0.22, 0.3);
    scene.environmentIntensity = 0.42 * U.uLit.value;
    floor.material.uniforms.uLit.value = U.uLit.value;

    // Мойка: пена сверху вниз, потом смывается сверху вниз.
    U.uFoamY.value = THREE.MathUtils.lerp(2, -0.4, seg(pr, 0.315, 0.365));
    U.uRinseY.value = THREE.MathUtils.lerp(2.4, -0.5, seg(pr, 0.385, 0.43));
    U.uDirt.value = 1;
    sprayMat.uniforms.uOn.value = seg(pr, 0.305, 0.325) * (1 - seg(pr, 0.425, 0.44));

    // Полировка идёт от носа к корме.
    U.uPolish.value = THREE.MathUtils.lerp(3.2, -3.2, seg(pr, 0.46, 0.585));
    U.uHaze.value = 1;

    // Керамика: капли появляются и скатываются.
    U.uDrops.value = seg(pr, 0.61, 0.645) * (1 - seg(pr, 0.715, 0.74));
    U.uRoll.value = seg(pr, 0.64, 0.74) * -0.55;

    // Плёнка опускается на капот, по нему бежит край.
    const fIn = seg(pr, 0.735, 0.775), fDown = seg(pr, 0.76, 0.825);
    film.visible = fIn > 0.001 && fDown < 0.999;
    film.position.set(0, THREE.MathUtils.lerp(1.5, 1.0, fDown), 1.5);
    film.rotation.x = THREE.MathUtils.lerp(0.28, 0.17, fDown);
    filmMat.uniforms.uAmp.value = THREE.MathUtils.lerp(0.07, 0.008, fDown);
    filmMat.uniforms.uT.value = t;
    filmMat.uniforms.uA.value = 0.72 * fIn * (1 - seg(pr, 0.825, 0.845));
    U.uFilmOn.value = seg(pr, 0.8, 0.815) * (1 - seg(pr, 0.85, 0.865));
    U.uFilm.value = THREE.MathUtils.lerp(2.75, 0.7, seg(pr, 0.805, 0.86));

    lamps.forEach((l) => { l.mat.emissiveIntensity = l.max * seg(pr, 0.87, 0.9); });
    sprayMat.uniforms.uT.value = t;
    moteMat.uniforms.uT.value = t;
    moteMat.uniforms.uOn.value = U.uLit.value;
    updateTubes();
  };

  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 30, fit: 1 };
  const tmpV = new THREE.Vector3();
  const applyCam = (pr) => {
    camAt(pr, cam);
    const narrow = clamp(1.5 - camera.aspect, 0, 1.2);
    tmpV.copy(cam.pos).sub(cam.look).multiplyScalar(1 + narrow * cam.fit);
    const finalK = seg(pr, 0.86, 0.95);
    tmpV.applyAxisAngle(THREE.Object3D.DEFAULT_UP, ptr.syaw * finalK);
    camera.position.copy(cam.look).add(tmpV);
    camera.position.x += ptr.sx * 0.1;
    // Внутри бокса камера не выходит за стены: на узком экране её тянет назад.
    if (pr > 0.24) {
      camera.position.x = clamp(camera.position.x, -ROOM.halfX + 0.25, ROOM.halfX - 0.25);
      camera.position.z = clamp(camera.position.z, ROOM.back + 0.25, Math.abs(camera.position.x) > 3.4 ? ROOM.front - 0.25 : 30);
    }
    camera.position.y = Math.max(0.16, camera.position.y - ptr.sy * 0.05);
    camera.fov = cam.fov + narrow * 11;
    camera.updateProjectionMatrix();
    camera.lookAt(cam.look);
  };

  // Качество подстраиваем под устройство: если кадры тормозят, снижаем плотность пикселей.
  let visible = true, slow = 0, fast = 0, last = performance.now(), running = false, clock = 0;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { rootMargin: '10% 0px' }).observe(root);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });

  const frame = (now) => {
    if (!visible || document.hidden) { running = false; return; }
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    const goal = carReady ? target_p : Math.min(target_p, 0.03);
    p += (goal - p) * (1 - Math.exp(-dt * 7));
    if (Math.abs(goal - p) < 0.00002) p = goal;
    ptr.sx += (ptr.x - ptr.sx) * (1 - Math.exp(-dt * 3));
    ptr.sy += (ptr.y - ptr.sy) * (1 - Math.exp(-dt * 3));
    ptr.syaw += (ptr.yaw - ptr.syaw) * (1 - Math.exp(-dt * 6));
    applyState(p, clock);
    applyCam(p);
    applyOverlay(p);
    finish.uniforms.uT.value = clock % 10;
    composer.render(dt);

    if (dt > 0.034) { slow++; fast = 0; } else { fast++; }
    if (slow > 24 && dpr > 0.8) { dpr = Math.max(0.8, dpr - 0.25); slow = 0; size(); }
    if (fast > 600) { slow = 0; fast = 0; }
  };
  const start = () => { if (running) return; running = true; last = performance.now(); requestAnimationFrame(frame); };

  applyState(p, 0); applyCam(p); applyOverlay(p);
  composer.render(0);
  document.documentElement.classList.add('gl-ready');
  document.dispatchEvent(new CustomEvent('gtn:ready'));
  start();
  loadCar().catch(fail);
};

const fail = (err) => {
  console.error('[GTN] 3D-сцена не запустилась', err);
  document.documentElement.classList.remove('gl', 'gl-ready');
  document.documentElement.classList.add('gl-failed');
  document.dispatchEvent(new CustomEvent('gtn:ready'));
};
boot().catch(fail);
