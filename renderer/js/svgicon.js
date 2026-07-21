const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  'file-plus': ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M12 12v6', 'M9 15h6'],
  folder: ['M4 7a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'],
  library: ['M4 4h5v16H4z', 'M11 4h4v16h-4z', 'M17.5 4.5l3 15'],
  save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h7'],
  'save-as': ['M20 12V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7', 'M7 3v5h8', 'M16 19h6', 'M19 16v6'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H10'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H14'],
  cube: ['M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.3 7L12 12l8.7-5', 'M12 22V12'],
  dock: ['M3 4h18v16H3z', 'M3 14h18'],
  check: ['M21 11v1a9 9 0 1 1-5.3-8.2', 'M21 5l-9 9-3-3'],
  alert: ['M12 3.5L2.6 19a1.6 1.6 0 0 0 1.4 2.4h16a1.6 1.6 0 0 0 1.4-2.4z', 'M12 9.5v4.5', 'M12 18h.01'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.3 9.2a2.8 2.8 0 0 1 5.4.9c0 1.9-2.7 2.6-2.7 2.6', 'M12 17h.01'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 11l5 5 5-5', 'M12 16V3'],
  maximize: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M16 21h3a2 2 0 0 0 2-2v-3', 'M3 16v3a2 2 0 0 0 2 2h3'],
  sliders: ['M4 21v-6', 'M4 11V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-4', 'M20 13V3', 'M1.5 15h5', 'M9.5 8h5', 'M17.5 17h5'],
  play: ['M6 3.5l13 8.5-13 8.5z'],
  pause: ['M7 4h3v16H7z', 'M14 4h3v16h-3z'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  'chevron-down': ['M6 9l6 6 6-6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  map: ['M9 4L3 7v13l6-3 6 3 6-3V4l-6 3z', 'M9 4v13', 'M15 7v13'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 14l9 5 9-5'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  crosshair: ['M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 2v4', 'M12 18v4', 'M2 12h4', 'M18 12h4', 'M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z'],
  brush: ['M9.5 14.5L4 20l1.5 1.5 5.5-5.5', 'M14 3.5l6.5 6.5-7 7-6.5-6.5z', 'M12.5 5l6.5 6.5'],
  eraser: ['M8 21H5l-2.5-2.5a2 2 0 0 1 0-2.8L13.6 5.6a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L11.5 21z', 'M8 21h13', 'M9 10l6 6']
};

export function icon(name, size = 16) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'svgi');
  for (const d of PATHS[name] || PATHS.help) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}
