#include "cbase.h"
#include "filesystem.h"
#include "tier1/utlvector.h"
#include "tier1/utlbuffer.h"
#include "tier1/strtools.h"
#include "generated/defaults_generated.h"

#include <stdlib.h>
#include <string.h>

struct SimFile_t
{
	char *pPath;
	char *pPathID;
	unsigned char *pData;
	int nSize;
};

struct SimOpenFile_t
{
	int nFile;
	int nPos;
};

struct SimFind_t
{
	CUtlVector< int > entries;
	CUtlVector< bool > isDir;
	CUtlVector< char * > names;
	int nCurrent;
	bool bActive;
};

static void SimFS_NormalizePath( const char *pIn, char *pOut, int nOutSize )
{
	if ( !pIn || nOutSize <= 0 )
	{
		if ( nOutSize > 0 )
			pOut[ 0 ] = '\0';
		return;
	}

	while ( pIn[ 0 ] == '.' && ( pIn[ 1 ] == '/' || pIn[ 1 ] == '\\' ) )
		pIn += 2;
	while ( pIn[ 0 ] == '/' || pIn[ 0 ] == '\\' )
		pIn++;

	int nOut = 0;
	for ( int i = 0; pIn[ i ] && nOut < nOutSize - 1; i++ )
	{
		char c = pIn[ i ];
		if ( c == '\\' )
			c = '/';
		if ( c >= 'A' && c <= 'Z' )
			c = char( c - 'A' + 'a' );
		if ( c == '/' && nOut > 0 && pOut[ nOut - 1 ] == '/' )
			continue;
		pOut[ nOut++ ] = c;
	}
	pOut[ nOut ] = '\0';
}

static bool SimFS_PathIDMatches( const char *pFileID, const char *pRequestID )
{
	if ( !pFileID || !pFileID[ 0 ] )
		return true;
	if ( !pRequestID || !pRequestID[ 0 ] )
		return true;
	if ( V_stricmp( pRequestID, "GAME" ) == 0 )
		return true;
	return V_stricmp( pFileID, pRequestID ) == 0;
}

static bool SimFS_WildcardMatch( const char *pPattern, const char *pName )
{
	const char *pStarPattern = NULL;
	const char *pStarName = NULL;

	while ( *pName )
	{
		if ( *pPattern == '?' || *pPattern == *pName )
		{
			pPattern++;
			pName++;
		}
		else if ( *pPattern == '*' )
		{
			pStarPattern = pPattern++;
			pStarName = pName;
		}
		else if ( pStarPattern )
		{
			pPattern = pStarPattern + 1;
			pName = ++pStarName;
		}
		else
		{
			return false;
		}
	}

	while ( *pPattern == '*' )
		pPattern++;

	return *pPattern == '\0';
}

class CSimFileSystem : public CSimDefault_IFileSystem
{
public:
	int AddFile( const char *pPath, const char *pPathID, const unsigned char *pData, int nSize )
	{
		char szPath[ MAX_PATH ];
		SimFS_NormalizePath( pPath, szPath, sizeof( szPath ) );
		if ( !szPath[ 0 ] || nSize < 0 )
			return -1;

		int nIndex = FindFile( szPath, pPathID );
		if ( nIndex >= 0 )
		{
			free( m_Files[ nIndex ].pData );
			free( m_Files[ nIndex ].pPathID );
		}
		else
		{
			nIndex = m_Files.AddToTail();
			m_Files[ nIndex ].pPath = strdup( szPath );
		}

		m_Files[ nIndex ].pPathID = ( pPathID && pPathID[ 0 ] ) ? strdup( pPathID ) : NULL;
		m_Files[ nIndex ].pData = ( unsigned char * )malloc( nSize + 1 );
		if ( nSize > 0 && pData )
			memcpy( m_Files[ nIndex ].pData, pData, nSize );
		m_Files[ nIndex ].pData[ nSize ] = 0;
		m_Files[ nIndex ].nSize = nSize;
		return nIndex;
	}

	void Reset()
	{
		for ( int i = 0; i < m_Files.Count(); i++ )
		{
			free( m_Files[ i ].pPath );
			free( m_Files[ i ].pPathID );
			free( m_Files[ i ].pData );
		}
		m_Files.RemoveAll();

		for ( int i = 0; i < m_Finds.Count(); i++ )
			ReleaseFind( i );
		m_Finds.RemoveAll();
	}

	int FileCount() const { return m_Files.Count(); }

	int Read( void *pOutput, int size, FileHandle_t file ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )file;
		if ( !pOpen || !pOutput || size <= 0 )
			return 0;

		const SimFile_t &entry = m_Files[ pOpen->nFile ];
		int nRemaining = entry.nSize - pOpen->nPos;
		if ( nRemaining <= 0 )
			return 0;

		int nRead = size < nRemaining ? size : nRemaining;
		memcpy( pOutput, entry.pData + pOpen->nPos, nRead );
		pOpen->nPos += nRead;
		return nRead;
	}

	int ReadEx( void *pOutput, int sizeDest, int size, FileHandle_t file ) override
	{
		return Read( pOutput, size < sizeDest ? size : sizeDest, file );
	}

	int Write( void const *pInput, int size, FileHandle_t file ) override { return 0; }

	FileHandle_t Open( const char *pFileName, const char *pOptions, const char *pathID ) override
	{
		if ( pOptions && ( strchr( pOptions, 'w' ) || strchr( pOptions, 'a' ) || strchr( pOptions, '+' ) ) )
			return NULL;

		char szPath[ MAX_PATH ];
		SimFS_NormalizePath( pFileName, szPath, sizeof( szPath ) );
		int nIndex = FindFile( szPath, pathID );
		if ( nIndex < 0 )
			return NULL;

		SimOpenFile_t *pOpen = ( SimOpenFile_t * )malloc( sizeof( SimOpenFile_t ) );
		pOpen->nFile = nIndex;
		pOpen->nPos = 0;
		return ( FileHandle_t )pOpen;
	}

	FileHandle_t OpenEx( const char *pFileName, const char *pOptions, unsigned flags, const char *pathID, char **ppszResolvedFilename ) override
	{
		if ( ppszResolvedFilename )
			*ppszResolvedFilename = NULL;
		return Open( pFileName, pOptions, pathID );
	}

	void Close( FileHandle_t file ) override
	{
		if ( file )
			free( file );
	}

	void Seek( FileHandle_t file, int pos, FileSystemSeek_t seekType ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )file;
		if ( !pOpen )
			return;

		const int nSize = m_Files[ pOpen->nFile ].nSize;
		int nNew = pos;
		if ( seekType == FILESYSTEM_SEEK_CURRENT )
			nNew = pOpen->nPos + pos;
		else if ( seekType == FILESYSTEM_SEEK_TAIL )
			nNew = nSize + pos;

		if ( nNew < 0 )
			nNew = 0;
		if ( nNew > nSize )
			nNew = nSize;
		pOpen->nPos = nNew;
	}

	unsigned int Tell( FileHandle_t file ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )file;
		return pOpen ? ( unsigned int )pOpen->nPos : 0;
	}

	unsigned int Size( FileHandle_t file ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )file;
		return pOpen ? ( unsigned int )m_Files[ pOpen->nFile ].nSize : 0;
	}

	unsigned int Size( const char *pFileName, const char *pPathID ) override
	{
		char szPath[ MAX_PATH ];
		SimFS_NormalizePath( pFileName, szPath, sizeof( szPath ) );
		int nIndex = FindFile( szPath, pPathID );
		return nIndex >= 0 ? ( unsigned int )m_Files[ nIndex ].nSize : 0;
	}

	bool IsOk( FileHandle_t file ) override { return file != NULL; }

	bool EndOfFile( FileHandle_t file ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )file;
		return !pOpen || pOpen->nPos >= m_Files[ pOpen->nFile ].nSize;
	}

	char *ReadLine( char *pOutput, int maxChars, FileHandle_t file ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )file;
		if ( !pOpen || !pOutput || maxChars <= 0 )
			return NULL;

		const SimFile_t &entry = m_Files[ pOpen->nFile ];
		if ( pOpen->nPos >= entry.nSize )
			return NULL;

		int nOut = 0;
		while ( nOut < maxChars - 1 && pOpen->nPos < entry.nSize )
		{
			char c = ( char )entry.pData[ pOpen->nPos++ ];
			pOutput[ nOut++ ] = c;
			if ( c == '\n' )
				break;
		}
		pOutput[ nOut ] = '\0';
		return pOutput;
	}

	void Flush( FileHandle_t file ) override {}

	bool Precache( const char *pFileName, const char *pPathID ) override
	{
		return FileExists( pFileName, pPathID );
	}

	bool FileExists( const char *pFileName, const char *pPathID ) override
	{
		char szPath[ MAX_PATH ];
		SimFS_NormalizePath( pFileName, szPath, sizeof( szPath ) );
		return FindFile( szPath, pPathID ) >= 0;
	}

	bool IsDirectory( const char *pFileName, const char *pathID ) override
	{
		char szPath[ MAX_PATH ];
		SimFS_NormalizePath( pFileName, szPath, sizeof( szPath ) );
		if ( !szPath[ 0 ] )
			return false;

		const int nLen = V_strlen( szPath );
		for ( int i = 0; i < m_Files.Count(); i++ )
		{
			const char *pCandidate = m_Files[ i ].pPath;
			if ( V_strncmp( pCandidate, szPath, nLen ) == 0 && pCandidate[ nLen ] == '/' )
				return true;
		}
		return false;
	}

	long GetFileTime( const char *pFileName, const char *pPathID ) override
	{
		return FileExists( pFileName, pPathID ) ? 1 : 0;
	}

	bool ReadFile( const char *pFileName, const char *pPath, CUtlBuffer &buf, int nMaxBytes, int nStartingByte, FSAllocFunc_t pfnAlloc ) override
	{
		FileHandle_t fp = Open( pFileName, buf.IsText() ? "rt" : "rb", pPath );
		if ( !fp )
			return false;

		int nBytesToRead = (int)Size( fp );
		if ( nMaxBytes > 0 && nMaxBytes < nBytesToRead )
			nBytesToRead = nMaxBytes;

		buf.EnsureCapacity( nBytesToRead + buf.TellPut() );

		if ( nStartingByte != 0 )
			Seek( fp, nStartingByte, FILESYSTEM_SEEK_HEAD );

		int nBytesRead = Read( buf.PeekPut(), nBytesToRead, fp );
		buf.SeekPut( CUtlBuffer::SEEK_CURRENT, nBytesRead );

		Close( fp );
		return nBytesRead != 0;
	}

	int ReadFileEx( const char *pFileName, const char *pPath, void **ppBuf, bool bNullTerminate, bool bOptimalAlloc, int nMaxBytes, int nStartingByte, FSAllocFunc_t pfnAlloc ) override
	{
		char szPath[ MAX_PATH ];
		SimFS_NormalizePath( pFileName, szPath, sizeof( szPath ) );
		int nIndex = FindFile( szPath, pPath );
		if ( nIndex < 0 || !ppBuf )
			return 0;

		const SimFile_t &entry = m_Files[ nIndex ];
		if ( nStartingByte < 0 || nStartingByte > entry.nSize )
			return 0;

		int nBytes = entry.nSize - nStartingByte;
		if ( nMaxBytes > 0 && nMaxBytes < nBytes )
			nBytes = nMaxBytes;

		const int nAlloc = nBytes + ( bNullTerminate ? 1 : 0 );
		void *pBuf = pfnAlloc ? pfnAlloc( pFileName, nAlloc ) : malloc( nAlloc );
		if ( !pBuf )
			return 0;

		memcpy( pBuf, entry.pData + nStartingByte, nBytes );
		if ( bNullTerminate )
			( ( char * )pBuf )[ nBytes ] = '\0';

		*ppBuf = pBuf;
		return nAlloc;
	}

	bool ReadToBuffer( FileHandle_t hFile, CUtlBuffer &buf, int nMaxBytes, FSAllocFunc_t pfnAlloc ) override
	{
		SimOpenFile_t *pOpen = ( SimOpenFile_t * )hFile;
		if ( !pOpen )
			return false;

		int nBytesToRead = m_Files[ pOpen->nFile ].nSize - pOpen->nPos;
		if ( nMaxBytes > 0 && nMaxBytes < nBytesToRead )
			nBytesToRead = nMaxBytes;
		if ( nBytesToRead < 0 )
			return false;

		buf.EnsureCapacity( nBytesToRead + buf.TellPut() );
		const int nBytesRead = Read( buf.PeekPut(), nBytesToRead, hFile );
		buf.SeekPut( CUtlBuffer::SEEK_CURRENT, nBytesRead );
		return nBytesRead != 0;
	}

	void *AllocOptimalReadBuffer( FileHandle_t hFile, unsigned nSize, unsigned nOffset ) override
	{
		return malloc( nSize ? nSize : 1 );
	}

	void FreeOptimalReadBuffer( void *pBuffer ) override
	{
		free( pBuffer );
	}

	const char *FindFirst( const char *pWildCard, FileFindHandle_t *pHandle ) override
	{
		return FindFirstEx( pWildCard, NULL, pHandle );
	}

	const char *FindFirstEx( const char *pWildCard, const char *pPathID, FileFindHandle_t *pHandle ) override
	{
		if ( !pHandle )
			return NULL;

		char szPattern[ MAX_PATH ];
		SimFS_NormalizePath( pWildCard, szPattern, sizeof( szPattern ) );

		char szDir[ MAX_PATH ];
		const char *pLeaf = szPattern;
		szDir[ 0 ] = '\0';

		const char *pSlash = strrchr( szPattern, '/' );
		if ( pSlash )
		{
			const int nDirLen = int( pSlash - szPattern );
			V_strncpy( szDir, szPattern, nDirLen + 1 );
			pLeaf = pSlash + 1;
		}

		const int nHandle = AllocFind();
		SimFind_t *pFind = m_Finds[ nHandle ];
		const int nDirLen = V_strlen( szDir );

		for ( int i = 0; i < m_Files.Count(); i++ )
		{
			if ( !SimFS_PathIDMatches( m_Files[ i ].pPathID, pPathID ) )
				continue;

			const char *pPath = m_Files[ i ].pPath;
			if ( nDirLen )
			{
				if ( V_strncmp( pPath, szDir, nDirLen ) != 0 || pPath[ nDirLen ] != '/' )
					continue;
				pPath += nDirLen + 1;
			}

			const char *pChildSlash = strchr( pPath, '/' );
			if ( pChildSlash )
			{
				char szChild[ MAX_PATH ];
				V_strncpy( szChild, pPath, int( pChildSlash - pPath ) + 1 );
				if ( !SimFS_WildcardMatch( pLeaf, szChild ) )
					continue;
				if ( HasName( pFind, szChild ) )
					continue;
				pFind->names.AddToTail( strdup( szChild ) );
				pFind->isDir.AddToTail( true );
				pFind->entries.AddToTail( i );
				continue;
			}

			if ( !SimFS_WildcardMatch( pLeaf, pPath ) )
				continue;
			if ( HasName( pFind, pPath ) )
				continue;
			pFind->names.AddToTail( strdup( pPath ) );
			pFind->isDir.AddToTail( false );
			pFind->entries.AddToTail( i );
		}

		*pHandle = nHandle;
		pFind->nCurrent = 0;
		return pFind->names.Count() ? pFind->names[ 0 ] : NULL;
	}

	const char *FindNext( FileFindHandle_t handle ) override
	{
		SimFind_t *pFind = GetFind( handle );
		if ( !pFind )
			return NULL;

		pFind->nCurrent++;
		return pFind->nCurrent < pFind->names.Count() ? pFind->names[ pFind->nCurrent ] : NULL;
	}

	bool FindIsDirectory( FileFindHandle_t handle ) override
	{
		SimFind_t *pFind = GetFind( handle );
		if ( !pFind || pFind->nCurrent >= pFind->isDir.Count() )
			return false;
		return pFind->isDir[ pFind->nCurrent ];
	}

	void FindClose( FileFindHandle_t handle ) override
	{
		if ( handle >= 0 && handle < m_Finds.Count() )
			ReleaseFind( handle );
	}

	int GetSearchPath( const char *pathID, bool bGetPackFiles, char *pDest, int maxLenInChars ) override
	{
		if ( pDest && maxLenInChars > 0 )
			pDest[ 0 ] = '\0';
		return 0;
	}

private:
	int FindFile( const char *pNormalizedPath, const char *pPathID ) const
	{
		if ( !pNormalizedPath || !pNormalizedPath[ 0 ] )
			return -1;
		for ( int i = 0; i < m_Files.Count(); i++ )
		{
			if ( V_strcmp( m_Files[ i ].pPath, pNormalizedPath ) != 0 )
				continue;
			if ( SimFS_PathIDMatches( m_Files[ i ].pPathID, pPathID ) )
				return i;
		}
		return -1;
	}

	static bool HasName( const SimFind_t *pFind, const char *pName )
	{
		for ( int i = 0; i < pFind->names.Count(); i++ )
		{
			if ( V_strcmp( pFind->names[ i ], pName ) == 0 )
				return true;
		}
		return false;
	}

	int AllocFind()
	{
		for ( int i = 0; i < m_Finds.Count(); i++ )
		{
			if ( !m_Finds[ i ]->bActive )
			{
				m_Finds[ i ]->bActive = true;
				return i;
			}
		}

		SimFind_t *pFind = new SimFind_t;
		pFind->nCurrent = 0;
		pFind->bActive = true;
		return m_Finds.AddToTail( pFind );
	}

	SimFind_t *GetFind( FileFindHandle_t handle )
	{
		if ( handle < 0 || handle >= m_Finds.Count() || !m_Finds[ handle ]->bActive )
			return NULL;
		return m_Finds[ handle ];
	}

	void ReleaseFind( int nHandle )
	{
		SimFind_t *pFind = m_Finds[ nHandle ];
		for ( int i = 0; i < pFind->names.Count(); i++ )
			free( pFind->names[ i ] );
		pFind->names.RemoveAll();
		pFind->isDir.RemoveAll();
		pFind->entries.RemoveAll();
		pFind->nCurrent = 0;
		pFind->bActive = false;
	}

	CUtlVector< SimFile_t > m_Files;
	CUtlVector< SimFind_t * > m_Finds;
};

static CSimFileSystem &SimFileSystem()
{
	static CSimFileSystem s_FileSystem;
	return s_FileSystem;
}

IFileSystem *SimEngine_CreateFileSystem()
{
	return &SimFileSystem();
}

int SimEngine_FSAddFile( const char *pPath, const char *pPathID, const unsigned char *pData, int nSize )
{
	return SimFileSystem().AddFile( pPath, pPathID, pData, nSize );
}

void SimEngine_FSReset()
{
	SimFileSystem().Reset();
}

int SimEngine_FSFileCount()
{
	return SimFileSystem().FileCount();
}

bool SimEngine_FSFileExists( const char *pPath )
{
	return SimFileSystem().FileExists( pPath, NULL );
}
