#include "cbase.h"
#include "eiface.h"
#include "engine/IVModelInfo.h"
#include "edict.h"
#include "iservernetworkable.h"
#include "utlvector.h"
#include "utlstring.h"
#include "model_types.h"
#include "ispatialpartition.h"
#include "gameinterface.h"

#include <stdlib.h>
#include <string.h>

struct SimModel_t
{
	char name[ 260 ];
	int index;
	int type;
	Vector mins;
	Vector maxs;
};

static int SimModelTypeFromName( const char *name )
{
	if ( !name || !name[ 0 ] )
		return mod_bad;
	if ( name[ 0 ] == '*' )
		return mod_brush;

	const char *pExt = V_strrchr( name, '.' );
	if ( pExt )
	{
		if ( V_stricmp( pExt, ".mdl" ) == 0 )
			return mod_studio;
		if ( V_stricmp( pExt, ".spr" ) == 0 || V_stricmp( pExt, ".vmt" ) == 0 )
			return mod_sprite;
		if ( V_stricmp( pExt, ".bsp" ) == 0 )
			return mod_brush;
	}
	return mod_bad;
}

static CUtlVector< SimModel_t * > g_SimModels;
static CUtlVector< char * > g_SimSounds;
static CUtlVector< char * > g_SimGenerics;
static CUtlVector< char * > g_SimDecals;

static edict_t *g_SimEdicts = NULL;
static int g_nSimEdicts = 0;
static int g_nSimMaxClients = 0;
static char *g_pSimMapEntities = NULL;
static CSharedEdictChangeInfo g_SimChangeInfo;

extern CServerGameClients g_ServerGameClients;

struct SimClientCvar_t
{
	int nClient;
	CUtlString name;
	CUtlString value;
};

static CUtlVector< SimClientCvar_t > g_SimClientCvars;

static SimClientCvar_t *SimFindClientCvar( int clientIndex, const char *pName )
{
	if ( !pName )
		return NULL;

	for ( int i = 0; i < g_SimClientCvars.Count(); ++i )
	{
		SimClientCvar_t &entry = g_SimClientCvars[ i ];
		if ( entry.nClient == clientIndex && !V_stricmp( entry.name.Get(), pName ) )
			return &entry;
	}
	return NULL;
}

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
	pModel->type = SimModelTypeFromName( name );
	pModel->mins.Init();
	pModel->maxs.Init();
	g_SimModels.AddToTail( pModel );
	return pModel;
}

void SimEngine_ResetModels()
{
	for ( int i = 0; i < g_SimModels.Count(); ++i )
		free( g_SimModels[ i ] );
	g_SimModels.RemoveAll();

	SimModel_t *pEmpty = (SimModel_t *)calloc( 1, sizeof( SimModel_t ) );
	pEmpty->index = 0;
	pEmpty->type = mod_bad;
	pEmpty->mins.Init();
	pEmpty->maxs.Init();
	g_SimModels.AddToTail( pEmpty );
}

int SimEngine_RegisterModel( const char *name, const Vector &mins, const Vector &maxs )
{
	SimModel_t *pModel = SimFindModel( name );
	if ( !pModel )
		return -1;
	pModel->mins = mins;
	pModel->maxs = maxs;
	return pModel->index;
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

		edict_t *pEdict = &g_SimEdicts[ iEntIndex ];
		return pEdict->IsFree() ? NULL : pEdict;
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
			if ( i >= 1 && i <= g_nSimMaxClients )
				continue;

			edict_t *pEdict = &g_SimEdicts[ i ];
			if ( pEdict->IsFree() )
			{
				pEdict->ClearFree();
				return pEdict;
			}
		}
		return NULL;
	}

	const char *GetMapEntitiesString() override
	{
		return g_pSimMapEntities;
	}

	const char *GetClientConVarValue( int clientIndex, const char *name ) override
	{
		SimClientCvar_t *pEntry = SimFindClientCvar( clientIndex, name );
		return pEntry ? pEntry->value.Get() : "";
	}

	void SetFakeClientConVarValue( edict_t *pEntity, const char *cvar, const char *value ) override
	{
		if ( !pEntity || !cvar )
			return;

		SimClientCvar_t *pEntry = SimFindClientCvar( IndexOfEdict( pEntity ), cvar );
		if ( pEntry )
		{
			pEntry->value = value ? value : "";
		}
		else
		{
			SimClientCvar_t entry;
			entry.nClient = IndexOfEdict( pEntity );
			entry.name = cvar;
			entry.value = value ? value : "";
			g_SimClientCvars.AddToTail( entry );
		}

		g_ServerGameClients.ClientSettingsChanged( pEntity );
	}

	edict_t *CreateFakeClient( const char *netname ) override
	{
		return CreateFakeClientEx( netname, true );
	}

	edict_t *CreateFakeClientEx( const char *netname, bool bReportFakeClient ) override
	{
		if ( !g_SimEdicts )
			return NULL;

		for ( int i = 1; i <= g_nSimMaxClients && i < g_nSimEdicts; ++i )
		{
			edict_t *pEdict = &g_SimEdicts[ i ];
			if ( !pEdict->IsFree() )
				continue;

			pEdict->ClearFree();
			g_ServerGameClients.ClientPutInServer( pEdict, netname ? netname : "" );

			if ( !pEdict->GetUnknown() )
			{
				pEdict->SetFree();
				return NULL;
			}
			return pEdict;
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

	int GetModelType( const model_t *model ) const override
	{
		const SimModel_t *pModel = (const SimModel_t *)model;
		return pModel ? pModel->type : (int)mod_bad;
	}

	int GetModelFrameCount( const model_t *model ) const override { return 1; }

	virtualmodel_t *GetVirtualModel( const studiohdr_t *pStudioHdr ) const override { return 0; }
};

class CSimSpatialPartition : public ISpatialPartition
{
public:
#include "generated/spatialpartition_generated.inl"

	SpatialPartitionHandle_t CreateHandle( IHandleEntity *pHandleEntity ) override
	{
		return (SpatialPartitionHandle_t)m_Handles.AddToTail( pHandleEntity );
	}

	SpatialPartitionHandle_t CreateHandle( IHandleEntity *pHandleEntity,
		SpatialPartitionListMask_t listMask, const Vector &mins, const Vector &maxs ) override
	{
		return CreateHandle( pHandleEntity );
	}

	void DestroyHandle( SpatialPartitionHandle_t handle ) override
	{
		if ( handle >= 0 && handle < m_Handles.Count() )
			m_Handles[ handle ] = NULL;
	}

private:
	CUtlVector< IHandleEntity * > m_Handles;
};

static CSimSpatialPartition g_SimSpatialPartition;
static CSimEngineServer g_SimEngineServer;
static CSimModelInfo g_SimModelInfo;

void SimEngine_InstallDefaults();

void SimEngine_Init( int nMaxEdicts, int nMaxClients )
{
	if ( g_SimEdicts )
		return;

	SimEngine_InstallDefaults();

	g_nSimEdicts = nMaxEdicts;
	g_nSimMaxClients = nMaxClients;
	g_SimEdicts = (edict_t *)calloc( nMaxEdicts, sizeof( edict_t ) );
	g_SimAccessors = (CSimChangeAccessor *)calloc( nMaxEdicts, sizeof( CSimChangeAccessor ) );
	for ( int i = 0; i < nMaxEdicts; ++i )
	{
		g_SimEdicts[ i ].m_EdictIndex = i;
		g_SimEdicts[ i ].SetFree();
	}

	g_pSharedChangeInfo = &g_SimChangeInfo;
	engine = &g_SimEngineServer;
	modelinfo = &g_SimModelInfo;
	partition = &g_SimSpatialPartition;
}

void SimEngine_ClearClientCvars()
{
	g_SimClientCvars.RemoveAll();
}

edict_t *SimEngine_EdictList()
{
	return g_SimEdicts;
}

int SimEngine_EdictCount()
{
	return g_nSimEdicts;
}

void SimEngine_SetMapEntitiesString( const char *pLump )
{
	free( g_pSimMapEntities );
	g_pSimMapEntities = pLump ? strdup( pLump ) : NULL;
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
