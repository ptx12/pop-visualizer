#include "bspcollision.h"
#include "dispcollision.h"

#include <emscripten/emscripten.h>
#include <stdlib.h>

using namespace simcore;

static CollisionWorld *g_world = 0;
static TraceResult g_result;

extern "C" {

EMSCRIPTEN_KEEPALIVE
int sim_collision_load(const uint8_t *planes, int planesLen,
                       const uint8_t *nodes, int nodesLen,
                       const uint8_t *leafs, int leafsLen, int leafSize,
                       const uint8_t *leafBrushes, int leafBrushesLen,
                       const uint8_t *brushes, int brushesLen,
                       const uint8_t *brushSides, int brushSidesLen,
                       const uint8_t *models, int modelsLen) {
  if (g_world) delete g_world;
  g_world = new CollisionWorld();
  bool ok = g_world->Load(planes, planesLen, nodes, nodesLen, leafs, leafsLen, leafSize,
                          leafBrushes, leafBrushesLen, brushes, brushesLen,
                          brushSides, brushSidesLen, models, modelsLen);
  return ok ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int sim_collision_stats(int which) {
  if (!g_world) return -1;
  switch (which) {
    case 0: return g_world->NumPlanes();
    case 1: return g_world->NumNodes();
    case 2: return g_world->NumLeafs();
    case 3: return g_world->NumBrushes();
  }
  return -1;
}

EMSCRIPTEN_KEEPALIVE
int sim_disp_load(const uint8_t *dispInfo, int dispInfoLen,
                  const uint8_t *dispVerts, int dispVertsLen,
                  const uint8_t *dispTris, int dispTrisLen,
                  const uint8_t *faces, int facesLen,
                  const uint8_t *surfEdges, int surfEdgesLen,
                  const uint8_t *edges, int edgesLen,
                  const uint8_t *verts, int vertsLen) {
  return DispCollision_Load(dispInfo, dispInfoLen, dispVerts, dispVertsLen,
                            dispTris, dispTrisLen, faces, facesLen,
                            surfEdges, surfEdgesLen, edges, edgesLen,
                            verts, vertsLen);
}

EMSCRIPTEN_KEEPALIVE
int sim_disp_count() { return DispCollision_Count(); }

EMSCRIPTEN_KEEPALIVE
float sim_trace_hull(float sx, float sy, float sz, float ex, float ey, float ez,
                     float minx, float miny, float minz,
                     float maxx, float maxy, float maxz, int mask) {
  if (!g_world) return 1.0f;
  g_world->TraceHull(Vec3(sx, sy, sz), Vec3(ex, ey, ez), Vec3(minx, miny, minz),
                     Vec3(maxx, maxy, maxz), mask, &g_result);

  const float start[3] = {sx, sy, sz};
  const float end[3] = {ex, ey, ez};
  const float mins[3] = {minx, miny, minz};
  const float maxs[3] = {maxx, maxy, maxz};
  bool isPoint = (minx == 0 && miny == 0 && minz == 0 &&
                  maxx == 0 && maxy == 0 && maxz == 0);

  float frac = g_result.fraction;
  float normal[3] = {0, 0, 0};
  int contents = 0;
  if (DispCollision_Trace(start, end, mins, maxs, isPoint, &frac, normal, &contents)) {
    g_result.fraction = frac;
    g_result.planeNormal = Vec3(normal[0], normal[1], normal[2]);
    g_result.contents = contents;
    g_result.endpos = Vec3(sx + frac * (ex - sx), sy + frac * (ey - sy),
                           sz + frac * (ez - sz));
  }

  return g_result.fraction;
}

EMSCRIPTEN_KEEPALIVE
float sim_trace_result(int which) {
  switch (which) {
    case 0: return g_result.fraction;
    case 1: return g_result.endpos.x;
    case 2: return g_result.endpos.y;
    case 3: return g_result.endpos.z;
    case 4: return g_result.planeNormal.x;
    case 5: return g_result.planeNormal.y;
    case 6: return g_result.planeNormal.z;
    case 7: return g_result.startsolid ? 1.0f : 0.0f;
    case 8: return g_result.allsolid ? 1.0f : 0.0f;
    case 9: return (float)g_result.contents;
  }
  return 0.0f;
}

EMSCRIPTEN_KEEPALIVE
int sim_point_contents(float x, float y, float z) {
  if (!g_world) return 0;
  return g_world->PointContents(Vec3(x, y, z));
}

EMSCRIPTEN_KEEPALIVE
void *sim_alloc(int n) { return malloc(n); }

EMSCRIPTEN_KEEPALIVE
void sim_free(void *p) { free(p); }

}
