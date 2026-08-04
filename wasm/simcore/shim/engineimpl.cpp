#include "cbase.h"
#include "eiface.h"
#include "engine/IVModelInfo.h"
#include "edict.h"
#include "iservernetworkable.h"
#include "utlvector.h"
#include "utlstring.h"
#include "model_types.h"

#include <stdlib.h>
#include <string.h>

struct SimModel_t
{
	char name[ 260 ];
	int index;
	Vector mins;
	Vector maxs;
};

static CUtlVector< SimModel_t * > g_SimModels;
static CUtlVector< char * > g_SimSounds;
static CUtlVector< char * > g_SimGenerics;
static CUtlVector< char * > g_SimDecals;

static edict_t *g_SimEdicts = NULL;
static int g_nSimEdicts = 0;
static CSharedEdictChangeInfo g_SimChangeInfo;

class CSimChangeAccessor : public IChangeInfoAccessor
{
};

static CSimChangeAccessor *g_SimAccessors = NULL;

static int SimStringIndex( CUtlVector< char * > &table, const char *name )
{
	if ( !name )
		return 0;
	for ( int i = 0; i < table.Count(); ++i )
	{
		if ( V_stricmp( table[ i ], name ) == 0 )
			return i;
	}
	return table.AddToTail( strdup( name ) );
}

static SimModel_t *SimFindModel( const char *name )
{
	if ( !name || !name[ 0 ] )
		return NULL;

	for ( int i = 0; i < g_SimModels.Count(); ++i )
	{
		if ( V_stricmp( g_SimModels[ i ]->name, name ) == 0 )
			return g_SimModels[ i ];
	}

	SimModel_t *pModel = (SimModel_t *)calloc( 1, sizeof( SimModel_t ) );
	V_strncpy( pModel->name, name, sizeof( pModel->name ) );
	pModel->index = g_SimModels.Count();
	pModel->mins.Init( -8, -8, -8 );
	pModel->maxs.Init( 8, 8, 8 );
	g_SimModels.AddToTail( pModel );
	return pModel;
}

static SimModel_t *SimModelByIndex( int index )
{
	if ( index < 0 || index >= g_SimModels.Count() )
		return NULL;
	return g_SimModels[ index ];
}

class CSimEngineServer : public IVEngineServer
{
public:
#include "generated/engineserver_generated.inl"

	int PrecacheModel( const char *s, bool preload ) override
	{
		SimModel_t *pModel = SimFindModel( s );
		return pModel ? pModel->index : 0;
	}

	int PrecacheGeneric( const char *s, bool preload ) override
	{
		return SimStringIndex( g_SimGenerics, s );
	}

	int PrecacheDecal( const char *name, bool preload ) override
	{
		return SimStringIndex( g_SimDecals, name );
	}

	bool IsModelPrecached( char const *s ) const override
	{
		for ( int i = 0; i < g_SimModels.Count(); ++i )
		{
			if ( V_stricmp( g_SimModels[ i ]->name, s ) == 0 )
				return true;
		}
		return false;
	}

	bool IsDedicatedServer( void ) override { return true; }

	float Time() override { return gpGlobals ? gpGlobals->curtime : 0.0f; }

	int IndexOfEdict( const edict_t *pEdict ) override
	{
		if ( !pEdict || !g_SimEdicts )
			return 0;
		return (int)( pEdict - g_SimEdicts );
	}

	edict_t *PEntityOfEntIndex( int iEntIndex ) override
	{
		if ( !g_SimEdicts || iEntIndex < 0 || iEntIndex >= g_nSimEdicts )
			return NULL;
		return &g_SimEdicts[ iEntIndex ];
	}

	edict_t *CreateEdict( int iForceEdictIndex ) override
	{
		if ( !g_SimEdicts )
			return NULL;

		if ( iForceEdictIndex >= 0 && iForceEdictIndex < g_nSimEdicts )
		{
			edict_t *pForced = &g_SimEdicts[ iForceEdictIndex ];
			pForced->ClearFree();
			return pForced;
		}

		for ( int i = 0; i < g_nSimEdicts; ++i )
		{
			edict_t *pEdict = &g_SimEdicts[ i ];
			if ( pEdict->IsFree() )
			{
				pEdict->ClearFree();
				return pEdict;
			}
		}
		return NULL;
	}

	void RemoveEdict( edict_t *pEdict ) override
	{
		if ( !pEdict )
			return;
		pEdict->SetFree();
		pEdict->m_pNetworkable = NULL;
	}

	int GetEntityCount( void ) override
	{
		int count = 0;
		for ( int i = 0; i < g_nSimEdicts; ++i )
		{
			if ( !g_SimEdicts[ i ].IsFree() )
				++count;
		}
		return count;
	}

	IChangeInfoAccessor *GetChangeAccessor( const edict_t *pEdict ) override
	{
		if ( !pEdict || !g_SimEdicts || !g_SimAccessors )
			return NULL;
		int index = (int)( pEdict - g_SimEdicts );
		if ( index < 0 || index >= g_nSimEdicts )
			return NULL;
		return &g_SimAccessors[ index ];
	}

	void GetGameDir( char *szGetGameDir, int maxlength ) override { V_strncpy( szGetGameDir, "tf", maxlength ); }

	bool IsInternalBuild( void ) override { return false; }

	int GetAppID() override { return 440; }

	void *PvAllocEntPrivateData( long cb ) override { return calloc( 1, cb ); }
	void FreeEntPrivateData( void *pEntity ) override { free( pEntity ); }

	void *SaveAllocMemory( size_t num, size_t size ) override { return calloc( num, size ); }
	void SaveFreeMemory( void *pSaveMem ) override { free( pSaveMem ); }
};

class CSimModelInfo : public IVModelInfo
{
public:
#include "generated/modelinfo_generated.inl"

	const model_t *GetModel( int modelindex ) override
	{
		return (const model_t *)SimModelByIndex( modelindex );
	}

	int GetModelIndex( const char *name ) const override
	{
		SimModel_t *pModel = SimFindModel( name );
		return pModel ? pModel->index : -1;
	}

	const char *GetModelName( const model_t *model ) const override
	{
		const SimModel_t *pModel = (const SimModel_t *)model;
		return pModel ? pModel->name : "";
	}

	void GetModelBounds( const model_t *model, Vector &mins, Vector &maxs ) const override
	{
		const SimModel_t *pModel = (const SimModel_t *)model;
		if ( !pModel )
		{
			mins.Init();
			maxs.Init();
			return;
		}
		mins = pModel->mins;
		maxs = pModel->maxs;
	}

	void GetModelRenderBounds( const model_t *model, Vector &mins, Vector &maxs ) const override
	{
		GetModelBounds( model, mins, maxs );
	}

	int GetModelType( const model_t *model ) const override { return (int)mod_studio; }

	int GetModelFrameCount( const model_t *model ) const override { return 1; }

	virtualmodel_t *GetVirtualModel( const studiohdr_t *pStudioHdr ) const override { return 0; }
};

static CSimEngineServer g_SimEngineServer;
static CSimModelInfo g_SimModelInfo;

void SimEngine_Init( int nMaxEdicts )
{
	if ( g_SimEdicts )
		return;

	g_nSimEdicts = nMaxEdicts;
	g_SimEdicts = (edict_t *)calloc( nMaxEdicts, sizeof( edict_t ) );
	g_SimAccessors = (CSimChangeAccessor *)calloc( nMaxEdicts, sizeof( CSimChangeAccessor ) );
	for ( int i = 0; i < nMaxEdicts; ++i )
		g_SimEdicts[ i ].SetFree();

	g_pSharedChangeInfo = &g_SimChangeInfo;
	engine = &g_SimEngineServer;
	modelinfo = &g_SimModelInfo;
}

void SimEngine_SetModelBounds( const char *name, const Vector &mins, const Vector &maxs )
{
	SimModel_t *pModel = SimFindModel( name );
	if ( !pModel )
		return;
	pModel->mins = mins;
	pModel->maxs = maxs;
}

int SimEngine_ModelCount()
{
	return g_SimModels.Count();
}

const char *SimEngine_ModelName( int index )
{
	SimModel_t *pModel = SimModelByIndex( index );
	return pModel ? pModel->name : "";
}
