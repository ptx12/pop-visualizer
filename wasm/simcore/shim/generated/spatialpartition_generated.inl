	void Insert( SpatialPartitionListMask_t listMask, SpatialPartitionHandle_t handle ) override {  }
	void Remove( SpatialPartitionListMask_t listMask, SpatialPartitionHandle_t handle ) override {  }
	void RemoveAndInsert( SpatialPartitionListMask_t removeMask, SpatialPartitionListMask_t insertMask, SpatialPartitionHandle_t handle ) override {  }
	void Remove( SpatialPartitionHandle_t handle ) override {  }
	void ElementMoved( SpatialPartitionHandle_t handle, const Vector& mins, const Vector& maxs ) override {  }
	SpatialTempHandle_t HideElement( SpatialPartitionHandle_t handle ) override { return SpatialTempHandle_t(); }
	void UnhideElement( SpatialPartitionHandle_t handle, SpatialTempHandle_t tempHandle ) override {  }
	void InstallQueryCallback_V1( IPartitionQueryCallback *pCallback ) override {  }
	void RemoveQueryCallback( IPartitionQueryCallback *pCallback ) override {  }
	void EnumerateElementsInBox( SpatialPartitionListMask_t listMask, const Vector& mins, const Vector& maxs, bool coarseTest, IPartitionEnumerator* pIterator ) override {  }
	void EnumerateElementsInSphere( SpatialPartitionListMask_t listMask, const Vector& origin, float radius, bool coarseTest, IPartitionEnumerator* pIterator ) override {  }
	void EnumerateElementsAlongRay( SpatialPartitionListMask_t listMask, const Ray_t& ray, bool coarseTest, IPartitionEnumerator* pIterator ) override {  }
	void EnumerateElementsAtPoint( SpatialPartitionListMask_t listMask, const Vector& pt, bool coarseTest, IPartitionEnumerator* pIterator ) override {  }
	void SuppressLists( SpatialPartitionListMask_t nListMask, bool bSuppress ) override {  }
	SpatialPartitionListMask_t GetSuppressedLists(  ) override { return SpatialPartitionListMask_t(); }
	void RenderAllObjectsInTree( float flTime ) override {  }
	void RenderObjectsInPlayerLeafs( const Vector &vecPlayerMin, const Vector &vecPlayerMax, float flTime ) override {  }
	void RenderLeafsForRayTraceStart( float flTime ) override {  }
	void RenderLeafsForRayTraceEnd( void ) override {  }
	void RenderLeafsForHullTraceStart( float flTime ) override {  }
	void RenderLeafsForHullTraceEnd( void ) override {  }
	void RenderLeafsForBoxStart( float flTime ) override {  }
	void RenderLeafsForBoxEnd( void ) override {  }
	void RenderLeafsForSphereStart( float flTime ) override {  }
	void RenderLeafsForSphereEnd( void ) override {  }
	void RenderObjectsInBox( const Vector &vecMin, const Vector &vecMax, float flTime ) override {  }
	void RenderObjectsInSphere( const Vector &vecCenter, float flRadius, float flTime ) override {  }
	void RenderObjectsAlongRay( const Ray_t& ray, float flTime ) override {  }
	void ReportStats( const char *pFileName ) override {  }
	void InstallQueryCallback( IPartitionQueryCallback *pCallback ) override {  }
