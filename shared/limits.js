export const LIMITS = {
  lzmaOut: 256 * 1024 * 1024,
  lzmaRatio: 5000,
  vtfDim: 8192,
  vtfResources: 4096,
  vvdVerts: 6000000,
  mdlBones: 8192,
  mdlTextures: 8192,
  mdlBodyParts: 4096,
  mdlModels: 4096,
  mdlMeshes: 65536,
  mdlSkinRefs: 8192,
  mdlSkinFamilies: 4096,
  mdlCdTextures: 4096,
  mdlAnims: 262144,
  mdlSeq: 262144,
  navConnections: 4000000,
  zipEntry: 256 * 1024 * 1024,
  vpkTree: 128 * 1024 * 1024
};

export function cap(n, max, label) {
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(label + ': value ' + n + ' out of range (0..' + max + ')');
  return n;
}
