#ifndef SIMCORE_GCSDK_STDAFX_H
#define SIMCORE_GCSDK_STDAFX_H

#include "tier0/platform.h"
#include "tier0/dbg.h"
#include "tier0/threadtools.h"
#include "tier1/strtools.h"
#include "tier1/utlmemory.h"
#include "tier1/utlvector.h"
#include "tier1/utlstring.h"
#include "tier1/utlbuffer.h"
#include "tier1/utlmap.h"
#include "tier1/mempool.h"
#include "tier0/t0constants.h"

enum
{
	SPEW_SYSTEM_MISC = 0,
	SPEW_ALWAYS = 0,
	LOG_ALWAYS = 0,
};

inline void EmitInfo( int nGroup, int nSpewLevel, int nLogLevel, const char *pchMsg, ... )
{
}

#endif
