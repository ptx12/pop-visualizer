(function () {
  var fx = null;
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/test/.fixture.json', false);
  xhr.send(null);
  fx = JSON.parse(xhr.responseText);
  window.__fx = fx;
  window.__errs = [];
  window.addEventListener('error', function (e) { window.__errs.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) {
    window.__errs.push('rejection: ' + String((e.reason && e.reason.message) || e.reason));
  });
  var geo = fx.mapGeo ? {
    polys: fx.mapGeo.polys, bounds: fx.mapGeo.bounds, zRange: fx.mapGeo.zRange,
    lit: fx.mapGeo.lit, data: new Uint8Array(new Float32Array(fx.mapGeo.data).buffer)
  } : null;
  var waves = null;
  try {
    var wx = new XMLHttpRequest();
    wx.open('GET', '/test/.fixture-waves.json', false);
    wx.send(null);
    if (wx.status === 200) waves = JSON.parse(wx.responseText);
  } catch (err) { waves = null; }
  window.__waves = waves;
  var nil = function () { return Promise.resolve(null); };
  window.popnative = {
    paths: function () { return Promise.resolve({ base: 'base', vanilla: 'vanilla', sep: '/', platform: 'win32' }); },
    tfDetect: function () { return Promise.resolve('C:/tf'); },
    mapData: function () { return Promise.resolve(fx.mapData); },
    mapGeo: function () { return Promise.resolve(geo); },
    mapTexture: function () {
      if (!fx.mapTexture) return Promise.resolve(null);
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var cv = document.createElement('canvas');
          cv.width = fx.mapTexture.width; cv.height = fx.mapTexture.height;
          var cx = cv.getContext('2d');
          cx.drawImage(img, 0, 0);
          var rgba = new Uint8Array(cx.getImageData(0, 0, cv.width, cv.height).data.buffer);
          var hg = fx.mapTexture.heightGrid;
          if (!hg) return resolve({ width: cv.width, height: cv.height, bounds: fx.mapTexture.bounds, rgba: rgba });
          fetch('/test/.fixture-height.bin').then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
            resolve({
              width: cv.width, height: cv.height, bounds: fx.mapTexture.bounds, rgba: rgba,
              heightGrid: { grid: new Uint8Array(buf), gw: hg.gw, gh: hg.gh, cellPx: hg.cellPx, zMin: hg.zMin, zMax: hg.zMax }
            });
          });
        };
        img.onerror = function () { resolve(null); };
        img.src = '/test/.fixture-map.png';
      });
    },
    simulateWave: function (opts) {
      var o = opts || {};
      if (!waves || String(o.popName || waves.pop) !== waves.pop) {
        return Promise.resolve({ actors: [], end: 0, note: 'No recorded run for ' + (o.popName || 'this popfile') + '.' });
      }
      var run = waves.runs[String(o.waveIndex || 0)];
      if (!run) return Promise.resolve({ actors: [], end: 0, note: 'No recorded run for wave ' + ((o.waveIndex || 0) + 1) + '.' });
      (run.actors || []).forEach(function (a) { if (a.dieT === null) a.dieT = Infinity; });
      return Promise.resolve(run);
    },
    mapFaces3d: nil, mapProps: nil, mapLighting: nil,
    tankPath: nil, navUse: nil, mapFlush: nil, navKernel: nil,
    itemsResolve: function () { return Promise.resolve({}); },
    itemsWeaponRole: function () { return Promise.resolve({}); },
    resolveIcons: function () { return Promise.resolve({}); },
    listIcons: function () { return Promise.resolve([]); },
    refreshIcons: nil, tfFonts: function () { return Promise.resolve([]); },
    listDir: function (dir) {
      var vanilla = ['mvm_bigrock.pop', 'mvm_coaltown.pop', 'mvm_decoy.pop', 'mvm_decoy_advanced.pop',
        'mvm_mannhattan.pop', 'mvm_rottenburg.pop'];
      var base = ['robot_standard.pop', 'robot_giant.pop', 'robot_gatebot.pop'];
      return Promise.resolve(String(dir).indexOf('base') >= 0 ? base : vanilla);
    },
    exists: function () { return Promise.resolve(true); },
    readFile: function (path) {
      var name = String(path).split(/[\/]/).pop();
      var dir = String(path).indexOf('base') >= 0 ? '../base/' : '../vanilla/';
      return fetch(dir + name).then(function (r) { return r.ok ? r.text() : null; });
    },
    writeFile: nil,
    pathForFile: function (f) { return Promise.resolve(String(f)); },
    onCommand: function () {}, watchAdd: nil, watchRemove: nil,
    buildTimes: function () { return Promise.resolve({}); },
    fsxList: function () { return Promise.resolve([]); },
    assetRoots: function () { return Promise.resolve([]); },
    openDialog: function () { return Promise.resolve([]); },
    saveDialog: nil, winList: function () { return Promise.resolve([]); },
    matRead: nil, matTexture: nil, matIcon: nil, modelLoad: nil,
    particlesSystem: nil, particlesList: function () { return Promise.resolve([]); },
    potatoList: function () { return Promise.resolve([]); },
    potatoModel: nil, potatoMap: nil, potatoNav: nil, potatoNavIndex: nil,
    hlmvFind: nil, hlmvOpen: nil, reveal: nil, editorGoto: nil, imageSave: nil,
    dockStart: nil, dockPos: nil, dockStop: nil, dirDialog: nil,
    closeAck: function () {}, closeProceed: function () {}
  };
})();
