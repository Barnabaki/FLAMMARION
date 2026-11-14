// Tiny DOM helpers + provenance badges.
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
export const PROVENANCE = {
  SATELLITE: 'Orbital imagery / remote sensing product',
  IAU: 'IAU / USGS Gazetteer of Planetary Nomenclature',
  HISTORIC: 'Historic in-situ measurement — not live',
  MODELLED: 'Model-based estimate — not a measurement',
  SIMULATED: 'Simulated for this demo — no real data exists',
  EMULATED: 'Emulated for this demo',
  COMPUTED: 'Computed exactly from ephemeris / geometry',
  DEMO: 'Created solely for demonstration',
};
export const badge = (p) => h(`span.badge.b-${p.toLowerCase()}`, { title: PROVENANCE[p] || p }, p);
/** A labelled value row: label, value (updatable), unit, provenance badge. Returns { el, set }. */
export function metric(label, prov, unit = '') {
  const v = h('span.val', {}, '—');
  const el = h('.metric', {}, h('span.lab', {}, label), h('span.right', {}, v, unit ? h('span.unit', {}, unit) : null, badge(prov)));
  return { el, set: (x, cls) => { v.textContent = x; v.className = 'val' + (cls ? ' ' + cls : ''); } };
}
export const fmtDur = (s) => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60; return hh ? `${hh} h ${String(mm).padStart(2, '0')} min` : `${mm} min ${String(s % 60).padStart(2, '0')} s`; };
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
export const fmtLat = (v) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? 'N' : 'S'}`;
export const fmtLon = (v) => `${v.toFixed(4)}°E`;
export function toast(text) {
  const t = h('.toast', {}, text); document.getElementById('ui').append(t);
  setTimeout(() => t.classList.add('out'), 2600); setTimeout(() => t.remove(), 3200);
}
