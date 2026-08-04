#include "cbase.h"
#include "mapentities.h"
#include "eventqueue.h"
#include "entitylist.h"
#include "edict.h"
#include "igamesystem.h"
#include "gameinterface.h"
#include "pathtrack.h"
#include "vstdlib/random.h"
#include "nav_mesh.h"
#include "player_vs_environment/tf_population_manager.h"
#include "player_vs_environment/tf_populators.h"
#include "tf_gamerules.h"
#include "bot/tf_bot.h"
#include "NextBot/Player/NextBotPlayer.h"
#include "NextBot/NextBotManager.h"
#include "tf_classdata.h"
#include "tf_objective_resource.h"
#include "player_vs_environment/tf_mann_vs_machine_logic.h"

#include <emscripten/emscripten.h>
#include <stdlib.h>
#include <string.h>

extern CGlobalVars *gpGlobals;
extern void Physics_RunThinkFunctions( bool simulating );
extern void SimEngine_Init( int nMaxEdicts, int nMaxClients );
extern void SimEngine_SetMapEntitiesString( const char *pLump );
extern edict_t *SimEngine_EdictList();
extern int SimEngine_EdictCount();
extern CServerGameDLL g_ServerGameDLL;

int SimEngine_LoadCollision( const uint8_t *planes, int planesLen,
	const uint8_t *nodes, int nodesLen,
	const uint8_t *leafs, int leafsLen, int leafSize,
	const uint8_t *leafBrushes, int leafBrushesLen,
	const uint8_t *brushes, int brushesLen,
	const uint8_t *brushSides, int brushSidesLen,
	const uint8_t *models, int modelsLen,
	const char *pMapName );
int SimEngine_LoadDisplacements( const uint8_t *dispInfo, int dispInfoLen,
	const uint8_t *dispVerts, int dispVertsLen,
	const uint8_t *dispTris, int dispTrisLen,
	const uint8_t *faces, int facesLen,
	const uint8_t *surfEdges, int surfEdgesLen,
	const uint8_t *edges, int edgesLen,
	const uint8_t *verts, int vertsLen );
int SimEngine_LoadSurfaces( const uint8_t *texInfo, int texInfoLen,
	const uint8_t *texData, int texDataLen,
	const uint8_t *stringTable, int stringTableLen,
	const uint8_t *stringData, int stringDataLen );
bool SimEngine_HasCollision();
int SimEngine_UntracedVPhysicsCount();
int SimEngine_FSAddFile( const char *pPath, const char *pPathID, const unsigned char *pData, int nSize );
void SimEngine_FSReset();
int SimEngine_FSFileCount();
bool SimEngine_FSFileExists( const char *pPath );

static const int SIM_FIRST_TICK = 1;

static CGlobalVars s_SimGlobals( false );
static bool s_bInitialized = false;
static char *s_pEntityLump = NULL;
static char s_szLastTraceSurface[ 128 ] = "";

static CUtlVector< CBaseEntity * > s_EntityIndex;
static bool s_bIndexValid = false;
static bool s_bFullFrame = false;

static void SimInvalidateIndex()
{
	s_bIndexValid = false;
}

static void SimRebuildIndex()
{
	if ( s_bIndexValid )
		return;
	s_EntityIndex.RemoveAll();
	for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
		s_EntityIndex.AddToTail( pEnt );
	s_bIndexValid = true;
}

static CBaseEntity *SimEntityByIndex( int index )
{
	SimRebuildIndex();
	if ( index < 0 || index >= s_EntityIndex.Count() )
		return NULL;
	return s_EntityIndex[ index ];
}

static int SimEntityCount()
{
	SimRebuildIndex();
	return s_EntityIndex.Count();
}

static void SimLevelInit()
{
	g_ServerGameDLL.LevelInit( STRING( gpGlobals->mapname ), s_pEntityLump, NULL, NULL, false, false );
	g_ServerGameDLL.ServerActivate( SimEngine_EdictList(), SimEngine_EdictCount(), gpGlobals->maxClients );
	SimInvalidateIndex();
}

extern "C" {

EMSCRIPTEN_KEEPALIVE void *sim_ents_alloc( int size )
{
	return malloc( size );
}

EMSCRIPTEN_KEEPALIVE void sim_ents_free( void *p )
{
	free( p );
}

EMSCRIPTEN_KEEPALIVE int sim_ents_init( float tickInterval )
{
	if ( s_bInitialized )
		return 1;

	SimEngine_Init( MAX_EDICTS, MAX_PLAYERS );

	gpGlobals = &s_SimGlobals;
	gpGlobals->interval_per_tick = tickInterval;
	gpGlobals->frametime = tickInterval;
	gpGlobals->tickcount = SIM_FIRST_TICK;
	gpGlobals->curtime = SIM_FIRST_TICK * tickInterval;
	gpGlobals->maxClients = MAX_PLAYERS;
	gpGlobals->maxEntities = MAX_EDICTS;

	g_ServerGameDLL.CreateNetworkStringTables();

	s_bInitialized = true;
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_load_lump( const char *pLump, int length )
{
	if ( !s_bInitialized || !pLump || length <= 0 )
		return 0;

	free( s_pEntityLump );
	s_pEntityLump = (char *)malloc( length + 1 );
	memcpy( s_pEntityLump, pLump, length );
	s_pEntityLump[ length ] = 0;
	SimEngine_SetMapEntitiesString( s_pEntityLump );

	SimInvalidateIndex();
	SimLevelInit();

	return SimEntityCount();
}

EMSCRIPTEN_KEEPALIVE int sim_ents_count()
{
	return SimEntityCount();
}

EMSCRIPTEN_KEEPALIVE int sim_ents_reset()
{
	if ( !s_bInitialized || !s_pEntityLump )
		return 0;

	g_EventQueue.Clear();
	g_ServerGameDLL.LevelShutdown();
	SimInvalidateIndex();

	gpGlobals->tickcount = SIM_FIRST_TICK;
	gpGlobals->curtime = SIM_FIRST_TICK * gpGlobals->interval_per_tick;

	SimLevelInit();

	return SimEntityCount();
}

EMSCRIPTEN_KEEPALIVE int sim_ents_load_bsp( const uint8_t *planes, int planesLen,
	const uint8_t *nodes, int nodesLen,
	const uint8_t *leafs, int leafsLen, int leafSize,
	const uint8_t *leafBrushes, int leafBrushesLen,
	const uint8_t *brushes, int brushesLen,
	const uint8_t *brushSides, int brushSidesLen,
	const uint8_t *models, int modelsLen,
	const char *pMapName )
{
	if ( !s_bInitialized || s_pEntityLump )
		return 0;

	if ( pMapName && pMapName[ 0 ] )
		gpGlobals->mapname = AllocPooledString( pMapName );

	return SimEngine_LoadCollision( planes, planesLen, nodes, nodesLen, leafs, leafsLen,
		leafSize, leafBrushes, leafBrushesLen, brushes, brushesLen, brushSides,
		brushSidesLen, models, modelsLen, pMapName );
}

EMSCRIPTEN_KEEPALIVE int sim_ents_load_disp( const uint8_t *dispInfo, int dispInfoLen,
	const uint8_t *dispVerts, int dispVertsLen,
	const uint8_t *dispTris, int dispTrisLen,
	const uint8_t *faces, int facesLen,
	const uint8_t *surfEdges, int surfEdgesLen,
	const uint8_t *edges, int edgesLen,
	const uint8_t *verts, int vertsLen )
{
	if ( !s_bInitialized )
		return 0;

	return SimEngine_LoadDisplacements( dispInfo, dispInfoLen, dispVerts, dispVertsLen,
		dispTris, dispTrisLen, faces, facesLen, surfEdges, surfEdgesLen, edges, edgesLen,
		verts, vertsLen );
}

EMSCRIPTEN_KEEPALIVE int sim_ents_load_surfaces( const uint8_t *texInfo, int texInfoLen,
	const uint8_t *texData, int texDataLen,
	const uint8_t *stringTable, int stringTableLen,
	const uint8_t *stringData, int stringDataLen )
{
	if ( !s_bInitialized )
		return 0;

	return SimEngine_LoadSurfaces( texInfo, texInfoLen, texData, texDataLen,
		stringTable, stringTableLen, stringData, stringDataLen );
}

EMSCRIPTEN_KEEPALIVE const char *sim_ents_trace_surface()
{
	return s_szLastTraceSurface;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_has_collision()
{
	return SimEngine_HasCollision() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_untraced_vphysics()
{
	return SimEngine_UntracedVPhysicsCount();
}

EMSCRIPTEN_KEEPALIVE float sim_ents_trace( float sx, float sy, float sz,
	float ex, float ey, float ez,
	float minx, float miny, float minz,
	float maxx, float maxy, float maxz,
	int mask, int entities, float *pOut, int *pOutInt )
{
	if ( !s_bInitialized )
		return 1.0f;

	Ray_t ray;
	Vector vecStart( sx, sy, sz );
	Vector vecEnd( ex, ey, ez );
	Vector vecMins( minx, miny, minz );
	Vector vecMaxs( maxx, maxy, maxz );

	if ( vecMins == vec3_origin && vecMaxs == vec3_origin )
		ray.Init( vecStart, vecEnd );
	else
		ray.Init( vecStart, vecEnd, vecMins, vecMaxs );

	CTraceFilterWorldOnly worldFilter;
	CTraceFilterSimple simpleFilter( NULL, COLLISION_GROUP_NONE );
	ITraceFilter *pFilter = entities ? (ITraceFilter *)&simpleFilter
		: (ITraceFilter *)&worldFilter;

	trace_t tr;
	enginetrace->TraceRay( ray, mask, pFilter, &tr );

	V_strncpy( s_szLastTraceSurface, tr.surface.name ? tr.surface.name : "",
		sizeof( s_szLastTraceSurface ) );

	if ( pOut )
	{
		pOut[ 0 ] = tr.endpos.x;
		pOut[ 1 ] = tr.endpos.y;
		pOut[ 2 ] = tr.endpos.z;
		pOut[ 3 ] = tr.plane.normal.x;
		pOut[ 4 ] = tr.plane.normal.y;
		pOut[ 5 ] = tr.plane.normal.z;
		pOut[ 6 ] = tr.plane.dist;
	}

	if ( pOutInt )
	{
		pOutInt[ 0 ] = tr.contents;
		pOutInt[ 1 ] = tr.startsolid ? 1 : 0;
		pOutInt[ 2 ] = tr.allsolid ? 1 : 0;
		pOutInt[ 3 ] = tr.m_pEnt ? tr.m_pEnt->entindex() : -1;
		pOutInt[ 4 ] = tr.surface.flags;
		pOutInt[ 5 ] = tr.dispFlags;
		pOutInt[ 6 ] = tr.hitgroup;
	}

	return tr.fraction;
}

EMSCRIPTEN_KEEPALIVE void sim_ents_frame()
{
	if ( !s_bInitialized )
		return;

	gpGlobals->tickcount++;
	gpGlobals->curtime = gpGlobals->tickcount * gpGlobals->interval_per_tick;
	gpGlobals->frametime = gpGlobals->interval_per_tick;

	if ( s_bFullFrame )
		g_ServerGameDLL.GameFrame( true );
	else
	{
		Physics_RunThinkFunctions( true );
		g_EventQueue.ServiceEvents();
	}
	SimInvalidateIndex();
}

EMSCRIPTEN_KEEPALIVE void sim_ents_full_frame( int enable )
{
	s_bFullFrame = enable != 0;
}

EMSCRIPTEN_KEEPALIVE float sim_ents_curtime()
{
	return gpGlobals ? gpGlobals->curtime : 0.0f;
}

EMSCRIPTEN_KEEPALIVE const char *sim_ents_classname( int index )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	return pEnt ? STRING( pEnt->m_iClassname ) : "";
}

EMSCRIPTEN_KEEPALIVE const char *sim_ents_targetname( int index )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	return pEnt ? STRING( pEnt->GetEntityName() ) : "";
}

EMSCRIPTEN_KEEPALIVE float sim_ents_origin( int index, int axis )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	if ( !pEnt || axis < 0 || axis > 2 )
		return 0.0f;
	return pEnt->GetAbsOrigin()[ axis ];
}

EMSCRIPTEN_KEEPALIVE int sim_ents_pose( int index, float *pOut )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	if ( !pEnt || !pOut )
		return 0;

	const Vector &vecOrigin = pEnt->GetAbsOrigin();
	const QAngle &angles = pEnt->GetAbsAngles();
	pOut[ 0 ] = vecOrigin.x; pOut[ 1 ] = vecOrigin.y; pOut[ 2 ] = vecOrigin.z;
	pOut[ 3 ] = angles.x; pOut[ 4 ] = angles.y; pOut[ 5 ] = angles.z;
	return 1;
}

EMSCRIPTEN_KEEPALIVE float sim_ents_angles( int index, int axis )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	if ( !pEnt || axis < 0 || axis > 2 )
		return 0.0f;
	return pEnt->GetAbsAngles()[ axis ];
}

EMSCRIPTEN_KEEPALIVE int sim_ents_bounds( int index, float *pOut )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	if ( !pEnt || !pOut )
		return 0;

	const Vector &mins = pEnt->WorldAlignMins();
	const Vector &maxs = pEnt->WorldAlignMaxs();
	pOut[ 0 ] = mins.x; pOut[ 1 ] = mins.y; pOut[ 2 ] = mins.z;
	pOut[ 3 ] = maxs.x; pOut[ 4 ] = maxs.y; pOut[ 5 ] = maxs.z;
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_fire_input( const char *pTarget, const char *pInput, const char *pParam, float delay )
{
	if ( !s_bInitialized || !pTarget || !pInput )
		return 0;

	variant_t value;
	if ( pParam && pParam[ 0 ] )
		value.SetString( MAKE_STRING( pParam ) );

	g_EventQueue.AddEvent( pTarget, pInput, value, delay, NULL, NULL );
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_fire_input_index( int index, const char *pInput, const char *pParam, float delay )
{
	if ( !s_bInitialized || !pInput )
		return 0;

	CBaseEntity *pEnt = SimEntityByIndex( index );
	if ( !pEnt )
		return 0;

	variant_t value;
	if ( pParam && pParam[ 0 ] )
		value.SetString( MAKE_STRING( pParam ) );

	g_EventQueue.AddEvent( pEnt, pInput, value, delay, NULL, NULL );
	return 1;
}

EMSCRIPTEN_KEEPALIVE void sim_ents_random_seed( int seed )
{
	RandomSeed( seed );
}

EMSCRIPTEN_KEEPALIVE float sim_ents_random_float( float flLow, float flHigh )
{
	return RandomFloat( flLow, flHigh );
}

EMSCRIPTEN_KEEPALIVE int sim_ents_random_int( int iLow, int iHigh )
{
	return RandomInt( iLow, iHigh );
}

EMSCRIPTEN_KEEPALIVE int sim_ents_handle( int index )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	return pEnt ? pEnt->GetRefEHandle().ToInt() : -1;
}

static CBaseEntity *SimEntityByHandle( int handle )
{
	if ( handle < 0 )
		return NULL;
	return gEntList.GetBaseEntity( CBaseHandle::UnsafeFromIndex( handle ) );
}

EMSCRIPTEN_KEEPALIVE int sim_ents_pose_handle( int handle, float *pOut )
{
	CBaseEntity *pEnt = SimEntityByHandle( handle );
	if ( !pEnt || !pOut )
		return 0;

	const Vector &vecOrigin = pEnt->GetAbsOrigin();
	const QAngle &angles = pEnt->GetAbsAngles();
	pOut[ 0 ] = vecOrigin.x; pOut[ 1 ] = vecOrigin.y; pOut[ 2 ] = vecOrigin.z;
	pOut[ 3 ] = angles.x; pOut[ 4 ] = angles.y; pOut[ 5 ] = angles.z;
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_fire_input_handle( int handle, const char *pInput, const char *pParam, float delay )
{
	CBaseEntity *pEnt = SimEntityByHandle( handle );
	if ( !pEnt || !pInput )
		return 0;

	variant_t value;
	if ( pParam && pParam[ 0 ] )
		value.SetString( MAKE_STRING( pParam ) );

	g_EventQueue.AddEvent( pEnt, pInput, value, delay, NULL, NULL );
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_index_of( CBaseEntity *pEnt )
{
	if ( !pEnt )
		return -1;
	SimRebuildIndex();
	for ( int i = 0; i < s_EntityIndex.Count(); ++i )
	{
		if ( s_EntityIndex[ i ] == pEnt )
			return i;
	}
	return -1;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_path_link( int index, int which )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	CPathTrack *pPath = dynamic_cast< CPathTrack * >( pEnt );
	if ( !pPath )
		return -1;

	CPathTrack *pLink = NULL;
	if ( which == 0 )
		pLink = pPath->GetNext();
	else if ( which == 1 )
		pLink = pPath->GetPrevious();
	else
		pLink = pPath->m_paltpath;

	return sim_ents_index_of( pLink );
}

EMSCRIPTEN_KEEPALIVE float sim_ents_path_radius( int index )
{
	CPathTrack *pPath = dynamic_cast< CPathTrack * >( SimEntityByIndex( index ) );
	return pPath ? pPath->GetRadius() : 0.0f;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_accepts_input( int index, const char *pInput )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	if ( !pEnt || !pInput || !pInput[ 0 ] )
		return 0;

	for ( datamap_t *dmap = pEnt->GetDataDescMap(); dmap != NULL; dmap = dmap->baseMap )
	{
		for ( int i = 0; i < dmap->dataNumFields; i++ )
		{
			if ( !( dmap->dataDesc[ i ].flags & FTYPEDESC_INPUT ) )
				continue;
			if ( Q_stricmp( dmap->dataDesc[ i ].externalName, pInput ) == 0 )
				return 1;
		}
	}
	return 0;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_movetype( int index )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	return pEnt ? (int)pEnt->GetMoveType() : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_class_supported( const char *pClassname )
{
	if ( !pClassname || !pClassname[ 0 ] )
		return 0;
	return EntityFactoryDictionary()->FindFactory( pClassname ) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_ents_solid( int index )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	return pEnt ? (int)pEnt->GetSolid() : 0;
}

EMSCRIPTEN_KEEPALIVE const char *sim_ents_model( int index )
{
	CBaseEntity *pEnt = SimEntityByIndex( index );
	return pEnt ? STRING( pEnt->GetModelName() ) : "";
}

EMSCRIPTEN_KEEPALIVE int sim_fs_add( const char *pPath, const char *pPathID, const uint8_t *pData, int length )
{
	return SimEngine_FSAddFile( pPath, pPathID, pData, length ) >= 0 ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE void sim_fs_reset()
{
	SimEngine_FSReset();
}

EMSCRIPTEN_KEEPALIVE int sim_fs_count()
{
	return SimEngine_FSFileCount();
}

EMSCRIPTEN_KEEPALIVE int sim_fs_exists( const char *pPath )
{
	return SimEngine_FSFileExists( pPath ) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_nav_load()
{
	if ( !s_bInitialized || !TheNavMesh )
		return -1;
	return (int)TheNavMesh->Load();
}

EMSCRIPTEN_KEEPALIVE int sim_nav_area_count()
{
	return TheNavMesh ? TheNavMesh->GetNavAreaCount() : 0;
}

static CWave *SimWaveByIndex( int index )
{
	if ( !g_pPopulationManager || index < 0 )
		return NULL;
	return g_pPopulationManager->GetWave( index );
}

EMSCRIPTEN_KEEPALIVE int sim_pop_load( const char *pPopFile )
{
	if ( !s_bInitialized || !pPopFile || !pPopFile[ 0 ] )
		return 0;

	if ( !g_pPopulationManager )
	{
		CBaseEntity *pEnt = CreateEntityByName( "info_populator" );
		if ( !pEnt )
			return 0;
		DispatchSpawn( pEnt );
	}

	if ( !g_pPopulationManager )
		return 0;

	g_pPopulationManager->SetPopulationFilename( pPopFile );
	return g_pPopulationManager->Initialize() ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_count()
{
	return g_pPopulationManager ? g_pPopulationManager->GetTotalWaveCount() : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_enemy_count( int index )
{
	CWave *pWave = SimWaveByIndex( index );
	return pWave ? pWave->GetEnemyCount() : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_currency( int index )
{
	CWave *pWave = SimWaveByIndex( index );
	return pWave ? pWave->GetTotalCurrency() : 0;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_class_count( int index )
{
	CWave *pWave = SimWaveByIndex( index );
	return pWave ? pWave->GetNumClassTypes() : 0;
}

EMSCRIPTEN_KEEPALIVE const char *sim_pop_wave_class_icon( int index, int slot )
{
	CWave *pWave = SimWaveByIndex( index );
	if ( !pWave || slot < 0 || slot >= pWave->GetNumClassTypes() )
		return "";
	return STRING( pWave->GetClassIconName( slot ) );
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_class_quantity( int index, int slot )
{
	CWave *pWave = SimWaveByIndex( index );
	if ( !pWave || slot < 0 || slot >= pWave->GetNumClassTypes() )
		return 0;
	return pWave->GetClassCount( slot );
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_class_flags( int index, int slot )
{
	CWave *pWave = SimWaveByIndex( index );
	if ( !pWave || slot < 0 || slot >= pWave->GetNumClassTypes() )
		return 0;
	return (int)pWave->GetClassFlags( slot );
}

EMSCRIPTEN_KEEPALIVE const char *sim_pop_wave_description( int index )
{
	CWave *pWave = SimWaveByIndex( index );
	const char *pDesc = pWave ? pWave->GetDescription() : NULL;
	return pDesc ? pDesc : "";
}

EMSCRIPTEN_KEEPALIVE const char *sim_pop_filename()
{
	return g_pPopulationManager ? g_pPopulationManager->GetPopulationFilename() : "";
}

EMSCRIPTEN_KEEPALIVE int sim_tf_init_class_data()
{
	if ( !g_pTFPlayerClassDataMgr )
		return 0;

	g_pTFPlayerClassDataMgr->Init();

	int parsed = 0;
	for ( int i = TF_FIRST_NORMAL_CLASS; i < TF_LAST_NORMAL_CLASS; i++ )
	{
		TFPlayerClassData_t *pData = GetPlayerClassData( i );
		if ( pData && pData->m_szClassName[ 0 ] )
			parsed++;
	}
	return parsed;
}

EMSCRIPTEN_KEEPALIVE int sim_bots_add( const char *pTeam, const char *pClass )
{
	if ( !s_bInitialized )
		return 0;

	CTFBot *pBot = NextBotCreatePlayerBot< CTFBot >( pClass && pClass[ 0 ] ? pClass : "TFBot" );
	if ( !pBot )
		return 0;

	pBot->HandleCommand_JoinTeam( pTeam && pTeam[ 0 ] ? pTeam : "auto" );
	pBot->SetDifficulty( CTFBot::NORMAL );
	pBot->HandleCommand_JoinClass( pClass && pClass[ 0 ] ? pClass : pBot->GetNextSpawnClassname() );

	SimInvalidateIndex();
	return pBot->entindex();
}

EMSCRIPTEN_KEEPALIVE int sim_cvar_set( const char *pName, const char *pValue )
{
	if ( !g_pCVar || !pName || !pValue )
		return 0;

	ConVar *pVar = g_pCVar->FindVar( pName );
	if ( !pVar )
		return 0;

	pVar->SetValue( pValue );
	return 1;
}

EMSCRIPTEN_KEEPALIVE const char *sim_cvar_get( const char *pName )
{
	if ( !g_pCVar || !pName )
		return "";

	ConVar *pVar = g_pCVar->FindVar( pName );
	return pVar ? pVar->GetString() : "";
}

EMSCRIPTEN_KEEPALIVE int sim_pop_set_next( const char *pShortName )
{
	if ( !TFGameRules() )
		return 0;
	TFGameRules()->SetNextMvMPopfile( pShortName ? pShortName : "" );
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_start_wave()
{
	if ( !g_pPopulationManager )
		return 0;
	g_pPopulationManager->StartCurrentWave();
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_debug( float *pOut )
{
	if ( !pOut )
		return 0;

	CPopulationManager *pMgr = g_pPopulationManager;
	pOut[ 0 ] = pMgr ? (float)pMgr->entindex() : -1.0f;
	pOut[ 1 ] = pMgr ? pMgr->GetNextThink() : -1.0f;
	pOut[ 2 ] = pMgr ? (float)pMgr->GetTotalWaveCount() : -1.0f;
	pOut[ 3 ] = ( pMgr && pMgr->GetCurrentWave() ) ? 1.0f : 0.0f;
	pOut[ 4 ] = ( pMgr && pMgr->IsSpawningPaused() ) ? 1.0f : 0.0f;
	pOut[ 5 ] = TFObjectiveResource() ? (float)TFObjectiveResource()->GetMannVsMachineWaveCount() : -1.0f;
	pOut[ 6 ] = ( pMgr && pMgr->IsInEndlessWaves() ) ? 1.0f : 0.0f;
	pOut[ 7 ] = TFGameRules() ? (float)TFGameRules()->IsMannVsMachineMode() : -1.0f;
	pOut[ 8 ] = g_hMannVsMachineLogic ? (float)g_hMannVsMachineLogic->entindex() : -1.0f;
	pOut[ 9 ] = g_hMannVsMachineLogic ? g_hMannVsMachineLogic->GetNextThink() : -1.0f;
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_pop_wave_index()
{
	return g_pPopulationManager ? g_pPopulationManager->GetWaveNumber() : -1;
}

EMSCRIPTEN_KEEPALIVE int sim_gamerules_state()
{
	return TFGameRules() ? (int)TFGameRules()->State_Get() : -1;
}

EMSCRIPTEN_KEEPALIVE int sim_gamerules_set_state( int state )
{
	if ( !TFGameRules() )
		return 0;
	TFGameRules()->State_Transition( (gamerules_roundstate_t)state );
	return 1;
}

EMSCRIPTEN_KEEPALIVE int sim_bots_count()
{
	int count = 0;
	for ( int i = 1; i <= gpGlobals->maxClients; i++ )
	{
		CBasePlayer *pPlayer = UTIL_PlayerByIndex( i );
		if ( pPlayer && pPlayer->IsBot() )
			count++;
	}
	return count;
}

EMSCRIPTEN_KEEPALIVE int sim_bots_state( float *pOut, int maxBots )
{
	if ( !pOut || maxBots <= 0 )
		return 0;

	int written = 0;
	for ( int i = 1; i <= gpGlobals->maxClients && written < maxBots; i++ )
	{
		CBasePlayer *pPlayer = UTIL_PlayerByIndex( i );
		if ( !pPlayer || !pPlayer->IsBot() )
			continue;

		const Vector &origin = pPlayer->GetAbsOrigin();
		const QAngle &angles = pPlayer->GetAbsAngles();
		const Vector &velocity = pPlayer->GetAbsVelocity();

		float *p = pOut + written * 12;
		p[ 0 ] = (float)i;
		p[ 1 ] = origin.x;
		p[ 2 ] = origin.y;
		p[ 3 ] = origin.z;
		p[ 4 ] = angles.x;
		p[ 5 ] = angles.y;
		p[ 6 ] = angles.z;
		p[ 7 ] = velocity.x;
		p[ 8 ] = velocity.y;
		p[ 9 ] = velocity.z;
		p[ 10 ] = (float)pPlayer->GetHealth();
		p[ 11 ] = (float)pPlayer->GetTeamNumber();
		written++;
	}
	return written;
}

EMSCRIPTEN_KEEPALIVE const char *sim_bots_class( int playerIndex )
{
	CBasePlayer *pPlayer = UTIL_PlayerByIndex( playerIndex );
	CTFBot *pBot = pPlayer ? ToTFBot( pPlayer ) : NULL;
	if ( !pBot )
		return "";
	return pBot->GetPlayerClass() ? pBot->GetPlayerClass()->GetName() : "";
}

EMSCRIPTEN_KEEPALIVE const char *sim_bots_name( int playerIndex )
{
	CBasePlayer *pPlayer = UTIL_PlayerByIndex( playerIndex );
	return pPlayer ? pPlayer->GetPlayerName() : "";
}

}
