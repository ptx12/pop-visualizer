const NS = 'http://www.w3.org/2000/svg';

export function tfMark(size = 22, style = 'silver') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'tf-mark tf-mark-' + style);

  const gid = 'tfmark-' + style;
  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.setAttribute('id', gid);
  grad.setAttribute('x1', '0');
  grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0');
  grad.setAttribute('y2', '1');
  const stops = style === 'blue'
    ? [['0%', '#a8cff5'], ['45%', '#6a97c4'], ['55%', '#4d6f93'], ['100%', '#7ea9d2']]
    : [['0%', '#f4f7fa'], ['45%', '#c6ced6'], ['55%', '#868e97'], ['100%', '#dfe5ec']];
  for (const [off, col] of stops) {
    const s = document.createElementNS(NS, 'stop');
    s.setAttribute('offset', off);
    s.setAttribute('stop-color', col);
    grad.append(s);
  }
  defs.append(grad);
  svg.append(defs);

  const R = 46;
  const HOLE = 11.5;
  const GAP = 4;
  const outer = Math.sqrt(R * R - GAP * GAP);
  const inner = Math.sqrt(HOLE * HOLE - GAP * GAP);

  const pt = (x, y, angle) => {
    const a = angle * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return `${(50 + x * c - y * s).toFixed(2)} ${(50 + x * s + y * c).toFixed(2)}`;
  };

  const quarter = angle => [
    `M ${pt(GAP, -inner, angle)}`,
    `L ${pt(GAP, -outer, angle)}`,
    `A ${R} ${R} 0 0 1 ${pt(outer, -GAP, angle)}`,
    `L ${pt(inner, -GAP, angle)}`,
    `A ${HOLE} ${HOLE} 0 0 0 ${pt(GAP, -inner, angle)}`,
    'Z'
  ].join(' ');

  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', [0, 90, 180, 270].map(quarter).join(' '));
  p.setAttribute('fill', `url(#${gid})`);
  svg.append(p);
  return svg;
}
