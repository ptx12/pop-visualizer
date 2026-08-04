#include "cbase.h"
#include "tier0/threadtools.h"
#include "tier0/vprof.h"
#include "particles/particles.h"
#include "vgui/ILocalize.h"
#include "tier2/p4helpers.h"
#include "steam/steam_api.h"
#include "steam/steam_gameserver.h"
#include "gcsdk/gcclient.h"
#include "gcsdk/gcclient_sharedobjectcache.h"
#include "gcsdk/job.h"
#include "gcsdk/jobmgr.h"
#include "gcsdk/msgbase.h"
#include "gcsdk/msgprotobuf.h"
#include "gcsdk/sharedobject.h"
#include "gcsdk/protobufsharedobject.h"
#include "gcsdk/webapi_response.h"
#include "gcsdk/gclogger.h"
#include "gcsdk/workthreadpool.h"
#include "gcsdk/jobtime.h"

void ThreadSleep( unsigned nMilliseconds )
{
}

float GetCPUUsage()
{
	return 0.0f;
}

CThread::CThread()
{
}

CThread::~CThread()
{
}

bool CThread::Init()
{
	return false;
}

void CThread::OnExit()
{
}

bool CThread::IsThreadRunning()
{
	return false;
}

bool CThread::Start( unsigned nBytesStack )
{
	return false;
}

void CThread::SetName( const char *pszName )
{
}

ThreadFunc_t CThread::GetThreadProc()
{
	return NULL;
}

CWorkerThread::CWorkerThread()
{
}

bool CWorkerThread::WaitForCall( unsigned *pResult )
{
	return false;
}

void CWorkerThread::Reply( unsigned dw )
{
}

int CVProfile::BudgetGroupNameToBudgetGroupID( const char *pBudgetGroupName )
{
	return 0;
}

int *CVProfile::FindOrCreateCounter( const tchar *pName, CounterGroup_t eCounterGroup )
{
	static int s_nCounter = 0;
	return &s_nCounter;
}

void ConColorMsg( const Color &clr, const char *pMsg, ... )
{
}

bool AlmostEqual( float a, float b, int maxUlps )
{
	return a == b;
}

struct tm *Plat_localtime( const time_t *timep, struct tm *result )
{
	return NULL;
}

struct tm *Plat_gmtime( const time_t *timep, struct tm *result )
{
	return NULL;
}

vgui::ILocalize *g_pVGuiLocalize = NULL;
IP4 *p4 = NULL;
CP4Factory *g_p4factory = NULL;

CP4File *CP4Factory::AccessFile( const char *pFileName ) const
{
	return NULL;
}

bool CParticleSystemDefinition::ShouldAlwaysPrecache() const
{
	return false;
}

void CParticleSystemMgr::DecommitTempMemory()
{
}

CParticleSystemDefinition *CParticleSystemMgr::FindParticleSystem( const char *pName )
{
	return NULL;
}

int CParticleSystemMgr::GetParticleSystemCount()
{
	return 0;
}

const char *CParticleSystemMgr::GetParticleSystemNameFromIndex( int nIndex )
{
	return NULL;
}

bool CParticleSystemMgr::ReadParticleConfigFile( const char *pFileName, bool bPrecache, bool bDecommitTempMemory )
{
	return false;
}

bool CParticleSystemMgr::ReadParticleConfigFile( CUtlBuffer &buf, bool bPrecache, bool bDecommitTempMemory, const char *pFileName )
{
	return false;
}

void CParticleSystemMgr::ShouldLoadSheets( bool bLoadSheets )
{
}

CThreadSafeMultiMemoryPool::CThreadSafeMultiMemoryPool( const MemPoolConfig_t *pnBlock, int cnMemPoolConfig, int nGrowMode )
{
}

CThreadSafeMultiMemoryPool::~CThreadSafeMultiMemoryPool()
{
}

void *CThreadSafeMultiMemoryPool::Alloc( uint32 cubAlloc )
{
	return malloc( cubAlloc );
}

void CThreadSafeMultiMemoryPool::Free( void *pvMem )
{
	free( pvMem );
}

S_API void S_CALLTYPE SteamAPI_RunCallbacks()
{
}

S_API void S_CALLTYPE SteamGameServer_RunCallbacks()
{
}

S_API bool SteamGameServer_BSecure()
{
	return false;
}

S_API HSteamPipe S_CALLTYPE SteamAPI_GetHSteamPipe()
{
	return 0;
}

S_API void S_CALLTYPE SteamAPI_RegisterCallback( class CCallbackBase *pCallback, int iCallback )
{
}

S_API void S_CALLTYPE SteamAPI_UnregisterCallback( class CCallbackBase *pCallback )
{
}

S_API void S_CALLTYPE SteamAPI_RegisterCallResult( class CCallbackBase *pCallback, SteamAPICall_t hAPICall )
{
}

S_API void S_CALLTYPE SteamAPI_UnregisterCallResult( class CCallbackBase *pCallback, SteamAPICall_t hAPICall )
{
}

namespace GCSDK
{

CGCEmitGroup SPEW_GC( "GC", "gc_spew", "gc_log", "4", "4" );

void EmitWarning( const CGCEmitGroup &group, int iLevel, const char *pchMsg, ... )
{
}

CGCClient::CGCClient( ISteamGameCoordinator *pSteamGameCoordinator, bool bGameserver )
{
}

CGCClient::~CGCClient()
{
}

bool CGCClient::BInit( ISteamGameCoordinator *pSteamGameCoordinator )
{
	return false;
}

void CGCClient::Uninit()
{
}

bool CGCClient::BMainLoop( uint64 ulLimitMicroseconds, uint64 ulFrameTimeMicroseconds )
{
	return false;
}

bool CGCClient::BSendMessage( const CGCMsgBase &msg )
{
	return false;
}

bool CGCClient::BSendMessage( const CProtoBufMsgBase &msg )
{
	return false;
}

CGCClientSharedObjectCache *CGCClient::FindSOCache( const CSteamID &steamID, bool bCreateIfMissing )
{
	return NULL;
}

void CGCClient::AddSOCacheListener( const CSteamID &ownerID, ISharedObjectListener *pListener )
{
}

bool CGCClient::RemoveSOCacheListener( const CSteamID &ownerID, ISharedObjectListener *pListener )
{
	return false;
}

void CGCClient::Dump()
{
}

CGCClientSharedObjectCache *CGCClient::AddLocalSOCache( const CSteamID &ownerID, void *pubData, uint32 cubData )
{
	return NULL;
}

void CGCClientSharedObjectCache::AddListener( ISharedObjectListener *pListener )
{
}

bool CGCClientSharedObjectCache::RemoveListener( ISharedObjectListener *pListener )
{
	return false;
}

CJob::CJob( CJobMgr &jobMgr, const char *pchJobName )
	: m_JobMgr( jobMgr )
{
}

CJob::~CJob()
{
}

void CJob::StartJob( void *pvStartParam )
{
}

void CJob::StartJobDelayed( void *pvStartParam )
{
}

bool CJob::BYieldingWaitTime( uint32 cMicrosecondsToSleep )
{
	return false;
}

bool CJob::BYieldingWaitOneFrame()
{
	return false;
}

bool CJob::BYieldingWaitForMsg( IMsgNetPacket **ppNetPacket )
{
	return false;
}

CJobTime::CJobTime()
{
}

uint32 CJob::CHeartbeatsBeforeTimeout()
{
	return 0;
}

CJobMgr::CJobMgr()
	: m_WorkThreadPool( "GCJob" )
{
}

CJobMgr::~CJobMgr()
{
}

void CJobMgr::RegisterJobType( const JobType_t *pJobType )
{
}

CThreadMutex CProtoBufMsgBase::s_PoolRegMutex;

CProtoBufMsgBase::CProtoBufMsgBase()
{
}

CProtoBufMsgBase::CProtoBufMsgBase( MsgType_t eMsgType )
{
}

CProtoBufMsgBase::~CProtoBufMsgBase()
{
}

bool CProtoBufMsgBase::InitFromPacket( IMsgNetPacket *pNetPacket )
{
	return false;
}

CProtoBufMsgMemoryPoolBase::CProtoBufMsgMemoryPoolBase( uint32 unTargetLow, uint32 unTargetHigh )
	: m_unTargetCountLow( unTargetLow ), m_unTargetCountHigh( unTargetHigh )
{
	m_pTSQueueFreeObjects = new CTSQueue< google::protobuf::Message * >();
}

CProtoBufMsgMemoryPoolBase::~CProtoBufMsgMemoryPoolBase()
{
	delete m_pTSQueueFreeObjects;
}

::google::protobuf::Message *CProtoBufMsgMemoryPoolBase::Alloc()
{
	google::protobuf::Message *pMsg = NULL;
	if ( m_pTSQueueFreeObjects->PopItem( &pMsg ) )
	{
		++m_unAllocHitCounter;
		return pMsg;
	}
	++m_unAllocMissCounter;
	++m_unAllocated;
	return InternalAlloc();
}

void CProtoBufMsgMemoryPoolBase::Free( ::google::protobuf::Message *pMsg )
{
	m_pTSQueueFreeObjects->PushItem( pMsg );
}

bool CProtoBufMsgMemoryPoolBase::PopItem( google::protobuf::Message **ppMsg )
{
	return m_pTSQueueFreeObjects->PopItem( ppMsg );
}

CProtoBufMsgMemoryPoolMgr::CProtoBufMsgMemoryPoolMgr()
{
}

CProtoBufMsgMemoryPoolMgr::~CProtoBufMsgMemoryPoolMgr()
{
}

CWorkThreadPool::CWorkThreadPool( const char *pszThreadNamePfx )
{
}

CWorkThreadPool::~CWorkThreadPool()
{
}

void CWorkThreadPool::OnWorkItemCompleted( CWorkItem *pWorkItem )
{
}

void CProtoBufMsgMemoryPoolMgr::RegisterPool( CProtoBufMsgMemoryPoolBase *pPool )
{
}

CProtoBufMsgMemoryPoolMgr *GProtoBufMsgMemoryPoolMgr()
{
	static CProtoBufMsgMemoryPoolMgr s_Mgr;
	return &s_Mgr;
}

bool CProtoBufSharedObjectBase::BParseFromMessage( const CUtlBuffer &buffer )
{
	return false;
}

bool CProtoBufSharedObjectBase::BParseFromMessage( const std::string &buffer )
{
	return false;
}

bool CProtoBufSharedObjectBase::BUpdateFromNetwork( const CSharedObject &objUpdate )
{
	return false;
}

bool CProtoBufSharedObjectBase::BIsKeyLess( const CSharedObject &soRHS ) const
{
	return false;
}

void CProtoBufSharedObjectBase::Copy( const CSharedObject &soRHS )
{
}

void CProtoBufSharedObjectBase::Dump() const
{
}

void CProtoBufSharedObjectBase::Dump( const ::google::protobuf::Message &msg )
{
}

const char *CSharedObject::PchClassName( int nTypeID )
{
	return "";
}

void CSharedObject::RegisterFactory( int nTypeID, SOCreationFunc_t fnFactory, uint32 unFlags, const char *pchClassName )
{
}

CSharedObjectTypeCache *CSharedObjectCache::FindBaseTypeCache( int nClassID ) const
{
	return NULL;
}

CSharedObject *CSharedObjectCache::FindSharedObject( const CSharedObject &soIndex )
{
	return NULL;
}

CSharedObject *CSharedObjectTypeCache::FindSharedObject( const CSharedObject &soIndex )
{
	return NULL;
}

CWebAPIValues *CWebAPIValues::FindChild( const char *pchName )
{
	return NULL;
}

int32 CWebAPIValues::GetChildInt32Value( const char *pchChildName, int32 nDefault ) const
{
	return nDefault;
}

uint64 CWebAPIValues::GetChildUInt64Value( const char *pchChildName, uint64 ulDefault ) const
{
	return ulDefault;
}

void CWebAPIValues::GetChildStringValue( CUtlString &stringOut, const char *pchChildName, const char *pchDefault ) const
{
	stringOut = pchDefault;
}

bool CWebAPIValues::BGetChildBinaryValue( CUtlBuffer &bufferOut, const char *pchChildName ) const
{
	return false;
}

CWebAPIValues *CWebAPIValues::ParseJSON( CUtlBuffer &inputBuffer )
{
	return NULL;
}

CThreadSafeMultiMemoryPool::MemPoolConfig_t g_MsgMemPoolConfig[] = { { 64, 16 } };
CThreadSafeMultiMemoryPool g_MemPoolMsg( g_MsgMemPoolConfig, 1 );

}
