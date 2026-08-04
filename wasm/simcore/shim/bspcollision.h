#ifndef SIMCORE_BSPCOLLISION_H
#define SIMCORE_BSPCOLLISION_H

#include <stdint.h>

namespace simcore {

struct Vec3 {
  float x, y, z;
  Vec3() : x(0), y(0), z(0) {}
  Vec3(float a, float b, float c) : x(a), y(b), z(c) {}
  float operator[](int i) const { return (&x)[i]; }
  float &operator[](int i) { return (&x)[i]; }
};

struct Plane {
  Vec3 normal;
  float dist;
  int32_t type;
};

struct Node {
  int32_t planenum;
  int32_t children[2];
  int16_t mins[3];
  int16_t maxs[3];
  uint16_t firstface;
  uint16_t numfaces;
  int16_t area;
  int16_t padding;
};

struct Leaf {
  int32_t contents;
  int16_t cluster;
  int16_t areaFlags;
  int16_t mins[3];
  int16_t maxs[3];
  uint16_t firstleafface;
  uint16_t numleaffaces;
  uint16_t firstleafbrush;
  uint16_t numleafbrushes;
  int16_t leafWaterDataID;
  int16_t padding;
};

struct Brush {
  int32_t firstside;
  int32_t numsides;
  int32_t contents;
};

struct BrushSide {
  uint16_t planenum;
  int16_t texinfo;
  int16_t dispinfo;
  int16_t bevel;
};

struct Model {
  Vec3 mins, maxs;
  Vec3 origin;
  int32_t headnode;
  int32_t firstface, numfaces;
};

struct TexInfo {
  int32_t flags;
  int32_t texdata;
};

struct TraceResult {
  float fraction;
  Vec3 endpos;
  Vec3 planeNormal;
  float planeDist;
  bool startsolid;
  bool allsolid;
  int32_t contents;
  int32_t surfaceFlags;
  const char *surfaceName;
};

class CollisionWorld {
 public:
  CollisionWorld();
  ~CollisionWorld();

  bool Load(const uint8_t *planes, int planesLen,
            const uint8_t *nodes, int nodesLen,
            const uint8_t *leafs, int leafsLen, int leafSize,
            const uint8_t *leafBrushes, int leafBrushesLen,
            const uint8_t *brushes, int brushesLen,
            const uint8_t *brushSides, int brushSidesLen,
            const uint8_t *models, int modelsLen);

  bool LoadSurfaces(const uint8_t *texInfo, int texInfoLen,
                    const uint8_t *texData, int texDataLen,
                    const uint8_t *stringTable, int stringTableLen,
                    const uint8_t *stringData, int stringDataLen);

  void TraceRay(const Vec3 &start, const Vec3 &end, int mask, TraceResult *out) const;

  void TraceHull(const Vec3 &start, const Vec3 &end, const Vec3 &mins, const Vec3 &maxs,
                 int mask, TraceResult *out) const;

  void TraceHullInModel(int modelIndex, const Vec3 &start, const Vec3 &end, const Vec3 &mins,
                        const Vec3 &maxs, int mask, TraceResult *out) const;

  int PointContents(const Vec3 &p) const;

  int NumBrushes() const { return m_numBrushes; }
  int NumNodes() const { return m_numNodes; }
  int NumLeafs() const { return m_numLeafs; }
  int NumPlanes() const { return m_numPlanes; }
  int NumModels() const { return m_numModels; }
  const Model *GetModel(int i) const {
    return (i >= 0 && i < m_numModels) ? (m_models + i) : 0;
  }
  int LeafContainingPoint(const Vec3 &p) const { return PointLeaf(p); }
  int NumTexInfo() const { return m_numTexInfo; }
  int SurfaceFlags(int texInfoIndex) const;
  const char *SurfaceName(int texInfoIndex) const;

 private:
  struct TraceWork {
    Vec3 start, end;
    Vec3 mins, maxs;
    Vec3 extents;
    bool isPoint;
    int mask;
    TraceResult *tr;
    int leadSideTexInfo;
  };

  void RecursiveHullCheck(TraceWork &w, int nodeNum, float p1f, float p2f,
                          const Vec3 &p1, const Vec3 &p2) const;
  void TestInLeaf(TraceWork &w, int leafNum) const;
  void ClipBoxToBrush(TraceWork &w, const Brush &b) const;
  int PointLeaf(const Vec3 &p) const;

  Plane *m_planes;
  Node *m_nodes;
  Leaf *m_leafs;
  uint16_t *m_leafBrushes;
  Brush *m_brushes;
  BrushSide *m_brushSides;
  Model *m_models;
  TexInfo *m_texInfo;
  int32_t *m_texDataName;
  int32_t *m_stringTable;
  char *m_stringData;

  int m_numPlanes, m_numNodes, m_numLeafs, m_numLeafBrushes;
  int m_numBrushes, m_numBrushSides, m_numModels;
  int m_numTexInfo, m_numTexData, m_numStrings, m_stringDataLen;

  mutable int m_checkCount;
  mutable int *m_brushCheck;
};

}  // namespace simcore

#endif
