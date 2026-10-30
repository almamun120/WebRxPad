'use strict';
/* ===== Page setup designer: drag items on a real A4 preview, fine-tune, templates, styles ===== */
Screens.settings_page = async () => {
  const [s, chs] = await Promise.all([api('settings_get'), api('chambers_list')]);
  let L = layoutFromJson(s.page_layout);
  let caption = s.qr_caption;
  let hasWm = s.has_watermark;
  const photoUrl = s.has_photo ? 'api.php?action=file&kind=photo&t=' + Date.now() : '';
  let wmUrl = hasWm ? 'api.php?action=file&kind=watermark&t=' + Date.now() : '';
  const d0 = s.doctor || {};
  const doctor = d0.name ? d0 : { name: 'Dr. Your Name', degrees: 'MBBS, FCPS', specialty: 'Medicine Specialist', bmdc: 'A-12345', phone: '01XXXXXXXXX', email: '' };
  const chamber = chs.chambers.find(c => c.id === chs.current) || chs.chambers[0] || { name: 'City Care Clinic', address: 'House 12, Road 3, Dhanmondi, Dhaka', phone: '01XXXXXXXXX', lat: '23.7461', lon: '90.3742', note: 'Sat–Thu, 5 PM – 9 PM' };
  const patient = { id: 'K7M2PQ9X4A', name: 'Rahim Uddin', age: '35', sex: 'Male' };
  const rx = { date: todayISO(), age: '35', complaints: ['Fever', 'Cough'], history: ['Hypertension'], findings: [{ type: 'BP', value: '120/80', unit: 'mmHg' }], investigation: ['CBC'], diagnosis: ['URTI'],
    medications: [{ name: 'Napa', generic: 'Paracetamol', strength: '500 mg', form: 'Tablet', dosage: '1+1+1', duration: '5 days', instruction: 'খাওয়ার পরে' },
      { name: 'Fexo', generic: 'Fexofenadine', strength: '120 mg', form: 'Tablet', dosage: '0+0+1', duration: '7 days', instruction: 'রাতে' }],
    advice: [Advice.encode({ c: 'Fever care', b: 'প্রচুর পানি পান করুন\nবিশ্রামে থাকুন\n  প্রয়োজনে প্যারাসিটামল', s: true })], followUp: ['After 7 days'] };
  let selected = K.H1;
  let imgVer = Date.now();
  const isImg = k => String(k).startsWith('img:');
  const imOf = k => L.images.find(i => 'img:' + i.id === k);
  const keyLabel = k => isImg(k) ? ((imOf(k) || {}).label || 'Picture') : K.label(k);
  const pageHost = h('div', { class: 'pgwrap' });
  const controls = h('div', { class: 'col' });
  let scale = 1;
  const sizeNow = () => Math.max(280, Math.min(pageHost.clientWidth - 20 || 600, 900));

  function render() {
    const w = sizeNow();
    scale = w / (L.pageW * PX_PER_MM);
    const pages = renderPrescription({ doctor, chamber, patient, rx, layout: L, qrCaption: caption, photoUrl, watermarkUrl: wmUrl, edit: true, imgVer });
    const page = pages[0];
    page.querySelectorAll('.ed').forEach(e => { if (e.dataset.k === selected) e.classList.add('sel'); });
    page.style.transformOrigin = 'top left'; page.style.transform = 'scale(' + scale + ')';
    const outer = h('div', { class: 'pgouter', style: 'width:' + w + 'px;height:' + (L.pageH * PX_PER_MM * scale) + 'px;position:relative;background:#fff;overflow:hidden;margin:0 auto;box-shadow:0 1px 6px rgba(0,0,0,.4)' }, page);
    clear(pageHost); pageHost.append(outer);
  }
  let raf = 0;
  const refresh = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); }); };
  const all = () => { refresh(); drawControls(); };

  /* ----- model changes ----- */
  const el = k => L.items[k];
  const setEl = (k, f) => { L.items[k] = Object.assign({}, L.items[k], f(L.items[k])); };
  function move(key, dx, dy) {
    const e = L.items[key]; if (!e) return;
    const nx = key === K.BODY ? e.x : Math.min(L.pageW - 5, Math.max(0, e.x + dx));
    const ny = Math.min(L.pageH - 2, Math.max(0, e.y + dy));
    const real = ny - e.y;
    L.items[key] = Object.assign({}, e, { x: nx, y: ny });
    if (key === K.H1 && L.followHeader) K.followers.forEach(k => { const f = L.items[k]; L.items[k] = Object.assign({}, f, { y: Math.min(L.pageH - 2, Math.max(0, f.y + real)) }); });
  }
  function resize(key, delta) { const e = L.items[key]; L.items[key] = Object.assign({}, e, { len: Math.min(key === K.V ? L.pageH : L.pageW, Math.max(5, e.len + delta)) }); }
  const widthOf = k => { const e = L.items[k]; return e.w > 0 ? e.w : (L.pageW - e.x - L.marginR); };

  function scaleImgBy(key, dxMm) {
    const e = L.items[key]; if (!e) return;
    const nw = Math.min(L.pageW, Math.max(5, e.w + dxMm));
    L.items[key] = Object.assign({}, e, { w: nw, len: e.len * nw / e.w });
  }
  function scaleImg(key, f) { const e = L.items[key]; scaleImgBy(key, e.w * f - e.w); }
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4))).map(b => b.toString(16).padStart(2, '0')).join('');
  async function pickPicture(replaceKey) {
    const f = await pickFile('image/*'); if (!f) return;
    try {
      const data = await resizeImage(f, 1600, 'image/png');
      const dim = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => rej(new Error('Cannot read the image')); i.src = data; });
      const aspect = dim.w / dim.h;
      const im = replaceKey ? imOf(replaceKey) : null;
      const id = im ? im.id : newId();
      await api('image_upload', { kind: 'img_' + id, data });
      imgVer = Date.now();
      if (im) { im.aspect = aspect; const e = L.items[replaceKey]; L.items[replaceKey] = Object.assign({}, e, { len: e.w / aspect }); }
      else {
        L.images.push({ id, label: 'Picture ' + (L.images.length + 1), placed: true, allPages: true, opacity: 1, aspect });
        L.items['img:' + id] = { x: 20, y: 20, w: 40, len: 40 / aspect, align: 0, visible: true, thick: 0.3 };
        selected = 'img:' + id;
      }
      all();
    } catch (er) { toast('Picture failed: ' + er.message); }
  }
  async function deletePicture(im) {
    try { await api('image_delete', { kind: 'img_' + im.id }); } catch (e) { /* file may be gone already */ }
    L.images = L.images.filter(x => x.id !== im.id); delete L.items['img:' + im.id];
    if (selected === 'img:' + im.id) selected = K.H1;
    all();
  }

  /* ----- drag with pointer events ----- */
  let drag = null;
  pageHost.addEventListener('pointerdown', ev => {
    const hd = ev.target.closest('.handle'); const t = ev.target.closest('.ed');
    if (!t && !hd) return;
    const key = hd ? hd.dataset.h : t.dataset.k;
    selected = key;
    drag = { key, handle: !!hd, x: ev.clientX, y: ev.clientY, vertical: key === K.V };
    pageHost.setPointerCapture(ev.pointerId);
    ev.preventDefault();
    all();
  });
  pageHost.addEventListener('pointermove', ev => {
    if (!drag) return;
    const k = scale * PX_PER_MM;
    const dx = (ev.clientX - drag.x) / k, dy = (ev.clientY - drag.y) / k;
    drag.x = ev.clientX; drag.y = ev.clientY;
    if (drag.handle) { if (isImg(drag.key)) scaleImgBy(drag.key, dx); else resize(drag.key, drag.vertical ? dy : dx); } else move(drag.key, dx, dy);
    refresh();
  });
  const endDrag = () => { if (drag) { drag = null; drawControls(); } };
  pageHost.addEventListener('pointerup', endDrag); pageHost.addEventListener('pointercancel', endDrag);

  /* ----- controls ----- */
  function StyleRow(key) {
    const st = styleOf(L, key);
    const shown = st.size > 0 ? st.size : L.baseFont * K.factor(key);
    const set = o => { L.styles[key] = Object.assign({}, styleOf(L, key), o); all(); };
    return h('div', { class: 'col', style: 'gap:4px' },
      h('div', { style: 'font-weight:600' }, K.styleLabel(key) + ': ' + shown.toFixed(1) + ' pt' + (st.size <= 0 ? ' (auto)' : '')),
      h('div', { class: 'scrollx' },
        Btn('A−', { kind: 'outline', sm: true, onClick: () => set({ size: Math.max(5, Math.round((shown - 0.5) * 2) / 2) }) }),
        Btn('A+', { kind: 'outline', sm: true, onClick: () => set({ size: Math.min(30, Math.round((shown + 0.5) * 2) / 2) }) }),
        Chip(h('b', null, 'B'), st.bold, () => set({ bold: !st.bold })), Chip(h('i', null, 'I'), st.italic, () => set({ italic: !st.italic })),
        Chip(h('u', null, 'U'), st.underline, () => set({ underline: !st.underline })), Btn('Reset', { kind: 'text', sm: true, onClick: () => { delete L.styles[key]; all(); } })));
  }
  const stepRow = (label, minus, plus) => h('div', { class: 'row' }, h('div', { class: 'grow' }, label), Btn('−', { kind: 'outline', sm: true, onClick: minus }), Btn('+', { kind: 'outline', sm: true, onClick: plus }));
  const slider = (label, v, min, max, step, on) => {
    const r = h('input', { type: 'range', min, max, step, value: v });
    const t = h('div', null, label(v));
    r.addEventListener('input', () => { t.textContent = label(+r.value); on(+r.value); });
    return h('div', null, t, r);
  };

  function drawControls() {
    clear(controls);
    const e = L.items[selected];
    const sel = Card('Selected: ' + keyLabel(selected), null);
    const keys = [K.DOCTOR, K.CHAMBER, K.PHOTO, K.H1, K.NAME, K.AGE, K.DATE, K.BODY, K.V, K.SIGN, K.QR, K.H2, K.FOOTER, K.ADVICE, K.WATERMARK];
    sel.append(h('div', { class: 'scrollx' }, keys.map(k => Chip(K.label(k), selected === k, () => { selected = k; all(); })),
      L.images.filter(i => i.placed).map(i => Chip(i.label, selected === 'img:' + i.id, () => { selected = 'img:' + i.id; all(); }))));
    if (e) sel.append(h('div', null, 'x = ' + e.x.toFixed(1) + ' mm,  y = ' + e.y.toFixed(1) + ' mm' + (K.lines.includes(selected) ? ',  length = ' + e.len.toFixed(1) + ' mm' : '')));
    sel.append(h('div', { class: 'row', style: 'justify-content:space-evenly' },
      iconBtn('back', 'Left', () => { move(selected, -0.5, 0); all(); }), iconBtn('up', 'Up', () => { move(selected, 0, -0.5); all(); }),
      iconBtn('down', 'Down', () => { move(selected, 0, 0.5); all(); }), (() => { const b = iconBtn('back', 'Right', () => { move(selected, 0.5, 0); all(); }); b.style.transform = 'scaleX(-1)'; return b; })()));
    if (K.hideable.includes(selected) || isImg(selected)) sel.append(SwitchRow('Show on prescription', e.visible, v => { setEl(selected, () => ({ visible: v })); all(); }));
    if (K.alignable.includes(selected)) sel.append(h('div', { class: 'row' }, 'Align:', ['Left', 'Center', 'Right'].map((t, i) => Chip(t, e.align === i, () => { setEl(selected, () => ({ align: i })); all(); }))));
    if (K.widthed.includes(selected)) sel.append(stepRow('Width ' + widthOf(selected).toFixed(0) + ' mm', () => { const w = widthOf(selected); setEl(selected, () => ({ w: Math.max(10, w - 2) })); all(); }, () => { const w = widthOf(selected); setEl(selected, () => ({ w: Math.min(200, w + 2) })); all(); }));
    if (selected === K.ADVICE) {
      sel.append(SwitchRow('Fixed advice box', L.adviceFixed, v => { L.adviceFixed = v; all(); }, 'Off (default): advice flows under the medicines. On: advice is printed inside this box.'),
        stepRow('Height ' + e.len.toFixed(0) + ' mm', () => { setEl(K.ADVICE, x => ({ len: Math.max(10, x.len - 5) })); all(); }, () => { setEl(K.ADVICE, x => ({ len: Math.min(280, x.len + 5) })); all(); }),
        h('div', { class: 'small muted' }, 'Text longer than the box continues on the next page in the same box position.'));
    }
    const im = isImg(selected) ? imOf(selected) : null;
    if (im) {
      sel.append(h('div', { style: 'font-weight:600' }, 'Size ' + e.w.toFixed(0) + ' × ' + e.len.toFixed(0) + ' mm'),
        h('div', { class: 'scrollx' }, Btn('Smaller', { kind: 'outline', sm: true, onClick: () => { scaleImg(selected, -0.08); all(); } }), Btn('Bigger', { kind: 'outline', sm: true, onClick: () => { scaleImg(selected, 0.08); all(); } }),
          Btn('Original ratio', { kind: 'outline', sm: true, onClick: () => { setEl(selected, x => ({ len: x.w / im.aspect })); all(); } })),
        h('div', { class: 'scrollx' }, 'Width', Btn('−', { kind: 'outline', sm: true, onClick: () => { setEl(selected, x => ({ w: Math.max(5, x.w - 1) })); all(); } }), Btn('+', { kind: 'outline', sm: true, onClick: () => { setEl(selected, x => ({ w: Math.min(L.pageW, x.w + 1) })); all(); } }),
          ' Height', Btn('−', { kind: 'outline', sm: true, onClick: () => { setEl(selected, x => ({ len: Math.max(5, x.len - 1) })); all(); } }), Btn('+', { kind: 'outline', sm: true, onClick: () => { setEl(selected, x => ({ len: Math.min(L.pageH, x.len + 1) })); all(); } })),
        slider(v => 'Opacity: ' + Math.round(v * 100) + ' %', im.opacity, 0.05, 1, 0.01, v => { im.opacity = v; refresh(); }),
        SwitchRow('Print on every page', im.allPages, v => { im.allPages = v; refresh(); }),
        h('div', { class: 'scrollx' }, Btn('Replace picture', { kind: 'outline', onClick: () => pickPicture(selected) }),
          Btn('Remove from page', { kind: 'outline', onClick: () => { im.placed = false; selected = K.H1; all(); } }),
          Btn('Delete', { kind: 'text', onClick: () => confirmDialog('Delete picture', 'Delete “' + im.label + '” permanently?', () => deletePicture(im)) })),
        h('div', { class: 'small muted' }, 'Drag the picture to move it; drag the round handle at its bottom-right corner to resize.'));
    }
    if (selected === K.WATERMARK) {
      sel.append(h('div', { class: 'row' },
        Btn(hasWm ? 'Change image' : 'Choose image', { onClick: async () => {
          const f = await pickFile('image/*'); if (!f) return;
          try { await api('image_upload', { kind: 'watermark', data: await resizeImage(f, 1200, 'image/png') }); hasWm = true; wmUrl = 'api.php?action=file&kind=watermark&t=' + Date.now(); setEl(K.WATERMARK, () => ({ visible: true })); all(); }
          catch (er) { toast('Image failed: ' + er.message); }
        } }),
        hasWm ? Btn('Remove image', { kind: 'outline', onClick: async () => { await api('image_delete', { kind: 'watermark' }); hasWm = false; wmUrl = ''; all(); } }) : null),
        slider(v => 'Opacity: ' + Math.round(v * 100) + ' %', L.wmOpacity, 0.02, 1, 0.01, v => { L.wmOpacity = v; refresh(); }),
        h('div', { class: 'small muted' }, 'Optional. Printed behind everything on every page when “Show on prescription” is on.'));
    }
    if (selected === K.NAME || selected === K.AGE || selected === K.DATE) sel.append(StyleRow(selected));
    if (selected === K.BODY) {
      sel.append(h('div', { class: 'small muted' }, 'Everything in the body area. Size “auto” follows the text size in Layout options.'),
        [K.S_HEAD, K.S_ITEM, K.S_RX, K.S_MEDNAME, K.S_MEDDOSE].map(StyleRow),
        slider(v => 'Line height: ' + v.toFixed(2), L.lineSpacing, 0.9, 1.6, 0.05, v => { L.lineSpacing = v; refresh(); }),
        slider(v => 'Gap between entries: ' + v + ' pt', L.itemGap, 0, 12, 1, v => { L.itemGap = v; refresh(); }),
        h('div', { class: 'small muted' }, 'Move the “body starts here” marker to set where the body begins; the vertical line sets the sidebar width.'));
    }
    if (K.templated.includes(selected)) {
      const hf = HtmlField({ label: K.label(selected) + ' text (HTML tags and {variables})', value: tplOf(L, selected), variables: Rich.VARIABLES, minLines: 4, onChange: v => { L.templates[selected] = v; refresh(); } });
      sel.append(hf, h('div', { class: 'small muted' }, 'Put each line’s tags inside that line. A line whose variables are all empty (e.g. no BMDC no.) is left out automatically. <br> or Enter = new line.'),
        h('div', null, Btn('Reset this text', { kind: 'text', onClick: () => { delete L.templates[selected]; all(); } })));
    }
    if (K.lines.includes(selected)) {
      sel.append(stepRow('Thickness ' + e.thick.toFixed(1) + ' mm', () => { setEl(selected, x => ({ thick: Math.max(0.1, Math.round((x.thick - 0.1) * 10) / 10) })); all(); }, () => { setEl(selected, x => ({ thick: Math.min(3, Math.round((x.thick + 0.1) * 10) / 10) })); all(); }),
        h('div', { class: 'row' }, Btn('Shorter', { kind: 'outline', onClick: () => { resize(selected, -1); all(); } }), Btn('Longer', { kind: 'outline', onClick: () => { resize(selected, 1); all(); } })));
    }
    const pics = Card('Pictures (logo, stamp, banner …)', [
      h('div', { class: 'small muted' }, 'Add as many pictures as you like and place them anywhere on the page.'),
      h('div', null, Btn('Add picture', { icon: 'add', onClick: () => pickPicture(null) })),
      L.images.map(i => { const k = 'img:' + i.id, e2 = L.items[k];
        return h('div', { class: 'row', style: 'gap:8px' },
          h('img', { src: 'api.php?action=file&kind=img_' + i.id + '&t=' + imgVer, style: 'width:40px;height:40px;object-fit:contain;background:#eee;border-radius:4px' }),
          h('div', { class: 'grow' }, h('div', { style: 'font-weight:600' }, i.label), h('div', { class: 'small muted' }, !i.placed ? 'Not on the page' : e2.visible ? 'On the page' : 'Hidden')),
          i.placed ? [Btn('Select', { kind: 'text', sm: true, onClick: () => { selected = k; all(); } }), Switch(e2.visible, v => { L.items[k] = Object.assign({}, e2, { visible: v }); all(); })]
            : [Btn('Place', { kind: 'text', sm: true, onClick: () => { i.placed = true; L.items[k] = Object.assign({}, e2, { visible: true }); selected = k; all(); } }),
              Btn('Delete', { kind: 'text', sm: true, onClick: () => confirmDialog('Delete picture', 'Delete “' + i.label + '” permanently?', () => deletePicture(i)) })]);
      })]);
    const opt = Card('Layout options', [
      SwitchRow('Header line carries everything below it', L.followHeader, v => { L.followHeader = v; }, 'Patient info, vertical line and the body move together with the header line.'),
      slider(v => 'Left margin: ' + v + ' mm', L.marginL, 5, 30, 1, v => { L.marginL = v; refresh(); }),
      slider(v => 'Right margin: ' + v + ' mm', L.marginR, 5, 30, 1, v => { L.marginR = v; refresh(); }),
      slider(v => 'Text size: ' + v.toFixed(1) + ' pt', L.baseFont, 8, 14, 0.5, v => { L.baseFont = v; refresh(); }),
      Field({ label: 'QR caption (above the QR code)', value: caption, onInput: v => { caption = v; refresh(); } }),
      slider(v => 'QR code size: ' + v + ' mm', L.qrSize, 18, 40, 1, v => { L.qrSize = v; refresh(); }),
      h('div', { class: 'small muted' }, 'The QR holds ID, date, patient, doctor, BMDC no. and chamber. A larger QR scans more easily.'),
      SwitchRow('Print the “Rx” mark', L.showRx, v => { L.showRx = v; refresh(); }),
      SwitchRow('Show “Name:” label', L.showNameLabel, v => { L.showNameLabel = v; refresh(); }),
      SwitchRow('Show “Age:” label', L.showAgeLabel, v => { L.showAgeLabel = v; refresh(); }),
      SwitchRow('Show “Date:” label', L.showDateLabel, v => { L.showDateLabel = v; refresh(); }),
      SwitchRow('Line above signature', L.sigLine, v => { L.sigLine = v; refresh(); }),
      h('div', { class: 'small muted' }, 'The patient name is always printed with the patient ID, e.g. Mamun (ID).')], 'opt');
    const wide = window.innerWidth >= 1100;
    controls.append(sel, pics, opt);
  }

  async function save() {
    await api('settings_set', { page_layout: layoutToJson(L), qr_caption: caption });
    toast('Page setup saved');
  }
  async function previewPdf() {
    const pg = renderPrescription({ doctor, chamber, patient, rx, layout: L, qrCaption: caption, photoUrl, watermarkUrl: wmUrl, imgVer });
    modal({ title: 'PDF preview (sample data)', wide: true, body: scaledPages(pg, Math.min(720, window.innerWidth - 80)), actions: [{ label: 'Print', onClick: () => { printPages(renderPrescription({ doctor, chamber, patient, rx, layout: L, qrCaption: caption, photoUrl, watermarkUrl: wmUrl, imgVer })); return false; } }, { label: 'Close' }] });
  }
  const bottom = h('div', { class: 'row' }, Btn('Save', { onClick: () => save().catch(e => toast(e.message)) }), Btn('Preview', { kind: 'outline', onClick: previewPdf }),
    Btn('Reset', { kind: 'text', onClick: () => confirmDialog('Reset page setup', 'Put every item back to the default place and style?', () => { const keepI = L.images, keepE = {}; keepI.forEach(i => { keepE['img:' + i.id] = L.items['img:' + i.id]; }); L = defaultLayout(); L.images = keepI; Object.assign(L.items, keepE); selected = K.H1; all(); }, 'Reset') }));
  bottom.firstChild.style.flex = bottom.children[1].style.flex = '1';

  const wide = h('div', { class: 'psetup' }, h('div', { class: 'psetup-l col' }, h('div', { class: 'small muted' }, 'Drag any item on the page to where you want it printed. Tap an item to select it, then fine-tune with the arrows. Lines have a round handle at the end to change their length.'), pageHost), h('div', { class: 'psetup-r' }, controls));
  const style = h('style', null, '.psetup{display:flex;flex-direction:column;gap:12px}@media(min-width:1100px){.psetup{flex-direction:row;align-items:flex-start}.psetup-l{flex:0 0 min(58%,760px);position:sticky;top:0}.psetup-r{flex:1;min-width:0}}');
  return { title: 'Page setup', back: true, backTo: '#/settings', wide: true, el: h('div', { style: 'width:100%;max-width:1400px;margin:0 auto' }, style, wide), bottom,
    onMount: () => { drawControls(); render(); window.addEventListener('resize', onResize); } };
  function onResize() { if (!document.body.contains(pageHost)) { window.removeEventListener('resize', onResize); return; } refresh(); }
};
