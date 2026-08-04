#include "cbase.h"
#include "generated/defaults_generated.h"
#include "enginecallback.h"
#include "networkstringtable_gamedll.h"
#include "physics_shared.h"
#include "utlvector.h"

#include <stdlib.h>
#include <string.h>

struct SimMDL_t
{
	char name[ 260 ];
	int refCount;
	studiohdr_t *pStudioHdr;
	void *pUserData;
};

static CUtlVector< SimMDL_t * > g_SimMDLs;
static int g_nMDLLockDepth = 0;
static int g_nMDLFrameUnlockCounter = 0;
static bool g_bMDLAsyncLoad[ ( MDLCACHE_DECODEDANIMBLOCK + 1 ) ] = { false };

static SimMDL_t *SimMDLByHandle( MDLHandle_t handle )
{
	if ( handle == MDLHANDLE_INVALID || (int)handle >= g_SimMDLs.Count() )
		return NULL;
	return g_SimMDLs[ handle ];
}

class CSimMDLCache : public CSimDefault_IMDLCache
{
public:
	MDLHandle_t FindMDL( const char *pMDLRelativePath ) override
	{
		if ( !pMDLRelativePath || !pMDLRelativePath[ 0 ] )
			return MDLHANDLE_INVALID;

		for ( int i = 0; i < g_SimMDLs.Count(); ++i )
		{
			if ( V_stricmp( g_SimMDLs[ i ]->name, pMDLRelativePath ) == 0 )
			{
				++g_SimMDLs[ i ]->refCount;
				return (MDLHandle_t)i;
			}
		}

		SimMDL_t *pMDL = (SimMDL_t *)calloc( 1, sizeof( SimMDL_t ) );
		V_strncpy( pMDL->name, pMDLRelativePath, sizeof( pMDL->name ) );
		pMDL->refCount = 1;
		return (MDLHandle_t)g_SimMDLs.AddToTail( pMDL );
	}

	int AddRef( MDLHandle_t handle ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		return pMDL ? ++pMDL->refCount : 0;
	}

	int Release( MDLHandle_t handle ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		if ( !pMDL )
			return 0;
		if ( pMDL->refCount > 0 )
			--pMDL->refCount;
		return pMDL->refCount;
	}

	int GetRef( MDLHandle_t handle ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		return pMDL ? pMDL->refCount : 0;
	}

	const char *GetModelName( MDLHandle_t handle ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		return pMDL ? pMDL->name : "?";
	}

	studiohdr_t *GetStudioHdr( MDLHandle_t handle ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		return pMDL ? pMDL->pStudioHdr : NULL;
	}

	studiohdr_t *LockStudioHdr( MDLHandle_t handle ) override
	{
		return GetStudioHdr( handle );
	}

	void UnlockStudioHdr( MDLHandle_t handle ) override {}

	void SetUserData( MDLHandle_t handle, void *pData ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		if ( pMDL )
			pMDL->pUserData = pData;
	}

	void *GetUserData( MDLHandle_t handle ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		return pMDL ? pMDL->pUserData : NULL;
	}

	bool IsDataLoaded( MDLHandle_t handle, MDLCacheDataType_t type ) override
	{
		SimMDL_t *pMDL = SimMDLByHandle( handle );
		if ( !pMDL )
			return false;
		return type == MDLCACHE_STUDIOHDR && pMDL->pStudioHdr != NULL;
	}

	bool GetAsyncLoad( MDLCacheDataType_t type ) override
	{
		if ( type < 0 || type >= ( MDLCACHE_DECODEDANIMBLOCK + 1 ) )
			return false;
		return g_bMDLAsyncLoad[ type ];
	}

	bool SetAsyncLoad( MDLCacheDataType_t type, bool bAsync ) override
	{
		if ( type < 0 || type >= ( MDLCACHE_DECODEDANIMBLOCK + 1 ) )
			return false;
		bool bPrior = g_bMDLAsyncLoad[ type ];
		g_bMDLAsyncLoad[ type ] = bAsync;
		return bPrior;
	}

	void BeginLock() override { ++g_nMDLLockDepth; }

	void EndLock() override
	{
		if ( g_nMDLLockDepth > 0 && --g_nMDLLockDepth == 0 )
			++g_nMDLFrameUnlockCounter;
	}

	int *GetFrameUnlockCounterPtr( MDLCacheDataType_t type ) override { return &g_nMDLFrameUnlockCounter; }
	int *GetFrameUnlockCounterPtrOLD() override { return &g_nMDLFrameUnlockCounter; }

	void MarkFrame() override { ++g_nMDLFrameUnlockCounter; }

	bool IsErrorModel( MDLHandle_t handle ) override { return SimMDLByHandle( handle ) == NULL; }
};

static CSimMDLCache s_MDLCache;
static CSimDefault_IEngineTrace s_EngineTrace;
static CSimDefault_IStaticPropMgrServer s_StaticPropMgr;
static CSimDefault_IGameEventManager2 s_GameEventManager;
static CSimDefault_IDataCache s_DataCache;
static CSimDefault_ISoundEmitterSystemBase s_SoundEmitterBase;
static CSimDefault_IServerPluginHelpers s_ServerPluginHelpers;
static CSimDefault_IEngineSound s_EngineSound;
static CSimDefault_IVoiceServer s_VoiceServer;
static CSimDefault_IScriptManager s_ScriptManager;
static CSimDefault_ILagCompensationManager s_LagCompensation;
static CSimDefault_ITempEntsSystem s_TempEnts;
static CSimDefault_IResponseSystem s_ResponseSystem;
static CSimDefault_ISceneFileCache s_SceneFileCache;
static CSimDefault_IFileSystem s_FileSystem;
static CSimDefault_IPhysicsCollision s_PhysicsCollision;
static CSimDefault_IPhysicsSurfaceProps s_PhysicsSurfaceProps;

extern IFileSystem *g_pFullFileSystem;
extern IFileSystem *filesystem;
extern ISceneFileCache *scenefilecache;
extern ILagCompensationManager *lagcompensation;
extern ITempEntsSystem *te;
extern IResponseSystem *g_pResponseSystem;
INetworkStringTableContainer *SimEngine_StringTables();

extern ISoundEmitterSystemBase *soundemitterbase;
extern IServerPluginHelpers *serverpluginhelpers;

void SimEngine_InstallDefaults()
{
	mdlcache = &s_MDLCache;
	enginetrace = &s_EngineTrace;
	staticpropmgr = &s_StaticPropMgr;
	gameeventmanager = &s_GameEventManager;
	datacache = &s_DataCache;
	soundemitterbase = &s_SoundEmitterBase;
	serverpluginhelpers = &s_ServerPluginHelpers;
	enginesound = &s_EngineSound;
	g_pVoiceServer = &s_VoiceServer;
	networkstringtable = SimEngine_StringTables();
	scriptmanager = &s_ScriptManager;
	lagcompensation = &s_LagCompensation;
	te = &s_TempEnts;
	g_pResponseSystem = &s_ResponseSystem;
	scenefilecache = &s_SceneFileCache;
	g_pFullFileSystem = &s_FileSystem;
	filesystem = &s_FileSystem;
	physcollision = &s_PhysicsCollision;
	physprops = &s_PhysicsSurfaceProps;
}

void SimEngine_SetStudioHdr( const char *pModelName, void *pData )
{
	MDLHandle_t handle = s_MDLCache.FindMDL( pModelName );
	SimMDL_t *pMDL = SimMDLByHandle( handle );
	if ( pMDL )
		pMDL->pStudioHdr = (studiohdr_t *)pData;
}
