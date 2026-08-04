#include "dispcollision.h"

#include "cmodel.h"
#include "trace.h"
#include "bspfile.h"
#include "builddisp.h"
#include "dispcoll_common.h"

#include <stdlib.h>
#include <string.h>
#include <math.h>

namespace simcore {

struct DispSet {
  CCoreDispInfo **cores;
  CDispCollTree *trees;
  int count;
};

static DispSet g_disp = {0, 0, 0};

void DispCollision_Free() {
  if (g_disp.cores) {
    for (int i = 0; i < g_disp.count; ++i) delete g_disp.cores[i];
    free(g_disp.cores);
    g_disp.cores = 0;
  }
  if (g_disp.trees) {
    delete[] g_disp.trees;
    g_disp.trees = 0;
  }
  g_disp.count = 0;
}

int DispCollision_Load(const uint8_t *dispInfoBuf, int dispInfoLen,
                       const uint8_t *dispVertBuf, int dispVertLen,
                       const uint8_t *dispTriBuf, int dispTriLen,
                       const uint8_t *facesBuf, int facesLen,
                       const uint8_t *surfEdgesBuf, int surfEdgesLen,
                       const uint8_t *edgesBuf, int edgesLen,
                       const uint8_t *vertsBuf, int vertsLen) {
  DispCollision_Free();

  const ddispinfo_t *dispinfos = (const ddispinfo_t *)dispInfoBuf;
  int numDisp = dispInfoLen / (int)sizeof(ddispinfo_t);
  if (numDisp <= 0) return 0;

  const CDispVert *dispVerts = (const CDispVert *)dispVertBuf;
  const CDispTri *dispTris = (const CDispTri *)dispTriBuf;
  const dface_t *faces = (const dface_t *)facesBuf;
  int numFaces = facesLen / (int)sizeof(dface_t);
  const int *surfEdges = (const int *)surfEdgesBuf;
  int numSurfEdges = surfEdgesLen / 4;
  const dedge_t *edges = (const dedge_t *)edgesBuf;
  int numEdges = edgesLen / (int)sizeof(dedge_t);
  const Vector *verts = (const Vector *)vertsBuf;
  int numVerts = vertsLen / (int)sizeof(Vector);

  if (!faces || numFaces <= 0 || !surfEdges || !edges || !verts) return 0;

  int *faceForDisp = (int *)malloc(sizeof(int) * numDisp);
  for (int i = 0; i < numDisp; ++i) faceForDisp[i] = -1;
  for (int f = 0; f < numFaces; ++f) {
    int di = faces[f].dispinfo;
    if (di >= 0 && di < numDisp) faceForDisp[di] = f;
  }

  g_disp.count = numDisp;
  g_disp.cores = (CCoreDispInfo **)malloc(sizeof(CCoreDispInfo *) * numDisp);
  for (int i = 0; i < numDisp; ++i) g_disp.cores[i] = new CCoreDispInfo;

  for (int i = 0; i < numDisp; ++i) {
    g_disp.cores[i]->SetDispUtilsHelperInfo(g_disp.cores, numDisp);
  }

  int built = 0;
  for (int i = 0; i < numDisp; ++i) {
    int faceIndex = faceForDisp[i];
    if (faceIndex < 0) continue;

    const dface_t *pFace = &faces[faceIndex];
    const ddispinfo_t *pDisp = &dispinfos[i];
    CCoreDispInfo *pBuilderDisp = g_disp.cores[i];

    CCoreDispSurface *pSurf = pBuilderDisp->GetSurface();
    pSurf->SetPointCount(4);
    pSurf->SetHandle(faceIndex);
    pSurf->SetContents(pDisp->contents);

    bool ok = true;
    for (int ndxPt = 0; ndxPt < 4; ++ndxPt) {
      int seIndex = pFace->firstedge + ndxPt;
      if (seIndex < 0 || seIndex >= numSurfEdges) { ok = false; break; }
      int eIndex = surfEdges[seIndex];
      int absEdge = eIndex < 0 ? -eIndex : eIndex;
      if (absEdge < 0 || absEdge >= numEdges) { ok = false; break; }
      int vi = eIndex < 0 ? edges[absEdge].v[1] : edges[absEdge].v[0];
      if (vi < 0 || vi >= numVerts) { ok = false; break; }
      pSurf->SetPoint(ndxPt, verts[vi]);
    }
    if (!ok) continue;

    Vector vFaceNormal;
    pSurf->GetNormal(vFaceNormal);
    for (int ndxPt = 0; ndxPt < 4; ++ndxPt) {
      pSurf->SetPointNormal(ndxPt, vFaceNormal);
    }

    pSurf->SetPointStart(pDisp->startPosition);
    pSurf->FindSurfPointStartIndex();
    pSurf->AdjustSurfPointData();

    pBuilderDisp->SetNeighborData(pDisp->m_EdgeNeighbors, pDisp->m_CornerNeighbors);

    const CDispVert *pVerts = dispVerts ? &dispVerts[pDisp->m_iDispVertStart] : 0;
    const CDispTri *pTris = dispTris ? &dispTris[pDisp->m_iDispTriStart] : 0;

    pBuilderDisp->InitDispInfo(pDisp->power, pDisp->minTess, pDisp->smoothingAngle,
                               pVerts, pTris);

    if (!pBuilderDisp->Create()) continue;
    ++built;
  }

  free(faceForDisp);

  g_disp.trees = new CDispCollTree[numDisp];
  int trees = 0;
  for (int i = 0; i < numDisp; ++i) {
    if (g_disp.trees[i].Create(g_disp.cores[i])) ++trees;
  }

  return trees;
}

int DispCollision_Count() { return g_disp.count; }

bool DispCollision_Trace(const float *start, const float *end, const float *mins,
                         const float *maxs, bool isPoint, int mask,
                         float *inOutFraction, float *outNormal, int *outContents) {
  if (!g_disp.trees || g_disp.count <= 0) return false;

  Vector vStart(start[0], start[1], start[2]);
  Vector vEnd(end[0], end[1], end[2]);
  Vector vMins(mins[0], mins[1], mins[2]);
  Vector vMaxs(maxs[0], maxs[1], maxs[2]);

  Ray_t ray;
  if (isPoint) {
    ray.Init(vStart, vEnd);
  } else {
    ray.Init(vStart, vEnd, vMins, vMaxs);
  }

  Vector invDelta;
  for (int i = 0; i < 3; ++i) {
    float d = ray.m_Delta[i];
    invDelta[i] = (d != 0.0f) ? (1.0f / d) : FLT_MAX;
  }

  CBaseTrace trace;
  memset(&trace, 0, sizeof(trace));
  trace.fraction = *inOutFraction;
  trace.startsolid = false;
  trace.allsolid = false;

  bool hit = false;
  for (int i = 0; i < g_disp.count; ++i) {
    CDispCollTree *pTree = &g_disp.trees[i];
    if (!(pTree->GetContents() & mask)) continue;
    float before = trace.fraction;
    bool r;
    if (isPoint) {
      r = pTree->AABBTree_Ray(ray, invDelta, &trace);
    } else {
      r = pTree->AABBTree_SweepAABB(ray, invDelta, &trace);
    }
    if (r && trace.fraction < before) hit = true;
  }

  if (hit) {
    *inOutFraction = trace.fraction;
    outNormal[0] = trace.plane.normal.x;
    outNormal[1] = trace.plane.normal.y;
    outNormal[2] = trace.plane.normal.z;
    *outContents = trace.contents;
  }
  return hit;
}

}  // namespace simcore
