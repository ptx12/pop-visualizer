#include "cbase.h"
#include "vphysics/object_hash.h"
#include "utlvector.h"

class CSimObjectPairHash : public IPhysicsObjectPairHash
{
public:
	void AddObjectPair( void *pObject0, void *pObject1 ) override
	{
		if ( FindPair( pObject0, pObject1 ) >= 0 )
			return;
		int i = m_Pairs.AddToTail();
		m_Pairs[ i ].pObject0 = pObject0;
		m_Pairs[ i ].pObject1 = pObject1;
	}

	void RemoveObjectPair( void *pObject0, void *pObject1 ) override
	{
		int i = FindPair( pObject0, pObject1 );
		if ( i >= 0 )
			m_Pairs.FastRemove( i );
	}

	bool IsObjectPairInHash( void *pObject0, void *pObject1 ) override
	{
		return FindPair( pObject0, pObject1 ) >= 0;
	}

	void RemoveAllPairsForObject( void *pObject0 ) override
	{
		for ( int i = m_Pairs.Count() - 1; i >= 0; --i )
		{
			if ( m_Pairs[ i ].pObject0 == pObject0 || m_Pairs[ i ].pObject1 == pObject0 )
				m_Pairs.FastRemove( i );
		}
	}

	bool IsObjectInHash( void *pObject0 ) override
	{
		for ( int i = 0; i < m_Pairs.Count(); ++i )
		{
			if ( m_Pairs[ i ].pObject0 == pObject0 || m_Pairs[ i ].pObject1 == pObject0 )
				return true;
		}
		return false;
	}

	int GetPairCountForObject( void *pObject0 ) override
	{
		int count = 0;
		for ( int i = 0; i < m_Pairs.Count(); ++i )
		{
			if ( m_Pairs[ i ].pObject0 == pObject0 || m_Pairs[ i ].pObject1 == pObject0 )
				++count;
		}
		return count;
	}

	int GetPairListForObject( void *pObject0, int nMaxCount, void **ppObjectList ) override
	{
		int count = 0;
		for ( int i = 0; i < m_Pairs.Count() && count < nMaxCount; ++i )
		{
			if ( m_Pairs[ i ].pObject0 == pObject0 )
				ppObjectList[ count++ ] = m_Pairs[ i ].pObject1;
			else if ( m_Pairs[ i ].pObject1 == pObject0 )
				ppObjectList[ count++ ] = m_Pairs[ i ].pObject0;
		}
		return count;
	}

private:
	struct Pair_t
	{
		void *pObject0;
		void *pObject1;
	};

	int FindPair( void *pObject0, void *pObject1 )
	{
		for ( int i = 0; i < m_Pairs.Count(); ++i )
		{
			if ( m_Pairs[ i ].pObject0 == pObject0 && m_Pairs[ i ].pObject1 == pObject1 )
				return i;
			if ( m_Pairs[ i ].pObject0 == pObject1 && m_Pairs[ i ].pObject1 == pObject0 )
				return i;
		}
		return -1;
	}

	CUtlVector< Pair_t > m_Pairs;
};

IPhysicsObjectPairHash *SimEngine_CreateObjectPairHash()
{
	return new CSimObjectPairHash;
}

void SimEngine_DestroyObjectPairHash( IPhysicsObjectPairHash *pHash )
{
	delete pHash;
}
