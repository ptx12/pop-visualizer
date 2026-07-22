const SQUAD_ESCORT_RANGE = 500;
const SLOT_ANGLE = Math.PI / 6;
const SLOT_DISTANCE = 90;
const CATCHUP_SPEED = 1.15;

export const escortSquadLeader = {
  id: 'escortSquadLeader',
  order: 10,
  selects(a) { return a.squadRole === 'member'; },
  step(a, ctx, t, dt, speed) {
    const leader = ctx.squadLeaders.get(a.squadId);
    if (!leader || !leader.alive) {
      a.squadRole = 'leader';
      ctx.squadLeaders.set(a.squadId, a);
      a.state = a.bot.ignoreFlag || !ctx.eligible(a) ? 'pushToPoint' : 'fetchFlag';
      return;
    }
    const slotAng = (a.memberIdx % 2 ? 1 : -1) * SLOT_ANGLE * (1 + (a.memberIdx >> 1) * 0.5);
    const heading = leader.heading ?? 0;
    const sx = leader.pos[0] - Math.cos(heading + slotAng) * SLOT_DISTANCE;
    const sy = leader.pos[1] - Math.sin(heading + slotAng) * SLOT_DISTANCE;
    const d = Math.hypot(leader.pos[0] - a.pos[0], leader.pos[1] - a.pos[1]);
    if (d > SQUAD_ESCORT_RANGE) {
      const field = leader.areaId != null ? ctx.navOf(a).flowField(leader.areaId) : null;
      ctx.moveField(a, field, leader.pos, dt, speed * CATCHUP_SPEED);
    } else {
      ctx.moveAlong(a, [sx, sy], dt, speed);
    }
  }
};
