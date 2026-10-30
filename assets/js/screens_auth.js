'use strict';
function authBox(title, sub, kids) {
  return h('div', { class: 'auth' }, h('div', { class: 'box' },
    h('div', { class: 'row' }, h('div', { class: 'logo' }, 'Rx'), h('div', null, h('h1', null, 'WebRxPad'), h('div', { class: 'muted small' }, sub))),
    h('div', { class: 'title-m' }, title), kids));
}
Screens.login = async () => {
  const email = Field({ label: 'E-mail', type: 'email', autocomplete: 'username' });
  const pw = Field({ label: 'Password', type: 'password', autocomplete: 'current-password', onEnter: () => go() });
  const msg = h('div', { class: 'err small' });
  async function go() {
    msg.textContent = '';
    try {
      const r = await api('login', { email: email.inp.value, password: pw.inp.value });
      State.csrf = r.csrf; State.user = r.user; location.hash = '#/patients';
    } catch (e) { msg.textContent = e.message; }
  }
  return { el: authBox('Sign in', 'Doctor prescription pad', [email, pw, msg,
    Btn('Sign in', { block: true, onClick: go }),
    h('div', { class: 'small muted', style: 'text-align:center' }, 'New doctor? ', h('a', { href: '#/signup' }, 'Create an account'), '. The admin must approve it before you can sign in.')]) };
};
Screens.signup = async () => {
  const f = {
    name: Field({ label: 'Full name *' }), email: Field({ label: 'E-mail *', type: 'email' }),
    pw: Field({ label: 'Password (min 6) *', type: 'password' }), pw2: Field({ label: 'Repeat password *', type: 'password' }),
    degrees: Field({ label: 'Degrees (optional)' }), specialty: Field({ label: 'Specialty (optional)' }),
    bmdc: Field({ label: 'BMDC registration no. (optional)' }), phone: Field({ label: 'Phone (optional)', type: 'tel' })
  };
  const msg = h('div', { class: 'err small' });
  const box = h('div', { class: 'col' });
  async function go() {
    msg.textContent = '';
    if (f.pw.inp.value !== f.pw2.inp.value) { msg.textContent = 'Passwords do not match'; return; }
    try {
      const r = await api('signup', { name: f.name.inp.value, email: f.email.inp.value, password: f.pw.inp.value, degrees: f.degrees.inp.value, specialty: f.specialty.inp.value, bmdc: f.bmdc.inp.value, phone: f.phone.inp.value });
      clear(box);
      box.append(h('div', { class: 'ok' }, r.message), Btn('Back to sign in', { block: true, onClick: () => { location.hash = '#/login'; } }));
    } catch (e) { msg.textContent = e.message; }
  }
  box.append(...Object.values(f), msg, Btn('Create account', { block: true, onClick: go }), h('div', { class: 'small muted', style: 'text-align:center' }, h('a', { href: '#/login' }, 'I already have an account')));
  return { el: authBox('Create doctor account', 'Your account is checked by the admin first', box) };
};
Screens.setup = async () => {
  const f = { name: Field({ label: 'Admin name' }), email: Field({ label: 'Admin e-mail', type: 'email' }), pw: Field({ label: 'Password (min 6)', type: 'password' }) };
  const msg = h('div', { class: 'err small' });
  async function go() {
    msg.textContent = '';
    try {
      const r = await api('setup_admin', { name: f.name.inp.value, email: f.email.inp.value, password: f.pw.inp.value });
      State.csrf = r.csrf; State.user = r.user; State.setup = false; location.hash = '#/patients';
    } catch (e) { msg.textContent = e.message; }
  }
  return { el: authBox('First-time setup', 'Create the administrator account', [h('div', { class: 'small muted' }, 'This account approves doctors, manages the medicine databases and can view every doctor’s data.'), Object.values(f), msg, Btn('Create admin account', { block: true, onClick: go })]) };
};
