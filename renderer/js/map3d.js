import { getTFPath } from './icons.js';
import { loadBotPose, loadPropModel, loadAttachment } from './botmodels.js';
import { ambientCubeAt, pickLocalLights, EMIT_SKYLIGHT } from '../../shared/lightmath.js';
import { loadSystem, createEmitter } from './particles.js';

const DEG = Math.PI / 180;
function angleMatrix(p, y, r) {
  p *= DEG; y *= DEG; r *= DEG;
  const sp = Math.sin(p), cp = Math.cos(p), sy = Math.sin(y), cy = Math.cos(y), sr = Math.sin(r), cr = Math.cos(r);
  return [
    cp * cy, cp * sy, -sp, 0,
    sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp, 0,
    cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp, 0,
    0, 0, 0, 1
  ];
}

const terrainCache = new Map();

const LIGHT_DIR = (() => { const l = Math.hypot(0.35, 0.82, 0.42); return [0.35 / l, 0.82 / l, 0.42 / l]; })();
const LIGHT_COLOR = [0.74, 0.7, 0.62];
const SKY_AMBIENT = [0.44, 0.47, 0.53];
const GROUND_AMBIENT = [0.17, 0.15, 0.13];
const FOG_COLOR = [0.043, 0.055, 0.071];

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye, tgt, up) {
  let zx = eye[0] - tgt[0], zy = eye[1] - tgt[1], zz = eye[2] - tgt[2];
  let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
}

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

const TERRAIN_VS = `attribute vec3 aPos;attribute vec2 aUV;attribute vec3 aNormal;
uniform mat4 uMVP;uniform float uFogStart;uniform float uFogEnd;
varying vec2 vUV;varying vec3 vN;varying float vFog;
void main(){vUV=aUV;vN=aNormal;vec4 p=uMVP*vec4(aPos,1.0);vFog=clamp((p.w-uFogStart)/(uFogEnd-uFogStart),0.0,1.0);gl_Position=p;}`;
const TERRAIN_FS = `precision mediump float;
varying vec2 vUV;varying vec3 vN;varying float vFog;
uniform sampler2D uTex;uniform vec3 uLightDir;uniform vec3 uLightColor;uniform vec3 uSkyAmb;uniform vec3 uGroundAmb;uniform vec3 uFogColor;
void main(){
vec3 tex=texture2D(uTex,vUV).rgb;
vec3 N=normalize(vN);
float diff=max(0.0,dot(N,uLightDir));
float hemi=0.5+0.5*N.y;
vec3 amb=mix(uGroundAmb,uSkyAmb,hemi);
vec3 c=tex*(amb+uLightColor*diff);
float l=dot(c,vec3(0.299,0.587,0.114));
c=mix(vec3(l),c,1.14);
c=(c-0.5)*1.07+0.5;
c=pow(clamp(c,0.0,1.0),vec3(0.95));
c=mix(c,uFogColor,vFog);
gl_FragColor=vec4(c,1.0);}`;
const POINT_VS = `attribute vec3 aPos;attribute float aSize;attribute vec3 aColor;
uniform mat4 uMVP;uniform float uFogStart;uniform float uFogEnd;
varying vec3 vColor;varying float vFog;
void main(){vColor=aColor;vec4 p=uMVP*vec4(aPos,1.0);vFog=clamp((p.w-uFogStart)/(uFogEnd-uFogStart),0.0,1.0);gl_Position=p;gl_PointSize=clamp(aSize*440.0/max(1.0,p.w),4.0,52.0);}`;
const POINT_FS = `precision mediump float;varying vec3 vColor;varying float vFog;
void main(){vec2 d=gl_PointCoord-vec2(0.5);float r=dot(d,d);if(r>0.25)discard;
float core=smoothstep(0.25,0.10,r);
float rim=smoothstep(0.25,0.20,r)-smoothstep(0.19,0.10,r);
vec3 c=mix(vColor,vec3(1.0),rim*0.5);
gl_FragColor=vec4(c,core*(1.0-vFog*0.7));}`;
const PART_VS = `attribute vec3 aPos;attribute float aSize;attribute vec3 aColor;attribute float aAlpha;attribute float aRot;
uniform mat4 uMVP;uniform float uProjScale;uniform float uFogStart;uniform float uFogEnd;
varying vec3 vColor;varying float vAlpha;varying float vRot;varying float vFog;
void main(){vColor=aColor;vAlpha=aAlpha;vRot=aRot;vec4 p=uMVP*vec4(aPos,1.0);
vFog=clamp((p.w-uFogStart)/(uFogEnd-uFogStart),0.0,1.0);gl_Position=p;
gl_PointSize=clamp(aSize*uProjScale/max(1.0,p.w),3.0,192.0);}`;
const PART_FS = `precision mediump float;varying vec3 vColor;varying float vAlpha;varying float vRot;varying float vFog;
uniform sampler2D uTex;uniform float uHasTex;
void main(){
vec2 d=gl_PointCoord-vec2(0.5);
float c=cos(vRot),si=sin(vRot);
vec2 uv=vec2(d.x*c-d.y*si,d.x*si+d.y*c)+vec2(0.5);
if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0)discard;
vec4 t=uHasTex>0.5?texture2D(uTex,uv):vec4(1.0,1.0,1.0,max(0.0,1.0-4.0*dot(d,d)));
float a=t.a*vAlpha*(1.0-vFog);
if(a<=0.003)discard;
gl_FragColor=vec4(vColor*t.rgb*a,a);}`;
const VIG_VS = `attribute vec2 aPos;varying vec2 vUV;void main(){vUV=aPos*0.5+0.5;gl_Position=vec4(aPos,0.0,1.0);}`;
const VIG_FS = `precision mediump float;varying vec2 vUV;uniform float uInner;uniform float uOuter;uniform float uStrength;uniform vec2 uAspect;
void main(){vec2 d=(vUV-0.5)*uAspect;float v=smoothstep(uInner,uOuter,length(d))*uStrength;gl_FragColor=vec4(0.0,0.0,0.0,v);}`;
const ZONE_VS = `attribute vec3 aPos;uniform mat4 uMVP;void main(){gl_Position=uMVP*vec4(aPos,1.0);}`;
const ZONE_FS = `precision mediump float;uniform vec4 uColor;void main(){gl_FragColor=uColor;}`;
const BLUR_FS = `precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform vec2 uDir;
void main(){vec3 s=texture2D(uTex,vUV).rgb*0.227027;
s+=texture2D(uTex,vUV+uDir*1.384615).rgb*0.316216;
s+=texture2D(uTex,vUV-uDir*1.384615).rgb*0.316216;
s+=texture2D(uTex,vUV+uDir*3.230769).rgb*0.070270;
s+=texture2D(uTex,vUV-uDir*3.230769).rgb*0.070270;
gl_FragColor=vec4(s,1.0);}`;
const BLOOM_FS = `precision mediump float;varying vec2 vUV;uniform sampler2D uTex;uniform float uScale;
void main(){vec3 b=texture2D(uTex,vUV).rgb*uScale;gl_FragColor=vec4(pow(clamp(b,0.0,1.0),vec3(1.0/2.2)),1.0);}`;
const MODEL_VS = `attribute vec3 aPos;attribute vec3 aNrm;attribute vec2 aUV;attribute vec3 aPos2;attribute vec3 aNrm2;
uniform mat4 uMVP;uniform mat4 uModel;uniform float uFogStart;uniform float uFogEnd;uniform float uBlend;
varying vec3 vN;varying vec2 vUV;varying float vFog;varying vec3 vWorld;
void main(){vUV=aUV;vec3 pos=mix(aPos,aPos2,uBlend);vN=mat3(uModel)*mix(aNrm,aNrm2,uBlend);
vWorld=(uModel*vec4(pos,1.0)).xyz;
vec4 p=uMVP*vec4(pos,1.0);vFog=clamp((p.w-uFogStart)/(uFogEnd-uFogStart),0.0,1.0);gl_Position=p;}`;
const MODEL_FS = `precision mediump float;varying vec3 vN;varying vec2 vUV;varying float vFog;varying vec3 vWorld;
uniform sampler2D uTex;uniform float uHasTex;uniform float uAlphaTest;uniform vec3 uGlow;uniform vec3 uFogColor;
uniform vec3 uAmbCube[6];uniform float uExposure;uniform float uNumLights;
uniform vec3 uLPos[4];uniform vec3 uLInt[4];uniform vec3 uLNrm[4];uniform vec4 uLAtt[4];uniform vec3 uLCone[4];
void main(){
vec4 t=uHasTex>0.5?texture2D(uTex,vUV):vec4(0.62,0.64,0.68,1.0);
if(uAlphaTest>0.5&&t.a<0.5)discard;
vec3 N=normalize(vN);
vec3 n2=N*N;
vec3 isNeg=vec3(lessThan(N,vec3(0.0)));
vec3 isPos=vec3(1.0)-isNeg;
vec3 light=isPos.x*n2.x*uAmbCube[0]+isNeg.x*n2.x*uAmbCube[1]
          +isPos.y*n2.y*uAmbCube[2]+isNeg.y*n2.y*uAmbCube[3]
          +isPos.z*n2.z*uAmbCube[4]+isNeg.z*n2.z*uAmbCube[5];
for(int i=0;i<4;i++){
  if(float(i)>=uNumLights)break;
  float ty=uLAtt[i].w;
  vec3 dl=uLPos[i]-vWorld;
  float d2=dot(dl,dl);
  float d=sqrt(max(d2,1e-8));
  vec3 dir=dl/d;
  float falloff;
  if(ty>2.5){dir=-uLNrm[i];falloff=1.0;}
  else{float den=uLAtt[i].x+uLAtt[i].y*d+uLAtt[i].z*d2;falloff=den>0.0?1.0/den:0.0;}
  float ang=max(0.0,dot(N,dir));
  if(ty>1.5&&ty<2.5){
    float dot2=dot(-dir,uLNrm[i]);
    if(dot2<=uLCone[i].y)ang=0.0;
    else if(dot2<uLCone[i].x)ang*=pow((dot2-uLCone[i].y)/max(1e-5,uLCone[i].x-uLCone[i].y),uLCone[i].z);
  }
  light+=uLInt[i]*(falloff*ang);
}
vec3 lin=pow(t.rgb,vec3(2.2))*light*uExposure;
vec3 c=pow(clamp(lin,0.0,1.0),vec3(1.0/2.2));
c=mix(c,uFogColor,vFog);
gl_FragColor=vec4(c+uGlow*(0.5+0.5*t.rgb),1.0);}`;

const MODEL_DISPLAY_SCALE = 1;
const LM_OVERBRIGHT = 2.0;
const BOMB_MODEL = 'models/props_td/atom_bomb';
const WORLD_VS = `attribute vec3 aPos;attribute vec2 aUV;attribute vec2 aLmUV;
uniform mat4 uMVP;uniform vec2 uTexSize;uniform float uFogStart;uniform float uFogEnd;
varying vec2 vUV;varying vec2 vLmUV;varying float vFog;
void main(){vUV=aUV/uTexSize;vLmUV=aLmUV;vec4 p=uMVP*vec4(aPos,1.0);vFog=clamp((p.w-uFogStart)/(uFogEnd-uFogStart),0.0,1.0);gl_Position=p;}`;
const WORLD_FS = `precision mediump float;varying vec2 vUV;varying vec2 vLmUV;varying float vFog;
uniform sampler2D uTex;uniform sampler2D uLightmap;uniform float uHasTex;uniform float uHasLM;uniform vec3 uFogColor;uniform float uLmRange;uniform float uExposure;uniform float uUseTexAlpha;uniform float uMatAlpha;uniform float uBrightPass;uniform vec3 uMinLight;
void main(){
vec4 t=uHasTex>0.5?texture2D(uTex,vUV):vec4(0.5,0.52,0.55,1.0);
vec3 lm=uHasLM>0.5?pow(texture2D(uLightmap,vLmUV).rgb,vec3(2.2))*uLmRange:vec3(1.0);
vec3 lin=pow(t.rgb,vec3(2.2))*lm*uExposure;
if(uBrightPass>0.5){gl_FragColor=vec4(max(vec3(0.0),lin-1.0)*(1.0-vFog),1.0);return;}
vec3 c=pow(clamp(lin,0.0,1.0),vec3(1.0/2.2));
c=max(c,uMinLight);
c=mix(c,uFogColor,vFog);
float a=mix(1.0,t.a,uUseTexAlpha)*uMatAlpha;
gl_FragColor=vec4(c,a);}`;

const LUM3 = (r, g, b) => r * 0.2126 + g * 0.7152 + b * 0.0722;
const ZUP2YUP = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
function mTranslate(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
function mRotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
function mScale(s) { return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]; }
function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }

function buildTerrain(hg, bounds) {
  const key = bounds.join(',') + ':' + hg.gw + 'x' + hg.gh;
  if (terrainCache.has(key)) return terrainCache.get(key);
  const { grid, gw, gh } = hg;
  const Wx = bounds[2] - bounds[0], Wy = bounds[3] - bounds[1];
  const WALL = 14;
  const v = [];
  const at = (r, c) => (r >= 0 && r < gh && c >= 0 && c < gw) ? grid[r * gw + c] : NaN;
  const worldX = c => bounds[0] + c / gw * Wx;
  const worldZ = r => -(bounds[3] - r / gh * Wy);
  const push = (x, y, z, u, vv, nx, ny, nz) => { v.push(x, y, z, u, vv, nx, ny, nz); };
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const h = grid[r * gw + c];
      if (h !== h) continue;
      const x0 = worldX(c), x1 = worldX(c + 1), z0 = worldZ(r), z1 = worldZ(r + 1);
      const u0 = c / gw, u1 = (c + 1) / gw, v0 = r / gh, v1 = (r + 1) / gh;
      push(x0, h, z0, u0, v0, 0, 1, 0); push(x1, h, z0, u1, v0, 0, 1, 0); push(x1, h, z1, u1, v1, 0, 1, 0);
      push(x0, h, z0, u0, v0, 0, 1, 0); push(x1, h, z1, u1, v1, 0, 1, 0); push(x0, h, z1, u0, v1, 0, 1, 0);
      const hR = at(r, c + 1);
      if (hR === hR && Math.abs(h - hR) > WALL) {
        const nx = h > hR ? 1 : -1;
        push(x1, h, z0, u1, v0, nx, 0, 0); push(x1, h, z1, u1, v1, nx, 0, 0); push(x1, hR, z1, u1, v1, nx, 0, 0);
        push(x1, h, z0, u1, v0, nx, 0, 0); push(x1, hR, z1, u1, v1, nx, 0, 0); push(x1, hR, z0, u1, v0, nx, 0, 0);
      }
      const hD = at(r + 1, c);
      if (hD === hD && Math.abs(h - hD) > WALL) {
        const nz = h > hD ? 1 : -1;
        push(x0, h, z1, u0, v1, 0, 0, nz); push(x1, h, z1, u1, v1, 0, 0, nz); push(x1, hD, z1, u1, v1, 0, 0, nz);
        push(x0, h, z1, u0, v1, 0, 0, nz); push(x1, hD, z1, u1, v1, 0, 0, nz); push(x0, hD, z1, u0, v1, 0, 0, nz);
      }
    }
  }
  const data = new Float32Array(v);
  const entry = { data, count: v.length / 8 };
  terrainCache.set(key, entry);
  if (terrainCache.size > 4) terrainCache.delete(terrainCache.keys().next().value);
  return entry;
}

export function createMap3D(scene) {
  const canvas = document.createElement('canvas');
  canvas.className = 'map-canvas map-3d';
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true });
  if (!gl) return null;

  const terrainProg = program(gl, TERRAIN_VS, TERRAIN_FS);
  const pointProg = program(gl, POINT_VS, POINT_FS);
  const partProg = program(gl, PART_VS, PART_FS);
  const paA = {
    pos: gl.getAttribLocation(partProg, 'aPos'),
    size: gl.getAttribLocation(partProg, 'aSize'),
    color: gl.getAttribLocation(partProg, 'aColor'),
    alpha: gl.getAttribLocation(partProg, 'aAlpha'),
    rot: gl.getAttribLocation(partProg, 'aRot'),
    mvp: gl.getUniformLocation(partProg, 'uMVP'),
    projScale: gl.getUniformLocation(partProg, 'uProjScale'),
    fogStart: gl.getUniformLocation(partProg, 'uFogStart'),
    fogEnd: gl.getUniformLocation(partProg, 'uFogEnd'),
    texU: gl.getUniformLocation(partProg, 'uTex'),
    hasTex: gl.getUniformLocation(partProg, 'uHasTex')
  };
  const partBuf = gl.createBuffer();
  let partScratch = new Float32Array(9 * 512);
  const fxCache = new Map();
  const fxEmitters = new Map();
  let fxLastT = null;

  // Real TF2 particle systems, attached to what the sim actually reports.
  // Both of these must be CONTINUOUS systems: a state indicator has to persist. One-shot
  // burst systems (mvm_pow_crit, crit_text, mvm_loot_floatember) fire once and vanish, so
  // they are useless here even though they sound right. Measured across the stock files for
  // sustained particle counts: soldierbuff_blue_spiral is TF2's BLU buff aura (rate 2000,
  // ~500 alive) and mvm_hatch_destroy_smolderembers is glowing embers on sc_hardglow
  // (rate 50, ~100 alive) — the live-bomb look on the carrier's back.
  const FX = { carrier: 'mvm_hatch_destroy_smolderembers', crit: 'soldierbuff_blue_spiral' };

  function fxFor(key) {
    const name = FX[key];
    if (!name) return null;
    if (!fxCache.has(name)) {
      fxCache.set(name, null);
      getTFPath().then(tf => loadSystem(name, tf)).then(rec => {
        if (disposed || !rec || !rec.def) return;
        let tex = null;
        if (rec.sheet && rec.sheet.rgba) tex = makeGLTex(rec.sheet);
        fxCache.set(name, { def: rec.def, tex });
        schedule();
      }).catch(() => {});
    }
    return fxCache.get(name);
  }

  function fxEmitter(id, key, origin) {
    const rec = fxFor(key);
    if (!rec) return null;
    let e = fxEmitters.get(id);
    if (!e || e.def !== rec.def) {
      e = createEmitter(rec.def);
      // Run the system forward once so a paused view (and the very first frame) shows it at
      // steady state instead of a cloud of zero-age, zero-alpha particles.
      if (origin) for (let i = 0; i < 45; i++) e.step(1 / 30, origin);
      fxEmitters.set(id, e);
    }
    return e;
  }

  const vigProg = program(gl, VIG_VS, VIG_FS);
  const tA = {
    pos: gl.getAttribLocation(terrainProg, 'aPos'),
    uv: gl.getAttribLocation(terrainProg, 'aUV'),
    normal: gl.getAttribLocation(terrainProg, 'aNormal'),
    mvp: gl.getUniformLocation(terrainProg, 'uMVP'),
    tex: gl.getUniformLocation(terrainProg, 'uTex'),
    lightDir: gl.getUniformLocation(terrainProg, 'uLightDir'),
    lightColor: gl.getUniformLocation(terrainProg, 'uLightColor'),
    skyAmb: gl.getUniformLocation(terrainProg, 'uSkyAmb'),
    groundAmb: gl.getUniformLocation(terrainProg, 'uGroundAmb'),
    fogColor: gl.getUniformLocation(terrainProg, 'uFogColor'),
    fogStart: gl.getUniformLocation(terrainProg, 'uFogStart'),
    fogEnd: gl.getUniformLocation(terrainProg, 'uFogEnd')
  };
  const pA = {
    pos: gl.getAttribLocation(pointProg, 'aPos'),
    size: gl.getAttribLocation(pointProg, 'aSize'),
    color: gl.getAttribLocation(pointProg, 'aColor'),
    mvp: gl.getUniformLocation(pointProg, 'uMVP'),
    fogStart: gl.getUniformLocation(pointProg, 'uFogStart'),
    fogEnd: gl.getUniformLocation(pointProg, 'uFogEnd')
  };
  const vA = {
    pos: gl.getAttribLocation(vigProg, 'aPos'),
    inner: gl.getUniformLocation(vigProg, 'uInner'),
    outer: gl.getUniformLocation(vigProg, 'uOuter'),
    strength: gl.getUniformLocation(vigProg, 'uStrength'),
    aspect: gl.getUniformLocation(vigProg, 'uAspect')
  };
  const modelProg = program(gl, MODEL_VS, MODEL_FS);
  const mA = {
    pos: gl.getAttribLocation(modelProg, 'aPos'),
    nrm: gl.getAttribLocation(modelProg, 'aNrm'),
    uv: gl.getAttribLocation(modelProg, 'aUV'),
    pos2: gl.getAttribLocation(modelProg, 'aPos2'),
    nrm2: gl.getAttribLocation(modelProg, 'aNrm2'),
    blend: gl.getUniformLocation(modelProg, 'uBlend'),
    mvp: gl.getUniformLocation(modelProg, 'uMVP'),
    model: gl.getUniformLocation(modelProg, 'uModel'),
    texU: gl.getUniformLocation(modelProg, 'uTex'),
    hasTex: gl.getUniformLocation(modelProg, 'uHasTex'),
    alphaTest: gl.getUniformLocation(modelProg, 'uAlphaTest'),
    glow: gl.getUniformLocation(modelProg, 'uGlow'),
    ambCube: gl.getUniformLocation(modelProg, 'uAmbCube[0]'),
    mExposure: gl.getUniformLocation(modelProg, 'uExposure'),
    numLights: gl.getUniformLocation(modelProg, 'uNumLights'),
    lPos: gl.getUniformLocation(modelProg, 'uLPos[0]'),
    lInt: gl.getUniformLocation(modelProg, 'uLInt[0]'),
    lNrm: gl.getUniformLocation(modelProg, 'uLNrm[0]'),
    lAtt: gl.getUniformLocation(modelProg, 'uLAtt[0]'),
    lCone: gl.getUniformLocation(modelProg, 'uLCone[0]'),
    fogColor: gl.getUniformLocation(modelProg, 'uFogColor'),
    fogStart: gl.getUniformLocation(modelProg, 'uFogStart'),
    fogEnd: gl.getUniformLocation(modelProg, 'uFogEnd')
  };
  const zoneProg = program(gl, ZONE_VS, ZONE_FS);
  const zA = {
    pos: gl.getAttribLocation(zoneProg, 'aPos'),
    mvp: gl.getUniformLocation(zoneProg, 'uMVP'),
    color: gl.getUniformLocation(zoneProg, 'uColor')
  };
  const zoneBuf = gl.createBuffer();
  gl.getExtension('OES_element_index_uint');
  const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;
  const models = new Map();

  const worldProg = program(gl, WORLD_VS, WORLD_FS);
  const wA = {
    pos: gl.getAttribLocation(worldProg, 'aPos'),
    uv: gl.getAttribLocation(worldProg, 'aUV'),
    lmuv: gl.getAttribLocation(worldProg, 'aLmUV'),
    mvp: gl.getUniformLocation(worldProg, 'uMVP'),
    texSize: gl.getUniformLocation(worldProg, 'uTexSize'),
    texU: gl.getUniformLocation(worldProg, 'uTex'),
    lightmap: gl.getUniformLocation(worldProg, 'uLightmap'),
    hasTex: gl.getUniformLocation(worldProg, 'uHasTex'),
    hasLM: gl.getUniformLocation(worldProg, 'uHasLM'),
    lmRange: gl.getUniformLocation(worldProg, 'uLmRange'),
    exposure: gl.getUniformLocation(worldProg, 'uExposure'),
    fogColor: gl.getUniformLocation(worldProg, 'uFogColor'),
    fogStart: gl.getUniformLocation(worldProg, 'uFogStart'),
    fogEnd: gl.getUniformLocation(worldProg, 'uFogEnd'),
    useTexAlpha: gl.getUniformLocation(worldProg, 'uUseTexAlpha'),
    matAlpha: gl.getUniformLocation(worldProg, 'uMatAlpha'),
    brightPass: gl.getUniformLocation(worldProg, 'uBrightPass'),
    minLight: gl.getUniformLocation(worldProg, 'uMinLight')
  };
  const blurProg = program(gl, VIG_VS, BLUR_FS);
  const blurA = { pos: gl.getAttribLocation(blurProg, 'aPos'), tex: gl.getUniformLocation(blurProg, 'uTex'), dir: gl.getUniformLocation(blurProg, 'uDir') };
  const bloomProg = program(gl, VIG_VS, BLOOM_FS);
  const bloomA = { pos: gl.getAttribLocation(bloomProg, 'aPos'), tex: gl.getUniformLocation(bloomProg, 'uTex'), scale: gl.getUniformLocation(bloomProg, 'uScale') };
  const bloomFBs = [null, null];
  let bloomW = 0, bloomH = 0;
  function makeFB(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex };
  }
  function ensureBloomFBs(w, h) {
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    if (bw === bloomW && bh === bloomH && bloomFBs[0]) return;
    for (const b of bloomFBs) if (b) { gl.deleteFramebuffer(b.fb); gl.deleteTexture(b.tex); }
    bloomFBs[0] = makeFB(bw, bh); bloomFBs[1] = makeFB(bw, bh);
    bloomW = bw; bloomH = bh;
  }
  let world = null;
  let worldKey = null;
  let lmTex = null;
  let worldExposure = LM_OVERBRIGHT;
  let worldLmRange = 16;
  let worldMinLight = [0.05, 0.05, 0.05];
  let worldUpBright = 0;
  let sunScale = 0;
  let ambUpRef = 0;
  const BLOOM_SCALE = 0.5;

  let lightData = null;
  const lightCache = new Map();
  const AMB_ZERO = new Float32Array(18);
  const EMPTY_LIGHT = { amb: AMB_ZERO, n: 0, pos: new Float32Array(12), int: new Float32Array(12), nrm: new Float32Array(12), att: new Float32Array(16), cone: new Float32Array(12) };

  // The engine's model lighting state at a world point: the leaf ambient cube plus the
  // strongest local worldlights. Cube faces and light vectors are rebased from TF axes
  // (x,y,z up) to this renderer's GL axes (x, z, -y).
  function lightingFor(x, y, z) {
    if (!lightData) return EMPTY_LIGHT;
    const key = (x >> 6) + ',' + (y >> 6) + ',' + (z >> 6);
    let e = lightCache.get(key);
    if (e) return e;
    const tf = ambientCubeAt(lightData, x, y, z);
    const amb = new Float32Array(18);
    const order = [0, 1, 4, 5, 3, 2];
    for (let f = 0; f < 6; f++) {
      const src = order[f] * 3;
      amb[f * 3] = tf[src]; amb[f * 3 + 1] = tf[src + 1]; amb[f * 3 + 2] = tf[src + 2];
    }
    // The leaf ambient cube is vrad's baked AMBIENT irradiance, unit-consistent with the
    // lightmap (measured: 0.37 vs 0.33 mean luminance) — but ambient-only leaves models with
    // no direct sun, which reads as the sky's flat blue. The one light worth re-adding is the
    // skylight (the sun); the point/spot lights measured ~0.00 at prop positions anyway.
    // dworldlight_t.intensity is vrad's PRE-radiosity input, so it cannot be mixed with baked
    // units directly (raw, it clipped 98% of props to white). Calibrate it instead: sunlit
    // up-facing world faces sit at lmUpBright, and the ambient cube supplies A_up there, so
    // the sun must contribute (lmUpBright - A_up) for an up-facing surface. Both sides are
    // measured vrad output — no guessed constant.
    const sun = lightData.lights.find(w => w.type === EMIT_SKYLIGHT);
    if (sun && !sunScale && worldUpBright > 0) {
      let aSum = 0, aN = 0;
      for (let i = 0; i < lightData.cubes.length; i += 18) {
        aSum += LUM3(lightData.cubes[i + 12], lightData.cubes[i + 13], lightData.cubes[i + 14]);
        aN++;
      }
      const aUp = aN ? aSum / aN : 0;
      ambUpRef = aUp;
      const sunLum = LUM3(sun.intensity[0], sun.intensity[1], sun.intensity[2]);
      const cos = Math.max(0.1, Math.abs(sun.normal[2]));
      sunScale = sunLum > 0 ? Math.max(0, worldUpBright - aUp) / (sunLum * cos) : 0;
    }
    if (sun && sunScale > 0) {
      // How much sun actually reaches this spot. vrad already answered that: the leaf ambient
      // cube's up-face is the baked measure of sky visibility here, so a prop tucked under an
      // arch or behind a building gets proportionally less sun instead of being lit as if it
      // stood in the open. Without this every prop reads equally sunlit regardless of cover.
      const localUp = LUM3(amb[6], amb[7], amb[8]);
      const skyVis = ambUpRef > 0 ? Math.max(0, Math.min(1, localUp / ambUpRef)) : 1;
      const pos = new Float32Array(12), int = new Float32Array(12), nrm = new Float32Array(12);
      const att = new Float32Array(16), cone = new Float32Array(12);
      const sf = sunScale * skyVis;
      int[0] = sun.intensity[0] * sf; int[1] = sun.intensity[1] * sf; int[2] = sun.intensity[2] * sf;
      nrm[0] = sun.normal[0]; nrm[1] = sun.normal[2]; nrm[2] = -sun.normal[1];
      att[3] = EMIT_SKYLIGHT;
      cone[2] = 1;
      e = { amb, n: 1, pos, int, nrm, att, cone };
    } else {
      e = { amb, n: 0, pos: EMPTY_LIGHT.pos, int: EMPTY_LIGHT.int, nrm: EMPTY_LIGHT.nrm, att: EMPTY_LIGHT.att, cone: EMPTY_LIGHT.cone };
    }
    if (lightCache.size < 20000) lightCache.set(key, e);
    return e;
  }

  function applyModelLight(x, y, z) {
    const L = lightingFor(Math.round(x), Math.round(y), Math.round(z));
    gl.uniform3fv(mA.ambCube, L.amb);
    gl.uniform1f(mA.numLights, L.n);
    gl.uniform3fv(mA.lPos, L.pos);
    gl.uniform3fv(mA.lInt, L.int);
    gl.uniform3fv(mA.lNrm, L.nrm);
    gl.uniform4fv(mA.lAtt, L.att);
    gl.uniform3fv(mA.lCone, L.cone);
  }

  function f32(b) { const u = b instanceof Uint8Array ? b : (b instanceof Float32Array ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b)); return b instanceof Float32Array ? b : new Float32Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)); }

  function buildWorld(faces3d, tfPath) {
    if (world) for (const g of world) { gl.deleteBuffer(g.posBuf); gl.deleteBuffer(g.uvBuf); gl.deleteBuffer(g.lmBuf); if (g.tex) gl.deleteTexture(g.tex); }
    if (lmTex) { gl.deleteTexture(lmTex); lmTex = null; }
    worldExposure = Number.isFinite(faces3d.exposure) ? faces3d.exposure : LM_OVERBRIGHT;
    worldLmRange = (faces3d.lightmap && faces3d.lightmap.range) || 16;
    worldUpBright = Number.isFinite(faces3d.lmUpBright) ? faces3d.lmUpBright : 0;
    sunScale = 0;
    lightCache.clear();
    const ml = (Number.isFinite(faces3d.minLight) ? faces3d.minLight : 0.05) * Math.pow(worldExposure, 1 / 2.2);
    const amb = Array.isArray(faces3d.ambient) && faces3d.ambient.length === 3 ? faces3d.ambient : [1, 1, 1];
    worldMinLight = amb.map(c => Math.max(0, Math.min(0.35, ml * c)));
    if (faces3d.lightmap && faces3d.lightmap.rgba) {
      const L = faces3d.lightmap;
      lmTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, lmTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, L.width, L.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8(L.rgba));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    world = [];
    for (const m of faces3d.materials) {
      const posBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, f32(m.positions), gl.STATIC_DRAW);
      const uvBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, f32(m.uvs), gl.STATIC_DRAW);
      const lmBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, lmBuf); gl.bufferData(gl.ARRAY_BUFFER, f32(m.lm), gl.STATIC_DRAW);
      const g = { posBuf, uvBuf, lmBuf, count: m.count, tex: null, texW: 256, texH: 256, translucent: false, alpha: 1 };
      world.push(g);
      resolveMat(m.name, [], tfPath).then(mat => { if (disposed) return; g.tex = mat.tex; g.translucent = mat.translucent; g.alpha = mat.alpha; if (mat.w) { g.texW = mat.w; g.texH = mat.h; } schedule(); });
    }
  }

  function makeGLTex(raw) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, raw.width, raw.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8(raw.rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const pot = (raw.width & (raw.width - 1)) === 0 && (raw.height & (raw.height - 1)) === 0;
    if (pot) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (maxAniso) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    return t;
  }

  async function effectiveVmt(rel, tfPath, bsp, seen) {
    const buf = await window.popnative.matRead(rel, tfPath, bsp);
    if (!buf) return null;
    const text = new TextDecoder('latin1').decode(u8(buf));
    if (/\$basetexture\b/i.test(text) || seen.size > 4) return text;
    const inc = text.match(/["']?include["']?\s+["']?([^"'\r\n]+?)["']?\s*$/im);
    if (!inc) return text;
    const next = inc[1].trim().replace(/\\/g, '/').replace(/^materials\//i, '').replace(/\.vmt$/i, '').toLowerCase();
    const nrel = 'materials/' + next + '.vmt';
    if (seen.has(nrel)) return text;
    seen.add(nrel);
    const baseText = await effectiveVmt(nrel, tfPath, bsp, seen);
    return baseText ? baseText + '\n' + text : text;
  }

  async function resolveMat(texName, cdtextures, tfPath) {
    const bsp = (scene && scene.bspPath) || null;
    const name = String(texName || '').replace(/\\/g, '/').toLowerCase();
    const cands = name.includes('/') ? ['materials/' + name + '.vmt'] : cdtextures.map(cd => ('materials/' + cd + name + '.vmt').replace(/\/+/g, '/').toLowerCase());
    for (const rel of cands) {
      const text = await effectiveVmt(rel, tfPath, bsp, new Set([rel]));
      if (!text) continue;
      const base = text.match(/\$basetexture"?\s*"?([^"\r\n]+?)"?\s*$/im);
      const has = k => new RegExp('"?\\$' + k + '"?\\s*"?\\s*1', 'i').test(text);
      const alphaIsMask = has('basemapalphaphongmask') || has('basealphaenvmapmask') || has('blendtintbybasealpha') || (has('selfillum') && !/\$selfillummask/i.test(text));
      const translucent = has('translucent') && !alphaIsMask;
      const alphaTest = has('alphatest') && !alphaIsMask;
      const am = text.match(/\$alpha"?\s+"?([0-9.]+)/i);
      const alpha = am ? Math.max(0, Math.min(1, parseFloat(am[1]))) : 1;
      let tex = null, w = 0, h = 0;
      if (base) {
        const vtf = 'materials/' + base[1].trim().replace(/\\/g, '/').replace(/\.vtf$/i, '').toLowerCase() + '.vtf';
        const raw = await window.popnative.matTexture(vtf, tfPath, bsp);
        if (raw) { tex = makeGLTex(raw); w = raw.width; h = raw.height; }
      }
      return { tex, alphaTest, translucent, alpha, w, h };
    }
    return { tex: null, alphaTest: false, translucent: false, alpha: 1, w: 0, h: 0 };
  }

  const props = new Map();
  let propInstances = null;
  let propsKey = null;

  function ensureProp(model) {
    if (!model || props.has(model)) return;
    const rec = { loading: true, loaded: false };
    props.set(model, rec);
    (async () => {
      let m = null;
      try { m = await loadPropModel(model); } catch {}
      if (disposed) return;
      if (!m) { rec.loading = false; rec.error = true; return; }
      const tfPath = await getTFPath();
      const posBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
      const nrmBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf); gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);
      const uvBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.STATIC_DRAW);
      const idxBuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
      const mats = new Map();
      const skin0 = m.skins && m.skins[0] ? m.skins[0] : null;
      for (const me of m.meshes) {
        if (mats.has(me.material)) continue;
        mats.set(me.material, { tex: null, alphaTest: false });
        const texIdx = skin0 && me.material < skin0.length ? skin0[me.material] : me.material;
        const texName = m.textures[texIdx] ?? m.textures[me.material];
        resolveMat(texName, m.cdtextures, tfPath).then(mat => { if (!disposed) { mats.set(me.material, mat); schedule(); } });
      }
      Object.assign(rec, { loading: false, loaded: true, posBuf, nrmBuf, uvBuf, idxBuf, meshes: m.meshes, mats });
      schedule();
    })();
  }

  function buildRenderable(pose, tfPath) {
    const frameBufs = pose.frames.map(fr => {
      const posBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, fr.pos, gl.STATIC_DRAW);
      const nrmBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf); gl.bufferData(gl.ARRAY_BUFFER, fr.nrm, gl.STATIC_DRAW);
      return { posBuf, nrmBuf };
    });
    const uvBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, pose.uv, gl.STATIC_DRAW);
    const idxBuf = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pose.idx, gl.STATIC_DRAW);
    const mats = new Map();
    const skinFam = pose.skins ? (pose.skins[1] || pose.skins[0] || null) : null;
    for (const m of pose.meshes) {
      if (mats.has(m.material)) continue;
      mats.set(m.material, { tex: null, alphaTest: false });
      const texIdx = skinFam && m.material < skinFam.length ? skinFam[m.material] : m.material;
      const texName = pose.textures[texIdx] ?? pose.textures[m.material];
      resolveMat(texName, pose.cdtextures, tfPath).then(mat => { if (!disposed) { mats.set(m.material, mat); schedule(); } });
    }
    return { frameBufs, uvBuf, idxBuf, meshes: pose.meshes, mats };
  }

  function drawRenderable(r, f0, f1, blend) {
    const fb = r.frameBufs[f0 % r.frameBufs.length];
    const fb1 = r.frameBufs[f1 % r.frameBufs.length];
    gl.uniform1f(mA.blend, blend);
    gl.bindBuffer(gl.ARRAY_BUFFER, fb.posBuf); gl.enableVertexAttribArray(mA.pos); gl.vertexAttribPointer(mA.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, fb.nrmBuf); gl.enableVertexAttribArray(mA.nrm); gl.vertexAttribPointer(mA.nrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, fb1.posBuf); gl.enableVertexAttribArray(mA.pos2); gl.vertexAttribPointer(mA.pos2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, fb1.nrmBuf); gl.enableVertexAttribArray(mA.nrm2); gl.vertexAttribPointer(mA.nrm2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.uvBuf); gl.enableVertexAttribArray(mA.uv); gl.vertexAttribPointer(mA.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.idxBuf);
    for (const m of r.meshes) {
      const mat = r.mats.get(m.material) || {};
      gl.activeTexture(gl.TEXTURE0);
      if (mat.tex) gl.bindTexture(gl.TEXTURE_2D, mat.tex);
      gl.uniform1i(mA.texU, 0);
      gl.uniform1f(mA.hasTex, mat.tex ? 1 : 0);
      gl.uniform1f(mA.alphaTest, mat.alphaTest ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, m.offset * 4);
    }
  }

  function drawStatic(pool) {
    gl.bindBuffer(gl.ARRAY_BUFFER, pool.posBuf); gl.enableVertexAttribArray(mA.pos); gl.vertexAttribPointer(mA.pos, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(mA.pos2); gl.vertexAttribPointer(mA.pos2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pool.nrmBuf); gl.enableVertexAttribArray(mA.nrm); gl.vertexAttribPointer(mA.nrm, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(mA.nrm2); gl.vertexAttribPointer(mA.nrm2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pool.uvBuf); gl.enableVertexAttribArray(mA.uv); gl.vertexAttribPointer(mA.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pool.idxBuf);
    for (const me of pool.meshes) {
      const mat = pool.mats.get(me.material) || {};
      gl.activeTexture(gl.TEXTURE0);
      if (mat.tex) gl.bindTexture(gl.TEXTURE_2D, mat.tex);
      gl.uniform1i(mA.texU, 0);
      gl.uniform1f(mA.hasTex, mat.tex ? 1 : 0);
      gl.uniform1f(mA.alphaTest, mat.alphaTest ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, me.count, gl.UNSIGNED_INT, me.offset * 4);
    }
  }

  function ensureModel(key, base, attachments) {
    if (!key || models.has(key)) return;
    const rec = { loading: true, loaded: false };
    models.set(key, rec);
    (async () => {
      let pose = null;
      try { pose = await loadBotPose(base); } catch {}
      if (disposed) return;
      if (!pose) { rec.loading = false; rec.error = true; return; }
      const tfPath = await getTFPath();
      const body = buildRenderable(pose, tfPath);
      const atts = [];
      for (const att of (attachments || [])) {
        let ap = null;
        try { ap = await loadAttachment(att, pose); } catch {}
        if (disposed) return;
        if (ap && ap.frames.length) atts.push(buildRenderable(ap, tfPath));
      }
      Object.assign(rec, { loading: false, loaded: true, ...body, attachments: atts, numframes: pose.numframes, fps: pose.fps, flagFrames: pose.flagFrames });
      schedule();
    })();
  }

  const terrainBuf = gl.createBuffer();
  const pointBuf = gl.createBuffer();
  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const tex = gl.createTexture();
  let terrainCount = 0;
  let center = [0, 0, 0], diag = 4000;
  let raf = 0, disposed = false, lastT = 0;

  function uploadTexture(cv) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  function loadScene(s) {
    scene = s;
    if (s.lighting !== lightData) { lightData = s.lighting || null; lightCache.clear(); }
    canvas.style.cursor = s.tool === 'kill' ? 'crosshair' : '';
    const t = buildTerrain(s.heightGrid, s.bounds);
    terrainCount = t.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuf);
    gl.bufferData(gl.ARRAY_BUFFER, t.data, gl.STATIC_DRAW);
    uploadTexture(s.tex);
    if (s.faces3d && s.faces3d.materials && worldKey !== s.mapName) {
      getTFPath().then(tfPath => { if (!disposed) buildWorld(s.faces3d, tfPath); });
      worldKey = s.mapName;
    } else if (!s.faces3d && worldKey !== s.mapName) {
      world = null; worldKey = null;
    }
    if (s.props && s.props.length && propsKey !== s.mapName) {
      propInstances = new Map();
      for (const p of s.props) {
        if (!propInstances.has(p.model)) propInstances.set(p.model, []);
        propInstances.get(p.model).push(p);
      }
      for (const model of propInstances.keys()) ensureProp(model);
      propsKey = s.mapName;
    } else if (!s.props && propsKey !== s.mapName) {
      propInstances = null; propsKey = null;
    }
    const midH = (s.heightGrid.zMin + s.heightGrid.zMax) / 2;
    center = [(s.bounds[0] + s.bounds[2]) / 2, midH, -(s.bounds[1] + s.bounds[3]) / 2];
    diag = Math.hypot(s.bounds[2] - s.bounds[0], s.bounds[3] - s.bounds[1]);
    if (!s.cam.dist) Object.assign(s.cam, { yaw: 0.6, pitch: 0.92, dist: diag * 0.72 });
  }

  function sampleHeight(x, y) {
    const hg = scene.heightGrid, b = scene.bounds;
    const c = Math.max(0, Math.min(hg.gw - 1, Math.round((x - b[0]) / (b[2] - b[0]) * hg.gw)));
    const r = Math.max(0, Math.min(hg.gh - 1, Math.round((b[3] - y) / (b[3] - b[1]) * hg.gh)));
    let h = hg.grid[r * hg.gw + c];
    if (h !== h) { for (let k = 1; k <= 3 && h !== h; k++) h = hg.grid[Math.min(hg.gh - 1, r + k) * hg.gw + c]; }
    return h === h ? h : hg.zMin;
  }

  function camEye() {
    const cam = scene.cam;
    const target = [center[0] + (cam.panX || 0), center[1] + (cam.panY || 0), center[2] + (cam.panZ || 0)];
    const horiz = Math.cos(cam.pitch) * cam.dist;
    const eye = [target[0] + horiz * Math.sin(cam.yaw), target[1] + Math.sin(cam.pitch) * cam.dist, target[2] + horiz * Math.cos(cam.yaw)];
    return { eye, target };
  }

  function pickGround(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const { eye, target } = camEye();
    let fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, ry = 0, rz = fx;
    const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const tanY = Math.tan(0.82 / 2), tanX = tanY * aspect;
    let dx = fx + rx * ndcX * tanX + ux * ndcY * tanY;
    let dy = fy + ry * ndcX * tanX + uy * ndcY * tanY;
    let dz = fz + rz * ndcX * tanX + uz * ndcY * tanY;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const far = diag * 3.5, step = Math.max(6, diag / 400);
    let prevAbove = eye[1] - sampleHeight(eye[0], -eye[2]);
    let tPrev = 0;
    for (let t = step; t <= far; t += step) {
      const px = eye[0] + dx * t, py = eye[1] + dy * t, pz = eye[2] + dz * t;
      const above = py - sampleHeight(px, -pz);
      if (above <= 0 && prevAbove > 0) {
        let lo = tPrev, hi = t;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          const mx = eye[0] + dx * mid, my = eye[1] + dy * mid, mz = eye[2] + dz * mid;
          if (my - sampleHeight(mx, -mz) > 0) lo = mid; else hi = mid;
        }
        const hx = eye[0] + dx * hi, hz = eye[2] + dz * hi;
        return [hx, -hz];
      }
      prevAbove = above; tPrev = t;
    }
    return null;
  }

  function drawZones(mvp) {
    const kps = scene.killPoints;
    if (!kps || !kps.length) return;
    gl.useProgram(zoneProg);
    gl.uniformMatrix4fv(zA.mvp, false, mvp);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const N = 44;
    const fan = new Float32Array((N + 2) * 3);
    const ring = new Float32Array(N * 3);
    for (const kp of kps) {
      const wx = kp[0], wy = kp[1], r = kp[2] || 200;
      fan[0] = wx; fan[1] = sampleHeight(wx, wy) + 6; fan[2] = -wy;
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2, tx = wx + r * Math.cos(a), ty = wy + r * Math.sin(a), o = (i + 1) * 3;
        fan[o] = tx; fan[o + 1] = sampleHeight(tx, ty) + 6; fan[o + 2] = -ty;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, zoneBuf);
      gl.bufferData(gl.ARRAY_BUFFER, fan, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(zA.pos); gl.vertexAttribPointer(zA.pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(zA.color, 0.95, 0.26, 0.2, 0.24);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, N + 2);
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2, tx = wx + r * Math.cos(a), ty = wy + r * Math.sin(a), o = i * 3;
        ring[o] = tx; ring[o + 1] = sampleHeight(tx, ty) + 8; ring[o + 2] = -ty;
      }
      gl.bufferData(gl.ARRAY_BUFFER, ring, gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(zA.pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(zA.color, 1.0, 0.42, 0.34, 0.9);
      gl.drawArrays(gl.LINE_LOOP, 0, N);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
  }

  function draw() {
    raf = 0;
    if (disposed || !canvas.isConnected) return;
    const now = performance.now();
    if (scene.ps.playing && scene.waveEnd) {
      const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
      scene.ps.t = Math.min(scene.waveEnd, scene.ps.t + dt * (scene.ps.speed || 1));
      if (scene.ps.t >= scene.waveEnd) { scene.ps.playing = false; if (scene.onPlayEnd) scene.onPlayEnd(); }
    }
    lastT = now;
    if (scene.onTime) scene.onTime(scene.ps.t);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w && h && (canvas.width !== w * dpr || canvas.height !== h * dpr)) { canvas.width = w * dpr; canvas.height = h * dpr; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(FOG_COLOR[0], FOG_COLOR[1], FOG_COLOR[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const cam = scene.cam;
    const target = [center[0] + (cam.panX || 0), center[1] + (cam.panY || 0), center[2] + (cam.panZ || 0)];
    const horiz = Math.cos(cam.pitch) * cam.dist;
    const eye = [target[0] + horiz * Math.sin(cam.yaw), target[1] + Math.sin(cam.pitch) * cam.dist, target[2] + horiz * Math.cos(cam.yaw)];
    const aspect = canvas.width / Math.max(1, canvas.height);
    const proj = perspective(0.82, aspect, Math.max(8, diag * 0.01), diag * 4);
    const view = lookAt(eye, target, [0, 1, 0]);
    const mvp = new Float32Array(mul(proj, view));
    const fogStart = diag * 0.5, fogEnd = diag * 1.85;

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    if (world && world.length) {
      gl.useProgram(worldProg);
      gl.uniformMatrix4fv(wA.mvp, false, mvp);
      gl.uniform3fv(wA.fogColor, FOG_COLOR);
      gl.uniform1f(wA.fogStart, fogStart);
      gl.uniform1f(wA.fogEnd, fogEnd);
      gl.uniform1f(wA.lmRange, worldLmRange);
      gl.uniform1f(wA.exposure, worldExposure);
      gl.uniform3fv(wA.minLight, worldMinLight);
      gl.uniform1i(wA.texU, 0);
      gl.uniform1i(wA.lightmap, 1);
      gl.uniform1f(wA.hasLM, lmTex ? 1 : 0);
      gl.uniform1f(wA.useTexAlpha, 0);
      gl.uniform1f(wA.matAlpha, 1);
      gl.uniform1f(wA.brightPass, 0);
      gl.activeTexture(gl.TEXTURE1);
      if (lmTex) gl.bindTexture(gl.TEXTURE_2D, lmTex);
      for (const g of world) {
        if (g.translucent) continue;
        gl.activeTexture(gl.TEXTURE0);
        if (g.tex) gl.bindTexture(gl.TEXTURE_2D, g.tex);
        gl.uniform1f(wA.hasTex, g.tex ? 1 : 0);
        gl.uniform2f(wA.texSize, g.texW, g.texH);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf); gl.enableVertexAttribArray(wA.pos); gl.vertexAttribPointer(wA.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.uvBuf); gl.enableVertexAttribArray(wA.uv); gl.vertexAttribPointer(wA.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.lmBuf); gl.enableVertexAttribArray(wA.lmuv); gl.vertexAttribPointer(wA.lmuv, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, g.count);
      }
    } else {
      gl.useProgram(terrainProg);
      gl.uniformMatrix4fv(tA.mvp, false, mvp);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(tA.tex, 0);
      gl.uniform3fv(tA.lightDir, LIGHT_DIR);
      gl.uniform3fv(tA.lightColor, LIGHT_COLOR);
      gl.uniform3fv(tA.skyAmb, SKY_AMBIENT);
      gl.uniform3fv(tA.groundAmb, GROUND_AMBIENT);
      gl.uniform3fv(tA.fogColor, FOG_COLOR);
      gl.uniform1f(tA.fogStart, fogStart);
      gl.uniform1f(tA.fogEnd, fogEnd);
      gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuf);
      gl.enableVertexAttribArray(tA.pos); gl.vertexAttribPointer(tA.pos, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(tA.uv); gl.vertexAttribPointer(tA.uv, 2, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(tA.normal); gl.vertexAttribPointer(tA.normal, 3, gl.FLOAT, false, 32, 20);
      gl.drawArrays(gl.TRIANGLES, 0, terrainCount);
    }

    if (propInstances) {
      gl.useProgram(modelProg);
      gl.uniform1f(mA.mExposure, worldExposure);
      gl.uniform3fv(mA.fogColor, FOG_COLOR);
      gl.uniform1f(mA.fogStart, fogStart);
      gl.uniform1f(mA.fogEnd, fogEnd);
      gl.uniform1f(mA.blend, 0);
      gl.uniform3f(mA.glow, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      for (const [model, insts] of propInstances) {
        const pool = props.get(model);
        if (!pool || !pool.loaded) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, pool.posBuf); gl.enableVertexAttribArray(mA.pos); gl.vertexAttribPointer(mA.pos, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(mA.pos2); gl.vertexAttribPointer(mA.pos2, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, pool.nrmBuf); gl.enableVertexAttribArray(mA.nrm); gl.vertexAttribPointer(mA.nrm, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(mA.nrm2); gl.vertexAttribPointer(mA.nrm2, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, pool.uvBuf); gl.enableVertexAttribArray(mA.uv); gl.vertexAttribPointer(mA.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pool.idxBuf);
        for (const inst of insts) {
          applyModelLight(inst.origin[0], inst.origin[1], inst.origin[2] + 32);
          const M = mul(mul(mul(ZUP2YUP, mTranslate(inst.origin[0], inst.origin[1], inst.origin[2])), angleMatrix(inst.angles[0], inst.angles[1], inst.angles[2])), mScale(inst.scale || 1));
          gl.uniformMatrix4fv(mA.mvp, false, new Float32Array(mul(mvp, M)));
          gl.uniformMatrix4fv(mA.model, false, new Float32Array(M));
          for (const me of pool.meshes) {
            const mat = pool.mats.get(me.material) || {};
            gl.activeTexture(gl.TEXTURE0);
            if (mat.tex) gl.bindTexture(gl.TEXTURE_2D, mat.tex);
            gl.uniform1i(mA.texU, 0);
            gl.uniform1f(mA.hasTex, mat.tex ? 1 : 0);
            gl.uniform1f(mA.alphaTest, mat.alphaTest ? 1 : 0);
            gl.drawElements(gl.TRIANGLES, me.count, gl.UNSIGNED_INT, me.offset * 4);
          }
        }
      }
    }

    const actors = scene.actorsAt ? scene.actorsAt(scene.ps.t) : [];
    const pts = [];
    const modelActors = [];
    for (const a of actors) {
      if (a.kind === 'bot' && a.modelBase && a.loadoutKey) {
        const pool = models.get(a.loadoutKey);
        if (!pool) ensureModel(a.loadoutKey, a.modelBase, a.attachments);
        if (pool && pool.loaded) { modelActors.push(a); continue; }
        if (pool && pool.error) { pts.push(a); continue; }
        if (pool && pool.loading) { pts.push(a); continue; }
      }
      pts.push(a);
    }

    if (modelActors.length) {
      gl.useProgram(modelProg);
      gl.uniform1f(mA.mExposure, worldExposure);
      gl.uniform3fv(mA.fogColor, FOG_COLOR);
      gl.uniform1f(mA.fogStart, fogStart);
      gl.uniform1f(mA.fogEnd, fogEnd);
      gl.uniform3f(mA.glow, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.disable(gl.CULL_FACE);
      const carriers = modelActors.some(a => a.carrying);
      if (carriers) ensureProp(BOMB_MODEL);
      const bombPool = carriers ? props.get(BOMB_MODEL) : null;
      for (const a of modelActors) {
        const pool = models.get(a.loadoutKey);
        if (a.crit) {
          const pulse = 0.55 + 0.45 * Math.sin(scene.ps.t * 9.0);
          gl.uniform3f(mA.glow, 0.10 * pulse, 0.30 * pulse, 0.62 * pulse);
        } else gl.uniform3f(mA.glow, 0, 0, 0);
        const gy = Number.isFinite(a.z) ? a.z : sampleHeight(a.x, a.y);
        applyModelLight(a.x, a.y, gy + 40);
        const M = mul(mul(mul(mTranslate(a.x, gy, -a.y), mRotY(a.heading || 0)), ZUP2YUP), mScale((a.scale || 1) * MODEL_DISPLAY_SCALE));
        gl.uniformMatrix4fv(mA.mvp, false, new Float32Array(mul(mvp, M)));
        gl.uniformMatrix4fv(mA.model, false, new Float32Array(M));
        const nf = pool.numframes;
        const fpos = a.moving ? scene.ps.t * pool.fps + (a.phase || 0) : 0;
        const f0 = ((Math.floor(fpos) % nf) + nf) % nf;
        const f1 = a.moving ? (f0 + 1) % nf : f0;
        const blend = a.moving ? fpos - Math.floor(fpos) : 0;
        drawRenderable(pool, f0, f1, blend);
        if (pool.attachments) for (const att of pool.attachments) drawRenderable(att, f0, f1, blend);
        if (a.carrying && pool.flagFrames && bombPool && bombPool.loaded) {
          const bombM = mul(M, pool.flagFrames[f0]);
          gl.uniformMatrix4fv(mA.mvp, false, new Float32Array(mul(mvp, bombM)));
          gl.uniformMatrix4fv(mA.model, false, new Float32Array(bombM));
          gl.uniform1f(mA.blend, 0);
          gl.uniform3f(mA.glow, 0.42, 0.22, 0.05);
          drawStatic(bombPool);
          gl.uniform3f(mA.glow, 0, 0, 0);
        }
      }
      gl.disable(gl.CULL_FACE);
    }

    if (pts.length) {
      const arr = new Float32Array(pts.length * 7);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], o = i * 7;
        arr[o] = a.x; arr[o + 1] = (Number.isFinite(a.z) ? a.z : sampleHeight(a.x, a.y)) + 28; arr[o + 2] = -a.y;
        arr[o + 3] = a.size; arr[o + 4] = a.r; arr[o + 5] = a.g; arr[o + 6] = a.b;
      }
      gl.useProgram(pointProg);
      gl.uniformMatrix4fv(pA.mvp, false, mvp);
      gl.uniform1f(pA.fogStart, fogStart);
      gl.uniform1f(pA.fogEnd, fogEnd);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(pA.pos); gl.vertexAttribPointer(pA.pos, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(pA.size); gl.vertexAttribPointer(pA.size, 1, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(pA.color); gl.vertexAttribPointer(pA.color, 3, gl.FLOAT, false, 28, 16);
      gl.drawArrays(gl.POINTS, 0, pts.length);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    if (world && world.some(g => g.translucent)) {
      gl.useProgram(worldProg);
      gl.uniformMatrix4fv(wA.mvp, false, mvp);
      gl.uniform3fv(wA.fogColor, FOG_COLOR);
      gl.uniform1f(wA.fogStart, fogStart);
      gl.uniform1f(wA.fogEnd, fogEnd);
      gl.uniform1f(wA.lmRange, worldLmRange);
      gl.uniform1f(wA.exposure, worldExposure);
      gl.uniform3fv(wA.minLight, worldMinLight);
      gl.uniform1i(wA.texU, 0);
      gl.uniform1i(wA.lightmap, 1);
      gl.uniform1f(wA.hasLM, lmTex ? 1 : 0);
      gl.uniform1f(wA.useTexAlpha, 1);
      gl.activeTexture(gl.TEXTURE1);
      if (lmTex) gl.bindTexture(gl.TEXTURE_2D, lmTex);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(false);
      // Glass is single-sided in Source. With culling off every pane blends twice (front and
      // back face), which saturates it into flat opaque-looking panels instead of a subtle
      // tint — that is what produced the periwinkle slabs over mannhattan's storefronts.
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const g of world) {
        if (!g.translucent) continue;
        gl.uniform1f(wA.matAlpha, g.alpha != null ? g.alpha : 1);
        gl.activeTexture(gl.TEXTURE0);
        if (g.tex) gl.bindTexture(gl.TEXTURE_2D, g.tex);
        gl.uniform1f(wA.hasTex, g.tex ? 1 : 0);
        gl.uniform2f(wA.texSize, g.texW, g.texH);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf); gl.enableVertexAttribArray(wA.pos); gl.vertexAttribPointer(wA.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.uvBuf); gl.enableVertexAttribArray(wA.uv); gl.vertexAttribPointer(wA.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.lmBuf); gl.enableVertexAttribArray(wA.lmuv); gl.vertexAttribPointer(wA.lmuv, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, g.count);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Particle effects: step TF2's own particle systems and draw them as additive sprites.
    // Emitters follow whatever the sim says they are attached to — the bomb on the carrier's
    // back (its real "flag" attachment point) and crit-boosted robots.
    {
      // Particles are real-time effects in TF2 — they keep animating when the sim is paused,
      // so drive them off the wall clock rather than sim time (which is frozen while paused).
      const tNow = performance.now() / 1000;
      const dt = fxLastT === null ? 1 / 60 : Math.max(0, Math.min(0.1, tNow - fxLastT));
      fxLastT = tNow;
      const live = [];
      for (const a of actors) {
        if (a.kind !== 'bot') continue;
        const gy = Number.isFinite(a.z) ? a.z : sampleHeight(a.x, a.y);
        if (a.carrying) {
          const o = [a.x, a.y, gy + 52];
          const e = fxEmitter('carrier', 'carrier', o);
          if (e) { e.step(dt, o); live.push(['carrier', e]); }
        }
        if (a.crit) {
          const o = [a.x, a.y, gy + 40];
          const e = fxEmitter('crit:' + (a.key || a.id || Math.round(a.x) + ',' + Math.round(a.y)), 'crit', o);
          if (e) { e.step(dt, o); live.push(['crit', e]); }
        }
      }
      if (live.length) {
        gl.useProgram(partProg);
        gl.uniformMatrix4fv(paA.mvp, false, mvp);
        gl.uniform1f(paA.fogStart, fogStart);
        gl.uniform1f(paA.fogEnd, fogEnd);
        gl.uniform1f(paA.projScale, canvas.height / (2 * Math.tan(0.82 / 2)));
        gl.uniform1i(paA.texU, 0);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        for (const [key, e] of live) {
          const need = 9 * Math.max(1, e.particles.length);
          if (partScratch.length < need) partScratch = new Float32Array(need * 2);
          const n = e.fill(partScratch);
          if (!n) continue;
          const rec = fxFor(key);
          gl.activeTexture(gl.TEXTURE0);
          if (rec && rec.tex) gl.bindTexture(gl.TEXTURE_2D, rec.tex);
          gl.uniform1f(paA.hasTex, rec && rec.tex ? 1 : 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
          gl.bufferData(gl.ARRAY_BUFFER, partScratch.subarray(0, n * 9), gl.DYNAMIC_DRAW);
          const stride = 36;
          gl.enableVertexAttribArray(paA.pos); gl.vertexAttribPointer(paA.pos, 3, gl.FLOAT, false, stride, 0);
          gl.enableVertexAttribArray(paA.size); gl.vertexAttribPointer(paA.size, 1, gl.FLOAT, false, stride, 12);
          gl.enableVertexAttribArray(paA.color); gl.vertexAttribPointer(paA.color, 3, gl.FLOAT, false, stride, 16);
          gl.enableVertexAttribArray(paA.alpha); gl.vertexAttribPointer(paA.alpha, 1, gl.FLOAT, false, stride, 28);
          gl.enableVertexAttribArray(paA.rot); gl.vertexAttribPointer(paA.rot, 1, gl.FLOAT, false, stride, 32);
          gl.drawArrays(gl.POINTS, 0, n);
        }
        gl.disableVertexAttribArray(paA.alpha);
        gl.disableVertexAttribArray(paA.rot);
        gl.disableVertexAttribArray(paA.size);
        gl.disable(gl.BLEND);
        gl.depthMask(true);
        schedule();
      }
    }

    drawZones(mvp);

    // Bloom: TF2's HDR glow. Capture the real >1.0 overflow of lit world surfaces into a
    // half-res buffer, gaussian-blur it, and add it back scaled by the map's SetBloomScale.
    if (world && world.length && lmTex) {
      ensureBloomFBs(canvas.width, canvas.height);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBs[0].fb);
      gl.viewport(0, 0, bloomW, bloomH);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(worldProg);
      gl.uniformMatrix4fv(wA.mvp, false, mvp);
      gl.uniform1f(wA.fogStart, fogStart); gl.uniform1f(wA.fogEnd, fogEnd);
      gl.uniform1f(wA.lmRange, worldLmRange); gl.uniform1f(wA.exposure, worldExposure);
      gl.uniform1i(wA.texU, 0); gl.uniform1i(wA.lightmap, 1);
      gl.uniform1f(wA.hasLM, lmTex ? 1 : 0); gl.uniform1f(wA.useTexAlpha, 0); gl.uniform1f(wA.matAlpha, 1);
      gl.uniform1f(wA.brightPass, 1);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lmTex);
      for (const g of world) {
        if (g.translucent) continue;
        gl.activeTexture(gl.TEXTURE0); if (g.tex) gl.bindTexture(gl.TEXTURE_2D, g.tex);
        gl.uniform1f(wA.hasTex, g.tex ? 1 : 0); gl.uniform2f(wA.texSize, g.texW, g.texH);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf); gl.enableVertexAttribArray(wA.pos); gl.vertexAttribPointer(wA.pos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.uvBuf); gl.enableVertexAttribArray(wA.uv); gl.vertexAttribPointer(wA.uv, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.lmBuf); gl.enableVertexAttribArray(wA.lmuv); gl.vertexAttribPointer(wA.lmuv, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, g.count);
      }
      gl.useProgram(blurProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(blurA.pos); gl.vertexAttribPointer(blurA.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(blurA.tex, 0); gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBs[1].fb);
      gl.bindTexture(gl.TEXTURE_2D, bloomFBs[0].tex);
      gl.uniform2f(blurA.dir, 1 / bloomW, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBs[0].fb);
      gl.bindTexture(gl.TEXTURE_2D, bloomFBs[1].tex);
      gl.uniform2f(blurA.dir, 0, 1 / bloomH); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(bloomProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(bloomA.pos); gl.vertexAttribPointer(bloomA.pos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(bloomA.tex, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bloomFBs[0].tex);
      gl.uniform1f(bloomA.scale, BLOOM_SCALE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND); gl.depthMask(true);
    }

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(vigProg);
    gl.uniform1f(vA.inner, 0.62); gl.uniform1f(vA.outer, 1.08); gl.uniform1f(vA.strength, 0.4);
    gl.uniform2f(vA.aspect, Math.max(1, aspect), Math.max(1, 1 / aspect));
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(vA.pos); gl.vertexAttribPointer(vA.pos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);

    if (scene.ps.playing) schedule();
  }

  function schedule() { if (!raf && !disposed) raf = requestAnimationFrame(draw); }

  let drag = null;
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    const c = scene.cam;
    if (scene.tool === 'kill' && (e.button === 0 || e.button === 2)) {
      const hit = pickGround(e.clientX, e.clientY);
      if (hit && scene.onKill) scene.onKill(hit[0], hit[1], e.button === 2 || e.shiftKey);
      return;
    }
    const pan = e.button === 2 || e.button === 1 || e.shiftKey;
    drag = { type: pan ? 'pan' : 'rot', x: e.clientX, y: e.clientY, yaw: c.yaw, pitch: c.pitch, panX: c.panX || 0, panY: c.panY || 0, panZ: c.panZ || 0 };
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  const onMove = e => {
    if (!drag) return;
    const cam = scene.cam;
    if (drag.type === 'pan') {
      const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
      const fh = Math.cos(cam.pitch);
      const fx = -fh * Math.sin(cam.yaw), fy = -Math.sin(cam.pitch), fz = -fh * Math.cos(cam.yaw);
      const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
      const s = cam.dist * 0.0015;
      const dx = -(e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
      cam.panX = drag.panX + rx * dx + ux * dy;
      cam.panY = drag.panY + uy * dy;
      cam.panZ = drag.panZ + rz * dx + uz * dy;
    } else {
      cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.006;
      cam.pitch = Math.max(0.12, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.005));
    }
    schedule();
  };
  const onUp = () => { drag = null; };
  addEventListener('mousemove', onMove);
  addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const cam = scene.cam;
    cam.dist = Math.max(diag * 0.12, Math.min(diag * 2.2, cam.dist * (e.deltaY < 0 ? 0.88 : 1.14)));
    schedule();
  }, { passive: false });

  loadScene(scene);
  schedule();

  return {
    canvas,
    mapName: scene.mapName,
    update(s) { loadScene(s); schedule(); },
    redraw() { schedule(); },
    resetCamera() { Object.assign(scene.cam, { yaw: 0.6, pitch: 0.92, dist: diag * 0.72, panX: 0, panY: 0, panZ: 0 }); schedule(); },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      removeEventListener('mousemove', onMove);
      removeEventListener('mouseup', onUp);
      for (const b of bloomFBs) if (b) { gl.deleteFramebuffer(b.fb); gl.deleteTexture(b.tex); }
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  };
}
