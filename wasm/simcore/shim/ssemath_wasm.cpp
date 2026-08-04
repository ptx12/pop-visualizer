#include "mathlib/mathlib.h"
#include "mathlib/vector.h"
#include <xmmintrin.h>
#include <emmintrin.h>
#include <float.h>

static const __m128 f3 = _mm_set_ss( 3.0f );
static const __m128 f05 = _mm_set_ss( 0.5f );

float _SSE_Sqrt( float x )
{
	float root = 0.f;
	_mm_store_ss( &root, _mm_sqrt_ss( _mm_load_ss( &x ) ) );
	return root;
}

float _SSE_RSqrtAccurate( float a )
{
	__m128 xx = _mm_load_ss( &a );
	__m128 xr = _mm_rsqrt_ss( xx );
	__m128 xt;

	xt = _mm_mul_ss( xr, xr );
	xt = _mm_mul_ss( xt, xx );
	xt = _mm_sub_ss( f3, xt );
	xt = _mm_mul_ss( xt, f05 );
	xr = _mm_mul_ss( xr, xt );

	_mm_store_ss( &a, xr );
	return a;
}

float _SSE_RSqrtFast( float x )
{
	float rroot;
	_mm_store_ss( &rroot, _mm_rsqrt_ss( _mm_load_ss( &x ) ) );
	return rroot;
}

float _SSE_InvRSquared( const float *v )
{
	__m128 x4 = _mm_loadu_ps( v );
	__m128 x1 = _mm_mul_ps( x4, x4 );
	__m128 x3 = _mm_movehl_ps( x1, x1 );
	__m128 x2 = _mm_shuffle_ps( x1, x1, 1 );
	x1 = _mm_add_ss( x1, x2 );
	x1 = _mm_add_ss( x1, x3 );
	x1 = _mm_max_ss( x1, _mm_set_ss( 1.0f ) );

	float inv_r2;
	_mm_store_ss( &inv_r2, _mm_rcp_ss( x1 ) );
	return inv_r2;
}

void FASTCALL _SSE_VectorNormalizeFast( Vector &vec )
{
	float ool = _SSE_RSqrtAccurate( FLT_EPSILON + vec.x * vec.x + vec.y * vec.y + vec.z * vec.z );

	vec.x *= ool;
	vec.y *= ool;
	vec.z *= ool;
}
