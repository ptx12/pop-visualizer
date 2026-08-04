#include "cbase.h"
#include "mapentities.h"
#include "eventqueue.h"
#include "entitylist.h"
#include "edict.h"
#include "igamesystem.h"

#include <emscripten/emscripten.h>
#include <stdlib.h>
#include <string.h>

extern CGlobalVars *gpGlobals;
extern void Physics_RunThinkFunctions( bool simulating );
extern void SimEngine_Init( int nMaxEdicts );

static CGlobalVars s_SimGlobals( false );
static bool s_bInitialized = false;
static char *s_pEntityLump = NULL;

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
