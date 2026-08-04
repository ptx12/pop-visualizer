#ifndef SIM_DEFAULTS_GENERATED_H
#define SIM_DEFAULTS_GENERATED_H

#include "datacache/imdlcache.h"
#include "appframework/IAppSystem.h"
#include "eiface.h"
#include "engine/IVModelInfo.h"
#include "ispatialpartition.h"
#include "engine/IEngineTrace.h"
#include "engine/IStaticPropMgr.h"
#include "igameevents.h"
#include "datacache/idatacache.h"
#include "SoundEmitterSystem/isoundemittersystembase.h"
#include "engine/iserverplugin.h"
#include "engine/IEngineSound.h"
#include "ivoiceserver.h"
#include "networkstringtabledefs.h"
#include "vscript/ivscript.h"
#include "toolframework/iserverenginetools.h"
#include "ilagcompensationmanager.h"
#include "itempents.h"
#include "AI_ResponseSystem.h"
#include "engine/ivdebugoverlay.h"
#include "scenefilecache/ISceneFileCache.h"
#include "filesystem.h"
#include "vphysics_interface.h"

class CSimDefault_IMDLCache : public IMDLCache
{
public:
	bool Connect( CreateInterfaceFn factory ) override { return false; }
	void Disconnect(  ) override {  }
	void * QueryInterface( const char *pInterfaceName ) override { return 0; }
	InitReturnVal_t Init(  ) override { return InitReturnVal_t(); }
	void Shutdown(  ) override {  }
	void SetCacheNotify( IMDLCacheNotify *pNotify ) override {  }
	MDLHandle_t FindMDL( const char *pMDLRelativePath ) override { return MDLHandle_t(); }
	int AddRef( MDLHandle_t handle ) override { return int(); }
	int Release( MDLHandle_t handle ) override { return int(); }
	int GetRef( MDLHandle_t handle ) override { return int(); }
	studiohdr_t * GetStudioHdr( MDLHandle_t handle ) override { return 0; }
	studiohwdata_t * GetHardwareData( MDLHandle_t handle ) override { return 0; }
	vcollide_t * GetVCollide( MDLHandle_t handle ) override { return 0; }
	unsigned char * GetAnimBlock( MDLHandle_t handle, int nBlock ) override { return 0; }
	virtualmodel_t * GetVirtualModel( MDLHandle_t handle ) override { return 0; }
	int GetAutoplayList( MDLHandle_t handle, unsigned short **pOut ) override { return int(); }
	vertexFileHeader_t * GetVertexData( MDLHandle_t handle ) override { return 0; }
	void TouchAllData_Old( MDLHandle_t handle ) override {  }
	void SetUserData( MDLHandle_t handle, void* pData ) override {  }
	void * GetUserData( MDLHandle_t handle ) override { return 0; }
	bool IsErrorModel( MDLHandle_t handle ) override { return false; }
	void Flush( MDLCacheFlush_t nFlushFlags ) override {  }
	void Flush( MDLHandle_t handle, int nFlushFlags ) override {  }
	const char * GetModelName( MDLHandle_t handle ) override { return 0; }
	virtualmodel_t * GetVirtualModelFast( const studiohdr_t *pStudioHdr, MDLHandle_t handle ) override { return 0; }
	void BeginLock(  ) override {  }
	void EndLock(  ) override {  }
	int * GetFrameUnlockCounterPtrOLD(  ) override { return 0; }
	void FinishPendingLoads(  ) override {  }
	vcollide_t * GetVCollideEx( MDLHandle_t handle, bool synchronousLoad ) override { return 0; }
	bool GetVCollideSize( MDLHandle_t handle, int *pVCollideSize ) override { return false; }
	bool GetAsyncLoad( MDLCacheDataType_t type ) override { return false; }
	bool SetAsyncLoad( MDLCacheDataType_t type, bool bAsync ) override { return false; }
	void BeginMapLoad(  ) override {  }
	void EndMapLoad(  ) override {  }
	void MarkAsLoaded( MDLHandle_t handle ) override {  }
	void InitPreloadData( bool rebuild ) override {  }
	void ShutdownPreloadData(  ) override {  }
	bool IsDataLoaded( MDLHandle_t handle, MDLCacheDataType_t type ) override { return false; }
	int * GetFrameUnlockCounterPtr( MDLCacheDataType_t type ) override { return 0; }
	studiohdr_t * LockStudioHdr( MDLHandle_t handle ) override { return 0; }
	void UnlockStudioHdr( MDLHandle_t handle ) override {  }
	bool PreloadModel( MDLHandle_t handle ) override { return false; }
	void ResetErrorModelStatus( MDLHandle_t handle ) override {  }
	void MarkFrame(  ) override {  }
	bool TouchAllData( MDLHandle_t handle ) override { return false; }
};
class CSimDefault_IEngineTrace : public IEngineTrace
{
public:
	int GetPointContents( const Vector &vecAbsPosition, IHandleEntity** ppEntity ) override { return int(); }
	int GetPointContents_Collideable( ICollideable *pCollide, const Vector &vecAbsPosition ) override { return int(); }
	void ClipRayToEntity( const Ray_t &ray, unsigned int fMask, IHandleEntity *pEnt, trace_t *pTrace ) override {  }
	void ClipRayToCollideable( const Ray_t &ray, unsigned int fMask, ICollideable *pCollide, trace_t *pTrace ) override {  }
	void TraceRay( const Ray_t &ray, unsigned int fMask, ITraceFilter *pTraceFilter, trace_t *pTrace ) override {  }
	void SetupLeafAndEntityListRay( const Ray_t &ray, CTraceListData &traceData ) override {  }
	void SetupLeafAndEntityListBox( const Vector &vecBoxMin, const Vector &vecBoxMax, CTraceListData &traceData ) override {  }
	void TraceRayAgainstLeafAndEntityList( const Ray_t &ray, CTraceListData &traceData, unsigned int fMask, ITraceFilter *pTraceFilter, trace_t *pTrace ) override {  }
	void SweepCollideable( ICollideable *pCollide, const Vector &vecAbsStart, const Vector &vecAbsEnd, const QAngle &vecAngles, unsigned int fMask, ITraceFilter *pTraceFilter, trace_t *pTrace ) override {  }
	void EnumerateEntities( const Ray_t &ray, bool triggers, IEntityEnumerator *pEnumerator ) override {  }
	void EnumerateEntities( const Vector &vecAbsMins, const Vector &vecAbsMaxs, IEntityEnumerator *pEnumerator ) override {  }
	ICollideable * GetCollideable( IHandleEntity *pEntity ) override { return 0; }
	int GetStatByIndex( int index, bool bClear ) override { return int(); }
	void GetBrushesInAABB( const Vector &vMins, const Vector &vMaxs, CUtlVector<int> *pOutput, int iContentsMask ) override {  }
	CPhysCollide* GetCollidableFromDisplacementsInAABB( const Vector& vMins, const Vector& vMaxs ) override { return 0; }
	bool GetBrushInfo( int iBrush, CUtlVector<Vector4D> *pPlanesOut, int *pContentsOut ) override { return false; }
	bool PointOutsideWorld( const Vector &ptTest ) override { return false; }
	int GetLeafContainingPoint( const Vector &ptTest ) override { return int(); }
};
class CSimDefault_IStaticPropMgrServer : public IStaticPropMgrServer
{
public:
	void CreateVPhysicsRepresentations( IPhysicsEnvironment *physenv, IVPhysicsKeyHandler *pDefaults, void *pGameData ) override {  }
	void TraceRayAgainstStaticProp( const Ray_t& ray, int staticPropIndex, trace_t& tr ) override {  }
	bool IsStaticProp( IHandleEntity *pHandleEntity ) const override { return false; }
	bool IsStaticProp( CBaseHandle handle ) const override { return false; }
	ICollideable * GetStaticPropByIndex( int propIndex ) override { return 0; }
	void GetAllStaticProps( CUtlVector<ICollideable *> *pOutput ) override {  }
	void GetAllStaticPropsInAABB( const Vector &vMins, const Vector &vMaxs, CUtlVector<ICollideable *> *pOutput ) override {  }
	void GetAllStaticPropsInOBB( const Vector &ptOrigin, const Vector &vExtent1, const Vector &vExtent2, const Vector &vExtent3, CUtlVector<ICollideable *> *pOutput ) override {  }
};
class CSimDefault_IGameEventManager2 : public IGameEventManager2
{
public:
	int LoadEventsFromFile( const char *filename ) override { return int(); }
	void Reset(  ) override {  }
	bool AddListener( IGameEventListener2 *listener, const char *name, bool bServerSide ) override { return false; }
	bool FindListener( IGameEventListener2 *listener, const char *name ) override { return false; }
	void RemoveListener( IGameEventListener2 *listener ) override {  }
	IGameEvent * CreateEvent( const char *name, bool bForce ) override { return 0; }
	bool FireEvent( IGameEvent *event, bool bDontBroadcast ) override { return false; }
	bool FireEventClientSide( IGameEvent *event ) override { return false; }
	IGameEvent * DuplicateEvent( IGameEvent *event ) override { return 0; }
	void FreeEvent( IGameEvent *event ) override {  }
	bool SerializeEvent( IGameEvent *event, bf_write *buf ) override { return false; }
	IGameEvent * UnserializeEvent( bf_read *buf ) override { return 0; }
};
class CSimDefault_IDataCache : public IDataCache
{
public:
	bool Connect( CreateInterfaceFn factory ) override { return false; }
	void Disconnect(  ) override {  }
	void * QueryInterface( const char *pInterfaceName ) override { return 0; }
	InitReturnVal_t Init(  ) override { return InitReturnVal_t(); }
	void Shutdown(  ) override {  }
	void SetSize( int nMaxBytes ) override {  }
	void SetOptions( unsigned options ) override {  }
	void SetSectionLimits( const char *pszSectionName, const DataCacheLimits_t &limits ) override {  }
	void GetStatus( DataCacheStatus_t *pStatus, DataCacheLimits_t *pLimits ) override {  }
	IDataCacheSection * AddSection( IDataCacheClient *pClient, const char *pszSectionName, const DataCacheLimits_t &limits, bool bSupportFastFind ) override { return 0; }
	void RemoveSection( const char *pszClientName, bool bCallFlush ) override {  }
	IDataCacheSection * FindSection( const char *pszClientName ) override { return 0; }
	unsigned Purge( unsigned nBytes ) override { return unsigned(); }
	unsigned Flush( bool bUnlockedOnly, bool bNotify ) override { return unsigned(); }
	void OutputReport( DataCacheReportType_t reportType, const char *pszSection ) override {  }
};
class CSimDefault_ISoundEmitterSystemBase : public ISoundEmitterSystemBase
{
public:
	bool Connect( CreateInterfaceFn factory ) override { return false; }
	void Disconnect(  ) override {  }
	void * QueryInterface( const char *pInterfaceName ) override { return 0; }
	InitReturnVal_t Init(  ) override { return InitReturnVal_t(); }
	void Shutdown(  ) override {  }
	bool ModInit(  ) override { return false; }
	void ModShutdown(  ) override {  }
	int GetSoundIndex( const char *pName ) const override { return int(); }
	bool IsValidIndex( int index ) override { return false; }
	int GetSoundCount( void ) override { return int(); }
	const char * GetSoundName( int index ) override { return 0; }
	bool GetParametersForSound( const char *soundname, CSoundParameters& params, gender_t gender, bool isbeingemitted ) override { return false; }
	const char * GetWaveName( CUtlSymbol& sym ) override { return 0; }
	CUtlSymbol AddWaveName( const char *name ) override { return CUtlSymbol(); }
	soundlevel_t LookupSoundLevel( const char *soundname ) override { return soundlevel_t(); }
	const char * GetWavFileForSound( const char *soundname, char const *actormodel ) override { return 0; }
	const char * GetWavFileForSound( const char *soundname, gender_t gender ) override { return 0; }
	int CheckForMissingWavFiles( bool verbose ) override { return int(); }
	const char * GetSourceFileForSound( int index ) const override { return 0; }
	int First(  ) const override { return int(); }
	int Next( int i ) const override { return int(); }
	int InvalidIndex(  ) const override { return int(); }
	CSoundParametersInternal * InternalGetParametersForSound( int index ) override { return 0; }
	bool AddSound( const char *soundname, const char *scriptfile, const CSoundParametersInternal& params ) override { return false; }
	void RemoveSound( const char *soundname ) override {  }
	void MoveSound( const char *soundname, const char *newscript ) override {  }
	void RenameSound( const char *soundname, const char *newname ) override {  }
	void UpdateSoundParameters( const char *soundname, const CSoundParametersInternal& params ) override {  }
	int GetNumSoundScripts(  ) const override { return int(); }
	char const * GetSoundScriptName( int index ) const override { return 0; }
	bool IsSoundScriptDirty( int index ) const override { return false; }
	int FindSoundScript( const char *name ) const override { return int(); }
	void SaveChangesToSoundScript( int scriptindex ) override {  }
	void ExpandSoundNameMacros( CSoundParametersInternal& params, char const *wavename ) override {  }
	gender_t GetActorGender( char const *actormodel ) override { return gender_t(); }
	void GenderExpandString( char const *actormodel, char const *in, char *out, int maxlen ) override {  }
	void GenderExpandString( gender_t gender, char const *in, char *out, int maxlen ) override {  }
	bool IsUsingGenderToken( char const *soundname ) override { return false; }
	unsigned int GetManifestFileTimeChecksum(  ) override { return ( unsigned int )0; }
	void AddSoundOverrides( char const *scriptfile, bool bPreload ) override {  }
	void ClearSoundOverrides(  ) override {  }
	bool GetParametersForSoundEx( const char *soundname, HSOUNDSCRIPTHANDLE& handle, CSoundParameters& params, gender_t gender, bool isbeingemitted ) override { return false; }
	soundlevel_t LookupSoundLevelByHandle( char const *soundname, HSOUNDSCRIPTHANDLE& handle ) override { return soundlevel_t(); }
	void ReloadSoundEntriesInList( IFileList *pFilesToReload ) override {  }
	void Flush(  ) override {  }
};
class CSimDefault_IServerPluginHelpers : public IServerPluginHelpers
{
public:
	void CreateMessage( edict_t *pEntity, DIALOG_TYPE type, KeyValues *data, IServerPluginCallbacks *plugin ) override {  }
	void ClientCommand( edict_t *pEntity, const char *cmd ) override {  }
	QueryCvarCookie_t StartQueryCvarValue( edict_t *pEntity, const char *pName ) override { return QueryCvarCookie_t(); }
};
class CSimDefault_IEngineSound : public IEngineSound
{
public:
	bool PrecacheSound( const char *pSample, bool bPreload, bool bIsUISound ) override { return false; }
	bool IsSoundPrecached( const char *pSample ) override { return false; }
	void PrefetchSound( const char *pSample ) override {  }
	float GetSoundDuration( const char *pSample ) override { return 0.0f; }
	void EmitSound( IRecipientFilter& filter, int iEntIndex, int iChannel, const char *pSample, float flVolume, float flAttenuation, int iFlags, int iPitch, int iSpecialDSP, const Vector *pOrigin, const Vector *pDirection, CUtlVector< Vector >* pUtlVecOrigins, bool bUpdatePositions, float soundtime, int speakerentity ) override {  }
	void EmitSound( IRecipientFilter& filter, int iEntIndex, int iChannel, const char *pSample, float flVolume, soundlevel_t iSoundlevel, int iFlags, int iPitch, int iSpecialDSP, const Vector *pOrigin, const Vector *pDirection, CUtlVector< Vector >* pUtlVecOrigins, bool bUpdatePositions, float soundtime, int speakerentity ) override {  }
	void EmitSentenceByIndex( IRecipientFilter& filter, int iEntIndex, int iChannel, int iSentenceIndex, float flVolume, soundlevel_t iSoundlevel, int iFlags, int iPitch, int iSpecialDSP, const Vector *pOrigin, const Vector *pDirection, CUtlVector< Vector >* pUtlVecOrigins, bool bUpdatePositions, float soundtime, int speakerentity ) override {  }
	void StopSound( int iEntIndex, int iChannel, const char *pSample ) override {  }
	void StopAllSounds( bool bClearBuffers ) override {  }
	void SetRoomType( IRecipientFilter& filter, int roomType ) override {  }
	void SetPlayerDSP( IRecipientFilter& filter, int dspType, bool fastReset ) override {  }
	void EmitAmbientSound( const char *pSample, float flVolume, int iPitch, int flags, float soundtime ) override {  }
	float GetDistGainFromSoundLevel( soundlevel_t soundlevel, float dist ) override { return 0.0f; }
	int GetGuidForLastSoundEmitted(  ) override { return int(); }
	bool IsSoundStillPlaying( int guid ) override { return false; }
	void StopSoundByGuid( int guid ) override {  }
	void SetVolumeByGuid( int guid, float fvol ) override {  }
	void GetActiveSounds( CUtlVector< SndInfo_t >& sndlist ) override {  }
	void PrecacheSentenceGroup( const char *pGroupName ) override {  }
	void NotifyBeginMoviePlayback(  ) override {  }
	void NotifyEndMoviePlayback(  ) override {  }
	IAudioOutputStream * CreateOutputStream( uint nSampleRate, uint nChannels, uint nBits ) override { return 0; }
	void DestroyOutputStream( IAudioOutputStream *pStream ) override {  }
	void ManualUpdate( const AudioState_t *pListenerState ) override {  }
	void ExtraUpdate(  ) override {  }
};
class CSimDefault_IVoiceServer : public IVoiceServer
{
public:
	bool GetClientListening( int iReceiver, int iSender ) override { return false; }
	bool SetClientListening( int iReceiver, int iSender, bool bListen ) override { return false; }
	bool SetClientProximity( int iReceiver, int iSender, bool bUseProximity ) override { return false; }
};
class CSimDefault_IUploadGameStats : public IUploadGameStats
{
public:
	bool UploadGameStats( char const *mapname, unsigned int blobversion, unsigned int blobsize, const void *pvBlobData ) override { return false; }
	void InitConnection( void ) override {  }
	void UpdateConnection( void ) override {  }
	bool IsGameStatsLoggingEnabled(  ) override { return false; }
	void GetPseudoUniqueId( char *buf, size_t bufsize ) override {  }
	bool IsCyberCafeUser( void ) override { return false; }
	bool IsHDREnabled( void ) override { return false; }
};
class CSimDefault_IScriptManager : public IScriptManager
{
public:
	bool Connect( CreateInterfaceFn factory ) override { return false; }
	void Disconnect(  ) override {  }
	void * QueryInterface( const char *pInterfaceName ) override { return 0; }
	InitReturnVal_t Init(  ) override { return InitReturnVal_t(); }
	void Shutdown(  ) override {  }
	IScriptVM * CreateVM( ScriptLanguage_t language ) override { return 0; }
	void DestroyVM( IScriptVM * ) override {  }
};
class CSimDefault_IServerEngineTools : public IServerEngineTools
{
public:
	void LevelInitPreEntityAllTools(  ) override {  }
	void LevelInitPostEntityAllTools(  ) override {  }
	void LevelShutdownPreEntityAllTools(  ) override {  }
	void LevelShutdownPostEntityAllTools(  ) override {  }
	void FrameUpdatePreEntityThinkAllTools(  ) override {  }
	void FrameUpdatePostEntityThinkAllTools(  ) override {  }
	void PreClientUpdateAllTools(  ) override {  }
	const char* GetEntityData( const char *pActualEntityData ) override { return 0; }
	void PreSetupVisibilityAllTools(  ) override {  }
	bool InToolMode(  ) override { return false; }
};
class CSimDefault_ILagCompensationManager : public ILagCompensationManager
{
public:
	void StartLagCompensation( CBasePlayer *player, CUserCmd *cmd ) override {  }
	void FinishLagCompensation( CBasePlayer *player ) override {  }
	bool IsCurrentlyDoingLagCompensation(  ) const override { return false; }
};
class CSimDefault_ITempEntsSystem : public ITempEntsSystem
{
public:
	void ArmorRicochet( IRecipientFilter& filer, float delay, const Vector* pos, const Vector* dir ) override {  }
	void BeamEntPoint( IRecipientFilter& filer, float delay, int nStartEntity, const Vector *start, int nEndEntity, const Vector* end, int modelindex, int haloindex, int startframe, int framerate, float life, float width, float endWidth, int fadeLength, float amplitude, int r, int g, int b, int a, int speed ) override {  }
	void BeamEnts( IRecipientFilter& filer, float delay, int start, int end, int modelindex, int haloindex, int startframe, int framerate, float life, float width, float endWidth, int fadeLength, float amplitude, int r, int g, int b, int a, int speed ) override {  }
	void BeamFollow( IRecipientFilter& filter, float delay, int iEntIndex, int modelIndex, int haloIndex, float life, float width, float endWidth, float fadeLength, float r, float g, float b, float a ) override {  }
	void BeamPoints( IRecipientFilter& filer, float delay, const Vector* start, const Vector* end, int modelindex, int haloindex, int startframe, int framerate, float life, float width, float endWidth, int fadeLength, float amplitude, int r, int g, int b, int a, int speed ) override {  }
	void BeamLaser( IRecipientFilter& filer, float delay, int start, int end, int modelindex, int haloindex, int startframe, int framerate, float life, float width, float endWidth, int fadeLength, float amplitude, int r, int g, int b, int a, int speed ) override {  }
	void BeamRing( IRecipientFilter& filer, float delay, int start, int end, int modelindex, int haloindex, int startframe, int framerate, float life, float width, int spread, float amplitude, int r, int g, int b, int a, int speed, int flags ) override {  }
	void BeamRingPoint( IRecipientFilter& filer, float delay, const Vector& center, float start_radius, float end_radius, int modelindex, int haloindex, int startframe, int framerate, float life, float width, int spread, float amplitude, int r, int g, int b, int a, int speed, int flags ) override {  }
	void BeamSpline( IRecipientFilter& filer, float delay, int points, Vector* rgPoints ) override {  }
	void BloodStream( IRecipientFilter& filer, float delay, const Vector* org, const Vector* dir, int r, int g, int b, int a, int amount ) override {  }
	void BloodSprite( IRecipientFilter& filer, float delay, const Vector* org, const Vector *dir, int r, int g, int b, int a, int size ) override {  }
	void BreakModel( IRecipientFilter& filer, float delay, const Vector& pos, const QAngle &angle, const Vector& size, const Vector& vel, int modelindex, int randomization, int count, float time, int flags ) override {  }
	void BSPDecal( IRecipientFilter& filer, float delay, const Vector* pos, int entity, int index ) override {  }
	void ProjectDecal( IRecipientFilter& filter, float delay, const Vector* pos, const QAngle *angles, float distance, int index ) override {  }
	void Bubbles( IRecipientFilter& filer, float delay, const Vector* mins, const Vector* maxs, float height, int modelindex, int count, float speed ) override {  }
	void BubbleTrail( IRecipientFilter& filer, float delay, const Vector* mins, const Vector* maxs, float height, int modelindex, int count, float speed ) override {  }
	void Decal( IRecipientFilter& filer, float delay, const Vector* pos, const Vector* start, int entity, int hitbox, int index ) override {  }
	void DynamicLight( IRecipientFilter& filer, float delay, const Vector* org, int r, int g, int b, int exponent, float radius, float time, float decay ) override {  }
	void Explosion( IRecipientFilter& filer, float delay, const Vector* pos, int modelindex, float scale, int framerate, int flags, int radius, int magnitude, const Vector* normal, unsigned char materialType ) override {  }
	void ShatterSurface( IRecipientFilter& filer, float delay, const Vector* pos, const QAngle* angle, const Vector* vForce, const Vector* vForcePos, float width, float height, float shardsize, ShatterSurface_t surfacetype, int front_r, int front_g, int front_b, int back_r, int back_g, int back_b ) override {  }
	void GlowSprite( IRecipientFilter& filer, float delay, const Vector* pos, int modelindex, float life, float size, int brightness ) override {  }
	void FootprintDecal( IRecipientFilter& filer, float delay, const Vector *origin, const Vector* right, int entity, int index, unsigned char materialType ) override {  }
	void Fizz( IRecipientFilter& filer, float delay, const CBaseEntity *ed, int modelindex, int density, int current ) override {  }
	void KillPlayerAttachments( IRecipientFilter& filer, float delay, int player ) override {  }
	void LargeFunnel( IRecipientFilter& filer, float delay, const Vector* pos, int modelindex, int reversed ) override {  }
	void MetalSparks( IRecipientFilter& filer, float delay, const Vector* pos, const Vector* dir ) override {  }
	void EnergySplash( IRecipientFilter& filer, float delay, const Vector* pos, const Vector* dir, bool bExplosive ) override {  }
	void PlayerDecal( IRecipientFilter& filer, float delay, const Vector* pos, int player, int entity ) override {  }
	void ShowLine( IRecipientFilter& filer, float delay, const Vector* start, const Vector* end ) override {  }
	void Smoke( IRecipientFilter& filer, float delay, const Vector* pos, int modelindex, float scale, int framerate ) override {  }
	void Sparks( IRecipientFilter& filer, float delay, const Vector* pos, int nMagnitude, int nTrailLength, const Vector *pDir ) override {  }
	void Sprite( IRecipientFilter& filer, float delay, const Vector* pos, int modelindex, float size, int brightness ) override {  }
	void SpriteSpray( IRecipientFilter& filer, float delay, const Vector* pos, const Vector* dir, int modelindex, int speed, float noise, int count ) override {  }
	void WorldDecal( IRecipientFilter& filer, float delay, const Vector* pos, int index ) override {  }
	void MuzzleFlash( IRecipientFilter& filer, float delay, const Vector &start, const QAngle &angles, float scale, int type ) override {  }
	void Dust( IRecipientFilter& filer, float delay, const Vector &pos, const Vector &dir, float size, float speed ) override {  }
	void GaussExplosion( IRecipientFilter& filer, float delay, const Vector &pos, const Vector &dir, int type ) override {  }
	void DispatchEffect( IRecipientFilter& filter, float delay, const Vector &pos, const char *pName, const CEffectData &data ) override {  }
	void PhysicsProp( IRecipientFilter& filter, float delay, int modelindex, int skin, const Vector& pos, const QAngle &angles, const Vector& vel, int flags, int effects ) override {  }
	void TriggerTempEntity( KeyValues *pKeyValues ) override {  }
	void ClientProjectile( IRecipientFilter& filter, float delay, const Vector* vecOrigin, const Vector* vecVelocity, int modelindex, int lifetime, CBaseEntity *pOwner ) override {  }
};
class CSimDefault_IResponseSystem : public IResponseSystem
{
public:
	bool FindBestResponse( const AI_CriteriaSet& set, AI_Response& response, IResponseFilter *pFilter ) override { return false; }
	void GetAllResponses( CUtlVector<AI_Response *> *pResponses ) override {  }
	void PrecacheResponses( bool bEnable ) override {  }
};
class CSimDefault_IVDebugOverlay : public IVDebugOverlay
{
public:
	void AddEntityTextOverlay( int ent_index, int line_offset, float duration, int r, int g, int b, int a, const char *format, ... ) override {  }
	void AddBoxOverlay( const Vector& origin, const Vector& mins, const Vector& max, QAngle const& orientation, int r, int g, int b, int a, float duration ) override {  }
	void AddTriangleOverlay( const Vector& p1, const Vector& p2, const Vector& p3, int r, int g, int b, int a, bool noDepthTest, float duration ) override {  }
	void AddLineOverlay( const Vector& origin, const Vector& dest, int r, int g, int b, bool noDepthTest, float duration ) override {  }
	void AddTextOverlay( const Vector& origin, float duration, const char *format, ... ) override {  }
	void AddTextOverlay( const Vector& origin, int line_offset, float duration, const char *format, ... ) override {  }
	void AddScreenTextOverlay( float flXPos, float flYPos, float flDuration, int r, int g, int b, int a, const char *text ) override {  }
	void AddSweptBoxOverlay( const Vector& start, const Vector& end, const Vector& mins, const Vector& max, const QAngle & angles, int r, int g, int b, int a, float flDuration ) override {  }
	void AddGridOverlay( const Vector& origin ) override {  }
	int ScreenPosition( const Vector& point, Vector& screen ) override { return int(); }
	int ScreenPosition( float flXPos, float flYPos, Vector& screen ) override { return int(); }
	OverlayText_t * GetFirst( void ) override { return 0; }
	OverlayText_t * GetNext( OverlayText_t *current ) override { return 0; }
	void ClearDeadOverlays( void ) override {  }
	void ClearAllOverlays(  ) override {  }
	void AddTextOverlayRGB( const Vector& origin, int line_offset, float duration, float r, float g, float b, float alpha, const char *format, ... ) override {  }
	void AddTextOverlayRGB( const Vector& origin, int line_offset, float duration, int r, int g, int b, int a, const char *format, ... ) override {  }
	void AddLineOverlayAlpha( const Vector& origin, const Vector& dest, int r, int g, int b, int a, bool noDepthTest, float duration ) override {  }
	void AddBoxOverlay2( const Vector& origin, const Vector& mins, const Vector& max, QAngle const& orientation, const Color& faceColor, const Color& edgeColor, float duration ) override {  }
	void AddScreenTextOverlay2( float flXPos, float flYPos, int iLine, float flDuration, int r, int g, int b, int a, const char *text ) override {  }
};
class CSimDefault_ISceneFileCache : public ISceneFileCache
{
public:
	bool Connect( CreateInterfaceFn factory ) override { return false; }
	void Disconnect(  ) override {  }
	void * QueryInterface( const char *pInterfaceName ) override { return 0; }
	InitReturnVal_t Init(  ) override { return InitReturnVal_t(); }
	void Shutdown(  ) override {  }
	size_t GetSceneBufferSize( char const *filename ) override { return size_t(); }
	bool GetSceneData( char const *filename, byte *buf, size_t bufsize ) override { return false; }
	bool GetSceneCachedData( char const *pFilename, SceneCachedData_t *pData ) override { return false; }
	short GetSceneCachedSound( int iScene, int iSound ) override { return short(); }
	const char * GetSceneString( short stringId ) override { return 0; }
	void Reload(  ) override {  }
};
class CSimDefault_IFileSystem : public IFileSystem
{
public:
	bool Connect( CreateInterfaceFn factory ) override { return false; }
	void Disconnect(  ) override {  }
	void * QueryInterface( const char *pInterfaceName ) override { return 0; }
	InitReturnVal_t Init(  ) override { return InitReturnVal_t(); }
	void Shutdown(  ) override {  }
	int Read( void* pOutput, int size, FileHandle_t file ) override { return int(); }
	int Write( void const* pInput, int size, FileHandle_t file ) override { return int(); }
	FileHandle_t Open( const char *pFileName, const char *pOptions, const char *pathID ) override { return FileHandle_t(); }
	void Close( FileHandle_t file ) override {  }
	void Seek( FileHandle_t file, int pos, FileSystemSeek_t seekType ) override {  }
	unsigned int Tell( FileHandle_t file ) override { return ( unsigned int )0; }
	unsigned int Size( FileHandle_t file ) override { return ( unsigned int )0; }
	unsigned int Size( const char *pFileName, const char *pPathID ) override { return ( unsigned int )0; }
	void Flush( FileHandle_t file ) override {  }
	bool Precache( const char *pFileName, const char *pPathID ) override { return false; }
	bool FileExists( const char *pFileName, const char *pPathID ) override { return false; }
	bool IsFileWritable( char const *pFileName, const char *pPathID ) override { return false; }
	bool SetFileWritable( char const *pFileName, bool writable, const char *pPathID ) override { return false; }
	long GetFileTime( const char *pFileName, const char *pPathID ) override { return long(); }
	bool ReadFile( const char *pFileName, const char *pPath, CUtlBuffer &buf, int nMaxBytes, int nStartingByte, FSAllocFunc_t pfnAlloc ) override { return false; }
	bool WriteFile( const char *pFileName, const char *pPath, CUtlBuffer &buf ) override { return false; }
	bool UnzipFile( const char *pFileName, const char *pPath, const char *pDestination ) override { return false; }
	bool IsSteam(  ) const override { return false; }
	FilesystemMountRetval_t MountSteamContent( int nExtraAppId ) override { return FilesystemMountRetval_t(); }
	void AddSearchPath( const char *pPath, const char *pathID, SearchPathAdd_t addType ) override {  }
	bool RemoveSearchPath( const char *pPath, const char *pathID ) override { return false; }
	void RemoveAllSearchPaths( void ) override {  }
	void RemoveSearchPaths( const char *szPathID ) override {  }
	void MarkPathIDByRequestOnly( const char *pPathID, bool bRequestOnly ) override {  }
	const char * RelativePathToFullPath( const char *pFileName, const char *pPathID, char *pDest, int maxLenInChars, PathTypeFilter_t pathFilter, PathTypeQuery_t *pPathType ) override { return 0; }
	int GetSearchPath( const char *pathID, bool bGetPackFiles, char *pDest, int maxLenInChars ) override { return int(); }
	bool AddPackFile( const char *fullpath, const char *pathID ) override { return false; }
	void RemoveFile( char const* pRelativePath, const char *pathID ) override {  }
	bool RenameFile( char const *pOldPath, char const *pNewPath, const char *pathID ) override { return false; }
	void CreateDirHierarchy( const char *path, const char *pathID ) override {  }
	bool IsDirectory( const char *pFileName, const char *pathID ) override { return false; }
	void FileTimeToString( char* pStrip, int maxCharsIncludingTerminator, long fileTime ) override {  }
	void SetBufferSize( FileHandle_t file, unsigned nBytes ) override {  }
	bool IsOk( FileHandle_t file ) override { return false; }
	bool EndOfFile( FileHandle_t file ) override { return false; }
	char * ReadLine( char *pOutput, int maxChars, FileHandle_t file ) override { return 0; }
	int FPrintf( FileHandle_t file, const char *pFormat, ... ) override { return int(); }
	CSysModule * LoadModule( const char *pFileName, const char *pPathID, bool bValidatedDllOnly ) override { return 0; }
	void UnloadModule( CSysModule *pModule ) override {  }
	const char * FindFirst( const char *pWildCard, FileFindHandle_t *pHandle ) override { return 0; }
	const char * FindNext( FileFindHandle_t handle ) override { return 0; }
	bool FindIsDirectory( FileFindHandle_t handle ) override { return false; }
	void FindClose( FileFindHandle_t handle ) override {  }
	const char * FindFirstEx( const char *pWildCard, const char *pPathID, FileFindHandle_t *pHandle ) override { return 0; }
	const char * GetLocalPath( const char *pFileName, char *pDest, int maxLenInChars ) override { return 0; }
	bool FullPathToRelativePath( const char *pFullpath, char *pDest, int maxLenInChars ) override { return false; }
	bool GetCurrentDirectory( char* pDirectory, int maxlen ) override { return false; }
	FileNameHandle_t FindOrAddFileName( char const *pFileName ) override { return FileNameHandle_t(); }
	bool String( const FileNameHandle_t& handle, char *buf, int buflen ) override { return false; }
	FSAsyncStatus_t AsyncReadMultiple( const FileAsyncRequest_t *pRequests, int nRequests, FSAsyncControl_t *phControls ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncAppend( const char *pFileName, const void *pSrc, int nSrcBytes, bool bFreeMemory, FSAsyncControl_t *pControl ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncAppendFile( const char *pAppendToFileName, const char *pAppendFromFileName, FSAsyncControl_t *pControl ) override { return FSAsyncStatus_t(); }
	void AsyncFinishAll( int iToPriority ) override {  }
	void AsyncFinishAllWrites(  ) override {  }
	FSAsyncStatus_t AsyncFlush(  ) override { return FSAsyncStatus_t(); }
	bool AsyncSuspend(  ) override { return false; }
	bool AsyncResume(  ) override { return false; }
	void AsyncAddFetcher( IAsyncFileFetch *pFetcher ) override {  }
	void AsyncRemoveFetcher( IAsyncFileFetch *pFetcher ) override {  }
	FSAsyncStatus_t AsyncBeginRead( const char *pszFile, FSAsyncFile_t *phFile ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncEndRead( FSAsyncFile_t hFile ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncFinish( FSAsyncControl_t hControl, bool wait ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncGetResult( FSAsyncControl_t hControl, void **ppData, int *pSize ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncAbort( FSAsyncControl_t hControl ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncStatus( FSAsyncControl_t hControl ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncSetPriority( FSAsyncControl_t hControl, int newPriority ) override { return FSAsyncStatus_t(); }
	void AsyncAddRef( FSAsyncControl_t hControl ) override {  }
	void AsyncRelease( FSAsyncControl_t hControl ) override {  }
	WaitForResourcesHandle_t WaitForResources( const char *resourcelist ) override { return WaitForResourcesHandle_t(); }
	bool GetWaitForResourcesProgress( WaitForResourcesHandle_t handle, float *progress, bool *complete ) override { return false; }
	void CancelWaitForResources( WaitForResourcesHandle_t handle ) override {  }
	int HintResourceNeed( const char *hintlist, int forgetEverything ) override { return int(); }
	bool IsFileImmediatelyAvailable( const char *pFileName ) override { return false; }
	void GetLocalCopy( const char *pFileName ) override {  }
	void PrintOpenedFiles( void ) override {  }
	void PrintSearchPaths( void ) override {  }
	void SetWarningFunc( void (*pfnWarning)( const char *fmt, ... ) ) override {  }
	void SetWarningLevel( FileWarningLevel_t level ) override {  }
	void AddLoggingFunc( void (*pfnLogFunc)( const char *fileName, const char *accessType ) ) override {  }
	void RemoveLoggingFunc( FileSystemLoggingFunc_t logFunc ) override {  }
	const FileSystemStatistics * GetFilesystemStatistics(  ) override { return 0; }
	FileHandle_t OpenEx( const char *pFileName, const char *pOptions, unsigned flags, const char *pathID, char **ppszResolvedFilename ) override { return FileHandle_t(); }
	int ReadEx( void* pOutput, int sizeDest, int size, FileHandle_t file ) override { return int(); }
	int ReadFileEx( const char *pFileName, const char *pPath, void **ppBuf, bool bNullTerminate, bool bOptimalAlloc, int nMaxBytes, int nStartingByte, FSAllocFunc_t pfnAlloc ) override { return int(); }
	FileNameHandle_t FindFileName( char const *pFileName ) override { return FileNameHandle_t(); }
	void SetupPreloadData(  ) override {  }
	void DiscardPreloadData(  ) override {  }
	void LoadCompiledKeyValues( KeyValuesPreloadType_t type, char const *archiveFile ) override {  }
	KeyValues * LoadKeyValues( KeyValuesPreloadType_t type, char const *filename, char const *pPathID ) override { return 0; }
	bool LoadKeyValues( KeyValues& head, KeyValuesPreloadType_t type, char const *filename, char const *pPathID ) override { return false; }
	bool ExtractRootKeyName( KeyValuesPreloadType_t type, char *outbuf, size_t bufsize, char const *filename, char const *pPathID ) override { return false; }
	FSAsyncStatus_t AsyncWrite( const char *pFileName, const void *pSrc, int nSrcBytes, bool bFreeMemory, bool bAppend, FSAsyncControl_t *pControl ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncWriteFile( const char *pFileName, const CUtlBuffer *pSrc, int nSrcBytes, bool bFreeMemory, bool bAppend, FSAsyncControl_t *pControl ) override { return FSAsyncStatus_t(); }
	FSAsyncStatus_t AsyncReadMultipleCreditAlloc( const FileAsyncRequest_t *pRequests, int nRequests, const char *pszFile, int line, FSAsyncControl_t *phControls ) override { return FSAsyncStatus_t(); }
	bool GetFileTypeForFullPath( char const *pFullPath, wchar_t *buf, size_t bufSizeInBytes ) override { return false; }
	bool ReadToBuffer( FileHandle_t hFile, CUtlBuffer &buf, int nMaxBytes, FSAllocFunc_t pfnAlloc ) override { return false; }
	bool GetOptimalIOConstraints( FileHandle_t hFile, unsigned *pOffsetAlign, unsigned *pSizeAlign, unsigned *pBufferAlign ) override { return false; }
	void * AllocOptimalReadBuffer( FileHandle_t hFile, unsigned nSize, unsigned nOffset ) override { return 0; }
	void FreeOptimalReadBuffer( void * ) override {  }
	void BeginMapAccess(  ) override {  }
	void EndMapAccess(  ) override {  }
	bool FullPathToRelativePathEx( const char *pFullpath, const char *pPathId, char *pDest, int maxLenInChars ) override { return false; }
	int GetPathIndex( const FileNameHandle_t &handle ) override { return int(); }
	long GetPathTime( const char *pPath, const char *pPathID ) override { return long(); }
	DVDMode_t GetDVDMode(  ) override { return DVDMode_t(); }
	void EnableWhitelistFileTracking( bool bEnable, bool bCacheAllVPKHashes, bool bRecalculateAndCheckHashes ) override {  }
	void RegisterFileWhitelist( IPureServerWhitelist *pWhiteList, IFileList **pFilesToReload ) override {  }
	void MarkAllCRCsUnverified(  ) override {  }
	void CacheFileCRCs( const char *pPathname, ECacheCRCType eType, IFileList *pFilter ) override {  }
	EFileCRCStatus CheckCachedFileHash( const char *pPathID, const char *pRelativeFilename, int nFileFraction, FileHash_t *pFileHash ) override { return EFileCRCStatus(); }
	int GetUnverifiedFileHashes( CUnverifiedFileHash *pFiles, int nMaxFiles ) override { return int(); }
	int GetWhitelistSpewFlags(  ) override { return int(); }
	void SetWhitelistSpewFlags( int flags ) override {  }
	void InstallDirtyDiskReportFunc( FSDirtyDiskReportFunc_t func ) override {  }
	FileCacheHandle_t CreateFileCache(  ) override { return FileCacheHandle_t(); }
	void AddFilesToFileCache( FileCacheHandle_t cacheId, const char **ppFileNames, int nFileNames, const char *pPathID ) override {  }
	bool IsFileCacheFileLoaded( FileCacheHandle_t cacheId, const char* pFileName ) override { return false; }
	bool IsFileCacheLoaded( FileCacheHandle_t cacheId ) override { return false; }
	void DestroyFileCache( FileCacheHandle_t cacheId ) override {  }
	bool RegisterMemoryFile( CMemoryFileBacking *pFile, CMemoryFileBacking **ppExistingFileWithRef ) override { return false; }
	void UnregisterMemoryFile( CMemoryFileBacking *pFile ) override {  }
	void CacheAllVPKFileHashes( bool bCacheAllVPKHashes, bool bRecalculateAndCheckHashes ) override {  }
	bool CheckVPKFileHash( int PackFileID, int nPackFileNumber, int nFileFraction, MD5Value_t &md5Value ) override { return false; }
	void NotifyFileUnloaded( const char *pszFilename, const char *pPathId ) override {  }
	bool GetCaseCorrectFullPath_Ptr( const char *pFullPath, char *pDest, int maxLenInChars ) override { return false; }
	void SetWriteProtectionEnable( bool bEnable ) override {  }
	bool GetWriteProtectionEnable(  ) const override { return false; }
};
class CSimDefault_IPhysicsCollision : public IPhysicsCollision
{
public:
	CPhysConvex * ConvexFromVerts( Vector **pVerts, int vertCount ) override { return 0; }
	CPhysConvex * ConvexFromPlanes( float *pPlanes, int planeCount, float mergeDistance ) override { return 0; }
	float ConvexVolume( CPhysConvex *pConvex ) override { return 0.0f; }
	float ConvexSurfaceArea( CPhysConvex *pConvex ) override { return 0.0f; }
	void SetConvexGameData( CPhysConvex *pConvex, unsigned int gameData ) override {  }
	void ConvexFree( CPhysConvex *pConvex ) override {  }
	CPhysConvex * BBoxToConvex( const Vector &mins, const Vector &maxs ) override { return 0; }
	CPhysConvex * ConvexFromConvexPolyhedron( const CPolyhedron &ConvexPolyhedron ) override { return 0; }
	void ConvexesFromConvexPolygon( const Vector &vPolyNormal, const Vector *pPoints, int iPointCount, CPhysConvex **pOutput ) override {  }
	CPhysPolysoup * PolysoupCreate( void ) override { return 0; }
	void PolysoupDestroy( CPhysPolysoup *pSoup ) override {  }
	void PolysoupAddTriangle( CPhysPolysoup *pSoup, const Vector &a, const Vector &b, const Vector &c, int materialIndex7bits ) override {  }
	CPhysCollide * ConvertPolysoupToCollide( CPhysPolysoup *pSoup, bool useMOPP ) override { return 0; }
	CPhysCollide * ConvertConvexToCollide( CPhysConvex **pConvex, int convexCount ) override { return 0; }
	CPhysCollide * ConvertConvexToCollideParams( CPhysConvex **pConvex, int convexCount, const convertconvexparams_t &convertParams ) override { return 0; }
	void DestroyCollide( CPhysCollide *pCollide ) override {  }
	int CollideSize( CPhysCollide *pCollide ) override { return int(); }
	int CollideWrite( char *pDest, CPhysCollide *pCollide, bool bSwap ) override { return int(); }
	CPhysCollide * UnserializeCollide( char *pBuffer, int size, int index ) override { return 0; }
	float CollideVolume( CPhysCollide *pCollide ) override { return 0.0f; }
	float CollideSurfaceArea( CPhysCollide *pCollide ) override { return 0.0f; }
	Vector CollideGetExtent( const CPhysCollide *pCollide, const Vector &collideOrigin, const QAngle &collideAngles, const Vector &direction ) override { return Vector(); }
	void CollideGetAABB( Vector *pMins, Vector *pMaxs, const CPhysCollide *pCollide, const Vector &collideOrigin, const QAngle &collideAngles ) override {  }
	void CollideGetMassCenter( CPhysCollide *pCollide, Vector *pOutMassCenter ) override {  }
	void CollideSetMassCenter( CPhysCollide *pCollide, const Vector &massCenter ) override {  }
	Vector CollideGetOrthographicAreas( const CPhysCollide *pCollide ) override { return Vector(); }
	void CollideSetOrthographicAreas( CPhysCollide *pCollide, const Vector &areas ) override {  }
	int CollideIndex( const CPhysCollide *pCollide ) override { return int(); }
	CPhysCollide * BBoxToCollide( const Vector &mins, const Vector &maxs ) override { return 0; }
	int GetConvexesUsedInCollideable( const CPhysCollide *pCollideable, CPhysConvex **pOutputArray, int iOutputArrayLimit ) override { return int(); }
	void TraceBox( const Vector &start, const Vector &end, const Vector &mins, const Vector &maxs, const CPhysCollide *pCollide, const Vector &collideOrigin, const QAngle &collideAngles, trace_t *ptr ) override {  }
	void TraceBox( const Ray_t &ray, const CPhysCollide *pCollide, const Vector &collideOrigin, const QAngle &collideAngles, trace_t *ptr ) override {  }
	void TraceBox( const Ray_t &ray, unsigned int contentsMask, IConvexInfo *pConvexInfo, const CPhysCollide *pCollide, const Vector &collideOrigin, const QAngle &collideAngles, trace_t *ptr ) override {  }
	void TraceCollide( const Vector &start, const Vector &end, const CPhysCollide *pSweepCollide, const QAngle &sweepAngles, const CPhysCollide *pCollide, const Vector &collideOrigin, const QAngle &collideAngles, trace_t *ptr ) override {  }
	bool IsBoxIntersectingCone( const Vector &boxAbsMins, const Vector &boxAbsMaxs, const truncatedcone_t &cone ) override { return false; }
	void VCollideLoad( vcollide_t *pOutput, int solidCount, const char *pBuffer, int size, bool swap ) override {  }
	void VCollideUnload( vcollide_t *pVCollide ) override {  }
	IVPhysicsKeyParser * VPhysicsKeyParserCreate( const char *pKeyData ) override { return 0; }
	void VPhysicsKeyParserDestroy( IVPhysicsKeyParser *pParser ) override {  }
	int CreateDebugMesh( CPhysCollide const *pCollisionModel, Vector **outVerts ) override { return int(); }
	void DestroyDebugMesh( int vertCount, Vector *outVerts ) override {  }
	ICollisionQuery * CreateQueryModel( CPhysCollide *pCollide ) override { return 0; }
	void DestroyQueryModel( ICollisionQuery *pQuery ) override {  }
	IPhysicsCollision * ThreadContextCreate( void ) override { return 0; }
	void ThreadContextDestroy( IPhysicsCollision *pThreadContex ) override {  }
	CPhysCollide * CreateVirtualMesh( const virtualmeshparams_t &params ) override { return 0; }
	bool SupportsVirtualMesh(  ) override { return false; }
	bool GetBBoxCacheSize( int *pCachedSize, int *pCachedCount ) override { return false; }
	CPolyhedron * PolyhedronFromConvex( CPhysConvex * const pConvex, bool bUseTempPolyhedron ) override { return 0; }
	void OutputDebugInfo( const CPhysCollide *pCollide ) override {  }
	unsigned int ReadStat( int statID ) override { return ( unsigned int )0; }
};
class CSimDefault_IPhysicsSurfaceProps : public IPhysicsSurfaceProps
{
public:
	int ParseSurfaceData( const char *pFilename, const char *pTextfile ) override { return int(); }
	int SurfacePropCount( void ) const override { return int(); }
	int GetSurfaceIndex( const char *pSurfacePropName ) const override { return int(); }
	void GetPhysicsProperties( int surfaceDataIndex, float *density, float *thickness, float *friction, float *elasticity ) const override {  }
	surfacedata_t * GetSurfaceData( int surfaceDataIndex ) override { return 0; }
	const char * GetString( unsigned short stringTableIndex ) const override { return 0; }
	const char * GetPropName( int surfaceDataIndex ) const override { return 0; }
	void SetWorldMaterialIndexTable( int *pMapArray, int mapSize ) override {  }
	void GetPhysicsParameters( int surfaceDataIndex, surfacephysicsparams_t *pParamsOut ) const override {  }
};
class CSimDefault_IPhysicsEnvironment : public IPhysicsEnvironment
{
public:
	void SetDebugOverlay( CreateInterfaceFn debugOverlayFactory ) override {  }
	IVPhysicsDebugOverlay * GetDebugOverlay( void ) override { return 0; }
	void SetGravity( const Vector &gravityVector ) override {  }
	void GetGravity( Vector *pGravityVector ) const override {  }
	void SetAirDensity( float density ) override {  }
	float GetAirDensity( void ) const override { return 0.0f; }
	IPhysicsObject * CreatePolyObject( const CPhysCollide *pCollisionModel, int materialIndex, const Vector &position, const QAngle &angles, objectparams_t *pParams ) override { return 0; }
	IPhysicsObject * CreatePolyObjectStatic( const CPhysCollide *pCollisionModel, int materialIndex, const Vector &position, const QAngle &angles, objectparams_t *pParams ) override { return 0; }
	IPhysicsObject * CreateSphereObject( float radius, int materialIndex, const Vector &position, const QAngle &angles, objectparams_t *pParams, bool isStatic ) override { return 0; }
	void DestroyObject( IPhysicsObject * ) override {  }
	IPhysicsFluidController * CreateFluidController( IPhysicsObject *pFluidObject, fluidparams_t *pParams ) override { return 0; }
	void DestroyFluidController( IPhysicsFluidController * ) override {  }
	IPhysicsSpring * CreateSpring( IPhysicsObject *pObjectStart, IPhysicsObject *pObjectEnd, springparams_t *pParams ) override { return 0; }
	void DestroySpring( IPhysicsSpring * ) override {  }
	IPhysicsConstraint * CreateRagdollConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_ragdollparams_t &ragdoll ) override { return 0; }
	IPhysicsConstraint * CreateHingeConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_hingeparams_t &hinge ) override { return 0; }
	IPhysicsConstraint * CreateFixedConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_fixedparams_t &fixed ) override { return 0; }
	IPhysicsConstraint * CreateSlidingConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_slidingparams_t &sliding ) override { return 0; }
	IPhysicsConstraint * CreateBallsocketConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_ballsocketparams_t &ballsocket ) override { return 0; }
	IPhysicsConstraint * CreatePulleyConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_pulleyparams_t &pulley ) override { return 0; }
	IPhysicsConstraint * CreateLengthConstraint( IPhysicsObject *pReferenceObject, IPhysicsObject *pAttachedObject, IPhysicsConstraintGroup *pGroup, const constraint_lengthparams_t &length ) override { return 0; }
	void DestroyConstraint( IPhysicsConstraint * ) override {  }
	IPhysicsConstraintGroup * CreateConstraintGroup( const constraint_groupparams_t &groupParams ) override { return 0; }
	void DestroyConstraintGroup( IPhysicsConstraintGroup *pGroup ) override {  }
	IPhysicsShadowController * CreateShadowController( IPhysicsObject *pObject, bool allowTranslation, bool allowRotation ) override { return 0; }
	void DestroyShadowController( IPhysicsShadowController * ) override {  }
	IPhysicsPlayerController * CreatePlayerController( IPhysicsObject *pObject ) override { return 0; }
	void DestroyPlayerController( IPhysicsPlayerController * ) override {  }
	IPhysicsMotionController * CreateMotionController( IMotionEvent *pHandler ) override { return 0; }
	void DestroyMotionController( IPhysicsMotionController *pController ) override {  }
	IPhysicsVehicleController * CreateVehicleController( IPhysicsObject *pVehicleBodyObject, const vehicleparams_t &params, unsigned int nVehicleType, IPhysicsGameTrace *pGameTrace ) override { return 0; }
	void DestroyVehicleController( IPhysicsVehicleController * ) override {  }
	void SetCollisionSolver( IPhysicsCollisionSolver *pSolver ) override {  }
	void Simulate( float deltaTime ) override {  }
	bool IsInSimulation(  ) const override { return false; }
	float GetSimulationTimestep(  ) const override { return 0.0f; }
	void SetSimulationTimestep( float timestep ) override {  }
	float GetSimulationTime(  ) const override { return 0.0f; }
	void ResetSimulationClock(  ) override {  }
	float GetNextFrameTime( void ) const override { return 0.0f; }
	void SetCollisionEventHandler( IPhysicsCollisionEvent *pCollisionEvents ) override {  }
	void SetObjectEventHandler( IPhysicsObjectEvent *pObjectEvents ) override {  }
	void SetConstraintEventHandler( IPhysicsConstraintEvent *pConstraintEvents ) override {  }
	void SetQuickDelete( bool bQuick ) override {  }
	int GetActiveObjectCount(  ) const override { return int(); }
	void GetActiveObjects( IPhysicsObject **pOutputObjectList ) const override {  }
	const IPhysicsObject * * GetObjectList( int *pOutputObjectCount ) const override { return 0; }
	bool TransferObject( IPhysicsObject *pObject, IPhysicsEnvironment *pDestinationEnvironment ) override { return false; }
	void CleanupDeleteList( void ) override {  }
	void EnableDeleteQueue( bool enable ) override {  }
	bool Save( const physsaveparams_t &params ) override { return false; }
	void PreRestore( const physprerestoreparams_t &params ) override {  }
	bool Restore( const physrestoreparams_t &params ) override { return false; }
	void PostRestore(  ) override {  }
	bool IsCollisionModelUsed( CPhysCollide *pCollide ) const override { return false; }
	void TraceRay( const Ray_t &ray, unsigned int fMask, IPhysicsTraceFilter *pTraceFilter, trace_t *pTrace ) override {  }
	void SweepCollideable( const CPhysCollide *pCollide, const Vector &vecAbsStart, const Vector &vecAbsEnd, const QAngle &vecAngles, unsigned int fMask, IPhysicsTraceFilter *pTraceFilter, trace_t *pTrace ) override {  }
	void GetPerformanceSettings( physics_performanceparams_t *pOutput ) const override {  }
	void SetPerformanceSettings( const physics_performanceparams_t *pSettings ) override {  }
	void ReadStats( physics_stats_t *pOutput ) override {  }
	void ClearStats(  ) override {  }
	unsigned int GetObjectSerializeSize( IPhysicsObject *pObject ) const override { return ( unsigned int )0; }
	void SerializeObjectToBuffer( IPhysicsObject *pObject, unsigned char *pBuffer, unsigned int bufferSize ) override {  }
	IPhysicsObject * UnserializeObjectFromBuffer( void *pGameData, unsigned char *pBuffer, unsigned int bufferSize, bool enableCollisions ) override { return 0; }
	void EnableConstraintNotify( bool bEnable ) override {  }
	void DebugCheckContacts( void ) override {  }
};

#endif
