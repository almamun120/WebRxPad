'use strict';
const LIST_LABELS = { complaints: 'Complaints', history: 'History', findings: 'Findings', investigation: 'Investigation', diagnosis: 'Diagnosis', advice: 'Advice', follow_up: 'Follow up', instruction: 'Medicine instruction' };
const LIST_TYPES = Object.keys(LIST_LABELS);

function settingsItem(ic, title, sub, hash) {
  return h('a', { href: hash, class: 'card click', style: 'text-decoration:none;color:inherit;flex-direction:row;align-items:center;gap:16px' },
    h('span', { class: 'ok' }, icon(ic)), h('div', { class: 'grow' }, h('div', { class: 'title-m', style: 'font-weight:500' }, title), h('div', { class: 'small muted' }, sub)), icon('drop', 22));
}
Screens.settings = async () => {
  const items = [
    ['person', 'Doctor profile', 'Photo, name, degrees, BMDC no.', '#/settings/doctor'],
    ['place', 'Chambers', 'Add / edit chambers, choose the current one', '#/settings/chambers'],
    ['tune', 'Page setup (PDF / print)', 'Place every item exactly where you want it', '#/settings/page'],
    ['mail', 'E-mail server', 'SMTP, sender, recipients, templates', '#/settings/email'],
    ['storage', 'Database', 'Backup patients, medicine search, suggestion lists', '#/settings/database'],
    ['med', 'Suggestion lists', 'Complaints, history, advice, ...', '#/settings/lists'],
    ['lock', 'Account', 'Password and sign out', '#/settings/account'],
    ['info', 'About', 'Version ' + State.version, '#/about']
  ];
  return { title: 'Settings', el: h('div', { class: 'grid2' }, items.map(i => settingsItem(...i))) };
};

Screens.settings_doctor = async () => {
  const s = await api('settings_get');
  const d = s.doctor || {};
  let hasPhoto = s.has_photo;
  const photo = h('div');
  const drawPhoto = () => {
    clear(photo);
    photo.append(h('div', { class: 'row', style: 'gap:12px' },
      hasPhoto ? h('img', { src: 'api.php?action=file&kind=photo&t=' + Date.now(), style: 'width:84px;height:84px;border-radius:50%;object-fit:cover' })
        : h('div', { style: 'width:84px;height:84px;border-radius:50%;background:var(--surface-v);display:flex;align-items:center;justify-content:center;color:var(--outline)' }, icon('person', 48)),
      h('div', { class: 'col', style: 'gap:6px' },
        Btn(hasPhoto ? 'Change photo' : 'Add photo', { onClick: async () => {
          const f = await pickFile('image/*'); if (!f) return;
          try { await api('image_upload', { kind: 'photo', data: await resizeImage(f, 600, 'image/jpeg') }); hasPhoto = true; drawPhoto(); } catch (e) { toast('Photo failed: ' + e.message); }
        } }),
        hasPhoto ? Btn('Remove photo', { kind: 'outline', onClick: async () => { await api('image_delete', { kind: 'photo' }); hasPhoto = false; drawPhoto(); } }) : null)));
  };
  drawPhoto();
  const f = {
    name: Field({ label: 'Doctor name', value: d.name }), degrees: Field({ label: 'Degrees', value: d.degrees, multiline: true, rows: 2 }),
    specialty: Field({ label: 'Specialty', value: d.specialty }), bmdc: Field({ label: 'BMDC registration no.', value: d.bmdc }),
    phone: Field({ label: 'Phone', value: d.phone, type: 'tel' }), email: Field({ label: 'E-mail', value: d.email, type: 'email' })
  };
  const save = async () => {
    await api('settings_set', { doctor: { name: f.name.inp.value, degrees: f.degrees.inp.value, specialty: f.specialty.inp.value, bmdc: f.bmdc.inp.value, phone: f.phone.inp.value, email: f.email.inp.value } });
    toast('Saved'); location.hash = '#/settings';
  };
  return { title: 'Doctor profile', back: true, backTo: '#/settings', el: h('div', { class: 'col' },
    Card('Photo', [photo, h('div', { class: 'small muted' }, 'The photo is printed only if you turn it on in Page setup.')]),
    Card('Printed on every prescription', Object.values(f)),
    Btn('Chambers (clinic, address, GPS) →', { kind: 'outline', block: true, onClick: () => { location.hash = '#/settings/chambers'; } }),
    Btn('Save', { block: true, onClick: save })) };
};

Screens.settings_chambers = async () => {
  const body = h('div', { class: 'col' });
  async function draw() {
    const r = await api('chambers_list');
    clear(body);
    const cur = Card('Current chamber', null);
    if (!r.chambers.length) cur.append(h('div', null, 'No chamber yet. Add one below.'));
    r.chambers.forEach(c => {
      const rd = h('input', { type: 'radio', class: 'rd', name: 'curch' }); rd.checked = c.id === r.current;
      rd.addEventListener('change', async () => { await api('settings_set', { current_chamber: c.id }); toast('Current chamber changed'); });
      cur.append(h('div', { class: 'li' }, rd, h('div', { class: 't' },
        h('div', { style: 'font-weight:600' }, c.name || '(no clinic name)'), c.address ? h('div', { class: 'small' }, c.address) : null,
        c.phone ? h('div', { class: 'small muted' }, 'Phone: ' + c.phone) : null, (c.lat && c.lon) ? h('div', { class: 'small muted' }, 'GPS: ' + c.lat + ', ' + c.lon) : null, c.note ? h('div', { class: 'small muted' }, c.note) : null),
        iconBtn('edit', 'Edit', () => edit(c)), iconBtn('del', 'Delete', () => confirmDialog('Delete chamber', 'Delete “' + (c.name || 'this chamber') + '”? Old prescriptions keep their copy.', async () => { await api('chamber_delete', { id: c.id }); draw(); }))));
    });
    cur.append(h('div', null, Btn('Add chamber', { icon: 'add', onClick: () => edit({ id: '', name: '', address: '', phone: '', lat: '', lon: '', note: '' }) })));
    body.append(cur, h('div', { class: 'small muted' }, 'The current chamber is added to every new prescription. You can change it per prescription.'));
  }
  function edit(c) {
    const f = { name: Field({ label: 'Clinic / chamber name', value: c.name }), address: Field({ label: 'Address', value: c.address, multiline: true, rows: 2 }),
      phone: Field({ label: 'Phone', value: c.phone, type: 'tel' }), lat: Field({ label: 'Latitude', value: c.lat }), lon: Field({ label: 'Longitude', value: c.lon }),
      note: Field({ label: 'Note (e.g. visiting hours)', value: c.note, multiline: true, rows: 2 }) };
    const gps = Btn('Use my current location', { kind: 'outline', icon: 'gps', onClick: () => {
      if (!navigator.geolocation) { toast('GPS is not available in this browser'); return; }
      gps.disabled = true;
      navigator.geolocation.getCurrentPosition(p => { f.lat.inp.value = p.coords.latitude.toFixed(6); f.lon.inp.value = p.coords.longitude.toFixed(6); gps.disabled = false; },
        e => { gps.disabled = false; toast('Could not get the location: ' + e.message); }, { enableHighAccuracy: true, timeout: 20000 });
    } });
    modal({ title: c.id ? 'Edit chamber' : 'Add chamber', body: [f.name, f.address, f.phone, h('div', { class: 'row' }, h('div', { class: 'grow' }, f.lat), h('div', { class: 'grow' }, f.lon)), gps, f.note],
      actions: [{ label: 'Cancel' }, { label: 'Save', onClick: async () => {
        try { await api('chamber_save', { chamber: { id: c.id, name: f.name.inp.value, address: f.address.inp.value, phone: f.phone.inp.value, lat: f.lat.inp.value, lon: f.lon.inp.value, note: f.note.inp.value } }); draw(); }
        catch (e) { toast(e.message); return false; }
      } }] });
  }
  await draw();
  return { title: 'Chambers', back: true, backTo: '#/settings', el: body };
};

Screens.settings_email = async () => {
  const s = await api('settings_get');
  const c = s.smtp || {};
  let security = c.security || 'SSL';
  const recipients = [...(s.recipients || [])];
  let def = s.default_recipient || '';
  const f = { host: Field({ label: 'Host (e.g. smtp.gmail.com)', value: c.host }), port: Field({ label: 'Port', value: c.port || 465, inputmode: 'numeric' }),
    user: Field({ label: 'Username', value: c.username }), pass: Field({ label: s.smtp_has_pass ? 'Password / app password (leave empty to keep)' : 'Password / app password', type: 'password', autocomplete: 'new-password' }),
    from: Field({ label: 'Sender e-mail', value: c.from, type: 'email' }), fromName: Field({ label: 'Sender name', value: c.from_name }),
    body: Field({ label: 'Body', value: s.mail_body, multiline: true, rows: 4 }), newEmail: Field({ label: 'New e-mail address', type: 'email' }), newLabel: Field({ label: 'Label (optional)' }) };
  const secRow = h('div', { class: 'row' });
  const drawSec = () => { clear(secRow); [['SSL', 465], ['STARTTLS', 587], ['NONE', 25]].forEach(([k, p]) => secRow.append(Chip(k === 'NONE' ? 'None' : k, security === k, () => { security = k; f.port.inp.value = p; drawSec(); }))); };
  drawSec();
  const recBox = h('div');
  const drawRec = () => {
    clear(recBox);
    if (!recipients.length) recBox.append(h('div', { class: 'small muted' }, 'No recipient yet.'));
    recipients.forEach((r, i) => {
      const rd = h('input', { type: 'radio', class: 'rd', name: 'defrec' }); rd.checked = def === r.email; rd.addEventListener('change', () => { def = r.email; });
      recBox.append(h('div', { class: 'li' }, rd, h('div', { class: 't' }, h('div', null, r.email), r.label ? h('div', { class: 'small muted' }, r.label) : null), iconBtn('close', 'Remove', () => { if (def === r.email) def = ''; recipients.splice(i, 1); drawRec(); })));
    });
  };
  drawRec();
  const saveAll = async () => {
    await api('settings_set', { smtp: { host: f.host.inp.value, port: parseInt(f.port.inp.value, 10) || 465, security, username: f.user.inp.value, password: f.pass.inp.value, from: f.from.inp.value || f.user.inp.value, from_name: f.fromName.inp.value },
      mail_body: f.body.inp.value, recipients, default_recipient: def });
  };
  const el = h('div', { class: 'grid2' },
    Card('SMTP server', [f.host, f.port, h('div', { class: 'small muted' }, 'Security'), secRow, f.user, f.pass, f.from, f.fromName]),
    h('div', { class: 'col' },
      Card('Recipients', [recBox, h('div', { class: 'small muted' }, 'The selected one is pre-checked when sending.'), f.newEmail, f.newLabel,
        h('div', null, Btn('Add recipient', { kind: 'outline', onClick: () => {
          const e = f.newEmail.inp.value.trim();
          if (!/^\S+@\S+\.\S+$/.test(e)) { toast('Invalid e-mail address'); return; }
          if (recipients.some(r => r.email.toLowerCase() === e.toLowerCase())) { toast('Already added'); return; }
          recipients.push({ email: e, label: f.newLabel.inp.value.trim() }); f.newEmail.inp.value = ''; f.newLabel.inp.value = ''; drawRec();
        } }))]),
      Card('Message template', [h('div', { class: 'small muted' }, 'Subject and PDF name are automatic: prescription_date-time_doctor_name_age_id'), f.body,
        h('div', { class: 'small muted' }, 'Placeholders: {patient}  {doctor}  {date}. Doctor info and Chamber info are always added under this text.')]),
      h('div', { class: 'row' },
        Btn('Save', { onClick: async () => { try { await saveAll(); toast('Saved'); } catch (e) { toast(e.message); } } }),
        Btn('Send test e-mail', { kind: 'outline', onClick: async () => {
          const to = recipients.length ? (def || recipients[0].email) : f.from.inp.value;
          try { await saveAll(); await api('mail_test', { to }); toast('Test e-mail sent to ' + to); } catch (e) { toast(e.message, 7000); }
        } }))));
  return { title: 'E-mail server', back: true, backTo: '#/settings', el };
};

Screens.settings_database = async () => {
  const [s, cnt, st] = await Promise.all([api('settings_get'), api('lists_counts'), api('drug_status')]);
  const limit = Field({ label: 'Maximum results in the search list (5–200)', value: s.drug_limit, inputmode: 'numeric', onChange: async v => { const n = parseInt(v, 10); if (n) { await api('settings_set', { drug_limit: n }); toast('Saved'); } } });
  const patBox = h('div');
  async function patientsExport() {
    const r = await api('patients_export');
    download('rxpad_patients_backup.json', JSON.stringify(r, null, 1), 'application/json');
    toast('Exported ' + r.patients.length + ' patients, ' + r.prescriptions.length + ' prescriptions');
  }
  async function patientsImport() {
    const f = await pickFile('.json,application/json'); if (!f) return;
    try { const r = await api('patients_import', { text: await readText(f) }); toast(r.message, 6000); } catch (e) { toast('Import failed: ' + e.message, 6000); }
  }
  async function listsImport() {
    const f = await pickFile('.json,.txt,.csv,text/*,application/json'); if (!f) return;
    try { const r = await api('lists_import', { text: await readText(f) }); toast('Added ' + r.added + ', skipped ' + r.skipped, 5000); route(); } catch (e) { toast('Import failed: ' + e.message, 6000); }
  }
  async function listsExport() { const r = await api('lists_export_json', { scope: 'own' }); download('rxpad_my_lists.json', JSON.stringify(r, null, 1), 'application/json'); }
  const el = h('div', { class: 'grid2' },
    h('div', { class: 'col' },
      Card('Medicine database', [h('div', null, st.has_db ? 'Active engine: ' + (st.engine === 'medex' ? 'MedEx' : 'DIMS') : 'No medicine database has been added yet.'),
        h('div', { class: 'small muted' }, 'The medicine databases are managed by the admin and shared with every doctor.')]),
      Card('Medicine search', [limit, h('div', { class: 'small muted' }, 'Default 40.'),
        SwitchRow('Also search in indications', s.search_indications, async v => { await api('settings_set', { search_indications: v }); }, 'Turn off for faster search on slow phones.')]),
      Card('Patients data (backup)', [h('div', { class: 'small muted' }, 'Export saves every one of your patients and prescriptions into one JSON file (it can also be imported in the Android app). Import adds what is missing; existing patient IDs are not overwritten.'),
        h('div', { class: 'row' }, Btn('Export all', { onClick: () => patientsExport().catch(e => toast(e.message)) }), Btn('Import', { kind: 'outline', onClick: patientsImport }))])),
    Card('Suggestion lists database', [...LIST_TYPES.map(t => h('div', null, LIST_LABELS[t] + ': ' + cnt.counts[t].own + ' yours' + (cnt.counts[t].all > cnt.counts[t].own ? ' (+' + (cnt.counts[t].all - cnt.counts[t].own) + ' shared by the admin)' : ''))),
      h('div', { class: 'small muted' }, 'Import a JSON file {"complaints": [...]} or a text file with lines “type,value” or [type] sections. Export saves your own lists only.'),
      h('div', { class: 'row' }, Btn('Export my lists', { onClick: () => listsExport().catch(e => toast(e.message)) }), Btn('Import', { kind: 'outline', onClick: listsImport })),
      h('div', null, Btn('Open suggestion lists →', { kind: 'text', onClick: () => { location.hash = '#/settings/lists'; } }))]));
  return { title: 'Database', back: true, backTo: '#/settings', el };
};

Screens.settings_account = async () => {
  const f = { old: Field({ label: 'Current password', type: 'password', autocomplete: 'current-password' }), n1: Field({ label: 'New password (min 6)', type: 'password', autocomplete: 'new-password' }), n2: Field({ label: 'Repeat new password', type: 'password', autocomplete: 'new-password' }) };
  const el = h('div', { class: 'col' },
    Card('Signed in as', [h('div', { style: 'font-weight:600' }, State.user.name), h('div', null, State.user.email), h('div', null, State.user.role === 'admin' ? h('span', { class: 'badge admin' }, 'Admin') : h('span', { class: 'badge approved' }, 'Doctor'))]),
    Card('Change password', [f.old, f.n1, f.n2, h('div', null, Btn('Change password', { onClick: async () => {
      if (f.n1.inp.value !== f.n2.inp.value) { toast('New passwords do not match'); return; }
      try { await api('change_password', { old: f.old.inp.value, new: f.n1.inp.value }); toast('Password changed'); Object.values(f).forEach(x => x.inp.value = ''); } catch (e) { toast(e.message); }
    } }))]),
    Btn('Sign out', { kind: 'outline', icon: 'logout', onClick: doLogout }));
  return { title: 'Account', back: true, backTo: '#/settings', el };
};

Screens.about = async () => {
  const link = (t, href) => h('a', { href }, t);
  return { title: 'About', back: true, backTo: '#/settings', el: h('div', { class: 'col' },
    Card('Developer', [h('div', { style: 'font-weight:700' }, 'Abdullah Al Mamun'), h('div', null, 'B.A/M.A (English)'),
      h('div', null, 'Email: ', link('mamun995599@gmail.com', 'mailto:mamun995599@gmail.com')), h('div', null, 'Phone: ', link('+8801945120109', 'tel:+8801945120109')), h('div', null, 'Dhaka, Bangladesh.')]),
    Card('WebRxPad', [h('div', null, 'Multi-doctor web prescription pad. Version ' + State.version), h('div', { class: 'small muted' }, 'Each doctor’s patients and prescriptions are private to their own account. Internet is used when you send an e-mail.')])) };
};
