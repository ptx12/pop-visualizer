#include "cbase.h"
#include "icvar.h"
#include "tier1/convar.h"
#include "tier1/utlvector.h"
#include "generated/defaults_generated.h"

class CSimCvar : public CSimDefault_ICvar
{
public:
	CVarDLLIdentifier_t AllocateDLLIdentifier() override
	{
		return m_nNextDLLIdentifier++;
	}

	void RegisterConCommand( ConCommandBase *pCommandBase ) override
	{
		if ( !pCommandBase || pCommandBase->IsRegistered() )
			return;
		if ( m_Commands.Find( pCommandBase ) != m_Commands.InvalidIndex() )
			return;
		m_Commands.AddToTail( pCommandBase );
	}

	void UnregisterConCommand( ConCommandBase *pCommandBase ) override
	{
		m_Commands.FindAndRemove( pCommandBase );
	}

	void UnregisterConCommands( CVarDLLIdentifier_t id ) override
	{
		for ( int i = m_Commands.Count() - 1; i >= 0; i-- )
		{
			if ( m_Commands[ i ]->GetDLLIdentifier() == id )
				m_Commands.Remove( i );
		}
	}

	const char *GetCommandLineValue( const char *pVariableName ) override
	{
		return NULL;
	}

	ConCommandBase *FindCommandBase( const char *name ) override
	{
		if ( !name )
			return NULL;
		for ( int i = 0; i < m_Commands.Count(); i++ )
		{
			if ( Q_stricmp( m_Commands[ i ]->GetName(), name ) == 0 )
				return m_Commands[ i ];
		}
		return NULL;
	}

	const ConCommandBase *FindCommandBase( const char *name ) const override
	{
		return const_cast< CSimCvar * >( this )->FindCommandBase( name );
	}

	ConVar *FindVar( const char *var_name ) override
	{
		ConCommandBase *pBase = FindCommandBase( var_name );
		return ( pBase && !pBase->IsCommand() ) ? static_cast< ConVar * >( pBase ) : NULL;
	}

	const ConVar *FindVar( const char *var_name ) const override
	{
		return const_cast< CSimCvar * >( this )->FindVar( var_name );
	}

	ConCommand *FindCommand( const char *name ) override
	{
		ConCommandBase *pBase = FindCommandBase( name );
		return ( pBase && pBase->IsCommand() ) ? static_cast< ConCommand * >( pBase ) : NULL;
	}

	const ConCommand *FindCommand( const char *name ) const override
	{
		return const_cast< CSimCvar * >( this )->FindCommand( name );
	}

	ConCommandBase *GetCommands( void ) override
	{
		return m_Commands.Count() ? m_Commands[ 0 ] : NULL;
	}

	const ConCommandBase *GetCommands( void ) const override
	{
		return m_Commands.Count() ? m_Commands[ 0 ] : NULL;
	}

	void InstallGlobalChangeCallback( FnChangeCallback_t callback ) override
	{
		if ( callback && m_ChangeCallbacks.Find( callback ) == m_ChangeCallbacks.InvalidIndex() )
			m_ChangeCallbacks.AddToTail( callback );
	}

	void RemoveGlobalChangeCallback( FnChangeCallback_t callback ) override
	{
		m_ChangeCallbacks.FindAndRemove( callback );
	}

	void CallGlobalChangeCallbacks( ConVar *var, const char *pOldString, float flOldValue ) override
	{
		for ( int i = 0; i < m_ChangeCallbacks.Count(); i++ )
			m_ChangeCallbacks[ i ]( var, pOldString, flOldValue );
	}

private:
	CUtlVector< ConCommandBase * > m_Commands;
	CUtlVector< FnChangeCallback_t > m_ChangeCallbacks;
	CVarDLLIdentifier_t m_nNextDLLIdentifier = 0;
};

ICvar *SimEngine_CreateCvar()
{
	static CSimCvar s_Cvar;
	return &s_Cvar;
}
