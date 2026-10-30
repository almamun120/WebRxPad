'use strict';
const DOSAGE_PRESETS = ['1+0+0', '0+1+0', '0+0+1', '1+1+0', '1+0+1', '0+1+1', '1+1+1', '1+1+1+1', '½+0+½', '½+½+½', 'SOS'];
const DURATION_PRESETS = ['3 days', '5 days', '7 days', '10 days', '14 days', '1 month', '3 months', 'Continue'];

/* page-setup context shared by the prescription screen: layout, doctor, chambers, image urls */
async function loadPrintContext() {
  const [s, c] = await Promise.all([api('settings_get'), api('chambers_list')]);
  const ts = Date.now();
  return {
    settings: s, chambers: c.chambers, currentChamber: c.current,
    doctor: s.doctor || {}, layout: layoutFromJson(s.page_layout), qrCaption: s.qr_caption,
    photoUrl: s.has_photo ? 'api.php?action=file&kind=photo&t=' + ts : '', watermarkUrl: s.has_watermark ? 'api.php?action=file&kind=watermark&t=' + ts : ''
  };
}
function infoBlock(doc, ch) {
  const out = ['Doctor info'];
  [doc.name, Rich.plain(doc.degrees || '').replace(/\n/g, ', '), doc.specialty, doc.bmdc ? 'BMDC Reg. No: ' + doc.bmdc : '', doc.phone ? 'Phone: ' + doc.phone : '', doc.email ? 'Email: ' + doc.email : '']
    .filter(x => x && String(x).trim()).forEach(x => out.push(x));
  if (ch) {
    out.push('', 'Chamber info');
    [ch.name, (ch.address || '').replace(/\n/g, ', '), ch.phone ? 'Phone: ' + ch.phone : '', ch.note, (ch.lat && ch.lon) ? 'GPS: ' + ch.lat + ', ' + ch.lon : '']
      .filter(x => x && String(x).trim()).forEach(x => out.push(x));
  }
  return out.join('\n');
}

function DrugInfo(url, fresh) {
  const box = h('div', { class: 'col drugpanel' });
  box.append(h('div', { class: 'title-m ok' }, 'Medicine description'), h('div', { class: 'small muted' }, 'For the doctor only – not printed on the prescription.'));
  const body = h('div', { class: 'col' });
  box.append(body);
  if (!url) { body.append(h('div', null, 'Select a medicine (or tap one already added) to see its description here.')); return box; }
  body.append(h('div', { class: 'muted' }, 'Loading…'));
  api('drug_details', { url }).then(r => {
    clear(body);
    const d = r.details;
    if (!d) { body.append(h('div', null, 'No description found.')); return; }
    d.basic.forEach(([l, v]) => body.append(h('div', { class: 'row', style: 'align-items:flex-start;gap:8px' }, h('div', { class: 'lbl', style: 'flex:0 0 38%' }, l + ':'), h('div', { style: 'flex:1' }, v || 'N/A'))));
    d.sections.forEach(sec => {
      const s = h('div', { class: 'sec' }, h('b', null, sec.title));
      sec.items.forEach(it => {
        if (it.label && !it.text) s.append(h('div', { style: 'font-weight:700' }, it.label));
        else if (it.url) s.append(h('div', { style: 'padding-left:8px' }, h('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.text + ' ↗')));
        else s.append(h('div', null, it.label ? it.label + ' ' + it.text : it.text));
      });
      body.append(s);
    });
    if (!d.sections.length) body.append(h('div', null, 'No description in the database.'));
  }).catch(e => { clear(body); body.append(h('div', { class: 'err' }, e.message)); });
  return box;
}

/** Value picked from a fixed list; multi = several can be ticked (stored as "A, B"). */
function OptionsField(label, value, options, multi, onChange) {
  const f = Field({ label, value, readonly: true, end: endBtn('drop', 'Choose', () => open()) });
  f.inp.readOnly = true; f.inp.style.cursor = 'pointer';
  const set = v => { f.inp.value = v; onChange(v); };
  const open = () => {
    const chosen = FindingDef.values(f.inp.value);
    const all = options.concat(chosen.filter(c => !options.some(o => o.toLowerCase() === c.toLowerCase())));
    if (!multi) { menuAt(f, all.map(o => ({ label: (chosen.includes(o) ? '✓ ' : '') + o, onClick: () => set(chosen.includes(o) ? '' : o) })).concat(chosen.length ? [{ label: 'Clear', onClick: () => set('') }] : [])); return; }
    const sel = new Set(chosen);
    const rows = all.map(o => { const cb = h('input', { type: 'checkbox' }); cb.checked = sel.has(o); cb.addEventListener('change', () => { cb.checked ? sel.add(o) : sel.delete(o); });
      return h('label', { class: 'row', style: 'padding:6px 0;gap:10px;cursor:pointer' }, cb, h('span', null, o)); });
    modal({ title: label, body: h('div', { class: 'col', style: 'gap:0' }, rows), actions: [{ label: 'Clear', onClick: () => { set(''); } }, { label: 'Done', onClick: () => { set(all.filter(o => sel.has(o)).join(', ')); } }] });
  };
  f.addEventListener('click', open);
  return f;
}

function FindingsEditor(model, defs) {
  const root = Card('Findings', null);
  const list = h('div', { class: 'col' });
  const types = defs.map(d => Rich.plain(d.name));
  const defOf = t => defs.find(d => Rich.plain(d.name).toLowerCase() === String(t || '').trim().toLowerCase());
  function draw() {
    clear(list);
    model.forEach((f, i) => {
      const d = defOf(f.type);
      const valueEl = d && d.options.length
        ? OptionsField('Value', f.value, d.options, d.multi, v => { f.value = v; f.unit = ''; })
        : Field({ label: 'Value', value: f.value, onInput: v => { f.value = v; }, end: (d && d.unit) || f.unit ? h('span', { class: 'small muted', style: 'position:absolute;right:12px;top:50%;transform:translateY(-50%);white-space:nowrap;pointer-events:none' }, (d && d.unit) || f.unit) : null });
      if (valueEl.inp && !(d && d.options.length) && ((d && d.unit) || f.unit)) valueEl.inp.style.paddingRight = ((((d && d.unit) || f.unit).length * 8) + 24) + 'px';
      list.append(h('div', { class: 'row', style: 'align-items:flex-start' },
        h('div', { class: 'grow' }, ChoiceField('Finding', f.type, types, v => {
          const before = defOf(f.type), nd = defOf(v); f.type = v; f.unit = nd ? nd.unit : '';
          if (nd && nd.options.length && FindingDef.values(f.value).some(x => !nd.options.some(o => o.toLowerCase() === x.toLowerCase()))) f.value = '';
          if (before !== nd) { draw(); const inp = list.children[i] && list.children[i].querySelector('input'); if (inp && !inp.readOnly) { inp.focus(); const n = inp.value.length; inp.setSelectionRange(n, n); } }
        })),
        h('div', { class: 'grow' }, valueEl),
        iconBtn('close', 'Remove', () => { model.splice(i, 1); draw(); })));
    });
  }
  draw();
  root.append(list, h('div', null, Btn('Add finding', { kind: 'outline', icon: 'add', onClick: () => { model.push({ type: '', value: '', unit: '' }); draw(); } })),
    h('div', { class: 'small muted' }, 'Units and dropdown options are set in Settings → Suggestion lists → Findings.'));
  return root;
}

function MedicationsEditor(model, instructions, ctx) {
  const root = Card('Medication (Rx)', null, 'med');
  const list = h('div', { class: 'col', style: 'gap:6px' });
  const results = h('div');
  let selected = '';
  const search = Field({ label: 'Search brand, generic, company or indication', onInput: v => doSearch(v) });
  const warn = h('div', { class: 'small err' });
  api('drug_status').then(r => { if (!r.has_db) warn.textContent = 'No medicine database has been added by the admin yet. You can still add medicines manually.'; }).catch(() => {});
  let seq = 0;
  const doSearch = debounce(async q => {
    const my = ++seq;
    if (q.trim().length < 2) { clear(results); return; }
    let r; try { r = await api('drug_search', { q }); } catch (e) { return; }
    if (my !== seq) return;
    clear(results);
    r.multi = new Set(r.results.map(x => x.engine)).size > 1;
    r.results.forEach(s => {
      const meta = [s.form, s.company].filter(x => x).join('  •  '), pp = [s.pack, s.price].filter(x => x).join('  •  ');
      results.append(h('div', { class: 'sugg', onClick: () => {
        model.push({ brandUrl: s.url, name: s.name, generic: s.generic, strength: s.strength, form: s.form, dosage: '', duration: '', instruction: '' });
        search.inp.value = ''; clear(results); select(s.url); draw();
      } },
        h('div', { class: 'nm' }, [s.name, s.strength].filter(x => x).join(' '), r.multi && s.engine ? h('span', { class: 'etag' }, s.engine) : null),
        s.generic ? h('div', { style: 'font-weight:500' }, s.generic) : null,
        meta ? h('div', { class: 'small' }, meta) : null,
        pp ? h('div', { class: 'small', style: 'color:var(--tertiary)' }, pp) : null,
        s.indication ? h('div', { class: 'small muted', style: 'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden' }, 'Indication: ' + s.indication.replace(/\s+/g, ' ').trim() + '…') : null));
    });
  }, 300);
  function select(url) { selected = url; ctx.showDrug(url); draw(); }
  function draw() {
    clear(list);
    model.forEach((m, i) => {
      const custom = !m.brandUrl;
      const head = h('div', { class: 'row' },
        h('div', { class: 'grow' }, custom ? Field({ label: 'Medicine name', value: m.name, onInput: v => { m.name = v; } })
          : [h('div', { style: 'font-weight:600' }, (i + 1) + '. ' + [m.form, m.name, m.strength].filter(x => x && String(x).trim()).join(' ')), m.generic ? h('div', { class: 'small muted' }, m.generic) : null]),
        custom ? null : iconBtn('info', 'Details', () => select(m.brandUrl)),
        iconBtn('close', 'Remove', () => { model.splice(i, 1); draw(); }));
      list.append(h('div', { class: 'col', style: 'padding:4px;border-radius:8px;' + (m.brandUrl && m.brandUrl === selected ? 'background:color-mix(in srgb,var(--primary-c) 35%,transparent)' : ''), onClick: e => { if (m.brandUrl && !e.target.closest('input,button')) select(m.brandUrl); } },
        head,
        h('div', { class: 'row' }, h('div', { class: 'grow' }, ChoiceField('Dosage', m.dosage, DOSAGE_PRESETS, v => { m.dosage = v; })), h('div', { class: 'grow' }, ChoiceField('Duration', m.duration, DURATION_PRESETS, v => { m.duration = v; }))),
        ChoiceField('Instruction', m.instruction, instructions, v => { m.instruction = v; }), h('hr')));
    });
  }
  draw();
  root.append(list, search, warn, results, h('div', null, Btn('Add custom medicine', { kind: 'outline', icon: 'add', onClick: () => { model.push({ brandUrl: '', name: '', generic: '', strength: '', form: '', dosage: '', duration: '', instruction: '' }); draw(); } })));
  return root;
}

Screens.rx = async (patientId, rxIdArg) => {
  const rxId0 = parseInt(rxIdArg, 10) || 0;
  const [pr, pc, inst, finds] = await Promise.all([api('patient_get', { id: patientId }), loadPrintContext(), api('lists_items', { type: 'instruction' }), api('lists_items', { type: 'findings' })]);
  const patient = pr.patient;
  let rxId = rxId0;
  const old = rxId0 ? pr.prescriptions.find(r => r.id === rxId0) : null;
  const d = old ? old.data : {};
  const M = {
    date: old ? old.date : todayISO(), age: old ? old.age : patient.age,
    chamber: (old && d.chamber) ? d.chamber : (pc.chambers.find(c => c.id === pc.currentChamber) || pc.chambers[0] || null),
    complaints: [...(d.complaints || [])], history: [...(d.history || [])], findings: (d.findings || []).map(f => ({ type: f.type || '', value: f.value || '', unit: f.unit || '' })),
    investigation: [...(d.investigation || [])], diagnosis: [...(d.diagnosis || [])], medications: (d.medications || []).map(m => Object.assign({ brandUrl: '', name: '', generic: '', strength: '', form: '', dosage: '', duration: '', instruction: '' }, m)),
    advice: [...(d.advice || [])], followUp: [...(d.followUp || [])]
  };
  const busyBar = h('div', { class: 'hidden' }, h('div', { class: 'small muted' }), h('div', { class: 'bar' }));
  const setBusy = t => { busyBar.classList.toggle('hidden', !t); busyBar.firstChild.textContent = t || ''; [bSave, bMail, bExp].forEach(b => b.disabled = !!t); };
  const toRx = () => ({ date: M.date, age: M.age, complaints: M.complaints, history: M.history, findings: M.findings, investigation: M.investigation, diagnosis: M.diagnosis,
    medications: M.medications, advice: M.advice, followUp: M.followUp });
  async function doSave() {
    try {
      const data = Object.assign({}, toRx(), M.chamber ? { chamber: M.chamber } : {});
      delete data.date; delete data.age;
      const r = await api('rx_save', { rx: { id: rxId, patient_id: patient.id, date: M.date, age: M.age, data } });
      rxId = r.id; return true;
    } catch (e) { toast('Save failed: ' + e.message); return false; }
  }
  const pages = () => renderPrescription({ doctor: pc.doctor, chamber: M.chamber, patient, rx: toRx(), layout: pc.layout, qrCaption: pc.qrCaption, photoUrl: pc.photoUrl, watermarkUrl: pc.watermarkUrl });
  const baseName = () => rxBase(pc.doctor.name, patient.name, M.age || patient.age, patient.id);
  async function makePdf() {
    try { const blob = await pagesToPdf(pages()); return { blob, name: baseName() + '.pdf' }; }
    catch (e) { toast('PDF failed: ' + e.message); return null; }
  }
  async function exportPdf() { setBusy('Creating PDF…'); const r = await makePdf(); setBusy(''); if (r) { download(r.name, r.blob); toast('PDF exported'); } }
  function doPrint() { printPages(pages()); }
  function doPreview() {
    const pg = pages();
    const w = Math.min(720, window.innerWidth - 80);
    modal({ title: 'Preview', wide: true, body: scaledPages(pg, w), actions: [{ label: 'Print', onClick: () => { doPrint(); return false; } }, { label: 'Close' }] });
  }
  async function doShare() {
    setBusy('Creating PDF…'); const r = await makePdf(); setBusy('');
    if (!r) return;
    const file = new File([r.blob], r.name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: r.name }); } catch (e) { /* cancelled */ } }
    else { download(r.name, r.blob); toast('Sharing is not supported here – the PDF was downloaded'); }
  }
  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.startsWith('0')) d = '88' + d;
    return d.length >= 10 && d.length <= 15 ? d : '';
  }
  async function doWhatsApp() {
    setBusy('Creating PDF…'); const r = await makePdf(); setBusy('');
    if (!r) return;
    const msg = 'Prescription of ' + patient.name + ' (' + fmtDate(M.date) + ')' + (pc.doctor.name ? ' – ' + pc.doctor.name : '');
    const file = new File([r.blob], r.name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {          // phones: pick WhatsApp in the share sheet
      try { await navigator.share({ files: [file], title: r.name, text: msg }); } catch (e) { /* cancelled */ }
      return;
    }
    download(r.name, r.blob);                                                   // computers: PDF is saved, WhatsApp chat opens, attach the file
    const n = waNumber(patient.phone);
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(msg), '_blank', 'noopener');
    toast('PDF downloaded – attach it in the WhatsApp chat', 6000);
  }
  function emailDialog() {
    const rec = pc.settings.recipients || [], def = pc.settings.default_recipient || '';
    const sel = new Set(def ? [def] : (rec.length === 1 ? [rec[0].email] : []));
    const other = Field({ label: 'Another e-mail address', type: 'email' });
    const s = pc.settings.smtp || {};
    const body = [!s.host || !s.from && !s.username ? h('div', { class: 'err' }, 'E-mail server is not set up yet (Settings → E-mail server).') : null,
      rec.map(r => h('label', { class: 'row', style: 'cursor:pointer' }, (() => { const c = h('input', { type: 'checkbox', class: 'cb' }); c.checked = sel.has(r.email); c.addEventListener('change', () => c.checked ? sel.add(r.email) : sel.delete(r.email)); return c; })(),
        h('div', null, h('div', null, r.email), r.label ? h('div', { class: 'small muted' }, r.label) : null))), other];
    modal({ title: 'Send by e-mail', body, actions: [{ label: 'Cancel' }, { label: 'Send', onClick: () => {
      const list = [...sel]; const o = other.inp.value.trim();
      if (o) { if (!/^\S+@\S+\.\S+$/.test(o)) { toast('Invalid e-mail address'); return false; } list.push(o); }
      if (!list.length) { toast('Choose at least one recipient'); return false; }
      sendMail([...new Set(list)]);
    } }] });
  }
  async function sendMail(to) {
    setBusy('Sending e-mail…');
    const r = await makePdf();
    if (!r) { setBusy(''); return; }
    try {
      const fill = t => t.replace(/\{patient\}/g, patient.name).replace(/\{doctor\}/g, pc.doctor.name || '').replace(/\{date\}/g, fmtDate(M.date));
      const body = fill((pc.settings.mail_body || '').trim()) + '\n\n' + infoBlock(pc.doctor, M.chamber);
      await api('mail_send', { to, subject: r.name.replace(/\.pdf$/, ''), body, filename: r.name, pdf: await blobToBase64(r.blob) });
      toast('E-mail sent to ' + to.join(', '));
    } catch (e) { toast(e.message, 6000); }
    setBusy('');
  }
  const bSave = Btn('Save', { onClick: async () => { setBusy('Saving…'); if (await doSave()) toast('Saved'); setBusy(''); } });
  const bMail = Btn('Save & Email', { kind: 'outline', onClick: async () => { setBusy('Saving…'); const ok = await doSave(); setBusy(''); if (ok) emailDialog(); } });
  const bExp = Btn('Save & Export', { kind: 'outline', onClick: async () => { setBusy('Saving…'); const ok = await doSave(); setBusy(''); if (ok) exportPdf(); } });
  [bSave, bMail, bExp].forEach((b, i) => { b.style.flex = ['1', '1.3', '1.3'][i]; });

  /* medicine description: side panel on wide screens, bottom sheet on narrow ones */
  const panelHost = h('div', { class: 'card panel drugpanel-host' }, DrugInfo(null));
  let sheet = null;
  const ctx = { showDrug: url => {
    if (window.innerWidth >= 1100) { clear(panelHost); panelHost.append(DrugInfo(url)); }
    else { if (sheet) sheet.close(); sheet = modal({ sheet: true, body: DrugInfo(url), onClose: () => { sheet = null; } }); }
  } };

  const visit = Card('Visit', null);
  const dateF = Field({ label: 'Date', type: 'date', value: M.date, onInput: v => { M.date = v || todayISO(); } });
  const ageF = Field({ label: 'Age', value: M.age, onInput: v => { M.age = v; } });
  visit.append(h('div', { style: 'font-weight:600' }, patient.name + '  •  ID ' + patient.id), h('div', { class: 'row' }, h('div', { class: 'grow' }, dateF), h('div', { class: 'grow' }, ageF)));
  if (!pc.chambers.length) visit.append(h('div', { class: 'small err' }, 'No chamber added yet (Settings → Chambers).'));
  else {
    const labels = pc.chambers.map(c => c.name || (c.address || '').split('\n')[0] || 'Chamber');
    let idx = pc.chambers.findIndex(c => M.chamber && c.id === M.chamber.id); if (idx < 0 && M.chamber) { labels.push(M.chamber.name || 'Saved chamber'); pc.chambers.push(M.chamber); idx = labels.length - 1; }
    visit.append(SelectField('Chamber for this prescription', labels, idx, i => { M.chamber = pc.chambers[i]; }));
  }
  const form = h('div', { class: 'form' }, visit,
    ListEditor('Complaints', M.complaints, 'complaints'), ListEditor('History', M.history, 'history'),
    FindingsEditor(M.findings, finds.items.map(x => FindingDef.parse(x.name)).filter(d => d.name)),
    ListEditor('Investigation', M.investigation, 'investigation'), ListEditor('Diagnosis', M.diagnosis, 'diagnosis'),
    MedicationsEditor(M.medications, inst.items.map(x => x.name), ctx),
    AdviceEditor('Advice', M.advice), ListEditor('Follow up', M.followUp, 'follow_up'));
  const el = h('div', { class: 'rxlayout' }, form, panelHost);
  const actions = [iconBtn('eye', 'Preview', doPreview), (() => { const b = iconBtn('more', 'More', () => menuAt(b, [
    { label: 'E-mail (without saving)', onClick: emailDialog }, { label: 'Export PDF (without saving)', onClick: exportPdf },
    { label: 'Send on WhatsApp', onClick: doWhatsApp }, { label: 'Print', onClick: doPrint }, { label: 'Share…', onClick: doShare }])); return b; })()];
  return { title: patient.name, back: true, backTo: '#/patient/' + patient.id, actions, el, wide: true, bottom: h('div', { class: 'col', style: 'gap:6px' }, busyBar, h('div', { class: 'row' }, bSave, bMail, bExp)) };
};
