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

  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', '50');
  ring.setAttribute('cy', '50');
  ring.setAttribute('r', '42');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', `url(#${gid})`);
  ring.setAttribute('stroke-width', '11');
  svg.append(ring);

  const quarter = (a0, a1) => {
    const rad = d => (d - 90) * Math.PI / 180;
    const r = 30;
    const x0 = 50 + Math.cos(rad(a0)) * r, y0 = 50 + Math.sin(rad(a0)) * r;
    const x1 = 50 + Math.cos(rad(a1)) * r, y1 = 50 + Math.sin(rad(a1)) * r;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', `M 50 50 L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`);
    p.setAttribute('fill', `url(#${gid})`);
    return p;
  };
  const gap = 7;
  for (const start of [0, 90, 180, 270]) svg.append(quarter(start + gap, start + 90 - gap));
  return svg;
}
