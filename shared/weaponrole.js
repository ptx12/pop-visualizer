export const ROLE_ACTIVITY = {
  primary: 'PRIMARY',
  secondary: 'SECONDARY',
  melee: 'MELEE',
  building: 'BUILDING',
  pda: 'PDA',
  item1: 'ITEM1',
  item2: 'ITEM2',
  melee_allclass: 'MELEE_ALLCLASS',
  secondary2: 'SECONDARY2',
  primary2: 'PRIMARY'
};

export function activityForRole(role) {
  return ROLE_ACTIVITY[String(role || '').toLowerCase()] || 'PRIMARY';
}

export function normalizeRole(value) {
  const v = String(value || '').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(ROLE_ACTIVITY, v) ? v : null;
}
