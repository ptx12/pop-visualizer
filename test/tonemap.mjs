import { existsSync } from 'fs';
import { join } from 'path';
import { readTonemapSettings, tonemapWithDefaults, TONEMAP_DEFAULTS } from '../shared/tonemap.js';
import { readEntityLump, parseEntities, flushLumpCache } from '../shared/bsp.js';
import { extractWorldFaces } from '../shared/bsprender.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

const ctrl = { classname: 'env_tonemap_controller', targetname: 'tonemap_global' };
const auto = out => ({ classname: 'logic_auto', onmapspawn: out });

eq('SetBloomScale is read', readTonemapSettings([ctrl, auto('tonemap_global,SetBloomScale,0,0,-1')]).bloomScale, 0);
eq('a fractional bloom scale is read', readTonemapSettings([ctrl, auto('tonemap_global,SetBloomScale,.3,0,-1')]).bloomScale, 0.3);
eq('SetAutoExposureMin is read', readTonemapSettings([ctrl, auto('tonemap_global,SetAutoExposureMin,0.8,0,-1')]).autoExposureMin, 0.8);
eq('SetAutoExposureMax is read', readTonemapSettings([ctrl, auto('tonemap_global,SetAutoExposureMax,1.1,0,-1')]).autoExposureMax, 1.1);
eq('SetTonemapScale is read', readTonemapSettings([ctrl, auto('tonemap_global,SetTonemapScale,0.7,0,-1')]).tonemapScale, 0.7);

const esc = 'tonemap_global\x1bSetBloomScale\x1b0.25\x1b0\x1b-1';
eq('compiled maps use an ESC delimiter and still parse', readTonemapSettings([ctrl, auto(esc)]).bloomScale, 0.25);

eq('an output aimed at another entity is ignored',
  readTonemapSettings([ctrl, auto('some_other_thing,SetBloomScale,0,0,-1')]).bloomScale, null);
eq('an output with no controller present is ignored',
  readTonemapSettings([auto('tonemap_global,SetBloomScale,0,0,-1')]).bloomScale, null);
eq('outputs on entities other than logic_auto are ignored',
  readTonemapSettings([ctrl, { classname: 'trigger_multiple', onstarttouch: 'tonemap_global,SetBloomScale,0,0,-1' }]).bloomScale, null);
eq('a non-spawn logic_auto output is ignored',
  readTonemapSettings([ctrl, { classname: 'logic_auto', onuser1: 'tonemap_global,SetBloomScale,0,0,-1' }]).bloomScale, null);
eq('a non-numeric parameter is ignored',
  readTonemapSettings([ctrl, auto('tonemap_global,SetBloomScale,abc,0,-1')]).bloomScale, null);
eq('multiple spawn outputs all apply',
  readTonemapSettings([ctrl, { classname: 'logic_auto', onmapspawn: ['tonemap_global,SetBloomScale,.4,0,-1', 'tonemap_global,SetAutoExposureMax,1.5,0,-1'] }]),
  { bloomScale: 0.4, autoExposureMin: null, autoExposureMax: 1.5, tonemapScale: null });

const swapped = readTonemapSettings([ctrl, { classname: 'logic_auto', onmapspawn: ['tonemap_global,SetAutoExposureMin,1.8,0,-1', 'tonemap_global,SetAutoExposureMax,0.6,0,-1'] }]);
check('an inverted min/max pair is put back in order', swapped.autoExposureMin === 0.6 && swapped.autoExposureMax === 1.8, JSON.stringify(swapped));

eq('unset fields fall back to the engine defaults', tonemapWithDefaults(readTonemapSettings([])), TONEMAP_DEFAULTS);
eq('defaults match Source (bloom 1, autoexposure 0.5..2)', TONEMAP_DEFAULTS, { bloomScale: 1, autoExposureMin: 0.5, autoExposureMax: 2, tonemapScale: null });
eq('a zero bloom scale survives the default fill', tonemapWithDefaults({ bloomScale: 0 }).bloomScale, 0);

const TF_CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Team Fortress 2/tf',
  'C:/Program Files/Steam/steamapps/common/Team Fortress 2/tf',
  process.env.TF_PATH || ''
];
const tfPath = TF_CANDIDATES.find(p => p && existsSync(join(p, 'tf2_misc_dir.vpk')));
if (!tfPath) {
  console.log('skip live tonemap checks: no Team Fortress 2 install found');
} else {
  const bspFor = m => {
    for (const d of [join(tfPath, 'maps'), join(tfPath, 'download', 'maps')]) {
      const p = join(d, m + '.bsp');
      if (existsSync(p)) return p;
    }
    return null;
  };
  let ran = false;
  for (const [map, field] of [['mvm_creepside_b2', 'bloomScale'], ['mvm_production_rc6', 'autoExposureMax']]) {
    const bsp = bspFor(map);
    if (!bsp) continue;
    ran = true;
    flushLumpCache();
    const t = readTonemapSettings(parseEntities(readEntityLump(bsp) || ''));
    check(map + ': authors ' + field, t[field] !== null, JSON.stringify(t));
    if (field === 'autoExposureMax') {
      const before = extractWorldFaces(bsp, {});
      const after = extractWorldFaces(bsp, { tonemap: t });
      check(map + ': its exposure cap is applied', after.exposure <= t.autoExposureMax + 1e-9 && after.exposure < before.exposure,
        before.exposure.toFixed(3) + ' -> ' + after.exposure.toFixed(3) + ' cap ' + t.autoExposureMax);
    }
  }
  if (!ran) console.log('skip live tonemap checks: neither reference map is installed');
}

console.log(failures ? failures + ' failure(s)' : 'all tonemap checks passed');
process.exit(failures ? 1 : 0);
