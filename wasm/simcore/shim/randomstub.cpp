#include "vstdlib/random.h"
#include "tier0/basetypes.h"
#include "tier0/dbg.h"
#include <math.h>

#define IA 16807
#define IM 2147483647
#define IQ 127773
#define IR 2836
#define NDIV ( 1 + ( IM - 1 ) / NTAB )
#define MAX_RANDOM_RANGE 0x7FFFFFFFUL

#define AM ( 1.0 / IM )
#define EPS 1.2e-7
#define RNMX ( 1.0 - EPS )

CUniformRandomStream::CUniformRandomStream()
{
	SetSeed( 0 );
}

void CUniformRandomStream::SetSeed( int iSeed )
{
	m_idum = ( ( iSeed < 0 ) ? iSeed : -iSeed );
	m_iy = 0;
}

int CUniformRandomStream::GenerateRandomNumber()
{
	int j;
	int k;

	if ( m_idum <= 0 || !m_iy )
	{
		if ( -( m_idum ) < 1 )
			m_idum = 1;
		else
			m_idum = -( m_idum );

		for ( j = NTAB + 7; j >= 0; j-- )
		{
			k = ( m_idum ) / IQ;
			m_idum = IA * ( m_idum - k * IQ ) - IR * k;
			if ( m_idum < 0 )
				m_idum += IM;
			if ( j < NTAB )
				m_iv[ j ] = m_idum;
		}
		m_iy = m_iv[ 0 ];
	}
	k = ( m_idum ) / IQ;
	m_idum = IA * ( m_idum - k * IQ ) - IR * k;
	if ( m_idum < 0 )
		m_idum += IM;
	j = m_iy / NDIV;
	m_iy = m_iv[ j ];
	m_iv[ j ] = m_idum;

	return m_iy;
}

float CUniformRandomStream::RandomFloat( float flLow, float flHigh )
{
	float fl = AM * GenerateRandomNumber();
	if ( fl > RNMX )
		fl = RNMX;
	return ( fl * ( flHigh - flLow ) ) + flLow;
}

float CUniformRandomStream::RandomFloatExp( float flMinVal, float flMaxVal, float flExponent )
{
	float fl = AM * GenerateRandomNumber();
	if ( fl > RNMX )
		fl = RNMX;
	if ( flExponent != 1.0f )
		fl = powf( fl, flExponent );
	return ( fl * ( flMaxVal - flMinVal ) ) + flMinVal;
}

int CUniformRandomStream::RandomInt( int iLow, int iHigh )
{
	Assert( iLow <= iHigh );
	unsigned int maxAcceptable;
	unsigned int x = 1 + (unsigned int)iHigh - iLow;
	unsigned int n = 0;
	if ( x <= 1 || MAX_RANDOM_RANGE < x - 1 )
		return iLow;

	maxAcceptable = MAX_RANDOM_RANGE - ( ( MAX_RANDOM_RANGE + 1 ) % x );
	do
	{
		n = GenerateRandomNumber();
	} while ( n > maxAcceptable );

	return iLow + ( n % x );
}

CGaussianRandomStream::CGaussianRandomStream( IUniformRandomStream *pUniformStream )
{
	AttachToStream( pUniformStream );
}

void CGaussianRandomStream::AttachToStream( IUniformRandomStream *pUniformStream )
{
	m_pUniformStream = pUniformStream;
	m_bHaveValue = false;
}

float CGaussianRandomStream::RandomFloat( float flMean, float flStdDev )
{
	IUniformRandomStream *pUniformStream = m_pUniformStream;
	float fac, rsq, v1, v2;

	if ( !m_bHaveValue )
	{
		do
		{
			v1 = 2.0f * pUniformStream->RandomFloat() - 1.0f;
			v2 = 2.0f * pUniformStream->RandomFloat() - 1.0f;
			rsq = v1 * v1 + v2 * v2;
		} while ( ( rsq > 1.0f ) || ( rsq == 0.0f ) );

		fac = sqrtf( -2.0f * logf( rsq ) / rsq );
		m_flRandomValue = v2 * fac;
		m_bHaveValue = true;
		return ( v1 * fac * flStdDev ) + flMean;
	}

	m_bHaveValue = false;
	return ( m_flRandomValue * flStdDev ) + flMean;
}

static CUniformRandomStream &DefaultUniformStream()
{
	static CUniformRandomStream s_UniformStream;
	return s_UniformStream;
}

static CGaussianRandomStream &DefaultGaussianStream()
{
	static CGaussianRandomStream s_GaussianStream( &DefaultUniformStream() );
	return s_GaussianStream;
}

static IUniformRandomStream *&ActiveUniformStream()
{
	static IUniformRandomStream *s_pUniformStream = &DefaultUniformStream();
	return s_pUniformStream;
}

void RandomSeed( int iSeed )
{
	ActiveUniformStream()->SetSeed( iSeed );
}

float RandomFloat( float flMinVal, float flMaxVal )
{
	return ActiveUniformStream()->RandomFloat( flMinVal, flMaxVal );
}

float RandomFloatExp( float flMinVal, float flMaxVal, float flExponent )
{
	return ActiveUniformStream()->RandomFloatExp( flMinVal, flMaxVal, flExponent );
}

int RandomInt( int iMinVal, int iMaxVal )
{
	return ActiveUniformStream()->RandomInt( iMinVal, iMaxVal );
}

float RandomGaussianFloat( float flMean, float flStdDev )
{
	return DefaultGaussianStream().RandomFloat( flMean, flStdDev );
}

void InstallUniformRandomStream( IUniformRandomStream *pStream )
{
	ActiveUniformStream() = pStream ? pStream : &DefaultUniformStream();
	DefaultGaussianStream().AttachToStream( ActiveUniformStream() );
}

extern IUniformRandomStream *random_valve;

static struct CSimRandomInstaller
{
	CSimRandomInstaller() { random_valve = &DefaultUniformStream(); }
} s_SimRandomInstaller;
