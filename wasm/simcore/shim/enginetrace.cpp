#include "cbase.h"
#include "generated/defaults_generated.h"
#include "collisionutils.h"
#include "entitylist.h"
#include "world.h"
#include "model_types.h"
#include "bspcollision.h"
#include "dispcollision.h"

#include <stdlib.h>
#include <string.h>

void SimEngine_ResetModels();
int SimEngine_RegisterModel( const char *name, const Vector &mins, const Vector &maxs );

static simcore::CollisionWorld *g_pSimWorld = NULL;
static int g_nUntracedVPhysics = 0;

static inline simcore::Vec3 ToSim( const Vector &v )
{
	return simcore::Vec3( v.x, v.y, v.z );
}

static void SimClearTrace( const Vector &vecRayStart, const Vector &vecRayDelta, trace_t *pTrace )
{
	pTrace->startpos = vecRayStart;
	pTrace->endpos = vecRayStart;
	pTrace->endpos += vecRayDelta;
	pTrace->plane.normal.Init();
	pTrace->plane.dist = 0.0f;
	pTrace->plane.type = 0;
	pTrace->plane.signbits = 0;
	pTrace->fraction = 1.0f;
	pTrace->fractionleftsolid = 0.0f;
	pTrace->contents = 0;
	pTrace->dispFlags = 0;
	pTrace->allsolid = false;
	pTrace->startsolid = false;
	memset( &pTrace->surface, 0, sizeof( pTrace->surface ) );
	pTrace->surface.name = "";
	pTrace->hitgroup = 0;
	pTrace->physicsbone = 0;
	pTrace->hitbox = 0;
	pTrace->m_pEnt = NULL;
}

static void SimCopyTrace( trace_t *pDest, const trace_t &src )
{
	pDest->startpos = src.startpos;
	pDest->endpos = src.endpos;
	pDest->plane = src.plane;
	pDest->fraction = src.fraction;
	pDest->fractionleftsolid = src.fractionleftsolid;
	pDest->contents = src.contents;
	pDest->dispFlags = src.dispFlags;
	pDest->surface = src.surface;
	pDest->hitgroup = src.hitgroup;
	pDest->physicsbone = src.physicsbone;
	pDest->hitbox = src.hitbox;
	pDest->m_pEnt = src.m_pEnt;
}

static void SimMergeTrace( trace_t *pDest, const trace_t &src )
{
	if ( src.startsolid )
	{
		pDest->startsolid = true;
		if ( src.allsolid )
			pDest->allsolid = true;
	}

	if ( src.fraction < pDest->fraction )
	{
		bool bStartSolid = pDest->startsolid;
		bool bAllSolid = pDest->allsolid;
		SimCopyTrace( pDest, src );
		pDest->startsolid = bStartSolid;
		pDest->allsolid = bAllSolid;
	}
}

static void SimTraceWorldModel( const Ray_t &ray, unsigned int fMask, int nModelIndex,
	const Vector &vecOrigin, const QAngle &angles, bool bDisplacements, trace_t *pTrace )
{
	SimClearTrace( ray.m_Start + ray.m_StartOffset, ray.m_Delta, pTrace );

	if ( !g_pSimWorld )
		return;

	bool bRotated = ( angles != vec3_angle );
	matrix3x4_t matModelToWorld;
	Vector vecStart, vecDelta;

	if ( bRotated )
	{
		AngleMatrix( angles, vecOrigin, matModelToWorld );
		VectorITransform( ray.m_Start, matModelToWorld, vecStart );
		VectorIRotate( ray.m_Delta, matModelToWorld, vecDelta );
	}
	else
	{
		VectorSubtract( ray.m_Start, vecOrigin, vecStart );
		vecDelta = ray.m_Delta;
	}

	Vector vecEnd;
	VectorAdd( vecStart, vecDelta, vecEnd );

	simcore::TraceResult res;
	g_pSimWorld->TraceHullInModel( nModelIndex, ToSim( vecStart ), ToSim( vecEnd ),
		ToSim( -ray.m_Extents ), ToSim( ray.m_Extents ), (int)fMask, &res );

	if ( bDisplacements )
	{
		const float start[ 3 ] = { vecStart.x, vecStart.y, vecStart.z };
		const float end[ 3 ] = { vecEnd.x, vecEnd.y, vecEnd.z };
		const float mins[ 3 ] = { -ray.m_Extents.x, -ray.m_Extents.y, -ray.m_Extents.z };
		const float maxs[ 3 ] = { ray.m_Extents.x, ray.m_Extents.y, ray.m_Extents.z };

		float flFraction = res.fraction;
		float normal[ 3 ] = { 0, 0, 0 };
		int nContents = 0;
		if ( simcore::DispCollision_Trace( start, end, mins, maxs, ray.m_IsRay,
				&flFraction, normal, &nContents ) )
		{
			res.fraction = flFraction;
			res.planeNormal = simcore::Vec3( normal[ 0 ], normal[ 1 ], normal[ 2 ] );
			res.contents = nContents;
			pTrace->dispFlags = DISPSURF_FLAG_SURFACE;
		}
	}

	pTrace->fraction = res.fraction;
	pTrace->startsolid = res.startsolid;
	pTrace->allsolid = res.allsolid;
	pTrace->contents = res.contents;

	Vector vecNormal( res.planeNormal.x, res.planeNormal.y, res.planeNormal.z );
	if ( bRotated )
	{
		Vector vecWorldNormal;
		VectorRotate( vecNormal, matModelToWorld, vecWorldNormal );
		vecNormal = vecWorldNormal;
	}
	pTrace->plane.normal = vecNormal;
	pTrace->plane.dist = res.planeDist;
	pTrace->plane.type = 3;

	VectorMA( ray.m_Start, pTrace->fraction, ray.m_Delta, pTrace->endpos );
	pTrace->endpos += ray.m_StartOffset;
}

static char g_szSimWorldModel[ 260 ] = "";

static int SimBrushModelIndex( ICollideable *pCollide )
{
	const model_t *pModel = pCollide->GetCollisionModel();
	if ( !pModel )
		return -1;

	const char *pName = modelinfo->GetModelName( pModel );
	if ( !pName || !pName[ 0 ] )
		return -1;

	if ( pName[ 0 ] == '*' )
		return atoi( pName + 1 );

	if ( g_szSimWorldModel[ 0 ] && V_stricmp( pName, g_szSimWorldModel ) == 0 )
		return 0;

	return -1;
}

static void SimClipRayToCollideable( const Ray_t &ray, unsigned int fMask,
	ICollideable *pCollide, trace_t *pTrace )
{
	SimClearTrace( ray.m_Start + ray.m_StartOffset, ray.m_Delta, pTrace );

	SolidType_t solid = pCollide->GetSolid();
	switch ( solid )
	{
	case SOLID_BSP:
		{
			int nModelIndex = SimBrushModelIndex( pCollide );
			if ( nModelIndex <= 0 )
				return;
			SimTraceWorldModel( ray, fMask, nModelIndex, pCollide->GetCollisionOrigin(),
				pCollide->GetCollisionAngles(), false, pTrace );
		}
		break;

	case SOLID_BBOX:
	case SOLID_OBB:
	case SOLID_OBB_YAW:
		IntersectRayWithOBB( ray, pCollide->GetCollisionOrigin(), pCollide->GetCollisionAngles(),
			pCollide->OBBMins(), pCollide->OBBMaxs(), 0.0f, pTrace );
		break;

	case SOLID_CUSTOM:
		pCollide->TestCollision( ray, fMask, *pTrace );
		break;

	case SOLID_VPHYSICS:
		++g_nUntracedVPhysics;
		break;

	default:
		break;
	}
}

class CSimEngineTrace : public CSimDefault_IEngineTrace
{
public:
	int GetPointContents( const Vector &vecAbsPosition, IHandleEntity **ppEntity ) override
	{
		if ( ppEntity )
			*ppEntity = NULL;
		if ( !g_pSimWorld )
			return CONTENTS_EMPTY;
		return g_pSimWorld->PointContents( ToSim( vecAbsPosition ) );
	}

	int GetPointContents_Collideable( ICollideable *pCollide, const Vector &vecAbsPosition ) override
	{
		if ( !g_pSimWorld || !pCollide )
			return CONTENTS_EMPTY;

		int nModelIndex = SimBrushModelIndex( pCollide );
		if ( nModelIndex < 0 )
			return CONTENTS_EMPTY;

		Ray_t ray;
		ray.Init( vecAbsPosition, vecAbsPosition );

		trace_t tr;
		SimTraceWorldModel( ray, MASK_ALL, nModelIndex, pCollide->GetCollisionOrigin(),
			pCollide->GetCollisionAngles(), false, &tr );
		return tr.startsolid ? tr.contents : CONTENTS_EMPTY;
	}

	void ClipRayToCollideable( const Ray_t &ray, unsigned int fMask, ICollideable *pCollide,
		trace_t *pTrace ) override
	{
		if ( !pCollide )
		{
			SimClearTrace( ray.m_Start + ray.m_StartOffset, ray.m_Delta, pTrace );
			return;
		}
		SimClipRayToCollideable( ray, fMask, pCollide, pTrace );
		if ( !pTrace->m_pEnt )
			pTrace->m_pEnt = SimEntityFromHandle( pCollide->GetEntityHandle() );
	}

	void ClipRayToEntity( const Ray_t &ray, unsigned int fMask, IHandleEntity *pEnt,
		trace_t *pTrace ) override
	{
		CBaseEntity *pEntity = SimEntityFromHandle( pEnt );
		if ( !pEntity )
		{
			SimClearTrace( ray.m_Start + ray.m_StartOffset, ray.m_Delta, pTrace );
			return;
		}
		SimClipRayToCollideable( ray, fMask, pEntity->GetCollideable(), pTrace );
		pTrace->m_pEnt = pEntity;
	}

	void TraceRay( const Ray_t &ray, unsigned int fMask, ITraceFilter *pTraceFilter,
		trace_t *pTrace ) override
	{
		TraceType_t type = pTraceFilter ? pTraceFilter->GetTraceType() : TRACE_EVERYTHING;

		if ( type != TRACE_ENTITIES_ONLY )
		{
			SimTraceWorldModel( ray, fMask, 0, vec3_origin, vec3_angle, true, pTrace );
			pTrace->m_pEnt = GetWorldEntity();
		}
		else
		{
			SimClearTrace( ray.m_Start + ray.m_StartOffset, ray.m_Delta, pTrace );
		}

		if ( type == TRACE_WORLD_ONLY )
			return;

		for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
		{
			if ( pEnt->entindex() == 0 )
				continue;

			ICollideable *pCollide = pEnt->GetCollideable();
			if ( !pCollide )
				continue;

			if ( !IsSolid( pCollide->GetSolid(), pCollide->GetSolidFlags() ) )
				continue;

			if ( pTraceFilter && !pTraceFilter->ShouldHitEntity( pEnt, fMask ) )
				continue;

			Vector vecEntMins, vecEntMaxs;
			pCollide->WorldSpaceSurroundingBounds( &vecEntMins, &vecEntMaxs );
			if ( !IsBoxIntersectingRay( vecEntMins, vecEntMaxs, ray, 0.0f ) )
				continue;

			trace_t entTrace;
			SimClipRayToCollideable( ray, fMask, pCollide, &entTrace );
			if ( !entTrace.m_pEnt )
				entTrace.m_pEnt = pEnt;
			SimMergeTrace( pTrace, entTrace );
		}
	}

	void EnumerateEntities( const Ray_t &ray, bool triggers, IEntityEnumerator *pEnumerator ) override
	{
		if ( !pEnumerator )
			return;

		for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
		{
			if ( pEnt->entindex() == 0 )
				continue;

			ICollideable *pCollide = pEnt->GetCollideable();
			if ( !pCollide )
				continue;

			bool bTrigger = ( pCollide->GetSolidFlags() & FSOLID_TRIGGER ) != 0;
			if ( bTrigger != triggers )
				continue;

			if ( !triggers && !IsSolid( pCollide->GetSolid(), pCollide->GetSolidFlags() ) )
				continue;

			Vector vecEntMins, vecEntMaxs;
			pCollide->WorldSpaceSurroundingBounds( &vecEntMins, &vecEntMaxs );
			if ( !IsBoxIntersectingRay( vecEntMins, vecEntMaxs, ray, 0.0f ) )
				continue;

			if ( !pEnumerator->EnumEntity( pEnt ) )
				return;
		}
	}

	void EnumerateEntities( const Vector &vecAbsMins, const Vector &vecAbsMaxs,
		IEntityEnumerator *pEnumerator ) override
	{
		if ( !pEnumerator )
			return;

		for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
		{
			if ( pEnt->entindex() == 0 )
				continue;

			ICollideable *pCollide = pEnt->GetCollideable();
			if ( !pCollide )
				continue;

			Vector vecEntMins, vecEntMaxs;
			pCollide->WorldSpaceSurroundingBounds( &vecEntMins, &vecEntMaxs );
			if ( !IsBoxIntersectingBox( vecAbsMins, vecAbsMaxs, vecEntMins, vecEntMaxs ) )
				continue;

			if ( !pEnumerator->EnumEntity( pEnt ) )
				return;
		}
	}

	ICollideable *GetCollideable( IHandleEntity *pEntity ) override
	{
		CBaseEntity *pEnt = SimEntityFromHandle( pEntity );
		return pEnt ? pEnt->GetCollideable() : NULL;
	}

	void SweepCollideable( ICollideable *pCollide, const Vector &vecAbsStart,
		const Vector &vecAbsEnd, const QAngle &vecAngles, unsigned int fMask,
		ITraceFilter *pTraceFilter, trace_t *pTrace ) override
	{
		Ray_t ray;
		ray.Init( vecAbsStart, vecAbsEnd, pCollide->OBBMins(), pCollide->OBBMaxs() );
		TraceRay( ray, fMask, pTraceFilter, pTrace );
	}

	bool PointOutsideWorld( const Vector &ptTest ) override
	{
		if ( !g_pSimWorld )
			return false;
		return g_pSimWorld->LeafContainingPoint( ToSim( ptTest ) ) < 0;
	}

	int GetLeafContainingPoint( const Vector &ptTest ) override
	{
		return g_pSimWorld ? g_pSimWorld->LeafContainingPoint( ToSim( ptTest ) ) : -1;
	}

private:
	static CBaseEntity *SimEntityFromHandle( IHandleEntity *pHandle )
	{
		if ( !pHandle )
			return NULL;
		for ( CBaseEntity *pEnt = gEntList.FirstEnt(); pEnt; pEnt = gEntList.NextEnt( pEnt ) )
		{
			if ( static_cast< IHandleEntity * >( pEnt ) == pHandle )
				return pEnt;
		}
		return NULL;
	}
};

static CSimEngineTrace s_SimEngineTrace;

void SimEngine_InstallTrace()
{
	enginetrace = &s_SimEngineTrace;
}

int SimEngine_LoadCollision( const uint8_t *planes, int planesLen,
	const uint8_t *nodes, int nodesLen,
	const uint8_t *leafs, int leafsLen, int leafSize,
	const uint8_t *leafBrushes, int leafBrushesLen,
	const uint8_t *brushes, int brushesLen,
	const uint8_t *brushSides, int brushSidesLen,
	const uint8_t *models, int modelsLen,
	const char *pMapName )
{
	delete g_pSimWorld;
	g_pSimWorld = new simcore::CollisionWorld();

	if ( !g_pSimWorld->Load( planes, planesLen, nodes, nodesLen, leafs, leafsLen, leafSize,
			leafBrushes, leafBrushesLen, brushes, brushesLen, brushSides, brushSidesLen,
			models, modelsLen ) )
	{
		delete g_pSimWorld;
		g_pSimWorld = NULL;
		return 0;
	}

	SimEngine_ResetModels();

	V_snprintf( g_szSimWorldModel, sizeof( g_szSimWorldModel ), "maps/%s.bsp",
		( pMapName && pMapName[ 0 ] ) ? pMapName : "unnamed" );

	for ( int i = 0; i < g_pSimWorld->NumModels(); ++i )
	{
		const simcore::Model *pModel = g_pSimWorld->GetModel( i );
		if ( !pModel )
			continue;

		char name[ 260 ];
		if ( i == 0 )
			V_strncpy( name, g_szSimWorldModel, sizeof( name ) );
		else
			V_snprintf( name, sizeof( name ), "*%d", i );

		SimEngine_RegisterModel( name,
			Vector( pModel->mins.x, pModel->mins.y, pModel->mins.z ),
			Vector( pModel->maxs.x, pModel->maxs.y, pModel->maxs.z ) );
	}

	return g_pSimWorld->NumModels();
}

int SimEngine_LoadDisplacements( const uint8_t *dispInfo, int dispInfoLen,
	const uint8_t *dispVerts, int dispVertsLen,
	const uint8_t *dispTris, int dispTrisLen,
	const uint8_t *faces, int facesLen,
	const uint8_t *surfEdges, int surfEdgesLen,
	const uint8_t *edges, int edgesLen,
	const uint8_t *verts, int vertsLen )
{
	return simcore::DispCollision_Load( dispInfo, dispInfoLen, dispVerts, dispVertsLen,
		dispTris, dispTrisLen, faces, facesLen, surfEdges, surfEdgesLen, edges, edgesLen,
		verts, vertsLen );
}

bool SimEngine_HasCollision()
{
	return g_pSimWorld != NULL;
}

int SimEngine_UntracedVPhysicsCount()
{
	return g_nUntracedVPhysics;
}
