'use strict';
function InfoRow(label, value) {
  if (!value || !String(value).trim()) return null;
  return h('div', { class: 'inforow' }, h('span', null, label), h('span', null, value));
}

function scanDialog(onId) {
  const video = h('video', { autoplay: true, playsinline: true, muted: true, style: 'width:100%;border-radius:8px;background:#000;max-height:50vh' });
  const manual = Field({ label: 'Or type / paste the patient ID', onEnter: v => accept(v) });
  const info = h('div', { class: 'small muted' });
  let stream = null, stopped = false;
  const m = modal({ title: 'Scan the patient’s QR code', body: [video, info, manual], actions: [{ label: 'Cancel' }, { label: 'Open', onClick: () => accept(manual.inp.value) }], onClose: () => { stopped = true; if (stream) stream.getTracks().forEach(t => t.stop()); } });
  function accept(text) {
    const id = extractPatientId(text);
    if (!id) { toast('No patient ID found'); return false; }
    m.close(); onId(id);
  }
  (async () => {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { video.remove(); info.textContent = 'Camera scanning is not supported in this browser. Type the ID from the printed QR instead.'; return; }
    try {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      const tick = async () => {
        if (stopped) return;
        try { const r = await det.detect(video); if (r.length) { const id = extractPatientId(r[0].rawValue); if (id) { m.close(); onId(id); return; } } } catch (e) { /* keep trying */ }
        setTimeout(tick, 350);
      };
      tick();
    } catch (e) { video.remove(); info.textContent = 'Camera not available: ' + e.message; }
  })();
}

Screens.patients = async () => {
  const listEl = h('div', { class: 'grid2' });
  const empty = h('div', { class: 'muted', style: 'padding:16px' });
  const more = h('div');
  let total = 0, q = '', shown = 0;
  const titleEl = { t: 'Patients' };
  const search = Field({ label: 'Search by name, ID or phone', onInput: debounce(v => { q = v; load(true); }, 200) });
  search.inp.type = 'search';
  async function load(reset) {
    if (reset) shown = 0;
    const r = await api('patients_list', { q, limit: 100, offset: shown });
    total = r.total;
    if (reset) clear(listEl);
    r.patients.forEach(p => listEl.append(patientCard(p)));
    shown += r.patients.length;
    const h1 = $('.appbar h1'); if (h1) h1.textContent = 'Patients (' + total + ')';
    empty.textContent = shown === 0 ? (total === 0 ? 'No patients yet. Tap “New patient” to add the first one.' : 'No match.') : '';
    clear(more);
    if (shown < r.matched) more.append(Btn('Load more (' + (r.matched - shown) + ' more)', { kind: 'outline', onClick: () => load(false) }));
  }
  function patientCard(p) {
    const sub = [p.age ? 'Age ' + p.age : '', p.sex, p.phone].filter(x => x).join('  •  ');
    return h('div', { class: 'card click', onClick: () => { location.hash = '#/patient/' + p.id; } },
      h('div', { class: 'row' }, h('div', { class: 'grow title-m' }, p.name), h('div', { class: 'small ok', style: 'font-weight:600' }, p.id)),
      sub ? h('div', { class: 'muted', style: 'font-size:14px' }, sub) : null,
      h('div', { class: 'muted small' }, p.rx_count === 0 ? 'No prescriptions' : p.rx_count + ' prescription(s) • last ' + fmtDate(p.last_rx)));
  }
  const fabs = h('div', { class: 'fabs' },
    h('button', { class: 'fab small', title: 'Scan QR', onClick: () => scanDialog(async id => { const r = await api('patient_lookup', { id }); if (r.found) location.hash = '#/patient/' + id; else toast('No patient found for this QR code'); }) }, icon('qr')),
    h('button', { class: 'fab', onClick: () => { location.hash = '#/patient_edit/new'; } }, icon('personadd'), 'New patient'));
  const el = h('div', { class: 'col' }, search, empty, listEl, more);
  return { title: 'Patients', el, fabs, onMount: () => load(true).catch(e => toast(e.message)) };
};

Screens.patient_edit = async id => {
  const isNew = id === 'new';
  let p = { id: '', name: '', age: '', sex: '', phone: '', address: '', blood_group: '', weight: '', notes: '' };
  if (!isNew) p = (await api('patient_get', { id })).patient;
  const f = {
    name: Field({ label: 'Name *', value: p.name }), age: Field({ label: 'Age', value: p.age }),
    sex: ChoiceField('Sex', p.sex, ['Male', 'Female', 'Other'], () => {}), phone: Field({ label: 'Phone (optional)', value: p.phone, type: 'tel' }),
    address: Field({ label: 'Address', value: p.address }),
    blood: ChoiceField('Blood group', p.blood_group, ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], () => {}),
    weight: Field({ label: 'Weight (kg)', value: p.weight }), notes: Field({ label: 'Notes', value: p.notes, multiline: true })
  };
  const save = async () => {
    if (!f.name.inp.value.trim()) { toast('Patient name is required'); return; }
    try {
      const r = await api('patient_save', { patient: { id: isNew ? '' : id, name: f.name.inp.value, age: f.age.inp.value, sex: f.sex.inp.value, phone: f.phone.inp.value, address: f.address.inp.value,
        blood_group: f.blood.inp.value, weight: f.weight.inp.value, notes: f.notes.inp.value } });
      location.hash = '#/patient/' + r.id;
    } catch (e) { toast(e.message); }
  };
  const el = h('div', { class: 'col' },
    Card('Basic information', [f.name, h('div', { class: 'row' }, h('div', { class: 'grow' }, f.age), h('div', { class: 'grow' }, f.sex)), f.phone]),
    Card('Other (optional)', [f.address, h('div', { class: 'row' }, h('div', { class: 'grow' }, f.blood), h('div', { class: 'grow' }, f.weight)), f.notes]),
    Btn(isNew ? 'Create patient' : 'Save changes', { block: true, onClick: save }));
  return { title: isNew ? 'New patient' : 'Edit patient', back: true, backTo: isNew ? '#/patients' : '#/patient/' + id, el };
};

Screens.patient = async id => {
  const r = await api('patient_get', { id });
  const p = r.patient;
  const rxEls = r.prescriptions.map(rx => {
    const dx = (rx.data.diagnosis || []).map(Rich.plain).join(', ');
    return h('div', { class: 'card click', onClick: () => { location.hash = '#/rx/' + p.id + '/' + rx.id; } },
      h('div', { class: 'row' }, h('div', { class: 'grow' },
        h('div', { class: 'title-m' }, fmtDate(rx.date)), dx ? h('div', { style: 'font-size:14px' }, dx) : null,
        h('div', { class: 'muted small' }, (rx.data.medications || []).length + ' medicine(s)')),
        iconBtn('del', 'Delete prescription', e => { e.stopPropagation(); confirmDialog('Delete prescription', 'Delete the prescription of ' + fmtDate(rx.date) + '?', async () => { await api('rx_delete', { id: rx.id }); route(); }); })));
  });
  const qr = h('div', { style: 'text-align:center;flex:none' }, h('div', { style: 'width:104px;height:104px;margin:0 auto;background:#fff;padding:4px;border-radius:4px', html: qrSvg(p.id, '96px') }), h('div', { class: 'small', style: 'letter-spacing:.08em' }, p.id));
  const el = h('div', { class: 'col' },
    Card(p.name, h('div', { class: 'row', style: 'align-items:flex-start' },
      h('div', { class: 'grow col', style: 'gap:4px' }, InfoRow('ID', p.id), InfoRow('Age', p.age), InfoRow('Sex', p.sex), InfoRow('Phone', p.phone), InfoRow('Address', p.address),
        InfoRow('Blood', p.blood_group), InfoRow('Weight', p.weight ? p.weight + ' kg' : ''), InfoRow('Notes', p.notes)), qr)),
    Btn('New prescription', { block: true, icon: 'add', onClick: () => { location.hash = '#/rx/' + p.id + '/0'; } }),
    h('div', { class: 'title-m' }, 'Prescriptions (' + r.prescriptions.length + ')'),
    h('div', { class: 'grid2' }, rxEls));
  const actions = [iconBtn('edit', 'Edit', () => { location.hash = '#/patient_edit/' + p.id; }),
    iconBtn('del', 'Delete', () => confirmDialog('Delete patient', 'Delete this patient and all of their prescriptions? This cannot be undone.', async () => { await api('patient_delete', { id: p.id }); location.hash = '#/patients'; }))];
  return { title: 'Patient', back: true, backTo: '#/patients', actions, el };
};
