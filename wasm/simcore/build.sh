#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="$HERE/sdk"
EMSDK="${EMSDK_ROOT:-/c/Users/jakub/emsdk}"
OUT="$HERE/build"

if [ ! -d "$SDK/public" ]; then
  echo "Vendored SDK missing at $SDK" >&2
  exit 1
fi

if [ ! -f "$EMSDK/emsdk_env.sh" ]; then
  echo "emscripten not found at $EMSDK; set EMSDK_ROOT" >&2
  exit 1
fi

source "$EMSDK/emsdk_env.sh" >/dev/null 2>&1

INCLUDES=(
  -I"$SDK/public"
  -I"$SDK/public/tier0"
  -I"$SDK/public/tier1"
  -I"$SDK/common"
  -I"$SDK"
  -I"$SDK/game/server"
  -I"$SDK/game/shared"
  -I"$HERE/shim"
)

DEFINES=(
  -DPOSIX -DLINUX -D_LINUX -DGNUC -DNDEBUG -DCOMPILER_GCC -DGAME_DLL
)

FLAGS=(
  -std=c++14 -msse2 -msimd128 -fpermissive -w -O2
)

NAV_SOURCES=(
  "$SDK/game/server/nav_area.cpp"
  "$SDK/game/server/nav_mesh.cpp"
  "$SDK/game/server/nav_file.cpp"
  "$SDK/game/server/nav_ladder.cpp"
)

COLLISION_SOURCES=(
  "$HERE/shim/bspcollision.cpp"
  "$HERE/shim/dispcollision.cpp"
  "$HERE/shim/capi.cpp"
  "$HERE/shim/tier0stub.cpp"
  "$SDK/public/builddisp.cpp"
  "$SDK/public/dispcoll_common.cpp"
  "$SDK/public/disp_common.cpp"
  "$SDK/public/disp_powerinfo.cpp"
  "$SDK/public/collisionutils.cpp"
  "$SDK/tier1/generichash.cpp"
  "$SDK/mathlib/mathlib_base.cpp"
  "$SDK/mathlib/vmatrix.cpp"
  "$SDK/mathlib/sseconst.cpp"
  "$SDK/mathlib/powsse.cpp"
)

EXPORTS='_sim_collision_load,_sim_collision_stats,_sim_disp_load,_sim_disp_count,_sim_trace_hull,_sim_trace_result,_sim_point_contents,_sim_alloc,_sim_free'

mkdir -p "$OUT"

fail=0

echo "nav subsystem"
for src in "${NAV_SOURCES[@]}"; do
  name="$(basename "${src%.cpp}")"
  if em++ -c "$src" -o "$OUT/$name.o" "${INCLUDES[@]}" "${DEFINES[@]}" "${FLAGS[@]}" 2>"$OUT/$name.log"; then
    echo "  ok    $name"
  else
    echo "  FAIL  $name"
    grep -E "error:" "$OUT/$name.log" | head -5
    fail=1
  fi
done

echo "collision module"
if em++ "${COLLISION_SOURCES[@]}" -o "$OUT/simcollision.wasm" \
    "${INCLUDES[@]}" "${DEFINES[@]}" "${FLAGS[@]}" \
    --no-entry -sSTANDALONE_WASM -sEXPORTED_FUNCTIONS="$EXPORTS" \
    -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB 2>"$OUT/simcollision.log"; then
  echo "  ok    simcollision.wasm ($(stat -c%s "$OUT/simcollision.wasm") bytes)"
else
  echo "  FAIL  simcollision.wasm"
  grep -E "error:|undefined symbol" "$OUT/simcollision.log" | head -8
  fail=1
fi

exit $fail
