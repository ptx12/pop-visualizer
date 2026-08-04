#include "cbase.h"
#include "networkstringtabledefs.h"
#include "utlvector.h"

#include <stdlib.h>
#include <string.h>

class CSimStringTable : public INetworkStringTable
{
public:
	CSimStringTable( const char *pName, TABLEID id, int nMaxEntries, int nUserDataFixedSize )
	{
		V_strncpy( m_Name, pName ? pName : "", sizeof( m_Name ) );
		m_ID = id;
		m_nMaxEntries = nMaxEntries;
		m_nUserDataFixedSize = nUserDataFixedSize;
		m_nTick = 0;
		m_nLastChangedTick = 0;
		m_pChangeObject = NULL;
		m_pChangeFunc = NULL;
	}

	~CSimStringTable()
	{
		for ( int i = 0; i < m_Entries.Count(); ++i )
		{
			free( m_Entries[ i ].pString );
			free( m_Entries[ i ].pUserData );
		}
	}

	const char *GetTableName( void ) const override { return m_Name; }
	TABLEID GetTableId( void ) const override { return m_ID; }
	int GetNumStrings( void ) const override { return m_Entries.Count(); }
	int GetMaxStrings( void ) const override { return m_nMaxEntries; }

	int GetEntryBits( void ) const override
	{
		int bits = 0;
		while ( ( 1 << bits ) < m_nMaxEntries )
			++bits;
		return bits;
	}

	void SetTick( int tick ) override { m_nTick = tick; }
	bool ChangedSinceTick( int tick ) const override { return m_nLastChangedTick > tick; }

	int AddString( bool bIsServer, const char *value, int length, const void *userdata ) override
	{
		if ( !value )
			return INVALID_STRING_INDEX;

		int index = FindStringIndex( value );
		if ( index == INVALID_STRING_INDEX )
		{
			if ( m_Entries.Count() >= m_nMaxEntries )
				return INVALID_STRING_INDEX;

			SimStringEntry_t entry;
			entry.pString = strdup( value );
			entry.pUserData = NULL;
			entry.nUserDataLength = 0;
			index = m_Entries.AddToTail( entry );
		}

		if ( length >= 0 )
			SetStringUserData( index, length, userdata );

		m_nLastChangedTick = m_nTick;
		return index;
	}

	const char *GetString( int stringNumber ) override
	{
		if ( stringNumber < 0 || stringNumber >= m_Entries.Count() )
			return NULL;
		return m_Entries[ stringNumber ].pString;
	}

	void SetStringUserData( int stringNumber, int length, const void *userdata ) override
	{
		if ( stringNumber < 0 || stringNumber >= m_Entries.Count() )
			return;

		SimStringEntry_t &entry = m_Entries[ stringNumber ];
		free( entry.pUserData );
		entry.pUserData = NULL;
		entry.nUserDataLength = 0;

		if ( userdata && length > 0 )
		{
			entry.pUserData = malloc( length );
			memcpy( entry.pUserData, userdata, length );
			entry.nUserDataLength = length;
		}

		m_nLastChangedTick = m_nTick;

		if ( m_pChangeFunc )
			m_pChangeFunc( m_pChangeObject, this, stringNumber, entry.pString, entry.pUserData );
	}

	const void *GetStringUserData( int stringNumber, int *length ) override
	{
		if ( stringNumber < 0 || stringNumber >= m_Entries.Count() )
		{
			if ( length )
				*length = 0;
			return NULL;
		}

		if ( length )
			*length = m_Entries[ stringNumber ].nUserDataLength;
		return m_Entries[ stringNumber ].pUserData;
	}

	int FindStringIndex( char const *string ) override
	{
		if ( !string )
			return INVALID_STRING_INDEX;
		for ( int i = 0; i < m_Entries.Count(); ++i )
		{
			if ( V_strcmp( m_Entries[ i ].pString, string ) == 0 )
				return i;
		}
		return INVALID_STRING_INDEX;
	}

	void SetStringChangedCallback( void *object, pfnStringChanged changeFunc ) override
	{
		m_pChangeObject = object;
		m_pChangeFunc = changeFunc;
	}

private:
	struct SimStringEntry_t
	{
		char *pString;
		void *pUserData;
		int nUserDataLength;
	};

	char m_Name[ 64 ];
	TABLEID m_ID;
	int m_nMaxEntries;
	int m_nUserDataFixedSize;
	int m_nTick;
	int m_nLastChangedTick;
	void *m_pChangeObject;
	pfnStringChanged m_pChangeFunc;
	CUtlVector< SimStringEntry_t > m_Entries;
};

class CSimStringTableContainer : public INetworkStringTableContainer
{
public:
	INetworkStringTable *CreateStringTable( const char *tableName, int maxentries,
		int userdatafixedsize, int userdatanetworkbits ) override
	{
		INetworkStringTable *pExisting = FindTable( tableName );
		if ( pExisting )
			return pExisting;

		if ( m_Tables.Count() >= MAX_TABLES )
			return NULL;

		CSimStringTable *pTable = new CSimStringTable( tableName, m_Tables.Count(),
			maxentries, userdatafixedsize );
		m_Tables.AddToTail( pTable );
		return pTable;
	}

	INetworkStringTable *CreateStringTableEx( const char *tableName, int maxentries,
		int userdatafixedsize, int userdatanetworkbits, bool bIsFilenames ) override
	{
		return CreateStringTable( tableName, maxentries, userdatafixedsize, userdatanetworkbits );
	}

	void RemoveAllTables( void ) override
	{
		m_Tables.PurgeAndDeleteElements();
	}

	INetworkStringTable *FindTable( const char *tableName ) const override
	{
		if ( !tableName )
			return NULL;
		for ( int i = 0; i < m_Tables.Count(); ++i )
		{
			if ( V_stricmp( m_Tables[ i ]->GetTableName(), tableName ) == 0 )
				return m_Tables[ i ];
		}
		return NULL;
	}

	INetworkStringTable *GetTable( TABLEID stringTable ) const override
	{
		if ( stringTable < 0 || stringTable >= m_Tables.Count() )
			return NULL;
		return m_Tables[ stringTable ];
	}

	int GetNumTables( void ) const override { return m_Tables.Count(); }

	void SetAllowClientSideAddString( INetworkStringTable *table, bool bAllowClientSideAddString ) override {}

private:
	CUtlVector< CSimStringTable * > m_Tables;
};

static CSimStringTableContainer s_SimStringTables;

INetworkStringTableContainer *SimEngine_StringTables()
{
	return &s_SimStringTables;
}
