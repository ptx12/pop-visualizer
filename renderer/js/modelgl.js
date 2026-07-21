import { getTFPath } from './icons.js';

const VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUV;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vNrm;
varying vec2 vUV;
void main() {
  gl_Position = uMVP * vec4(aPos, 1.0);
  vNrm = mat3(uModel) * aNrm;
  vUV = aUV;
}`;

const FS = `
precision mediump float;
varying vec3 vNrm;
varying vec2 vUV;
uniform sampler2D uTex;
uniform float uAlphaTest;
uniform float uHasTex;
void main() {
  vec4 tex = mix(vec4(0.62, 0.64, 0.68, 1.0), texture2D(uTex, vUV), uHasTex);
  if (uAlphaTest > 0.5 && tex.a < 0.5) discard;
  vec3 n = normalize(vNrm);
  float l = 0.62 + 0.5 * max(0.0, dot(n, normalize(vec3(0.5, 0.35, 0.8))));
  gl_FragColor = vec4(tex.rgb * l, tex.a);
}`;

function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function mat4Persp(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) / (near - far); o[11] = -1;
  o[14] = 2 * far * near / (near - far);
  return o;
}

function mat4LookAt(eye, at, up) {
  const zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const xl = Math.hypot(...x) || 1;
  x[0] /= xl; x[1] /= xl; x[2] /= xl;
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const o = mat4Identity();
  o[0] = x[0]; o[4] = x[1]; o[8] = x[2];
  o[1] = y[0]; o[5] = y[1]; o[9] = y[2];
  o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
  o[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  o[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  o[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  return o;
}

function quatToMat(q, p) {
  const [x, y, z, w] = q;
  const m = new Float32Array(16);
  m[0] = 1 - 2 * (y * y + z * z); m[4] = 2 * (x * y - w * z); m[8] = 2 * (x * z + w * y); m[12] = p[0];
  m[1] = 2 * (x * y + w * z); m[5] = 1 - 2 * (x * x + z * z); m[9] = 2 * (y * z - w * x); m[13] = p[1];
  m[2] = 2 * (x * z - w * y); m[6] = 2 * (y * z + w * x); m[10] = 1 - 2 * (x * x + y * y); m[14] = p[2];
  m[15] = 1;
  return m;
}

function mat4Invert(m) {
  const r = mat4Identity();
  const rot = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  r[0] = rot[0]; r[4] = rot[1]; r[8] = rot[2];
  r[1] = rot[3]; r[5] = rot[4]; r[9] = rot[5];
  r[2] = rot[6]; r[6] = rot[7]; r[10] = rot[8];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

function toF32(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new Float32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
}

function toU32(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new Uint32Array(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
}

function toU8(buf) {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

export function createModelScene(canvas) {
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true });
  if (!gl) return null;
  gl.getExtension('OES_element_index_uint');

  function shader(type, srcText) {
    const s = gl.createShader(type);
    gl.shaderSource(s, srcText);
    gl.compileShader(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const loc = {
    aPos: gl.getAttribLocation(prog, 'aPos'),
    aNrm: gl.getAttribLocation(prog, 'aNrm'),
    aUV: gl.getAttribLocation(prog, 'aUV'),
    uMVP: gl.getUniformLocation(prog, 'uMVP'),
    uModel: gl.getUniformLocation(prog, 'uModel'),
    uTex: gl.getUniformLocation(prog, 'uTex'),
    uAlphaTest: gl.getUniformLocation(prog, 'uAlphaTest'),
    uHasTex: gl.getUniformLocation(prog, 'uHasTex')
  };

  const texCache = new Map();
  let current = null;

  async function loadTexture(vtfRel, tfPath) {
    if (texCache.has(vtfRel)) return texCache.get(vtfRel);
    const p = (async () => {
      const raw = await window.popnative.matTexture(vtfRel, tfPath);
      if (!raw) return null;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, raw.width, raw.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, toU8(raw.rgba));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return tex;
    })();
    texCache.set(vtfRel, p);
    return p;
  }

  async function resolveMaterial(texName, cdtextures, tfPath) {
    const name = String(texName).replace(/\\/g, '/').toLowerCase();
    const candidates = name.includes('/')
      ? ['materials/' + name + '.vmt']
      : cdtextures.map(cd => ('materials/' + cd + name + '.vmt').replace(/\/+/g, '/').toLowerCase());
    for (const rel of candidates) {
      const buf = await window.popnative.matRead(rel, tfPath);
      if (!buf) continue;
      const text = new TextDecoder('latin1').decode(toU8(buf));
      const base = text.match(/\$basetexture"?\s*"?([^"\r\n]+?)"?\s*$/im);
      const mat = {
        alphaTest: /\$alphatest\b/i.test(text),
        translucent: /\$translucent\b/i.test(text),
        nocull: /\$nocull\b/i.test(text),
        tex: null
      };
      if (base) {
        const vtf = 'materials/' + base[1].trim().replace(/\\/g, '/').replace(/\.vtf$/i, '').toLowerCase() + '.vtf';
        mat.tex = await loadTexture(vtf, tfPath);
      }
      return mat;
    }
    return { tex: null, alphaTest: false, translucent: false, nocull: false };
  }

  async function setModel(payload, onprogress) {
    const tfPath = await getTFPath();
    if (!payload || payload.error || !payload.positions) return null;
    const positions = toF32(payload.positions);
    const normals = toF32(payload.normals);
    const uvs = toF32(payload.uvs);
    const boneWeights = toF32(payload.boneWeights);
    const boneIds = toU8(payload.boneIds);
    const indices = toU32(payload.indices);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    const nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.DYNAMIC_DRAW);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const skin0 = payload.skins && payload.skins[0] ? payload.skins[0] : null;
    const materials = new Map();
    for (const m of payload.meshes) {
      const texIdx = skin0 && m.material < skin0.length ? skin0[m.material] : m.material;
      const texName = payload.textures[texIdx] ?? payload.textures[m.material];
      if (!materials.has(m.material)) {
        materials.set(m.material, { tex: null, alphaTest: false, translucent: false, nocull: false, pending: true });
        resolveMaterial(texName || '', payload.cdtextures || [], tfPath).then(mat => {
          materials.set(m.material, mat);
          if (onprogress) onprogress();
        });
      }
    }

    const bindWorld = [];
    const invBind = [];
    for (let b = 0; b < payload.bones.length; b++) {
      const bone = payload.bones[b];
      const local = quatToMat(bone.quat, bone.pos);
      const world = bone.parent >= 0 ? mat4Mul(bindWorld[bone.parent], local) : local;
      bindWorld.push(world);
      invBind.push(mat4Invert(world));
    }

    current = {
      payload, positions, normals, uvs, boneWeights, boneIds, indices,
      posBuf, nrmBuf, uvBuf, idxBuf, materials, bindWorld, invBind,
      skinnedPos: new Float32Array(positions.length),
      skinnedNrm: new Float32Array(normals.length),
      bbox: payload.bbox
    };
    return current;
  }

  function applyAnim(animIdx, frame) {
    const c = current;
    if (!c) return;
    const anim = c.payload.anims[animIdx];
    if (!anim) {
      gl.bindBuffer(gl.ARRAY_BUFFER, c.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, c.positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, c.nrmBuf);
      gl.bufferData(gl.ARRAY_BUFFER, c.normals, gl.DYNAMIC_DRAW);
      return;
    }
    const frames = anim.framesF32 || (anim.framesF32 = toF32(anim.frames));
    const nb = c.payload.bones.length;
    const f = Math.min(anim.numframes - 1, Math.max(0, Math.floor(frame)));
    const world = [];
    const skinMat = [];
    for (let b = 0; b < nb; b++) {
      const o = (f * nb + b) * 7;
      const local = quatToMat([frames[o + 3], frames[o + 4], frames[o + 5], frames[o + 6]], [frames[o], frames[o + 1], frames[o + 2]]);
      const parent = c.payload.bones[b].parent;
      const w = parent >= 0 ? mat4Mul(world[parent], local) : local;
      world.push(w);
      skinMat.push(mat4Mul(w, c.invBind[b]));
    }
    const sp = c.skinnedPos, sn = c.skinnedNrm;
    const pos = c.positions, nrm = c.normals, bw = c.boneWeights, bi = c.boneIds;
    for (let v = 0; v < pos.length / 3; v++) {
      const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
      const nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0;
      const nBones = bi[v * 4 + 3];
      for (let k = 0; k < nBones; k++) {
        const w = nBones === 1 ? 1 : bw[v * 3 + k];
        if (w <= 0) continue;
        const m = skinMat[bi[v * 4 + k]];
        if (!m) continue;
        ox += w * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
        oy += w * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
        oz += w * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
        mx += w * (m[0] * nx + m[4] * ny + m[8] * nz);
        my += w * (m[1] * nx + m[5] * ny + m[9] * nz);
        mz += w * (m[2] * nx + m[6] * ny + m[10] * nz);
      }
      sp[v * 3] = ox; sp[v * 3 + 1] = oy; sp[v * 3 + 2] = oz;
      sn[v * 3] = mx; sn[v * 3 + 1] = my; sn[v * 3 + 2] = mz;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, c.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sp, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, c.nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sn, gl.DYNAMIC_DRAW);
  }

  function render(cam) {
    const c = current;
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.055, 0.063, 0.075, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!c) return;
    gl.enable(gl.DEPTH_TEST);
    const bb = c.bbox;
    const center = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2];
    const radius = Math.max(1, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2]) / 2);
    const dist = radius * (cam.zoom || 2.2);
    const eye = [
      center[0] + dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
      center[1] + dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      center[2] + dist * Math.sin(cam.pitch)
    ];
    const view = mat4LookAt(eye, center, [0, 0, 1]);
    const proj = mat4Persp(0.9, w / h, radius * 0.01, radius * 40);
    const mvp = mat4Mul(proj, view);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uMVP, false, mvp);
    gl.uniformMatrix4fv(loc.uModel, false, mat4Identity());

    const bind = (buf, attr, size) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, size, gl.FLOAT, false, 0, 0);
    };
    bind(c.posBuf, loc.aPos, 3);
    bind(c.nrmBuf, loc.aNrm, 3);
    bind(c.uvBuf, loc.aUV, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.idxBuf);

    const passes = [[], []];
    for (const m of c.payload.meshes) {
      const mat = c.materials.get(m.material) || {};
      passes[mat.translucent ? 1 : 0].push([m, mat]);
    }
    for (let p = 0; p < 2; p++) {
      if (p === 1) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      for (const [m, mat] of passes[p]) {
        if (mat.nocull) gl.disable(gl.CULL_FACE);
        else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT); }
        gl.activeTexture(gl.TEXTURE0);
        const tex = mat.tex && !(mat.tex instanceof Promise) ? mat.tex : null;
        if (tex) gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc.uTex, 0);
        gl.uniform1f(loc.uHasTex, tex ? 1 : 0);
        gl.uniform1f(loc.uAlphaTest, mat.alphaTest ? 1 : 0);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, m.offset * 4);
      }
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function dispose() {
    current = null;
  }

  return { gl, setModel, applyAnim, render, dispose, canvas };
}

let thumbScene = null;

export async function renderThumbnail(payload, size = 220) {
  if (!thumbScene) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    thumbScene = createModelScene(c);
  }
  if (!thumbScene) return null;
  thumbScene.canvas.width = size;
  thumbScene.canvas.height = size;
  let pending = 1;
  const done = new Promise(res => {
    let timer = setTimeout(res, 1600);
    thumbScene._prog = () => {
      clearTimeout(timer);
      timer = setTimeout(res, 120);
    };
  });
  const model = await thumbScene.setModel(payload, () => thumbScene._prog && thumbScene._prog());
  if (!model) return null;
  thumbScene._prog();
  await done;
  thumbScene.applyAnim(-1, 0);
  thumbScene.render({ yaw: Math.PI * 0.75, pitch: 0.35, zoom: 2.0 });
  const url = thumbScene.canvas.toDataURL('image/png');
  thumbScene.dispose();
  return url;
}
