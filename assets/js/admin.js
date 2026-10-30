'use strict';
/* ===== Admin: doctors, medicine engines, per-doctor data (view / export) ===== */
const STATUS_LABEL = { approved: 'Approved', pending: 'Pending', blocked: 'Blocked' };
const statusColor = s => s === 'approved' ? 'var(--primary)' : s === 'pending' ? '#b26a00' : 'var(--error,#b3261e)';

Screens.admin = async () => {
  const body = h('div', { class: 'col' });
  async function draw() {
    const r = await api('admin_users');
    clear(body);
    const pend = r.users.filter(u => u.status === 'pending').length;
    if (pend) body.append(Card(null, h('div', { style: 'font-weight:600;color:#b26a00' }, pend + ' account(s) waiting for approval')));
    const grid = h('div', { class: 'grid2' });
    r.users.forEach(u => {
      const me = State.user && u.id === State.user.id;
      const act = (label, fn, kind) => Btn(label, { kind: kind || 'outline', sm: true, onClick: () => fn().then(draw).catch(e => toast(e.message)) });
      const set = st => () => api('admin_user_set', { id: u.id, status: st });
      grid.append(Card(null, [
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, u.name || '(no name)', u.role === 'admin' ? h('span', { class: 'small', style: 'margin-left:8px;color:var(--primary)' }, 'ADMIN') : null),
          h('div', { class: 'small muted' }, u.email)),
          h('span', { style: 'font-weight:600;color:' + statusColor(u.status) }, STATUS_LABEL[u.status] || u.status)),
        h('div', { class: 'small muted' }, u.patients + ' patients · ' + u.prescriptions + ' prescriptions · ' + u.list_items + ' list items'),
        h('div', { class: 'small muted' }, 'Joined ' + fmtDateTime(u.created_at) + (u.last_login ? ' · last login ' + fmtDateTime(u.last_login) : '')),
        h('div', { class: 'scrollx' },
          Btn('Open data', { sm: true, onClick: () => { location.hash = '#/admin/user/' + u.id; } }),
          !me && u.status !== 'approved' ? act('Approve', set('approved'), 'filled') : null,
          !me && u.status === 'approved' ? act('Block', set('blocked')) : null,
          !me && u.status === 'approved' ? act('Set pending', set('pending')) : null,
          !me ? act(u.role === 'admin' ? 'Make doctor' : 'Make admin', () => api('admin_user_role', { id: u.id, role: u.role === 'admin' ? 'doctor' : 'admin' })) : null,
          Btn('Password', { kind: 'outline', sm: true, onClick: () => {
            const f = Field({ label: 'New password (min 6)', type: 'text' });
            modal({ title: 'Reset password – ' + u.email, body: f, actions: [{ label: 'Cancel' }, { label: 'Set', onClick: () => { api('admin_user_password', { id: u.id, password: f.inp.value }).then(() => toast('Password changed')).catch(e => toast(e.message)); } }] });
          } }),
          !me ? Btn('Delete', { kind: 'text', sm: true, onClick: () => confirmDialog('Delete doctor', 'Delete ' + u.email + ' with ALL patients, prescriptions, chambers and lists? This cannot be undone.', () => api('admin_user_delete', { id: u.id }).then(draw).catch(e => toast(e.message))) }) : null)]));
    });
    body.append(grid);
  }
  return { title: 'Doctors', wide: true, el: body, onMount: () => draw().catch(e => toast(e.message)) };
};

Screens.admin_engines = async () => {
  const body = h('div', { class: 'col' });
  const NAMES = { dims: 'DIMS', medex: 'MedEx' };
  async function draw() {
    const r = await api('admin_users');
    clear(body);
    body.append(h('div', { class: 'small muted' }, 'Medicine databases are shared by every doctor. Only the admin can upload, replace or delete them.'));
    const grid = h('div', { class: 'grid2' });
    r.engines.forEach(e => {
      const st = e.stats;
      const prog = h('div', { class: 'small muted' });
      grid.append(Card(NAMES[e.engine] || e.engine, [
        h('div', null, st ? [st.brands + ' brands', st.generics ? ' · ' + st.generics + ' generics' : '', ' · ' + fmtSize(st.size)].join('') : 'Not installed'),
        st ? SwitchRow('Use this engine in search', e.on, v => api('admin_engine_on', { engine: e.engine, on: v }).then(() => toast(v ? 'Switched on' : 'Switched off')).catch(er => toast(er.message)),
          'If both engines are on, search shows results from both, tagged dims / medex.') : null, prog,
        h('div', { class: 'scrollx' },
          Btn(st ? 'Replace file' : 'Upload file', { sm: true, onClick: async () => {
            const f = await pickFile('.db,.sqlite,.sqlite3,application/octet-stream'); if (!f) return;
            const CH = 1024 * 1024, total = Math.max(1, Math.ceil(f.size / CH));
            try {
              for (let i = 0; i < total; i++) {
                const fd = new FormData(); fd.append('engine', e.engine); fd.append('index', i); fd.append('total', total); fd.append('chunk', f.slice(i * CH, (i + 1) * CH), 'chunk');
                prog.textContent = 'Uploading… ' + Math.round((i + 1) * 100 / total) + ' %';
                await apiForm('engine_upload', fd);
              }
              toast('Installed'); draw();
            } catch (er) { prog.textContent = ''; toast(er.message); }
          } }),
          st ? Btn('Download', { kind: 'outline', sm: true, onClick: () => { location.href = 'api.php?action=engine_export&engine=' + e.engine; } }) : null,
          st ? Btn('Delete', { kind: 'text', sm: true, onClick: () => confirmDialog('Delete ' + (NAMES[e.engine] || e.engine), 'Remove this medicine database for all doctors?', () => api('admin_engine_delete', { engine: e.engine }).then(draw)) }) : null)]));
    });
    body.append(grid);
  }
  return { title: 'Medicine engines', wide: true, el: body, onMount: () => draw().catch(e => toast(e.message)) };
};

Screens.admin_user = async id => {
  const first = await api('admin_user_patients', { id });
  const u = first.user;
  let tab = 'patients', ltype = 'complaints', q = '';
  const body = h('div', { class: 'col' });
  const tabs = h('div', { class: 'scrollx' });
  async function draw() {
    clear(tabs); clear(body);
    tabs.append(Chip('Patients', tab === 'patients', () => { tab = 'patients'; draw(); }), Chip('Suggestion lists', tab === 'lists', () => { tab = 'lists'; draw(); }));
    if (tab === 'patients') {
      const r = await api('admin_user_patients', { id, q });
      body.append(h('div', { class: 'row' }, Field({ label: 'Search name / ID / phone', value: q, onInput: debounce(v => { q = v; draw(); }, 300) }), Btn('Export JSON', { kind: 'outline', onClick: async () => { const x = await api('admin_user_export_patients', { id }); download('patients_' + u.email + '.json', JSON.stringify(x, null, 1), 'application/json'); } })),
        h('div', { class: 'small muted' }, r.total + ' patients' + (r.total > r.patients.length ? ' (showing ' + r.patients.length + ')' : '')),
        h('div', { class: 'grid2' }, r.patients.map(p => h('a', { href: '#/admin/patient/' + id + '/' + p.id, class: 'card click', style: 'text-decoration:none;color:inherit' },
          h('div', { style: 'font-weight:600' }, p.name), h('div', { class: 'small muted' }, p.id + (p.age ? ' · ' + p.age : '') + (p.phone ? ' · ' + p.phone : '')),
          h('div', { class: 'small muted' }, p.rx_count + ' Rx' + (p.last_rx ? ' · last ' + fmtDate(p.last_rx) : ''))))));
    } else {
      const r = await api('admin_user_lists', { id, type: ltype });
      body.append(h('div', { class: 'scrollx' }, LIST_TYPES.map(t => Chip(LIST_LABELS[t] + ' (' + (r.counts[t] || 0) + ')', ltype === t, () => { ltype = t; draw(); }))),
        h('div', { class: 'row' }, Btn('Export this list (text)', { kind: 'outline', sm: true, onClick: async () => { const x = await api('admin_user_export_lists', { id, type: ltype }); download(ltype + '_' + u.email + '.txt', x.text); } }),
          Btn('Export all (JSON)', { kind: 'outline', sm: true, onClick: async () => { const x = await api('admin_user_export_lists', { id }); download('lists_' + u.email + '.json', JSON.stringify(x, null, 1), 'application/json'); } })),
        Card(LIST_LABELS[ltype], r.items.length ? r.items.map((it, i) => h('div', { style: 'padding:6px 0;border-bottom:1px solid var(--outline-v,#ddd)' }, (i + 1) + '. ', ltype === 'advice' ? Advice.captionPlain(it.name) : it.name)) : h('div', { class: 'muted' }, 'Empty')));
    }
  }
  return { title: u.name || u.email, back: true, backTo: '#/admin', wide: true, el: h('div', { class: 'col' }, h('div', { class: 'small muted' }, u.email + ' · view only'), tabs, body), onMount: () => draw().catch(e => toast(e.message)) };
};

Screens.admin_patient = async (uid, pid) => {
  const r = await api('admin_user_patient', { user_id: uid, id: pid });
  const p = r.patient;
  const list = (t, a) => a && a.length ? h('div', { class: 'small' }, h('b', null, t + ': '), a.map(x => typeof x === 'string' ? x : (x.type ? x.type + ' ' + x.value : x.name || '')).join(', ')) : null;
  return { title: p.name, back: true, backTo: '#/admin/user/' + uid, wide: true, el: h('div', { class: 'col' },
    Card('Patient (view only)', [h('div', null, p.id), h('div', null, [p.age, p.sex, p.phone, p.address].filter(Boolean).join(' · ')), p.notes ? h('div', { class: 'small muted' }, p.notes) : null]),
    r.prescriptions.map(x => { const d = x.data || {}; return Card(fmtDate(x.date), [list('Complaints', d.complaints), list('Findings', d.findings), list('Diagnosis', d.diagnosis), list('Investigation', d.investigation),
      (d.medications || []).length ? h('div', null, d.medications.map(m => h('div', { class: 'small' }, '℞ ' + [m.name, m.strength, m.dosage, m.duration, m.instruction].filter(Boolean).join(' · ')))) : null,
      list('Follow up', d.followUp)]); })) };
};
