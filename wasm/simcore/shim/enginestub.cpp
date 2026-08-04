#include "cbase.h"
#include "engine/IVDebugOverlay.h"
#include "vphysics_interface.h"
#include "vscript/ivscript.h"
#include "basecombatcharacter.h"

#include "igameevents.h"
#include "gamerules.h"

bool PhysIsInCallback()
{
	return false;
}

void PhysCallbackDamage( CBaseEntity *pEntity, const CTakeDamageInfo &info )
{
}

bool ScriptHookEnabled( const char *pszHook )
{
	return false;
}

#include "baseanimating.h"
#include "player.h"


void DispatchEffect( const char *pName, const CEffectData &data )
{
}

bool RunScriptHook( const char *pszHookName, HSCRIPT params )
{
	return false;
}

#include "datacache/imdlcache.h"
#include "SoundEmitterSystem/isoundemittersystembase.h"

IMDLCache *mdlcache = NULL;

bool PhysIsFinalTick()
{
	return true;
}

void PhysCollisionSound( CBaseEntity *pEntity, IPhysicsObject *pPhysObject, int channel, int surfaceProps, int surfacePropsHit, float deltaTime, float speed )
{
}

void PhysCollisionScreenShake( gamevcollisionevent_t *pEvent, int index )
{
}

void PhysCollisionDust( gamevcollisionevent_t *pEvent, surfacedata_t *phit )
{
}

#include "vscript_server.h"
#include "vscript_shared.h"

bool CBaseEntityScriptInstanceHelper::ToString( void *p, char *pBuf, int bufSize )
{
	return false;
}

void *CBaseEntityScriptInstanceHelper::BindOnRead( HSCRIPT hInstance, void *pOld, const char *pszId )
{
	return NULL;
}

CBaseEntityScriptInstanceHelper g_BaseEntityScriptInstanceHelper;

CScriptKeyValues::CScriptKeyValues( KeyValues *pKeyValues )
	: m_pKeyValues( pKeyValues )
{
}

template <> ScriptClassDesc_t *GetScriptDesc<CScriptKeyValues>( CScriptKeyValues * )
{
	return NULL;
}

bool VScriptRunScript( const char *pszScriptName, HSCRIPT hScope, bool bWarnMissing )
{
	return false;
}

#include "team.h"
#include "filesystem.h"
#include "engine/IEngineTrace.h"

IFileSystem *g_pFullFileSystem = NULL;

CBaseEntity *GetNextCommandEntity( CBasePlayer *pPlayer, const char *name, CBaseEntity *ent )
{
	return NULL;
}

void SetDebugBits( CBasePlayer *pPlayer, const char *name, int bit )
{
}

#include "engine/IEngineSound.h"


void ClientActive( edict_t *pEdict, bool bLoadGame )
{
}

void ClientPutInServer( edict_t *pEdict, const char *playername )
{
}

void PhysOnCleanupDeleteList()
{
}

#include "gameinterface.h"


#include "locksounds.h"
#include "ai_basenpc.h"
#include "ai_squad.h"
#include "isaverestore.h"
#include "physics_prop_ragdoll.h"

IPhysicsObject *FindPhysicsObjectByName( const char *pName, CBaseEntity *pErrorEntity )
{
	return NULL;
}

IPhysicsObject *EntityPhysics_CreateSolver( CBaseEntity *pMovingEntity, CBaseEntity *pPhysicsBlocker, bool disableCollisions, float separationDuration )
{
	return NULL;
}

#include "ilagcompensationmanager.h"

ILagCompensationManager *lagcompensation = NULL;

bool PhysGetTriggerEvent( triggerevent_t *pEvent, CBaseEntity *pTriggerEntity )
{
	return false;
}

#include "toolframework/itoolentity.h"
#include "RagdollBoogie.h"


void PhysCallbackRemove( IServerNetworkable *pRemove )
{
	UTIL_Remove( pRemove );
}

namespace NWCEdit
{
	void RememberEntityPosition( CBaseEntity *pEntity )
	{
	}
}



#include "te.h"
#include "tier0/vcrmode.h"

ITempEntsSystem *te = NULL;
VCR_t *g_pVCR = NULL;

#include "ammodef.h"
#include "soundent.h"

CAmmoDef *GetAmmoDef()
{
	static CAmmoDef def;
	return &def;
}

void Pickup_ForcePlayerToDropThisObject( CBaseEntity *pTarget )
{
}

void PhysRemoveShadow( CBaseEntity *pEntity )
{
}

#include "engine/IStaticPropMgr.h"

#include "gamerules_register.h"
#include "voice_gamemgr.h"

class CSimVoiceGameMgrHelper : public IVoiceGameMgrHelper
{
public:
	bool CanPlayerHearPlayer( CBasePlayer *pListener, CBasePlayer *pTalker, bool &bProximity ) override
	{
		return false;
	}
};

static CSimVoiceGameMgrHelper s_VoiceGameMgrHelper;
IVoiceGameMgrHelper *g_pVoiceGameMgrHelper = &s_VoiceGameMgrHelper;

void InstallGameRules()
{
	CreateGameRulesObject( "CTeamplayRules" );
}

#include "ai_initutils.h"
#include "ai_schedule.h"
#include "ai_networkmanager.h"
#include "basetempentity.h"
#include "precache_register.h"

IPredictionSystem *IPredictionSystem::g_pPredictionSystems = NULL;
void ClientPrecache()
{
}

void InitBodyQue()
{
}

void PrecacheStandardParticleSystems()
{
}


#include "vstdlib/jobthread.h"
#include "scripted.h"

IThreadPool *g_pThreadPool = NULL;

void SelectDeathPoseActivityAndFrame( CBaseAnimating *pAnim, const CTakeDamageInfo &info, int hitgroup, Activity &activity, int &frame )
{
	activity = ACT_INVALID;
	frame = 0;
}


bool IsInCommentaryMode( void )
{
	return false;
}

float PhysGetEntityMass( CBaseEntity *pEntity )
{
	return 0.0f;
}

IPhysicsObject *NPCPhysics_CreateSolver( CAI_BaseNPC *pNPC, CBaseEntity *pPhysicsObject, bool disableCollisions, float separationDuration )
{
	return NULL;
}

#include "vphysics/object_hash.h"


#include "scenefilecache/ISceneFileCache.h"


#include "networkstringtabledefs.h"


ConVar rr_debugresponses( "rr_debugresponses", "0", FCVAR_NONE );

void PhysBreakSound( CBaseEntity *pEntity, IPhysicsObject *pPhysics, Vector vecOrigin )
{
}

void PhysCallbackImpulse( IPhysicsObject *pPhysicsObject, const Vector &vecCenterForce, const AngularImpulse &vecCenterTorque )
{
}

#include "soundenvelope.h"
#include "physics_shared.h"


bool PhysFindOrAddVehicleScript( const char *pScriptName, vehicleparams_t *pVehicle, vehiclesounds_t *pSounds )
{
	return false;
}

void PhysFlushVehicleScripts()
{
}

IPhysicsMotionController *CreateKeepUpright( const Vector &up, const QAngle &localTestAxis, CBaseEntity *pOwner, float angularLimit, bool bApplyForce )
{
	return NULL;
}

Vector Pickup_DefaultPhysGunLaunchVelocity( const Vector &vecForward, float flMass )
{
	return vecForward;
}

#include "tier1/callqueue.h"
#include "physics_prop_ragdoll.h"
#include "env_player_surface_trigger.h"
#include "explode.h"

CCallQueue g_PostSimulationQueue;

void PhysCallbackDamage( CBaseEntity *pEntity, const CTakeDamageInfo &info, gamevcollisionevent_t &event, int hurtIndex )
{
}

void PhysEnableFloating( IPhysicsObject *pObject, bool bEnable )
{
}


void PhysGetMassCenterOverride( CBaseEntity *pEntity, vcollide_t *pCollide, solid_t &solidOut )
{
}

void PhysSolidOverride( solid_t &solid, string_t overrideScript )
{
}

void CEnvPlayerSurfaceTrigger::SetPlayerSurface( CBasePlayer *pPlayer, char gameMaterial )
{
}


void ExplosionCreate( const Vector &center, const QAngle &angles, CBaseEntity *pOwner, int magnitude, int radius, bool doDamage, float flExplosionForce, bool bSurfaceOnly, bool bSilent, int explosionType )
{
}

void ExplosionCreate( const Vector &center, const QAngle &angles, CBaseEntity *pOwner, int magnitude, int radius, int nSpawnFlags, float flExplosionForce, CBaseEntity *pInflictor, int iCustomDamageType, const EHANDLE *ignoredEntity, Class_T ignoredClass )
{
}

IResponseSystem *g_pResponseSystem = NULL;

void FireSystem_AddHeatInRadius( const Vector &vecSrc, float flRadius, float flHeat )
{
}

void PhysSetMassCenterOverride( masscenteroverride_t &override )
{
}

void PhysFrictionSound( CBaseEntity *pEntity, IPhysicsObject *pObject, const char *pSoundName, HSOUNDSCRIPTHANDLE &handle, float flVolume )
{
}


#include "weapon_parse.h"

FileWeaponInfo_t *CreateWeaponInfo()
{
	return new FileWeaponInfo_t;
}

#include "GameStats.h"
#include "particles/particles.h"
#include "init_factory.h"

CParticleSystemMgr *g_pParticleSystemMgr = NULL;

void GameStartFrame( void )
{
}

void ResetWindspeed( void )
{
}

const char *GetGameDescription()
{
	return "Team Fortress";
}

void DisconnectTier2Libraries()
{
}

void DisconnectTier3Libraries()
{
}

void ParseParticleEffects( bool bLoadSheets, bool bPrecache )
{
}

void ParseParticleEffectsMap( const char *pMapName, bool bLoadSheets )
{
}

void ClientCommand( CBasePlayer *pPlayer, const CCommand &args )
{
}
static ConVar s_SimCheats( "sv_cheats", "0", FCVAR_NOTIFY | FCVAR_REPLICATED );
ConVar *sv_cheats = &s_SimCheats;

IGameSystem *GameLogSystem()
{
	return NULL;
}

IGameSystem *PhysicsGameSystem()
{
	return NULL;
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

extern "C" int SteamAPI_GetHSteamUser()
{
	return 0;
}

extern "C" int SteamGameServer_GetHSteamUser()
{
	return 0;
}

extern "C" void *SteamInternal_FindOrCreateGameServerInterface( int hSteamUser, const char *pszVersion )
{
	return NULL;
}

class CSimParticleSystemMgr : public CParticleSystemMgr {};

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

void FactoryList_Store( const factorylist_t &sourceData )
{
}

void FactoryList_Retrieve( factorylist_t &destData )
{
}

void RegisterUserMessages()
{
}

void DrawMessageEntities()
{
}

ISaveRestoreBlockHandler *GetAchievementSaveRestoreBlockHandler()
{
	return NULL;
}

ISaveRestoreBlockHandler *GetCommentarySaveRestoreBlockHandler()
{
	return NULL;
}

ISaveRestoreBlockHandler *GetDefaultResponseSystemSaveRestoreBlockHandler()
{
	return NULL;
}


HSCRIPT ScriptCreateEntityFromTable( const char *pszClassname, HSCRIPT hKV )
{
	return NULL;
}

IScriptVM *g_pScriptVM = NULL;

void PhysCleanupFrictionSounds( CBaseEntity *pEntity )
{
}

void DebugDrawContactPoints( IPhysicsObject *pPhysics )
{
}

