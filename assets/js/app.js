'use strict';
/* ===== shell + router ===== */
const Screens = {};   // name -> async (params) => spec
let navToken = 0;

const NAV = [
  { key: 'patients', label: 'Patients', icon: 'people', hash: '#/patients' },
  { key: 'settings', label: 'Settings', icon: 'settings', hash: '#/settings' }
];
const ADMIN_NAV = [
  { key: 'admin', label: 'Doctors', icon: 'shield', hash: '#/admin' },
  { key: 'admin_engines', label: 'Medicine engines', icon: 'storage', hash: '#/admin/engines' }
];

function topKey(route) {
  if (route === 'patients') return 'patients';
  if (route === 'settings') return 'settings';
  if (route === 'admin') return 'admin';
  if (route === 'admin/engines') return 'admin_engines';
  return null;
}

function parseHash() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = raw.split('/').map(decodeURIComponent);
  return { raw, parts };
}

function resolve(parts) {
  const [a, b, c] = parts;
  if (!a) return { name: State.user ? 'patients' : 'login', p: [] };
  if (a === 'login' || a === 'signup' || a === 'setup') return { name: a, p: [] };
  if (a === 'patients') return { name: 'patients', p: [] };
  if (a === 'patient') return { name: 'patient', p: [b] };
  if (a === 'patient_edit') return { name: 'patient_edit', p: [b] };
  if (a === 'rx') return { name: 'rx', p: [b, c] };
  if (a === 'settings') return { name: b ? 'settings_' + b : 'settings', p: [c] };
  if (a === 'about') return { name: 'about', p: [] };
  if (a === 'admin') {
    if (!b) return { name: 'admin', p: [] };
    if (b === 'engines') return { name: 'admin_engines', p: [] };
    if (b === 'user') return { name: 'admin_user', p: [c] };
    if (b === 'patient') return { name: 'admin_patient', p: [c, parts[3]] };
  }
  return { name: 'patients', p: [] };
}

function drawShell(spec, routeKey, topLevel) {
  const app = $('#app');
  clear(app);
  const isAdmin = State.user && State.user.role === 'admin';
  const navItems = NAV.concat(isAdmin ? ADMIN_NAV : []);
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'Rx'), 'WebRxPad'),
    h('nav', null,
      NAV.map(n => h('a', { href: n.hash, class: routeKey === n.key ? 'on' : '' }, icon(n.icon), n.label)),
      isAdmin ? [h('div', { class: 'sep' }), h('div', { class: 'small muted', style: 'padding:2px 14px' }, 'Admin'), ADMIN_NAV.map(n => h('a', { href: n.hash, class: routeKey === n.key ? 'on' : '' }, icon(n.icon), n.label))] : null),
    h('div', { class: 'who' }, h('b', null, (State.user && State.user.name) || ''), State.user ? State.user.email : '',
      h('div', { style: 'margin-top:8px' }, h('a', { href: '#', onClick: e => { e.preventDefault(); doLogout(); } }, 'Sign out'))));
  const bar = h('header', { class: 'appbar' },
    spec.back ? iconBtn('back', 'Back', () => { if (spec.backTo) location.hash = spec.backTo; else history.back(); }) : null,
    h('h1', null, spec.title || ''), spec.actions || null);
  const content = h('main', { class: 'content' + (spec.nopad ? ' nopad' : '') });
  content.append(spec.wide ? spec.el : h('div', { class: 'wrap' }, spec.el));
  const mobileNav = h('nav', { class: 'bottomnav' }, navItems.map(n => h('a', { href: n.hash, class: routeKey === n.key ? 'on' : '' }, h('span', { class: 'pill' }, icon(n.icon)), n.label)));
  const main = h('div', { class: 'main' }, bar, content, spec.bottom ? h('div', { class: 'bottombar' }, h('div', { class: 'wrap', style: 'max-width:1040px' }, spec.bottom)) : null, topLevel ? mobileNav : null);
  app.append(side, main);
  if (spec.fabs) app.append(spec.fabs);
}

async function doLogout() {
  try { const r = await api('logout'); State.csrf = r.csrf; } catch (e) { /* ignore */ }
  State.user = null;
  location.hash = '#/login';
}

async function route() {
  const token = ++navToken;
  const { parts } = parseHash();
  const r = resolve(parts);
  const open = ['login', 'signup', 'setup'];
  if (State.setup && r.name !== 'setup') { location.hash = '#/setup'; return; }
  if (!State.user && !open.includes(r.name)) { location.hash = '#/login'; return; }
  if (State.user && open.includes(r.name)) { location.hash = '#/patients'; return; }
  if (r.name.startsWith('admin') && (!State.user || State.user.role !== 'admin')) { location.hash = '#/patients'; return; }
  const fn = Screens[r.name];
  if (!fn) { location.hash = '#/patients'; return; }
  const app = $('#app');
  document.body.classList.remove('printing');
  if (open.includes(r.name)) {
    clear(app);
    const spec = await fn(...r.p);
    if (token === navToken) app.append(spec.el);
    return;
  }
  if (!app.firstChild) app.append(h('div', { class: 'main' }, h('div', { class: 'content' }, h('div', { class: 'bar' }))));
  let spec;
  try { spec = await fn(...r.p); }
  catch (e) {
    if (token !== navToken) return;
    spec = { title: 'Error', back: true, backTo: '#/patients', el: Card('Something went wrong', h('div', { class: 'err' }, e.message || String(e))) };
  }
  if (token !== navToken) return;
  const tk = topKey(parts.join('/').replace(/\/+$/, ''));
  const seg = parts[0] === 'patient' || parts[0] === 'patient_edit' || parts[0] === 'rx' ? 'patients' : parts[0] === 'about' ? 'settings' : parts[0] === 'admin' ? (parts[1] === 'engines' ? 'admin_engines' : 'admin') : parts[0];
  drawShell(spec, tk || seg, !!tk);
  if (spec.onMount) spec.onMount();
  const cont = $('.content'); if (cont) cont.scrollTop = 0;
}

async function boot() {
  try {
    const r = await fetch('api.php?action=boot', { credentials: 'same-origin' }).then(x => x.json());
    State.csrf = r.csrf; State.user = r.user; State.setup = r.setup_needed; State.version = r.version;
  } catch (e) {
    $('#app').append(h('div', { class: 'auth' }, h('div', { class: 'box' }, h('h1', null, 'Cannot start'), h('div', { class: 'err' }, 'The server did not answer. Is PHP running?'))));
    return;
  }
  window.addEventListener('hashchange', route);
  route();
}
document.addEventListener('DOMContentLoaded', boot);
