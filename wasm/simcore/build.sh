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
  -I"$OUT/generated"
)

DEFINES=(
  -DPOSIX -DLINUX -D_LINUX -DGNUC -DNDEBUG -DCOMPILER_GCC -DGAME_DLL -DNO_VCR
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

ENT_SOURCES=(
  "$SDK/game/server/baseentity.cpp"
  "$SDK/game/server/cbase.cpp"
  "$SDK/game/server/entitylist.cpp"
  "$SDK/game/server/logicentities.cpp"
  "$SDK/game/server/logicrelay.cpp"
  "$SDK/game/server/doors.cpp"
  "$SDK/game/server/filters.cpp"
  "$SDK/game/server/triggers.cpp"
  "$SDK/game/server/mapentities.cpp"
  "$SDK/game/server/util.cpp"
  "$SDK/game/server/gameinterface.cpp"
  "$SDK/game/server/ServerNetworkProperty.cpp"
  "$SDK/game/server/physics_main.cpp"
  "$SDK/game/shared/baseentity_shared.cpp"
  "$SDK/game/shared/physics_main_shared.cpp"
  "$SDK/game/shared/entitylist_base.cpp"
  "$SDK/game/shared/collisionproperty.cpp"
  "$SDK/game/shared/predictableid.cpp"
  "$SDK/game/server/sendproxy.cpp"
  "$SDK/game/server/hierarchy.cpp"
  "$SDK/game/server/subs.cpp"
  "$SDK/game/server/damagemodifier.cpp"
  "$SDK/game/server/globalstate.cpp"

  "$SDK/game/server/ndebugoverlay.cpp"
  "$SDK/game/server/AI_Criteria.cpp"
  "$SDK/game/server/world.cpp"
  "$SDK/game/server/recipientfilter.cpp"
  "$SDK/game/server/variant_t.cpp"
  "$SDK/game/shared/saverestore.cpp"
  "$SDK/game/server/EntityParticleTrail.cpp"
  "$SDK/game/server/ai_basenpc.cpp"
  "$SDK/game/server/ai_initutils.cpp"
  "$SDK/game/server/ai_namespaces.cpp"
  "$SDK/game/server/ai_squad.cpp"
  "$SDK/game/server/ai_basenpc_schedule.cpp"
  "$SDK/game/server/ai_basenpc_squad.cpp"
  "$SDK/game/server/ai_default.cpp"
  "$SDK/game/server/ai_navigator.cpp"
  "$SDK/game/server/ai_motor.cpp"
  "$SDK/game/server/ai_activity.cpp"
  "$SDK/game/server/ai_utils.cpp"
  "$SDK/game/server/ai_localnavigator.cpp"
  "$SDK/game/server/ai_moveshoot.cpp"
  "$SDK/game/server/ai_pathfinder.cpp"
  "$SDK/game/server/ai_tacticalservices.cpp"
  "$SDK/game/server/ai_node.cpp"
  "$SDK/game/server/ai_network.cpp"
  "$SDK/game/server/ai_waypoint.cpp"
  "$SDK/game/server/ai_route.cpp"
  "$SDK/game/server/AI_Interest_Target.cpp"
  "$SDK/game/server/ai_link.cpp"
  "$SDK/game/server/ai_movesolver.cpp"
  "$SDK/game/server/ai_baseactor.cpp"
  "$SDK/game/server/ai_condition.cpp"
  "$SDK/game/server/ai_event.cpp"
  "$SDK/game/server/ai_goalentity.cpp"
  "$SDK/game/server/gib.cpp"
  "$SDK/game/server/CRagdollMagnet.cpp"
  "$SDK/game/server/cplane.cpp"
  "$SDK/game/server/game.cpp"
  "$SDK/game/server/base_gameinterface.cpp"
  "$SDK/game/server/serverbenchmark_base.cpp"
  "$SDK/game/server/textstatsmgr.cpp"
  "$SDK/game/server/func_areaportalbase.cpp"
  "$SDK/game/server/player_voice_listener.cpp"
  "$SDK/game/server/toolframework_server.cpp"
  "$SDK/game/shared/usermessages.cpp"
  "$SDK/game/shared/usercmd.cpp"
  "$SDK/tier1/bitbuf.cpp"
  "$SDK/game/server/EventLog.cpp"
  "$SDK/game/server/hltvdirector.cpp"
  "$SDK/game/server/ai_saverestore.cpp"
  "$SDK/game/shared/querycache.cpp"
  "$SDK/game/shared/particlesystemquery.cpp"
  "$SDK/game/server/envmicrophone.cpp"
  "$SDK/mathlib/IceKey.cpp"
  "$SDK/game/server/baseviewmodel.cpp"
  "$SDK/game/shared/baseviewmodel_shared.cpp"
  "$SDK/game/shared/gamerules.cpp"
  "$SDK/game/shared/gamerules_register.cpp"
  "$SDK/game/shared/multiplay_gamerules.cpp"
  "$SDK/game/shared/teamplay_gamerules.cpp"
  "$SDK/game/shared/mp_shareddefs.cpp"
  "$SDK/game/shared/gamevars_shared.cpp"
  "$SDK/game/shared/voice_gamemgr.cpp"
  "$SDK/game/server/globals.cpp"
  "$SDK/game/server/team.cpp"
  "$SDK/game/server/player_resource.cpp"
  "$SDK/game/server/basemultiplayerplayer.cpp"
  "$SDK/game/server/tactical_mission.cpp"
  "$SDK/public/registry.cpp"
  "$SDK/game/server/GameStats_BasicStatsFunctions.cpp"
  "$SDK/game/server/playerlocaldata.cpp"
  "$SDK/game/server/fogcontroller.cpp"
  "$SDK/game/server/ai_playerally.cpp"
  "$SDK/game/shared/Sprite.cpp"
  "$SDK/game/shared/weapon_proficiency.cpp"
  "$SDK/game/server/h_ai.cpp"
  "$SDK/game/shared/weapon_parse.cpp"
  "$SDK/game/shared/soundenvelope.cpp"
  "$SDK/game/server/movehelper_server.cpp"
  "$SDK/game/server/physics_bone_follower.cpp"
  "$SDK/game/server/vehicle_base.cpp"
  "$SDK/game/server/fourwheelvehiclephysics.cpp"
  "$SDK/game/server/physics_impact_damage.cpp"
  "$SDK/game/server/func_break.cpp"
  "$SDK/game/server/EntityFlame.cpp"
  "$SDK/game/server/EntityDissolve.cpp"
  "$SDK/game/server/basecombatweapon.cpp"
  "$SDK/game/shared/studio_shared.cpp"
  "$SDK/tier1/datamanager.cpp"
  "$SDK/game/server/RagdollBoogie.cpp"
  "$SDK/game/shared/precache_register.cpp"
  "$SDK/game/shared/physics_shared.cpp"
  "$SDK/game/shared/physics_saverestore.cpp"
  "$SDK/public/bone_setup.cpp"
  "$SDK/game/server/physobj.cpp"
  "$SDK/game/server/physics_prop_ragdoll.cpp"
  "$SDK/game/server/EntityBlocker.cpp"
  "$SDK/game/shared/vehicle_viewblend_shared.cpp"
  "$SDK/game/server/vehicle_baseserver.cpp"
  "$SDK/public/dt_utlvector_send.cpp"
  "$SDK/public/dt_utlvector_common.cpp"
  "$SDK/public/interpolatortypes.cpp"
  "$SDK/game/shared/sceneentity_shared.cpp"
  "$SDK/game/server/ai_basehumanoid.cpp"
  "$SDK/tier1/utlbufferutil.cpp"
  "$SDK/game/server/sceneentity.cpp"
  "$SDK/game/shared/choreoactor.cpp"
  "$SDK/game/shared/choreoevent.cpp"
  "$SDK/game/shared/choreoscene.cpp"
  "$SDK/game/shared/choreochannel.cpp"
  "$SDK/game/server/ai_planesolver.cpp"
  "$SDK/game/shared/interval.cpp"
  "$SDK/game/server/ai_speech.cpp"
  "$SDK/game/server/ai_squadslot.cpp"
  "$SDK/game/server/BaseFlex.cpp"
  "$SDK/game/shared/basecombatcharacter_shared.cpp"
  "$SDK/game/server/ai_dynamiclink.cpp"
  "$SDK/game/server/ai_schedule.cpp"
  "$SDK/game/shared/simtimer.cpp"
  "$SDK/game/shared/ragdoll_shared.cpp"
  "$SDK/tier1/checksum_crc.cpp"
  "$SDK/game/server/ai_task.cpp"
  "$SDK/game/server/props.cpp"
  "$SDK/game/shared/props_shared.cpp"
  "$SDK/game/shared/basecombatweapon_shared.cpp"
  "$SDK/game/server/ai_behavior_assault.cpp"
  "$SDK/game/server/BaseAnimatingOverlay.cpp"
  "$SDK/game/server/ai_moveprobe.cpp"
  "$SDK/game/server/ai_basenpc_movement.cpp"
  "$SDK/game/server/ai_senses.cpp"
  "$SDK/game/server/soundent.cpp"
  "$SDK/game/server/ai_networkmanager.cpp"
  "$SDK/game/server/ragdoll_manager.cpp"
  "$SDK/game/server/ai_memory.cpp"
  "$SDK/game/server/ai_hull.cpp"
  "$SDK/game/server/basecombatcharacter.cpp"
  "$SDK/game/server/baseanimating.cpp"
  "$SDK/game/server/scripted.cpp"
  "$SDK/game/server/ai_hint.cpp"
  "$SDK/game/server/point_template.cpp"
  "$SDK/game/server/TemplateEntities.cpp"
  "$SDK/game/server/lights.cpp"
  "$SDK/game/server/ai_behavior.cpp"
  "$SDK/game/server/ai_behavior_lead.cpp"
  "$SDK/game/shared/mapentities_shared.cpp"
  "$SDK/game/shared/movevars_shared.cpp"
  "$SDK/game/shared/EntityParticleTrail_Shared.cpp"
  "$SDK/game/server/player.cpp"
  "$SDK/game/shared/baseplayer_shared.cpp"
  "$SDK/game/shared/baseparticleentity.cpp"
  "$SDK/game/shared/ammodef.cpp"
  "$SDK/game/shared/activitylist.cpp"
  "$SDK/game/shared/eventlist.cpp"
  "$SDK/game/shared/GameStats.cpp"
  "$SDK/game/server/EffectsServer.cpp"
  "$SDK/game/server/gametrace_dll.cpp"
  "$SDK/game/server/saverestore_gamedll.cpp"
  "$SDK/game/shared/decals.cpp"
  "$SDK/game/server/timedeventmgr.cpp"
  "$SDK/public/stringregistry.cpp"
  "$SDK/tier1/mempool.cpp"
  "$SDK/tier1/tier1.cpp"
  "$SDK/tier1/interface.cpp"
  "$SDK/game/shared/SoundEmitterSystem.cpp"
  "$HERE/shim/randomstub.cpp"
  "$SDK/game/shared/igamesystem.cpp"
  "$SDK/game/shared/util_shared.cpp"
  "$SDK/game/shared/animation.cpp"
  "$SDK/game/shared/ModelSoundsCache.cpp"
  "$SDK/public/studio.cpp"
  "$SDK/tier1/utlstring.cpp"
  "$SDK/tier1/stringpool.cpp"
  "$SDK/tier1/strtools_unicode.cpp"
  "$SDK/tier1/KeyValues.cpp"
  "$SDK/game/shared/takedamageinfo.cpp"
  "$SDK/game/shared/debugoverlay_shared.cpp"
  "$SDK/game/shared/gamestringpool.cpp"
  "$SDK/tier1/convar.cpp"
  "$SDK/tier1/generichash.cpp"
  "$SDK/tier1/strtools.cpp"
  "$SDK/tier1/utlbuffer.cpp"
  "$SDK/tier1/utlsymbol.cpp"
  "$SDK/tier1/characterset.cpp"
  "$SDK/public/dt_send.cpp"
  "$SDK/public/collisionutils.cpp"
  "$SDK/mathlib/mathlib_base.cpp"
  "$SDK/mathlib/vmatrix.cpp"
  "$SDK/mathlib/sseconst.cpp"
  "$SDK/mathlib/powsse.cpp"
  "$SDK/mathlib/color_conversion.cpp"
  "$SDK/tier1/checksum_md5.cpp"
  "$SDK/game/server/SkyCamera.cpp"
  "$HERE/shim/tier0stub.cpp"
  "$HERE/shim/enginestub.cpp"
  "$HERE/shim/keyvaluesstub.cpp"
  "$HERE/shim/ssemath_wasm.cpp"
  "$HERE/shim/engineimpl.cpp"
  "$HERE/shim/enginedefaults.cpp"
  "$HERE/shim/stringtables.cpp"
  "$HERE/shim/enginetrace.cpp"
  "$HERE/shim/bspcollision.cpp"
  "$HERE/shim/dispcollision.cpp"
  "$SDK/public/builddisp.cpp"
  "$SDK/public/dispcoll_common.cpp"
  "$SDK/public/disp_common.cpp"
  "$SDK/public/disp_powerinfo.cpp"
  "$HERE/shim/entsapi.cpp"
)

EXPORTS='_sim_collision_load,_sim_collision_stats,_sim_disp_load,_sim_disp_count,_sim_trace_hull,_sim_trace_result,_sim_point_contents,_sim_alloc,_sim_free'

mkdir -p "$OUT"
mkdir -p "$OUT/generated"

python "$HERE/tools/genclass.py" --tu "$OUT/genclass_tu.cpp"
if ! em++ -E "$OUT/genclass_tu.cpp" -o "$OUT/genclass_tu.i" \
    "${INCLUDES[@]}" "${DEFINES[@]}" "${FLAGS[@]}" 2>"$OUT/genclass_tu.log"; then
  echo "  FAIL  interface preprocess"
  tail -20 "$OUT/genclass_tu.log"
  exit 1
fi
python "$HERE/tools/genclass.py" "$OUT/genclass_tu.i" "$HERE/shim/generated" >/dev/null

for nut in "$SDK"/game/server/*.nut; do
  base="$(basename "${nut%.nut}")"
  out="$OUT/generated/${base}_nut.h"
  if [ ! -f "$out" ] || [ "$nut" -nt "$out" ]; then
    python "$HERE/tools/nut2h.py" "$nut" "$out" "$base"
  fi
done

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

echo "entity module"
mkdir -p "$OUT/ents"
entobjs=()
for src in "${ENT_SOURCES[@]}"; do
  name="$(basename "${src%.cpp}")"
  obj="$OUT/ents/$name.o"
  entobjs+=("$obj")
  if [ -f "$obj" ] && [ "$obj" -nt "$src" ] && [ "$obj" -nt "$HERE/build.sh" ]; then continue; fi
  if em++ -c "$src" -o "$obj" "${INCLUDES[@]}" "${DEFINES[@]}" "${FLAGS[@]}" 2>"$OUT/ents/$name.log"; then
    echo "  ok    $name"
  else
    echo "  FAIL  $name"
    grep -E "error:" "$OUT/ents/$name.log" | head -5
    fail=1
  fi
done

if em++ "${entobjs[@]}" -o "$OUT/ents.wasm" \
    --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
    -sERROR_ON_UNDEFINED_SYMBOLS=1 2>"$OUT/entslink.log"; then
  echo "  ok    ents.wasm ($(stat -c%s "$OUT/ents.wasm") bytes)"
  if [ -n "${NAMED:-}" ]; then
    em++ "${entobjs[@]}" -o "$OUT/ents_named.wasm" \
      --no-entry -sSTANDALONE_WASM -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
      --profiling-funcs -sERROR_ON_UNDEFINED_SYMBOLS=1 2>"$OUT/entslink_named.log" \
      && echo "  ok    ents_named.wasm ($(stat -c%s "$OUT/ents_named.wasm") bytes)"
  fi
else
  echo "  link pending"
  grep -oE "(undefined|duplicate) symbol: .*" "$OUT/entslink.log" | sort -u | head -30
fi

exit $fail
