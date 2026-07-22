import { createRegistry } from '../renderer/js/sim/registry.js';

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const throws = fn => {
  try { fn(); return null; } catch (e) { return e.message; }
};

const make = () => createRegistry('test', { required: ['step'], optional: ['selects', 'requires'] });

const reg = make();
reg.register({ id: 'b', step() {} });
reg.register({ id: 'a', step() {} });
check('registers entries', reg.size() === 2);
check('looks entries up by id', reg.get('a') !== null && reg.get('nope') === null);
check('ids are sorted by order then id', reg.ids().join(',') === 'a,b', reg.ids().join(','));

const ord = make();
ord.register({ id: 'late', order: 200, step() {} });
ord.register({ id: 'early', order: 10, step() {} });
ord.register({ id: 'mid', step() {} });
check('explicit order beats id order', ord.ids().join(',') === 'early,mid,late', ord.ids().join(','));
check('order defaults to 100', ord.get('mid').order === 100);

check('a missing id is rejected', throws(() => make().register({ step() {} })) !== null);
check('a blank id is rejected', throws(() => make().register({ id: '  ', step() {} })) !== null);
check('a duplicate id is rejected', (() => {
  const r = make();
  r.register({ id: 'x', step() {} });
  return throws(() => r.register({ id: 'x', step() {} })) !== null;
})());

const missing = throws(() => make().register({ id: 'x' }));
check('a missing required hook is rejected', missing !== null && missing.includes('step()'), missing);

const unknown = throws(() => make().register({ id: 'x', step() {}, stpe() {} }));
check('a typo in a field name is rejected', unknown !== null && unknown.includes('stpe'), unknown);
check('the error names the registry and the entry',
  unknown.startsWith('test registry: "x"'), unknown);

check('a non-numeric order is rejected', throws(() => make().register({ id: 'x', order: 'first', step() {} })) !== null);
check('a non-array requires is rejected', throws(() => make().register({ id: 'x', requires: 'nav', step() {} })) !== null);

const caps = make();
caps.register({ id: 'always', step() {} });
caps.register({ id: 'needsNav', requires: ['nav'], step() {} });
caps.register({ id: 'needsBoth', requires: ['nav', 'bomb'], step() {} });
check('capability gating filters entries', caps.enabled(['nav']).map(e => e.id).join(',') === 'always,needsNav',
  caps.enabled(['nav']).map(e => e.id).join(','));
check('no capabilities leaves only ungated entries', caps.enabled([]).map(e => e.id).join(',') === 'always');
check('all capabilities enables everything', caps.enabled(['nav', 'bomb']).length === 3);
check('requires defaults to empty', caps.get('always').requires.length === 0);

const frozen = make();
frozen.register({ id: 'x', step() {} });
const entry = frozen.get('x');
try { entry.order = 5; } catch {}
check('registered entries are frozen', entry.order === 100);

check('require() throws a named error for a missing id',
  (throws(() => make().require('ghost')) || '').includes('"ghost"'));

const cached = make();
cached.register({ id: 'a', step() {} });
const first = cached.ordered();
check('ordered() is stable between calls', first === cached.ordered());
cached.register({ id: 'b', step() {} });
check('ordered() refreshes after a new registration', cached.ordered().length === 2);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
