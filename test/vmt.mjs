import { stripVmtComments, vmtParam, vmtFlag, vmtShader, vmtColor, vmtTexturePath } from '../shared/vmt.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log('ok   ' + label);
  else { failures++; console.log('FAIL ' + label + (detail ? ' — ' + detail : '')); }
};
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

const commented = `"WorldVertexTransition"
{
\t//"$basetexture" "pl_barnblitz/metalroof_prebump002"
\t"$basetexture" "Metal/wall028"
\t"$basetexture2" "Nature/snow_full001"
}`;
eq('a commented-out $basetexture never wins over the live one',
  vmtParam(stripVmtComments(commented), 'basetexture'), 'Metal/wall028');

const trailing = `"LightmappedGeneric"
{
\t"$basetexture" "concrete/foo" // inline note
}`;
eq('an inline // comment is trimmed off the value',
  vmtParam(stripVmtComments(trailing), 'basetexture'), 'concrete/foo');

const slashesInQuotes = `"UnlitGeneric"
{
\t"$basetexture" "de_train//metal01"
}`;
eq('a // inside a quoted value is not treated as a comment',
  vmtParam(stripVmtComments(slashesInQuotes), 'basetexture'), 'de_train//metal01');

const unquoted = `LightmappedGeneric
{
\t$basetexture concrete/concretewall001
\t$surfaceprop concrete
}`;
eq('unquoted keys and values parse', vmtParam(unquoted, 'basetexture'), 'concrete/concretewall001');

const noGap = `"UnlitGeneric"
{
\t"$baseTexture""gravelpass/hud/leaderboard_class_soldier"
\t"$translucent" 1
}`;
eq('a quoted key butted straight against a quoted value parses',
  vmtParam(noGap, 'basetexture'), 'gravelpass/hud/leaderboard_class_soldier');
check('the butted form still reads later flags', vmtFlag(noGap, 'translucent'));

eq('an empty quoted value is empty, not null', vmtParam('"X"\n{\n"$basetexture" ""\n}', 'basetexture'), '');

eq('$basetexture2 is not mistaken for $basetexture',
  vmtParam('"X"\n{\n"$basetexture2" "b"\n"$basetexture" "a"\n}', 'basetexture'), 'a');
eq('$basetexture does not match $basetexture2 lookups',
  vmtParam('"X"\n{\n"$basetexture" "a"\n"$basetexture2" "b"\n}', 'basetexture2'), 'b');
eq('a missing parameter is null', vmtParam('"X"\n{\n"$foo" "1"\n}', 'basetexture'), null);

eq('shader name is read from the first block', vmtShader(commented), 'worldvertextransition');
eq('shader name survives a leading comment', vmtShader(stripVmtComments('// header\n"Water"\n{\n}')), 'water');

check('$translucent 1 reads as set', vmtFlag('"X"\n{\n"$translucent" "1"\n}', 'translucent'));
check('$translucent 0 reads as unset', !vmtFlag('"X"\n{\n"$translucent" "0"\n}', 'translucent'));
check('an absent flag reads as unset', !vmtFlag('"X"\n{\n}', 'translucent'));

eq('brace colors are 0-255', vmtColor('"X"\n{\n"$color" "{255 128 0}"\n}', 'color'), [1, 128 / 255, 0]);
eq('bracket colors are 0-1', vmtColor('"X"\n{\n"$color" "[.85 .85 1]"\n}', 'color'), [0.85, 0.85, 1]);
eq('colors clamp to the unit range', vmtColor('"X"\n{\n"$color" "[2 -1 0.5]"\n}', 'color'), [1, 0, 0.5]);
eq('a comma-separated color parses', vmtColor('"X"\n{\n"$fogcolor" "{10, 20, 30}"\n}', 'fogcolor'), [10 / 255, 20 / 255, 30 / 255]);
eq('a non-color value is rejected', vmtColor('"X"\n{\n"$color" "red"\n}', 'color'), null);

eq('backslashes become forward slashes', vmtTexturePath('models\\props_soviet\\Pit_Black'), 'materials/models/props_soviet/pit_black.vtf');
eq('an explicit .vtf suffix is not doubled', vmtTexturePath('foo/bar.vtf'), 'materials/foo/bar.vtf');
eq('an empty texture value yields null', vmtTexturePath(''), null);

const flatOnly = `"LightmappedGeneric"
{
\t"$color" "[.85 .85 1]"
\t"$surfaceprop" "concrete"
}`;
check('a $color-only material exposes a color and no basetexture',
  vmtParam(flatOnly, 'basetexture') === null && !!vmtColor(flatOnly, 'color'));

console.log(failures ? failures + ' failure(s)' : 'all vmt checks passed');
process.exit(failures ? 1 : 0);
