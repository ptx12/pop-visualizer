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

static ConVar sim_sv_cheats( "sv_cheats", "0", FCVAR_NOTIFY | FCVAR_REPLICATED );
static ConVar sim_developer( "developer", "0", 0 );
static ConVar sim_commentary( "commentary", "0", FCVAR_ARCHIVE );
static ConVar sim_host_thread_mode( "host_thread_mode", "0", 0 );
static ConVar sim_host_timescale( "host_timescale", "1", FCVAR_REPLICATED | FCVAR_CHEAT );
static ConVar sim_hide_server( "hide_server", "0", 0 );
static ConVar sim_hostip( "hostip", "0", 0 );
static ConVar sim_hostport( "hostport", "27015", 0 );
static ConVar sim_closecaption( "closecaption", "0", FCVAR_ARCHIVE | FCVAR_USERINFO );
static ConVar sim_sv_maxreplay( "sv_maxreplay", "0", 0 );
static ConVar sim_sv_minupdaterate( "sv_minupdaterate", "10", FCVAR_REPLICATED );
static ConVar sim_sv_maxupdaterate( "sv_maxupdaterate", "66", FCVAR_REPLICATED );
static ConVar sim_sv_client_min_interp_ratio( "sv_client_min_interp_ratio", "1", FCVAR_REPLICATED );
static ConVar sim_sv_client_max_interp_ratio( "sv_client_max_interp_ratio", "5", FCVAR_REPLICATED );
static ConVar sim_cl_forwardspeed( "cl_forwardspeed", "450", FCVAR_REPLICATED | FCVAR_CHEAT );
static ConVar sim_snd_mixahead( "snd_mixahead", "0.1", FCVAR_ARCHIVE );
