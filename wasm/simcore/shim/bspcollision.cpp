#include "bspcollision.h"

#include <string.h>
#include <stdlib.h>
#include <math.h>

namespace simcore {

static const float DIST_EPSILON = 0.03125f;
static const float NEVER_UPDATED = -9999.0f;

static inline float Dot(const Vec3 &a, const Vec3 &b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

static inline int32_t ReadI32(const uint8_t *p) {
  int32_t v;
  memcpy(&v, p, 4);
  return v;
}

static inline int16_t ReadI16(const uint8_t *p) {
  int16_t v;
  memcpy(&v, p, 2);
  return v;
}

static inline uint16_t ReadU16(const uint8_t *p) {
  uint16_t v;
  memcpy(&v, p, 2);
  return v;
}

static inline float ReadF32(const uint8_t *p) {
  float v;
  memcpy(&v, p, 4);
  return v;
}

CollisionWorld::CollisionWorld()
    : m_planes(0), m_nodes(0), m_leafs(0), m_leafBrushes(0), m_brushes(0),
      m_brushSides(0), m_models(0), m_texInfo(0), m_texDataName(0), m_stringTable(0),
      m_stringData(0), m_numPlanes(0), m_numNodes(0), m_numLeafs(0),
      m_numLeafBrushes(0), m_numBrushes(0), m_numBrushSides(0), m_numModels(0),
      m_numTexInfo(0), m_numTexData(0), m_numStrings(0), m_stringDataLen(0),
      m_checkCount(0), m_brushCheck(0) {}

CollisionWorld::~CollisionWorld() {
  free(m_planes);
  free(m_nodes);
  free(m_leafs);
  free(m_leafBrushes);
  free(m_brushes);
  free(m_brushSides);
  free(m_models);
  free(m_texInfo);
  free(m_texDataName);
  free(m_stringTable);
  free(m_stringData);
  free(m_brushCheck);
}

bool CollisionWorld::LoadSurfaces(const uint8_t *texInfo, int texInfoLen,
                                  const uint8_t *texData, int texDataLen,
                                  const uint8_t *stringTable, int stringTableLen,
                                  const uint8_t *stringData, int stringDataLen) {
  free(m_texInfo);
  free(m_texDataName);
  free(m_stringTable);
  free(m_stringData);
  m_texInfo = 0;
  m_texDataName = 0;
  m_stringTable = 0;
  m_stringData = 0;

  m_numTexInfo = texInfoLen / 72;
  m_texInfo = (TexInfo *)calloc(m_numTexInfo > 0 ? m_numTexInfo : 1, sizeof(TexInfo));
  for (int i = 0; i < m_numTexInfo; ++i) {
    const uint8_t *p = texInfo + i * 72;
    m_texInfo[i].flags = ReadI32(p + 64);
    m_texInfo[i].texdata = ReadI32(p + 68);
  }

  m_numTexData = texDataLen / 32;
  m_texDataName = (int32_t *)calloc(m_numTexData > 0 ? m_numTexData : 1, sizeof(int32_t));
  for (int i = 0; i < m_numTexData; ++i) {
    m_texDataName[i] = ReadI32(texData + i * 32 + 12);
  }

  m_numStrings = stringTableLen / 4;
  m_stringTable = (int32_t *)calloc(m_numStrings > 0 ? m_numStrings : 1, sizeof(int32_t));
  for (int i = 0; i < m_numStrings; ++i) {
    m_stringTable[i] = ReadI32(stringTable + i * 4);
  }

  m_stringDataLen = stringDataLen;
  m_stringData = (char *)calloc(stringDataLen > 0 ? stringDataLen + 1 : 1, 1);
  if (stringDataLen > 0) memcpy(m_stringData, stringData, stringDataLen);

  return m_numTexInfo > 0;
}

int CollisionWorld::SurfaceFlags(int texInfoIndex) const {
  if (texInfoIndex < 0 || texInfoIndex >= m_numTexInfo) return 0;
  return m_texInfo[texInfoIndex].flags;
}

const char *CollisionWorld::SurfaceName(int texInfoIndex) const {
  if (texInfoIndex < 0 || texInfoIndex >= m_numTexInfo) return "";

  int texData = m_texInfo[texInfoIndex].texdata;
  if (texData < 0 || texData >= m_numTexData) return "";

  int stringIndex = m_texDataName[texData];
  if (stringIndex < 0 || stringIndex >= m_numStrings) return "";

  int offset = m_stringTable[stringIndex];
  if (offset < 0 || offset >= m_stringDataLen) return "";

  return m_stringData + offset;
}

bool CollisionWorld::Load(const uint8_t *planes, int planesLen,
                          const uint8_t *nodes, int nodesLen,
                          const uint8_t *leafs, int leafsLen, int leafSize,
                          const uint8_t *leafBrushes, int leafBrushesLen,
                          const uint8_t *brushes, int brushesLen,
                          const uint8_t *brushSides, int brushSidesLen,
                          const uint8_t *models, int modelsLen) {
  m_numPlanes = planesLen / 20;
  m_planes = (Plane *)calloc(m_numPlanes > 0 ? m_numPlanes : 1, sizeof(Plane));
  for (int i = 0; i < m_numPlanes; ++i) {
    const uint8_t *p = planes + i * 20;
    m_planes[i].normal = Vec3(ReadF32(p), ReadF32(p + 4), ReadF32(p + 8));
    m_planes[i].dist = ReadF32(p + 12);
    m_planes[i].type = ReadI32(p + 16);
  }

  m_numNodes = nodesLen / 32;
  m_nodes = (Node *)calloc(m_numNodes > 0 ? m_numNodes : 1, sizeof(Node));
  for (int i = 0; i < m_numNodes; ++i) {
    const uint8_t *p = nodes + i * 32;
    m_nodes[i].planenum = ReadI32(p);
    m_nodes[i].children[0] = ReadI32(p + 4);
    m_nodes[i].children[1] = ReadI32(p + 8);
    for (int j = 0; j < 3; ++j) m_nodes[i].mins[j] = ReadI16(p + 12 + j * 2);
    for (int j = 0; j < 3; ++j) m_nodes[i].maxs[j] = ReadI16(p + 18 + j * 2);
    m_nodes[i].firstface = ReadU16(p + 24);
    m_nodes[i].numfaces = ReadU16(p + 26);
    m_nodes[i].area = ReadI16(p + 28);
  }

  if (leafSize <= 0) leafSize = 32;
  m_numLeafs = leafsLen / leafSize;
  m_leafs = (Leaf *)calloc(m_numLeafs > 0 ? m_numLeafs : 1, sizeof(Leaf));
  for (int i = 0; i < m_numLeafs; ++i) {
    const uint8_t *p = leafs + i * leafSize;
    m_leafs[i].contents = ReadI32(p);
    m_leafs[i].cluster = ReadI16(p + 4);
    m_leafs[i].areaFlags = ReadI16(p + 6);
    for (int j = 0; j < 3; ++j) m_leafs[i].mins[j] = ReadI16(p + 8 + j * 2);
    for (int j = 0; j < 3; ++j) m_leafs[i].maxs[j] = ReadI16(p + 14 + j * 2);
    m_leafs[i].firstleafface = ReadU16(p + 20);
    m_leafs[i].numleaffaces = ReadU16(p + 22);
    m_leafs[i].firstleafbrush = ReadU16(p + 24);
    m_leafs[i].numleafbrushes = ReadU16(p + 26);
    m_leafs[i].leafWaterDataID = ReadI16(p + 28);
  }

  m_numLeafBrushes = leafBrushesLen / 2;
  m_leafBrushes = (uint16_t *)calloc(m_numLeafBrushes > 0 ? m_numLeafBrushes : 1, 2);
  for (int i = 0; i < m_numLeafBrushes; ++i) {
    m_leafBrushes[i] = ReadU16(leafBrushes + i * 2);
  }

  m_numBrushes = brushesLen / 12;
  m_brushes = (Brush *)calloc(m_numBrushes > 0 ? m_numBrushes : 1, sizeof(Brush));
  for (int i = 0; i < m_numBrushes; ++i) {
    const uint8_t *p = brushes + i * 12;
    m_brushes[i].firstside = ReadI32(p);
    m_brushes[i].numsides = ReadI32(p + 4);
    m_brushes[i].contents = ReadI32(p + 8);
  }

  m_numBrushSides = brushSidesLen / 8;
  m_brushSides = (BrushSide *)calloc(m_numBrushSides > 0 ? m_numBrushSides : 1, sizeof(BrushSide));
  for (int i = 0; i < m_numBrushSides; ++i) {
    const uint8_t *p = brushSides + i * 8;
    m_brushSides[i].planenum = ReadU16(p);
    m_brushSides[i].texinfo = ReadI16(p + 2);
    m_brushSides[i].dispinfo = ReadI16(p + 4);
    m_brushSides[i].bevel = ReadI16(p + 6);
  }

  m_numModels = modelsLen / 48;
  m_models = (Model *)calloc(m_numModels > 0 ? m_numModels : 1, sizeof(Model));
  for (int i = 0; i < m_numModels; ++i) {
    const uint8_t *p = models + i * 48;
    m_models[i].mins = Vec3(ReadF32(p), ReadF32(p + 4), ReadF32(p + 8));
    m_models[i].maxs = Vec3(ReadF32(p + 12), ReadF32(p + 16), ReadF32(p + 20));
    m_models[i].origin = Vec3(ReadF32(p + 24), ReadF32(p + 28), ReadF32(p + 32));
    m_models[i].headnode = ReadI32(p + 36);
    m_models[i].firstface = ReadI32(p + 40);
    m_models[i].numfaces = ReadI32(p + 44);
  }

  m_brushCheck = (int *)calloc(m_numBrushes > 0 ? m_numBrushes : 1, sizeof(int));
  m_checkCount = 0;

  return m_numPlanes > 0 && m_numNodes > 0 && m_numLeafs > 0;
}

int CollisionWorld::PointLeaf(const Vec3 &p) const {
  int ndxNode = (m_numModels > 0) ? m_models[0].headnode : 0;
  while (ndxNode >= 0) {
    const Node *pNode = m_nodes + ndxNode;
    const Plane *pPlane = m_planes + pNode->planenum;

    float dist;
    if (pPlane->type < 3) {
      dist = p[pPlane->type] - pPlane->dist;
    } else {
      dist = Dot(pPlane->normal, p) - pPlane->dist;
    }

    if (dist < 0.0f) {
      ndxNode = pNode->children[1];
    } else {
      ndxNode = pNode->children[0];
    }
  }
  return -1 - ndxNode;
}

int CollisionWorld::PointContents(const Vec3 &p) const {
  if (!m_nodes || m_numNodes == 0) return 0;
  int leafNum = PointLeaf(p);
  if (leafNum < 0 || leafNum >= m_numLeafs) return 0;

  const Leaf &leaf = m_leafs[leafNum];
  int contents = 0;
  for (int i = 0; i < leaf.numleafbrushes; ++i) {
    int bi = m_leafBrushes[leaf.firstleafbrush + i];
    if (bi < 0 || bi >= m_numBrushes) continue;
    const Brush &b = m_brushes[bi];

    bool inside = true;
    for (int s = 0; s < b.numsides; ++s) {
      const BrushSide &side = m_brushSides[b.firstside + s];
      const Plane *plane = m_planes + side.planenum;
      if (Dot(p, plane->normal) - plane->dist > 0) {
        inside = false;
        break;
      }
    }
    if (inside) contents |= b.contents;
  }
  return contents;
}

void CollisionWorld::ClipBoxToBrush(TraceWork &w, const Brush &brush) const {
  if (!brush.numsides) return;

  float enterfrac = NEVER_UPDATED;
  float leavefrac = 1.0f;
  const Plane *clipplane = 0;
  const BrushSide *clipside = 0;

  bool getout = false;
  bool startout = false;

  for (int i = 0; i < brush.numsides; ++i) {
    const BrushSide &side = m_brushSides[brush.firstside + i];
    const Plane *plane = m_planes + side.planenum;

    float dist;
    if (!w.isPoint) {
      Vec3 ofs;
      ofs.x = (plane->normal.x < 0) ? w.maxs.x : w.mins.x;
      ofs.y = (plane->normal.y < 0) ? w.maxs.y : w.mins.y;
      ofs.z = (plane->normal.z < 0) ? w.maxs.z : w.mins.z;
      dist = Dot(ofs, plane->normal);
      dist = plane->dist - dist;
    } else {
      if (side.bevel == 1) continue;
      dist = plane->dist;
    }

    float d1 = Dot(w.start, plane->normal) - dist;
    float d2 = Dot(w.end, plane->normal) - dist;

    if (d1 > 0 && d2 > 0) return;

    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;

    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      float f = (d1 - DIST_EPSILON) / (d1 - d2);
      if (f > enterfrac) {
        enterfrac = f;
        clipplane = plane;
        clipside = &side;
      }
    } else {
      float f = (d1 + DIST_EPSILON) / (d1 - d2);
      if (f < leavefrac) leavefrac = f;
    }
  }

  if (!startout) {
    w.tr->startsolid = true;
    if (!getout) w.tr->allsolid = true;
    return;
  }

  if (enterfrac < leavefrac) {
    if (enterfrac > NEVER_UPDATED && enterfrac < w.tr->fraction) {
      if (enterfrac < 0) enterfrac = 0;
      w.tr->fraction = enterfrac;
      w.tr->planeDist = clipplane->dist;
      w.tr->planeNormal = clipplane->normal;
      w.tr->contents = brush.contents;
      w.leadSideTexInfo = clipside ? clipside->texinfo : -1;
    }
  }
}

void CollisionWorld::TestInLeaf(TraceWork &w, int leafNum) const {
  if (leafNum < 0 || leafNum >= m_numLeafs) return;
  const Leaf &leaf = m_leafs[leafNum];

  for (int i = 0; i < leaf.numleafbrushes; ++i) {
    int bi = m_leafBrushes[leaf.firstleafbrush + i];
    if (bi < 0 || bi >= m_numBrushes) continue;
    if (m_brushCheck[bi] == m_checkCount) continue;
    m_brushCheck[bi] = m_checkCount;

    const Brush &b = m_brushes[bi];
    if (!(b.contents & w.mask)) continue;

    ClipBoxToBrush(w, b);
    if (w.tr->fraction <= 0.0f) return;
  }
}

void CollisionWorld::RecursiveHullCheck(TraceWork &w, int nodeNum, float p1f, float p2f,
                                        const Vec3 &p1, const Vec3 &p2) const {
  if (w.tr->fraction <= p1f) return;

  if (nodeNum < 0) {
    TestInLeaf(w, -1 - nodeNum);
    return;
  }

  const Node *node = m_nodes + nodeNum;
  const Plane *plane = m_planes + node->planenum;

  float t1, t2, offset;
  if (plane->type < 3) {
    t1 = p1[plane->type] - plane->dist;
    t2 = p2[plane->type] - plane->dist;
    offset = w.extents[plane->type];
  } else {
    t1 = Dot(plane->normal, p1) - plane->dist;
    t2 = Dot(plane->normal, p2) - plane->dist;
    if (w.isPoint) {
      offset = 0;
    } else {
      offset = fabsf(w.extents.x * plane->normal.x) +
               fabsf(w.extents.y * plane->normal.y) +
               fabsf(w.extents.z * plane->normal.z);
    }
  }

  if (t1 >= offset && t2 >= offset) {
    RecursiveHullCheck(w, node->children[0], p1f, p2f, p1, p2);
    return;
  }
  if (t1 < -offset && t2 < -offset) {
    RecursiveHullCheck(w, node->children[1], p1f, p2f, p1, p2);
    return;
  }

  int side;
  float frac, frac2;
  if (t1 < t2) {
    float idist = 1.0f / (t1 - t2);
    side = 1;
    frac2 = (t1 + offset + DIST_EPSILON) * idist;
    frac = (t1 - offset + DIST_EPSILON) * idist;
  } else if (t1 > t2) {
    float idist = 1.0f / (t1 - t2);
    side = 0;
    frac2 = (t1 - offset - DIST_EPSILON) * idist;
    frac = (t1 + offset + DIST_EPSILON) * idist;
  } else {
    side = 0;
    frac = 1.0f;
    frac2 = 0.0f;
  }

  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  float midf = p1f + (p2f - p1f) * frac;
  Vec3 mid(p1.x + frac * (p2.x - p1.x),
           p1.y + frac * (p2.y - p1.y),
           p1.z + frac * (p2.z - p1.z));
  RecursiveHullCheck(w, node->children[side], p1f, midf, p1, mid);

  if (frac2 < 0) frac2 = 0;
  if (frac2 > 1) frac2 = 1;
  midf = p1f + (p2f - p1f) * frac2;
  mid = Vec3(p1.x + frac2 * (p2.x - p1.x),
             p1.y + frac2 * (p2.y - p1.y),
             p1.z + frac2 * (p2.z - p1.z));
  RecursiveHullCheck(w, node->children[side ^ 1], midf, p2f, mid, p2);
}

void CollisionWorld::TraceHull(const Vec3 &start, const Vec3 &end, const Vec3 &mins,
                               const Vec3 &maxs, int mask, TraceResult *out) const {
  TraceHullInModel(0, start, end, mins, maxs, mask, out);
}

void CollisionWorld::TraceHullInModel(int modelIndex, const Vec3 &start, const Vec3 &end,
                                      const Vec3 &mins, const Vec3 &maxs, int mask,
                                      TraceResult *out) const {
  memset(out, 0, sizeof(*out));
  out->fraction = 1.0f;
  out->endpos = end;

  if (!m_nodes || m_numNodes == 0) return;
  if (modelIndex < 0 || (modelIndex > 0 && modelIndex >= m_numModels)) return;

  ++m_checkCount;

  TraceWork w;
  w.start = start;
  w.end = end;
  w.mins = mins;
  w.maxs = maxs;
  w.mask = mask;
  w.tr = out;
  w.leadSideTexInfo = -1;
  w.isPoint = (mins.x == 0 && mins.y == 0 && mins.z == 0 &&
               maxs.x == 0 && maxs.y == 0 && maxs.z == 0);
  w.extents = Vec3(-mins.x > maxs.x ? -mins.x : maxs.x,
                   -mins.y > maxs.y ? -mins.y : maxs.y,
                   -mins.z > maxs.z ? -mins.z : maxs.z);

  RecursiveHullCheck(w, (m_numModels > 0) ? m_models[modelIndex].headnode : 0, 0.0f, 1.0f,
                     start, end);

  if (out->fraction == 1.0f) {
    out->endpos = end;
  } else {
    out->endpos = Vec3(start.x + out->fraction * (end.x - start.x),
                       start.y + out->fraction * (end.y - start.y),
                       start.z + out->fraction * (end.z - start.z));
    out->surfaceFlags = SurfaceFlags(w.leadSideTexInfo);
    out->surfaceName = SurfaceName(w.leadSideTexInfo);
  }
}

void CollisionWorld::TraceRay(const Vec3 &start, const Vec3 &end, int mask,
                              TraceResult *out) const {
  Vec3 zero(0, 0, 0);
  TraceHull(start, end, zero, zero, mask, out);
}

}  // namespace simcore
