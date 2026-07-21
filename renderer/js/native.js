const hasElectron = typeof window !== 'undefined' && !!window.popnative;

const VANILLA_NAMES = ['mvm_bigrock.pop', 'mvm_bigrock_advanced1.pop', 'mvm_bigrock_advanced2.pop', 'mvm_coaltown.pop', 'mvm_coaltown_advanced.pop', 'mvm_coaltown_advanced2.pop', 'mvm_coaltown_expert1.pop', 'mvm_coaltown_intermediate.pop', 'mvm_coaltown_intermediate2.pop', 'mvm_decoy.pop', 'mvm_decoy_advanced.pop', 'mvm_decoy_advanced2.pop', 'mvm_decoy_advanced3.pop', 'mvm_decoy_expert1.pop', 'mvm_decoy_intermediate.pop', 'mvm_decoy_intermediate2.pop', 'mvm_ghost_town.pop', 'mvm_mannhattan.pop', 'mvm_mannhattan_advanced1.pop', 'mvm_mannhattan_advanced2.pop', 'mvm_mannworks.pop', 'mvm_mannworks_advanced.pop', 'mvm_mannworks_expert1.pop', 'mvm_mannworks_intermediate.pop', 'mvm_mannworks_intermediate2.pop', 'mvm_mannworks_ironman.pop', 'mvm_rottenburg.pop', 'mvm_rottenburg_advanced1.pop', 'mvm_rottenburg_advanced2.pop'];
const BASE_NAMES = ['robot_standard.pop', 'robot_giant.pop', 'robot_gatebot.pop'];

let cachedPaths = null;

export const native = {
  isElectron: hasElectron,

  async paths() {
    if (!hasElectron) return { base: '../base', vanilla: '../vanilla', sep: '/', platform: 'browser' };
    if (!cachedPaths) cachedPaths = await window.popnative.paths();
    return cachedPaths;
  },

  async isWindows() {
    return (await this.paths()).platform === 'win32';
  },

  async openDialog() {
    if (hasElectron) return window.popnative.openDialog();
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pop';
      input.multiple = true;
      input.onchange = async () => {
        const out = [];
        for (const f of input.files) {
          const buf = await f.arrayBuffer();
          out.push({ name: f.name, text: new TextDecoder('latin1').decode(buf) });
        }
        resolve(out);
      };
      input.oncancel = () => resolve([]);
      input.click();
    });
  },

  async saveDialog(suggested) {
    if (hasElectron) return window.popnative.saveDialog(suggested);
    return null;
  },

  async readFile(p) {
    if (hasElectron) return window.popnative.readFile(p);
    const res = await fetch(encodeURI(p.replace(/\\/g, '/')));
    if (!res.ok) throw new Error('not found: ' + p);
    const buf = await res.arrayBuffer();
    return new TextDecoder('latin1').decode(buf);
  },

  async writeFile(p, text) {
    if (hasElectron) return window.popnative.writeFile(p, text);
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.split(/[\\/]/).pop();
    a.click();
    return true;
  },

  async exists(p) {
    if (hasElectron) return window.popnative.exists(p);
    try {
      const res = await fetch(encodeURI(p.replace(/\\/g, '/')), { method: 'HEAD' });
      return res.ok;
    } catch { return false; }
  },

  async listVanilla() {
    if (hasElectron) {
      const p = await this.paths();
      return window.popnative.listDir(p.vanilla);
    }
    return VANILLA_NAMES;
  },

  async listBase() {
    if (hasElectron) {
      const p = await this.paths();
      return window.popnative.listDir(p.base);
    }
    return BASE_NAMES;
  },

  join(...parts) {
    const sep = cachedPaths ? cachedPaths.sep
      : parts.some(p => String(p).includes('\\')) ? '\\'
      : '/';
    return parts.join(sep).replace(/[\\/]+/g, sep === '\\' ? '\\' : '/');
  },

  dirname(p) {
    const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return i >= 0 ? p.slice(0, i) : '.';
  },

  basename(p) {
    return p.split(/[\\/]/).pop();
  },

  pathForFile(file) {
    if (hasElectron) return window.popnative.pathForFile(file);
    return file.name;
  },

  onCommand(cb) {
    if (hasElectron) window.popnative.onCommand(cb);
  },

  async dirDialog(title) {
    if (hasElectron) return window.popnative.dirDialog(title);
    return null;
  }
};
