#ifndef SIMCORE_DISPCOLLISION_H
#define SIMCORE_DISPCOLLISION_H

#include <stdint.h>

namespace simcore {

int DispCollision_Load(const uint8_t *dispInfoBuf, int dispInfoLen,
                       const uint8_t *dispVertBuf, int dispVertLen,
                       const uint8_t *dispTriBuf, int dispTriLen,
                       const uint8_t *facesBuf, int facesLen,
                       const uint8_t *surfEdgesBuf, int surfEdgesLen,
                       const uint8_t *edgesBuf, int edgesLen,
                       const uint8_t *vertsBuf, int vertsLen);

void DispCollision_Free();

int DispCollision_Count();

bool DispCollision_Trace(const float *start, const float *end, const float *mins,
                         const float *maxs, bool isPoint, float *inOutFraction,
                         float *outNormal, int *outContents);

}  // namespace simcore

#endif
