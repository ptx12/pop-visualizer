#include "cbase.h"
#include "datacache/imdlcache.h"
#include "filesystem.h"
#include "tier0/vcrmode.h"
#include "particles/particles.h"
#include "vstdlib/jobthread.h"

IMDLCache *mdlcache = NULL;
IFileSystem *g_pFullFileSystem = NULL;
VCR_t *g_pVCR = NULL;
CParticleSystemMgr *g_pParticleSystemMgr = NULL;
IThreadPool *g_pThreadPool = NULL;

bool CParticleSystemMgr::Init( IParticleSystemQuery *pQuery )
{
	return false;
}

void CParticleSystemMgr::RecreateDictionary()
{
}

void CParticleSystemMgr::UncacheAllParticleSystems()
{
}

void ConnectTier2Libraries( CreateInterfaceFn *pFactoryList, int nFactoryCount )
{
}

void ConnectTier3Libraries( CreateInterfaceFn *pFactoryList, int nFactoryCount )
{
}

void DisconnectTier2Libraries()
{
}

void DisconnectTier3Libraries()
{
}

extern "C" void *SteamInternal_ContextInit( void *pContextInitData )
{
	return NULL;
}

extern "C" void *SteamInternal_CreateInterface( const char *ver )
{
	return NULL;
}

extern "C" void *SteamInternal_FindOrCreateUserInterface( int hSteamUser, const char *pszVersion )
{
	return NULL;
}

extern "C" void *SteamInternal_FindOrCreateGameServerInterface( int hSteamUser, const char *pszVersion )
{
	return NULL;
}

extern "C" int SteamAPI_GetHSteamUser()
{
	return 0;
}

extern "C" int SteamGameServer_GetHSteamUser()
{
	return 0;
}
