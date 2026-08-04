#include "vstdlib/IKeyValuesSystem.h"
#include "tier1/utlvector.h"
#include "tier1/utlstring.h"
#include "tier1/strtools.h"
#include "tier1/utlsymbol.h"

#include <stdlib.h>
#include <string.h>

class CSimKeyValuesSystem : public IKeyValuesSystem
{
public:
	void RegisterSizeofKeyValues( int size ) override {}

	void *AllocKeyValuesMemory( int size ) override { return malloc( size ); }
	void FreeKeyValuesMemory( void *pMem ) override { free( pMem ); }

	HKeySymbol GetSymbolForString( const char *name, bool bCreate = true ) override
	{
		if ( !name )
			return INVALID_KEY_SYMBOL;

		for ( int i = 0; i < m_Strings.Count(); ++i )
		{
			if ( V_stricmp( m_Strings[ i ], name ) == 0 )
				return i;
		}

		if ( !bCreate )
			return INVALID_KEY_SYMBOL;

		return m_Strings.AddToTail( strdup( name ) );
	}

	const char *GetStringForSymbol( HKeySymbol symbol ) override
	{
		if ( symbol < 0 || symbol >= m_Strings.Count() )
			return "";
		return m_Strings[ symbol ];
	}

	void AddKeyValuesToMemoryLeakList( void *pMem, HKeySymbol name ) override {}
	void RemoveKeyValuesFromMemoryLeakList( void *pMem ) override {}

	void AddFileKeyValuesToCache( const KeyValues *_kv, const char *resourceName, const char *pathID ) override {}
	bool LoadFileKeyValuesFromCache( KeyValues *_outKv, const char *resourceName, const char *pathID, IBaseFileSystem *filesystem ) const override { return false; }
	void InvalidateCache() override {}
	void InvalidateCacheForFile( const char *resourceName, const char *pathID ) override {}

	void SetKeyValuesExpressionSymbol( const char *name, bool bValue ) override {}
	bool GetKeyValuesExpressionSymbol( const char *name ) override { return false; }

	HKeySymbol GetSymbolForStringCaseSensitive( HKeySymbol &hCaseInsensitiveSymbol, const char *name, bool bCreate = true ) override
	{
		hCaseInsensitiveSymbol = GetSymbolForString( name, bCreate );
		return hCaseInsensitiveSymbol;
	}

private:
	CUtlVector< char * > m_Strings;
};

static CSimKeyValuesSystem g_SimKeyValuesSystem;

IKeyValuesSystem *KeyValuesSystem()
{
	return &g_SimKeyValuesSystem;
}
