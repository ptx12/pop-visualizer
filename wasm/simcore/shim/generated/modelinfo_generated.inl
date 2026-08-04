	vcollide_t * GetVCollide( const model_t *model ) override { return 0; }
	vcollide_t * GetVCollide( int modelindex ) override { return 0; }
	void * GetModelExtraData( const model_t *model ) override { return 0; }
	bool ModelHasMaterialProxy( const model_t *model ) const override { return false; }
	bool IsTranslucent( model_t const* model ) const override { return false; }
	bool IsTranslucentTwoPass( const model_t *model ) const override { return false; }
	void RecomputeTranslucency( const model_t *model, int nSkin, int nBody, void *pClientRenderable, float fInstanceAlphaModulate ) override {  }
	int GetModelMaterialCount( const model_t* model ) const override { return int(); }
	void GetModelMaterials( const model_t *model, int count, IMaterial** ppMaterial ) override {  }
	bool IsModelVertexLit( const model_t *model ) const override { return false; }
	const char * GetModelKeyValueText( const model_t *model ) override { return 0; }
	bool GetModelKeyValue( const model_t *model, CUtlBuffer &buf ) override { return false; }
	float GetModelRadius( const model_t *model ) override { return 0.0f; }
	const studiohdr_t * FindModel( const studiohdr_t *pStudioHdr, void **cache, const char *modelname ) const override { return 0; }
	const studiohdr_t * FindModel( void *cache ) const override { return 0; }
	byte * GetAnimBlock( const studiohdr_t *pStudioHdr, int iBlock ) const override { return 0; }
	void GetModelMaterialColorAndLighting( const model_t *model, Vector const& origin, QAngle const& angles, trace_t* pTrace, Vector& lighting, Vector& matColor ) override {  }
	void GetIlluminationPoint( const model_t *model, IClientRenderable *pRenderable, Vector const& origin, QAngle const& angles, Vector* pLightingCenter ) override {  }
	int GetModelContents( int modelIndex ) override { return int(); }
	studiohdr_t * GetStudiomodel( const model_t *mod ) override { return 0; }
	int GetModelSpriteWidth( const model_t *model ) const override { return int(); }
	int GetModelSpriteHeight( const model_t *model ) const override { return int(); }
	void SetLevelScreenFadeRange( float flMinSize, float flMaxSize ) override {  }
	void GetLevelScreenFadeRange( float *pMinArea, float *pMaxArea ) const override {  }
	void SetViewScreenFadeRange( float flMinSize, float flMaxSize ) override {  }
	unsigned char ComputeLevelScreenFade( const Vector &vecAbsOrigin, float flRadius, float flFadeScale ) const override { return ( unsigned char )0; }
	unsigned char ComputeViewScreenFade( const Vector &vecAbsOrigin, float flRadius, float flFadeScale ) const override { return ( unsigned char )0; }
	int GetAutoplayList( const studiohdr_t *pStudioHdr, unsigned short **pAutoplayList ) const override { return int(); }
	CPhysCollide * GetCollideForVirtualTerrain( int index ) override { return 0; }
	bool IsUsingFBTexture( const model_t *model, int nSkin, int nBody, void *pClientRenderable ) const override { return false; }
	MDLHandle_t GetCacheHandle( const model_t *model ) const override { return MDLHandle_t(); }
	int GetBrushModelPlaneCount( const model_t *model ) const override { return int(); }
	void GetBrushModelPlane( const model_t *model, int nIndex, cplane_t &plane, Vector *pOrigin ) const override {  }
	int GetSurfacepropsForVirtualTerrain( int index ) override { return int(); }
	void OnLevelChange(  ) override {  }
	int GetModelClientSideIndex( const char *name ) const override { return int(); }
	int RegisterDynamicModel( const char *name, bool bClientSide ) override { return int(); }
	bool IsDynamicModelLoading( int modelIndex ) override { return false; }
	void AddRefDynamicModel( int modelIndex ) override {  }
	void ReleaseDynamicModel( int modelIndex ) override {  }
	bool RegisterModelLoadCallback( int modelindex, IModelLoadCallback* pCallback, bool bCallImmediatelyIfLoaded ) override { return false; }
	void UnregisterModelLoadCallback( int modelindex, IModelLoadCallback* pCallback ) override {  }
