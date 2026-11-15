// Tiny DOM helpers, inline citations and formatters.
import { icon } from './icons.js';
import { SOURCE_BY_ID } from '../sources.js';

export function h(tag, attrs = {}, ...children) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export { icon };

/** Inline citation: plain text that underlines on hover, shows its provenance, and opens its source on click. */
export function cite(text, src, cls = '') {
  const s = SOURCE_BY_ID[src];
  return h(`span.cite${cls ? '.' + cls : ''}`, { 'data-src': src, 'data-prov': s ? s.tag : '', role: 'button', tabindex: 0 }, text);
}
/** Label / value row. Returns { el, set(text, statusClass) }. */
export function metric(label, src, unit = '', ic = null) {
  const v = cite('—', src), num = document.createTextNode('—');
  v.replaceChildren(num, unit ? h('span.unit', {}, ' ' + unit) : '');
  const el = h('.row', {}, ic ? icon(ic, 17) : null, h('span.lab', {}, label), v);
  return { el, set: (x, cls) => { if (num.data !== x) num.data = x; const c = 'cite' + (cls ? ' ' + cls : ''); if (v.className !== c) v.className = c; } };
}
export const row = (label, value, src, ic = null, unit = '') => { const m = metric(label, src, unit, ic); m.set(value); return m.el; };

export const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60; return hh ? `${hh} h ${String(mm).padStart(2, '0')} min` : `${mm} min ${String(s % 60).padStart(2, '0')} s`; };
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtLat = (v, d = 2) => `${Math.abs(v).toFixed(d)}°${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v, d = 2) => `${v.toFixed(d)}°E`;
const ll = (v) => `${Math.abs(v)}°${v < 0 ? 'S' : v > 0 ? 'N' : ''}`;
export const latRange = (q) => (q.south > 0 ? `${q.south}°–${q.north}°N` : q.north < 0 ? `${-q.north}°–${-q.south}°S` : `${ll(q.south)}–${ll(q.north)}`);
export const lonRange = (q) => `${q.west}°–${q.east}°E`;
export function toast(text) {
  const t = h('.toast', {}, text); document.getElementById('ui').append(t);
  setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3900);
}
