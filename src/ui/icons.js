// Thin-stroke line icons (24×24 grid, 1.4 px stroke, currentColor).
const P = {
  ruler: '<path d="M3.5 15.5 15.5 3.5l5 5-12 12z"/><path d="m7 12 2 2M10 9l2 2M13 6l2 2"/>',
  orbit: '<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-28 12 12)"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
  thermo: '<path d="M12 3.5a2 2 0 0 0-2 2v8.3a4 4 0 1 0 4 0V5.5a2 2 0 0 0-2-2z"/><path d="M12 9v8"/>',
  wind: '<path d="M3 9h10.5a2.5 2.5 0 1 0-2.4-3.2M3 13h15a2.5 2.5 0 1 1-2.4 3.2M3 17h7"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M12 6.5l-2-2M12 6.5l2-2M12 17.5l-2 2M12 17.5l2 2"/>',
  hand: '<path d="M9 11.5V5.2a1.6 1.6 0 0 1 3.2 0v5M12.2 10V8.6a1.5 1.5 0 0 1 3 0V11M15.2 10.6a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.1a5 5 0 0 1-4-2l-3-4.1a1.5 1.5 0 0 1 2.3-1.9L9 15V9"/>',
  tap: '<path d="M12 2.5v2.2M6.3 4.9l1.5 1.6M17.7 4.9l-1.5 1.6M4.5 10h2.1M17.4 10h2.1"/><path d="M10 13.5V9.8a1.5 1.5 0 0 1 3 0v3.4l3.6.9a2 2 0 0 1 1.5 2.3l-.6 3.1a2.5 2.5 0 0 1-2.4 2h-3a3 3 0 0 1-2.3-1.1L6.6 17a1.4 1.4 0 0 1 2.1-1.8l1.3 1.2"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3.5"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.400 6.500 11 6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
  layers: '<path d="m12 3.5 9 4.800-9 4.800-9-4.800z"/><path d="m3.500 12.200 8.500 4.500 8.500-4.500M3.500 16l8.500 4.500 8.500-4.500"/>',
  mountain: '<path d="M2.500 19.500 9 8l4 6.500 2.500-3.500 6 8.500z"/>',
  chevL: '<path d="m14.500 5-7 7 7 7"/>', chevR: '<path d="m9.500 5 7 7-7 7"/>',
  back: '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7.500"/><circle cx="12" cy="12" r="1.600"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3"/>',
  zoom: '<circle cx="10.500" cy="10.500" r="6.500"/><path d="m15.500 15.500 5 5M10.500 8v5M8 10.500h5"/>',
  scroll: '<rect x="7.500" y="3" width="9" height="18" rx="4.500"/><path d="M12 7v4M9.800 14.500 12 17l2.200-2.500"/>',
  pinch: '<path d="M4 4l5 5M9 5v4H5M20 20l-5-5M15 19v-4h4"/>',
  play: '<path d="M8 5.500v13l10.500-6.500z"/>', pause: '<path d="M8.500 5.500v13M15.500 5.500v13"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5.500"/>',
  dust: '<circle cx="6" cy="8" r="1"/><circle cx="12" cy="6" r="1"/><circle cx="18" cy="9" r="1"/><circle cx="8" cy="13" r="1"/><circle cx="15" cy="13.500" r="1"/><circle cx="5" cy="18" r="1"/><circle cx="11" cy="18.500" r="1"/><circle cx="18" cy="17.500" r="1"/>',
  battery: '<rect x="3" y="7.500" width="15.500" height="9" rx="2.500"/><path d="M21 10.500v3M6 10.500v3M9 10.500v3"/>',
  drone: '<circle cx="5.500" cy="6.500" r="2.500"/><circle cx="18.500" cy="6.500" r="2.500"/><circle cx="5.500" cy="17.500" r="2.500"/><circle cx="18.500" cy="17.500" r="2.500"/><path d="m7.500 8.500 3 2M16.500 8.500l-3 2M7.500 15.500l3-2M16.500 15.500l-3-2"/><rect x="10" y="10" width="4" height="4" rx="1"/>',
  route: '<circle cx="6" cy="18.500" r="2"/><circle cx="18" cy="5.500" r="2"/><path d="M8 18.500h6.500a3 3 0 0 0 0-6h-5a3 3 0 0 1 0-6H16"/>',
  flag: '<path d="M6 21V4M6 4.500h11l-2.500 4 2.500 4H6"/>',
  alert: '<path d="M12 4 2.800 19.500h18.400z"/><path d="M12 10v4.500M12 17v.300"/>',
  doc: '<path d="M7 3.500h7l4 4V20.500H7z"/><path d="M14 3.500v4h4M9.500 12h5M9.500 15.500h5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="3.800"/><path d="M12 3v2.200M12 18.800V21M3 12h2.200M18.800 12H21M5.600 5.600l1.600 1.600M16.800 16.800l1.600 1.600M5.600 18.400l1.600-1.600M16.800 7.200l1.600-1.600"/>',
  compass: '<circle cx="12" cy="12" r="8.500"/><path d="m15 9-1.800 4.200L9 15l1.800-4.200z"/>',
  altitude: '<path d="M4 20h16M12 17V4M8 8l4-4 4 4"/>',
  speed: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17 8.500 9.500"/>',
  signal: '<path d="M5 18v-3M10 18v-6M15 18V9M20 18V5"/>',
  heart: '<path d="M12 20s-7.500-4.600-7.500-10A4.200 4.200 0 0 1 12 7.500 4.200 4.200 0 0 1 19.500 10c0 5.400-7.500 10-7.500 10z"/>',
  eye: '<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z"/><circle cx="12" cy="12" r="2.800"/>',
  restart: '<path d="M4.500 12a7.500 7.500 0 1 0 2.300-5.400M4.500 4.500v4h4"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  bolt: '<path d="M13 2.500 5.500 13.500H12l-1 8 7.500-11H12z"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('class', 'ic');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.4'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = P[name] || ''; return s;
}
