#include "cbase.h"
#include "mapentities.h"
#include "eventqueue.h"
#include "entitylist.h"
#include "edict.h"
#include "igamesystem.h"
#include "gameinterface.h"

#include <emscripten/emscripten.h>
#include <stdlib.h>
#include <string.h>

extern CGlobalVars *gpGlobals;
extern void Physics_RunThinkFunctions( bool simulating );
extern void SimEngine_Init( int nMaxEdicts );
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

static CGlobalVars s_SimGlobals( false );
static bool s_bInitialized = false;
static char *s_pEntityLump = NULL;
static char s_szLastTraceSurface[ 128 ] = "";

static int SimEntityCount();

static CBaseEntity *SimEntityByIndex( int index )
{
	int i = 0;
	for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
	{
		if ( i == index )
			return pEnt;
		++i;
	}
	return NULL;
}

static int SimEntityCount()
{
	int count = 0;
	for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
		++count;
	return count;
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

	SimEngine_Init( MAX_EDICTS );

	gpGlobals = &s_SimGlobals;
	gpGlobals->curtime = 0.0f;
	gpGlobals->frametime = tickInterval;
	gpGlobals->interval_per_tick = tickInterval;
	gpGlobals->tickcount = 0;
	gpGlobals->maxClients = 0;
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

	MapEntity_ParseAllEntities( s_pEntityLump, NULL, false );

	return SimEntityCount();
}

EMSCRIPTEN_KEEPALIVE int sim_ents_count()
{
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
	int mask, int entities, float *pOut )
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
		pOut[ 6 ] = (float)tr.contents;
		pOut[ 7 ] = tr.startsolid ? 1.0f : 0.0f;
		pOut[ 8 ] = tr.allsolid ? 1.0f : 0.0f;
		pOut[ 9 ] = tr.m_pEnt ? (float)tr.m_pEnt->entindex() : -1.0f;
		pOut[ 10 ] = (float)tr.surface.flags;
	}

	return tr.fraction;
}

EMSCRIPTEN_KEEPALIVE void sim_ents_frame()
{
	if ( !s_bInitialized )
		return;

	gpGlobals->tickcount++;
	gpGlobals->curtime = gpGlobals->tickcount * gpGlobals->interval_per_tick;

	Physics_RunThinkFunctions( true );
	g_EventQueue.ServiceEvents();
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

}
