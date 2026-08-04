	void ChangeLevel( const char *s1, const char *s2 ) override {  }
	int IsMapValid( const char *filename ) override { return int(); }
	int IsInEditMode( void ) override { return int(); }
	int PrecacheSentenceFile( const char *s, bool preload ) override { return int(); }
	bool IsDecalPrecached( char const *s ) const override { return false; }
	bool IsGenericPrecached( char const *s ) const override { return false; }
	int GetClusterForOrigin( const Vector &org ) override { return int(); }
	int GetPVSForCluster( int cluster, int outputpvslength, unsigned char *outputpvs ) override { return int(); }
	bool CheckOriginInPVS( const Vector &org, const unsigned char *checkpvs, int checkpvssize ) override { return false; }
	bool CheckBoxInPVS( const Vector &mins, const Vector &maxs, const unsigned char *checkpvs, int checkpvssize ) override { return false; }
	int GetPlayerUserId( const edict_t *e ) override { return int(); }
	const char * GetPlayerNetworkIDString( const edict_t *e ) override { return 0; }
	INetChannelInfo* GetPlayerNetInfo( int playerIndex ) override { return 0; }
	void EmitAmbientSound( int entindex, const Vector &pos, const char *samp, float vol, soundlevel_t soundlevel, int fFlags, int pitch, float delay ) override {  }
	void FadeClientVolume( const edict_t *pEdict, float fadePercent, float fadeOutSeconds, float holdTime, float fadeInSeconds ) override {  }
	int SentenceGroupPick( int groupIndex, char *name, int nameBufLen ) override { return int(); }
	int SentenceGroupPickSequential( int groupIndex, char *name, int nameBufLen, int sentenceIndex, int reset ) override { return int(); }
	int SentenceIndexFromName( const char *pSentenceName ) override { return int(); }
	const char * SentenceNameFromIndex( int sentenceIndex ) override { return 0; }
	int SentenceGroupIndexFromName( const char *pGroupName ) override { return int(); }
	const char * SentenceGroupNameFromIndex( int groupIndex ) override { return 0; }
	float SentenceLength( int sentenceIndex ) override { return 0.0f; }
	void ServerCommand( const char *str ) override {  }
	void ServerExecute( void ) override {  }
	void ClientCommand( edict_t *pEdict, const char *szFmt, ... ) override {  }
	void LightStyle( int style, const char *val ) override {  }
	void StaticDecal( const Vector &originInEntitySpace, int decalIndex, int entityIndex, int modelIndex, bool lowpriority ) override {  }
	void Message_DetermineMulticastRecipients( bool usepas, const Vector& origin, CBitVec< 255 >& playerbits ) override {  }
	bf_write * EntityMessageBegin( int ent_index, ServerClass * ent_class, bool reliable ) override { return 0; }
	bf_write * UserMessageBegin( IRecipientFilter *filter, int msg_type ) override { return 0; }
	void MessageEnd( void ) override {  }
	void ClientPrintf( edict_t *pEdict, const char *szMsg ) override {  }
	void Con_NPrintf( int pos, const char *fmt, ... ) override {  }
	void Con_NXPrintf( const struct con_nprint_s *info, const char *fmt, ... ) override {  }
	void SetView( const edict_t *pClient, const edict_t *pViewent ) override {  }
	void CrosshairAngle( const edict_t *pClient, float pitch, float yaw ) override {  }
	int CompareFileTime( const char *filename1, const char *filename2, int *iCompare ) override { return int(); }
	bool LockNetworkStringTables( bool lock ) override { return false; }
	edict_t * CreateFakeClient( const char *netname ) override { return 0; }
	const char * GetClientConVarValue( int clientIndex, const char *name ) override { return 0; }
	const char * ParseFile( const char *data, char *token, int maxlen ) override { return 0; }
	bool CopyFile( const char *source, const char *destination ) override { return false; }
	void ResetPVS( byte *pvs, int pvssize ) override {  }
	void AddOriginToPVS( const Vector &origin ) override {  }
	void SetAreaPortalState( int portalNumber, int isOpen ) override {  }
	void PlaybackTempEntity( IRecipientFilter& filter, float delay, const void *pSender, const SendTable *pST, int classID ) override {  }
	int CheckHeadnodeVisible( int nodenum, const byte *pvs, int vissize ) override { return int(); }
	int CheckAreasConnected( int area1, int area2 ) override { return int(); }
	int GetArea( const Vector &origin ) override { return int(); }
	void GetAreaBits( int area, unsigned char *bits, int buflen ) override {  }
	bool GetAreaPortalPlane( Vector const &vViewOrigin, int portalKey, VPlane *pPlane ) override { return false; }
	bool LoadGameState( char const *pMapName, bool createPlayers ) override { return false; }
	void LoadAdjacentEnts( const char *pOldLevel, const char *pLandmarkName ) override {  }
	void ClearSaveDir(  ) override {  }
	const char* GetMapEntitiesString(  ) override { return 0; }
	client_textmessage_t * TextMessageGet( const char *pName ) override { return 0; }
	void LogPrint( const char *msg ) override {  }
	void BuildEntityClusterList( edict_t *pEdict, PVSInfo_t *pPVSInfo ) override {  }
	void SolidMoved( edict_t *pSolidEnt, ICollideable *pSolidCollide, const Vector* pPrevAbsOrigin, bool testSurroundingBoundsOnly ) override {  }
	void TriggerMoved( edict_t *pTriggerEnt, bool testSurroundingBoundsOnly ) override {  }
	ISpatialPartition * CreateSpatialPartition( const Vector& worldmin, const Vector& worldmax ) override { return 0; }
	void DestroySpatialPartition( ISpatialPartition * ) override {  }
	void DrawMapToScratchPad( IScratchPad3D *pPad, unsigned long iFlags ) override {  }
	const CBitVec<(1<<11)>* GetEntityTransmitBitsForClient( int iClientIndex ) override { return 0; }
	bool IsPaused(  ) override { return false; }
	void ForceExactFile( const char *s ) override {  }
	void ForceModelBounds( const char *s, const Vector &mins, const Vector &maxs ) override {  }
	void ClearSaveDirAfterClientLoad(  ) override {  }
	void SetFakeClientConVarValue( edict_t *pEntity, const char *cvar, const char *value ) override {  }
	void ForceSimpleMaterial( const char *s ) override {  }
	int IsInCommentaryMode( void ) override { return int(); }
	void SetAreaPortalStates( const int *portalNumbers, const int *isOpen, int nPortals ) override {  }
	void NotifyEdictFlagsChange( int iEdict ) override {  }
	const CCheckTransmitInfo* GetPrevCheckTransmitInfo( edict_t *pPlayerEdict ) override { return 0; }
	CSharedEdictChangeInfo* GetSharedEdictChangeInfo(  ) override { return 0; }
	void AllowImmediateEdictReuse(  ) override {  }
	char const * GetMostRecentlyLoadedFileName(  ) override { return 0; }
	char const * GetSaveFileName(  ) override { return 0; }
	void MultiplayerEndGame(  ) override {  }
	void ChangeTeam( const char *pTeamName ) override {  }
	void CleanUpEntityClusterList( PVSInfo_t *pPVSInfo ) override {  }
	void SetAchievementMgr( IAchievementMgr *pAchievementMgr ) override {  }
	IAchievementMgr * GetAchievementMgr(  ) override { return 0; }
	bool IsLowViolence(  ) override { return false; }
	QueryCvarCookie_t StartQueryCvarValue( edict_t *pPlayerEntity, const char *pName ) override { return QueryCvarCookie_t(); }
	void InsertServerCommand( const char *str ) override {  }
	bool GetPlayerInfo( int ent_num, player_info_t *pinfo ) override { return false; }
	bool IsClientFullyAuthenticated( edict_t *pEdict ) override { return false; }
	void SetDedicatedServerBenchmarkMode( bool bBenchmarkMode ) override {  }
	void SetGamestatsData( CGamestatsData *pGamestatsData ) override {  }
	CGamestatsData * GetGamestatsData(  ) override { return 0; }
	const CSteamID * GetClientSteamID( edict_t *pPlayerEdict ) override { return 0; }
	const CSteamID * GetGameServerSteamID(  ) override { return 0; }
	void ClientCommandKeyValues( edict_t *pEdict, KeyValues *pCommand ) override {  }
	const CSteamID * GetClientSteamIDByPlayerIndex( int entnum ) override { return 0; }
	int GetClusterCount(  ) override { return int(); }
	int GetAllClusterBounds( bbox_t *pBBoxList, int maxBBox ) override { return int(); }
	edict_t * CreateFakeClientEx( const char *netname, bool bReportFakeClient ) override { return 0; }
	int GetServerVersion(  ) const override { return int(); }
	float GetServerTime(  ) const override { return 0.0f; }
	IServer * GetIServer(  ) override { return 0; }
	bool IsPlayerNameLocked( const edict_t *pEdict ) override { return false; }
	bool CanPlayerChangeName( const edict_t *pEdict ) override { return false; }
	eFindMapResult FindMap( char *pMapName, int nMapNameMax ) override { return eFindMapResult(); }
	void SetPausedForced( bool bPaused, float flDuration ) override {  }
