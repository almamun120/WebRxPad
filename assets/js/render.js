'use strict';
/* ===== Page layout model + prescription renderer (HTML, A4, mm positions) + PDF / print =====
   Mirrors PageLayout.kt and PdfBuilder.kt of the Android app. JSON is compatible with the app. */
const K = {
  DOCTOR: 'doctor', CHAMBER: 'chamber', PHOTO: 'photo', NAME: 'name', AGE: 'age', DATE: 'date', BODY: 'body', SIGN: 'signature',
  QR: 'qr', H1: 'h1', V: 'v', H2: 'h2', FOOTER: 'footer', ADVICE: 'advice', WATERMARK: 'watermark',
  S_HEAD: 's_head', S_ITEM: 's_item', S_RX: 's_rx', S_MEDNAME: 's_medname', S_MEDDOSE: 's_meddose'
};
K.lines = [K.H1, K.V, K.H2];
K.followers = [K.NAME, K.AGE, K.DATE, K.V, K.BODY];
K.templated = [K.DOCTOR, K.CHAMBER, K.SIGN, K.FOOTER];
K.hideable = [K.DOCTOR, K.CHAMBER, K.PHOTO, K.SIGN, K.V, K.H2, K.FOOTER, K.WATERMARK];
K.alignable = [K.DOCTOR, K.CHAMBER, K.SIGN, K.FOOTER];
K.widthed = [K.DOCTOR, K.CHAMBER, K.SIGN, K.FOOTER, K.PHOTO, K.ADVICE, K.WATERMARK];
K.styled = [K.NAME, K.AGE, K.DATE, K.S_HEAD, K.S_ITEM, K.S_RX, K.S_MEDNAME, K.S_MEDDOSE];
K.label = key => ({ doctor: 'Doctor info', chamber: 'Chamber info', photo: 'Doctor photo', name: 'Patient name', age: 'Age / sex', date: 'Date', body: 'Body start',
  signature: 'Signature', qr: 'QR + ID', h1: 'Header line', v: 'Vertical line', h2: 'Footer line', footer: 'Footer text', advice: 'Advice box', watermark: 'Watermark' }[key] || key);
K.styleLabel = key => ({ s_head: 'Section headings', s_item: 'Section / advice text', s_rx: '“Rx” mark', s_medname: 'Medicine name line', s_meddose: 'Dosage line' }[key] || K.label(key));
K.defStyle = key => ({ size: 0, bold: [K.NAME, K.AGE, K.DATE, K.S_MEDNAME, K.S_HEAD, K.S_RX].includes(key), italic: false, underline: false });
K.factor = key => key === K.S_HEAD ? 1.05 : key === K.S_RX ? 1.5 : 1;

const DefaultTemplates = {
  doctor: '<big><b>{doctor_name}</b></big><br>{degrees}<br>{specialty}<br><small>BMDC Reg. No: {bmdc}</small><br><small>Phone: {doctor_phone}</small>',
  chamber: '<b>{clinic_name}</b><br>{chamber_address}<br><small>Phone: {chamber_phone}</small><br><small>{chamber_note}</small>',
  signature: '<b>{doctor_name}</b><br><small>{degrees}</small><br><small>BMDC Reg. No: {bmdc}</small>',
  footer: ''
};

function defaultLayout() {
  const e = (x, y, o) => Object.assign({ x, y, len: 0, w: 0, align: 0, visible: true, thick: 0.3 }, o || {});
  return {
    pageW: 210, pageH: 297,
    items: {
      doctor: e(15, 10, { w: 80 }), photo: e(98, 10, { w: 24, visible: false }), chamber: e(125, 10, { w: 70, align: 2 }),
      h1: e(15, 48, { len: 180 }), name: e(15, 52), age: e(100, 52), date: e(150, 52), body: e(15, 64),
      v: e(70, 64, { len: 182 }), h2: e(15, 250, { len: 180 }), signature: e(135, 226, { w: 60, align: 2 }), qr: e(15, 252),
      footer: e(60, 251.5, { w: 135, align: 2 }), advice: e(73, 160, { len: 85, w: 122 }), watermark: e(55, 100, { w: 100, visible: false })
    },
    marginL: 15, marginR: 15, baseFont: 10, followHeader: true, qrSize: 26,
    showNameLabel: true, showAgeLabel: true, showDateLabel: true, sigLine: true,
    templates: {}, adviceFixed: false, showRx: true, wmOpacity: 0.15, styles: {}, lineSpacing: 1.1, itemGap: 2, images: []
  };
}
function layoutFromJson(json) {
  const d = defaultLayout();
  if (!json) return d;
  try {
    const o = JSON.parse(json);
    const its = o.items || {};
    for (const k in d.items) {
      const e = its[k], de = d.items[k];
      if (e) d.items[k] = { x: num(e.x, de.x), y: num(e.y, de.y), len: num(e.len, de.len), w: num(e.w, de.w), align: e.align | 0, visible: e.visible !== false, thick: num(e.thick, de.thick) };
    }
    for (const k of ['marginL', 'marginR', 'baseFont', 'qrSize', 'wmOpacity', 'lineSpacing', 'itemGap']) if (o[k] != null) d[k] = num(o[k], d[k]);
    for (const k of ['followHeader', 'showNameLabel', 'showAgeLabel', 'showDateLabel', 'sigLine', 'adviceFixed', 'showRx']) if (o[k] != null) d[k] = !!o[k];
    d.templates = o.templates || {};
    (Array.isArray(o.images) ? o.images : []).forEach(im => {
      const e = its['img:' + im.id];
      if (!e || !/^[a-z0-9]{6,16}$/.test(String(im.id))) return;
      d.images.push({ id: String(im.id), label: String(im.label || 'Picture'), placed: im.placed !== false, allPages: im.allPages !== false, opacity: num(im.opacity, 1), aspect: num(im.aspect, 1) });
      d.items['img:' + im.id] = { x: num(e.x, 20), y: num(e.y, 20), len: num(e.len, 30), w: num(e.w, 30), align: 0, visible: e.visible !== false, thick: 0.3 };
    });
    const so = o.styles || {};
    for (const k of K.styled) if (so[k]) d.styles[k] = { size: num(so[k].size, 0), bold: so[k].b != null ? !!so[k].b : K.defStyle(k).bold, italic: !!so[k].i, underline: !!so[k].u };
  } catch (e) { /* defaults */ }
  return d;
}
function num(v, def) { const n = parseFloat(v); return isFinite(n) ? n : def; }
function layoutToJson(L) {
  const styles = {};
  for (const k of K.styled) { const s = styleOf(L, k); styles[k] = { size: s.size, b: s.bold, i: s.italic, u: s.underline }; }
  return JSON.stringify({ marginL: L.marginL, marginR: L.marginR, baseFont: L.baseFont, followHeader: L.followHeader, qrSize: L.qrSize,
    showNameLabel: L.showNameLabel, showAgeLabel: L.showAgeLabel, showDateLabel: L.showDateLabel, sigLine: L.sigLine, adviceFixed: L.adviceFixed,
    showRx: L.showRx, wmOpacity: L.wmOpacity, lineSpacing: L.lineSpacing, itemGap: L.itemGap, items: L.items, templates: L.templates, styles, images: L.images || [] });
}
const styleOf = (L, k) => L.styles[k] || K.defStyle(k);
const sizeOf = (L, k) => styleOf(L, k).size > 0 ? styleOf(L, k).size : L.baseFont * K.factor(k);
const tplOf = (L, k) => (L.templates[k] != null ? L.templates[k] : DefaultTemplates[k] || '');

const FONT = 'system-ui,-apple-system,"Segoe UI","Noto Sans Bengali","Nirmala UI",Roboto,Arial,sans-serif';
const PX_PER_MM = 96 / 25.4;

function fontCss(L, key) {
  const s = styleOf(L, key);
  return 'font-size:' + sizeOf(L, key) + 'pt;font-weight:' + (s.bold ? 700 : 400) + ';font-style:' + (s.italic ? 'italic' : 'normal') + ';text-decoration:' + (s.underline ? 'underline' : 'none') + ';';
}
const alignCss = a => 'text-align:' + (a === 1 ? 'center' : a === 2 ? 'right' : 'left') + ';';

let measureHost = null;
function host() {
  if (!measureHost) { measureHost = h('div', { style: 'position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none' }); document.body.appendChild(measureHost); }
  return measureHost;
}

/**
 * Builds the pages. c = {doctor, chamber, patient, rx:{date,age,complaints,...}, layout, qrCaption, photoUrl, watermarkUrl, edit}
 * Returns an array of page elements (210mm x 297mm).
 */
function renderPrescription(c) {
  const L = c.layout, rx = c.rx, base = L.baseFont, edit = !!c.edit;
  const dateText = fmtDate(rx.date);
  const vars = Rich.vars(c.doctor, c.chamber, c.patient, rx, dateText);
  const hostEl = host();
  const gap = L.itemGap;
  const lh = 'line-height:' + (1.18 * L.lineSpacing).toFixed(3) + ';';

  const vx = L.items.v.x, leftX = L.marginL, leftW = Math.max(30, vx - L.marginL - 3);
  const rightX = vx + 3, rightW = Math.max(40, L.pageW - L.marginR - rightX);

  const blk = (widthMm, inner, extra) => h('div', { style: 'position:absolute;left:0;top:0;width:' + widthMm + 'mm;color:#000;' + lh + (extra || ''), html: inner });
  const measure = el => { hostEl.appendChild(el); const px = el.getBoundingClientRect().height; return px * 0.75; };   // px -> pt

  const itemCss = fontCss(L, K.S_ITEM), headCss = fontCss(L, K.S_HEAD);
  function bullet(html, prefix, extra) {
    return '<div style="display:flex;gap:0.35em;' + (extra || '') + '"><span style="flex:none;min-width:0.9em">' + esc(prefix) + '</span><div style="flex:1;min-width:0;word-break:break-word">' + Rich.sanitize(html) + '</div></div>';
  }
  const blocks = (list) => list;     // readability

  function sectionBlocks(title, items, widthMm, numbered, gapBefore) {
    const clean = items.filter(s => s && String(s).trim());
    const out = [];
    clean.forEach((s, i) => {
      const first = i === 0, last = i === clean.length - 1;
      const pad = (first ? gapBefore : 0);
      const inner = (first ? '<div style="' + headCss + 'padding-bottom:3pt">' + esc(title) + '</div>' : '') + bullet(s, numbered ? (i + 1) + '.' : '•', itemCss);
      const el = blk(widthMm, inner, 'padding-top:' + pad + 'pt;padding-bottom:' + (gap + (!numbered && last ? 8 : 0)) + 'pt;');
      out.push({ el, h: measure(el) });
    });
    return out;
  }

  const left = [];
  left.push(...sectionBlocks('COMPLAINTS', rx.complaints || [], leftW, false, 0));
  left.push(...sectionBlocks('HISTORY', rx.history || [], leftW, false, 0));
  left.push(...sectionBlocks('FINDINGS', (rx.findings || []).filter(f => (f.type || '').trim() || (f.value || '').trim())
    .map(f => (f.value || '').trim() ? f.type + ': ' + esc(f.value) + ((f.unit || '').trim() ? ' ' + esc(f.unit) : '') : f.type), leftW, false, 0));
  left.push(...sectionBlocks('INVESTIGATION', rx.investigation || [], leftW, false, 0));
  left.push(...sectionBlocks('DIAGNOSIS', rx.diagnosis || [], leftW, false, 0));

  const right = [];
  const meds = (rx.medications || []).filter(m => (m.name || '').trim());
  const rxHeadH = L.showRx ? null : 0;
  meds.forEach((m, i) => {
    const first = i === 0;
    const title = [abbreviateForm(m.form), m.name, m.strength].filter(x => x && String(x).trim()).join(' ');
    const dose = [esc(m.dosage || ''), esc(m.duration || ''), Rich.sanitize(m.instruction || '')].filter(x => x && x.trim()).join('&nbsp;&nbsp;&nbsp;&nbsp; ');
    const inner = (first && L.showRx ? '<div style="' + fontCss(L, K.S_RX) + 'padding-bottom:4pt">Rx</div>' : '') +
      '<div style="' + fontCss(L, K.S_MEDNAME) + '">' + (i + 1) + '.&nbsp; ' + esc(title) + '</div>' +
      (dose ? '<div style="margin-left:18pt;' + fontCss(L, K.S_MEDDOSE) + '">' + dose + '</div>' : '');
    const el = blk(rightW, inner, 'padding-bottom:7pt;');
    right.push({ el, h: measure(el) });
  });

  function adviceBlocks(items, widthMm, gapBefore) {
    const list = items.map(Advice.decode).filter(a => Advice.bullets(a).length || (a.s && a.c));
    const out = [];
    list.forEach((a, i) => {
      const first = i === 0;
      let inner = first ? '<div style="' + headCss + 'padding-bottom:3pt">ADVICE</div>' : '';
      if (a.s && a.c) inner += '<div style="' + itemCss + 'font-weight:700;padding-bottom:' + (gap / 2) + 'pt">' + Rich.sanitize(a.c) + '</div>';
      for (const [lvl, html] of Advice.bullets(a)) inner += '<div style="padding-bottom:' + (gap / 2) + 'pt;margin-left:' + (lvl * 4) + 'mm">' + bullet(html, Advice.glyph(lvl), itemCss) + '</div>';
      const el = blk(widthMm, inner, 'padding-top:' + (first ? gapBefore : 0) + 'pt;padding-bottom:' + (gap * 2) + 'pt;');
      out.push({ el, h: measure(el) });
    });
    return out;
  }
  const advEl = L.items.advice;
  let advBlocks = [];
  if (L.adviceFixed) advBlocks = adviceBlocks(rx.advice || [], advEl.w > 0 ? advEl.w : rightW, 0);
  else right.push(...adviceBlocks(rx.advice || [], rightW, 6));
  right.push(...sectionBlocks('FOLLOW UP', rx.followUp || [], rightW, false, 8));

  // ----- pagination (pt) -----
  const MM = 72 / 25.4;
  const firstTop = L.items.body.y * MM, nextTop = 15 * MM, bottom = (L.items.h2.y - 3) * MM;
  function paginate(list, top, limit) {
    const pages = []; let cur = []; let y = top;
    for (const b of list) {
      if (y + b.h > limit && cur.length) { pages.push(cur); cur = []; y = nextTop; }
      cur.push([b, y]); y += b.h;
    }
    pages.push(cur);
    return pages;
  }
  const leftPages = paginate(left, firstTop, bottom), rightPages = paginate(right, firstTop, bottom);
  const advLimit = advEl.len > 0 ? (advEl.y + advEl.len) * MM : bottom;
  const advPages = advBlocks.length ? paginate(advBlocks, advEl.y * MM, advLimit) : [];
  const pageCount = Math.max(leftPages.length, rightPages.length, advPages.length);

  // ----- fixed parts -----
  const ageSrc = rx.age || c.patient.age || '';
  const ageText = (ageSrc ? (/^\d+$/.test(ageSrc) ? ageSrc + 'Y' : ageSrc) : '') + (c.patient.sex ? (ageSrc ? ', ' : '') + c.patient.sex : '');
  const pages = [];

  const ed = (el, key, vis) => { if (edit) { el.dataset.k = key; el.classList.add('ed'); if (vis === false) el.classList.add('off'); } return el; };
  const abs = (key, css, inner, cls) => h('div', { style: 'position:absolute;' + css, html: inner });

  function tplBlock(page, key, extraCss, yOffsetPt) {
    const e = L.items[key];
    if (!e.visible && !edit) return;
    const html = Rich.template(tplOf(L, key), vars);
    const wMm = e.w > 0 ? e.w : (L.pageW - e.x - L.marginR);
    const css = 'left:' + e.x + 'mm;top:calc(' + e.y + 'mm + ' + (yOffsetPt || 0) + 'pt);width:' + wMm + 'mm;' + alignCss(e.align) + 'color:#000;' + lh + (extraCss || '') + 'word-break:break-word;';
    const el = h('div', { style: 'position:absolute;' + css, html: html || (edit ? '<span style="color:#bbb">(empty)</span>' : '') });
    if (!html && !edit) return;
    if (edit) el.style.minHeight = '5mm';
    page.appendChild(ed(el, key, e.visible));
  }
  function lineEl(page, key, vertical) {
    const e = L.items[key];
    if (!e.visible && !edit) return;
    const t = e.thick;
    if (!edit) {
      page.appendChild(h('div', { style: 'position:absolute;background:#5a5a5a;left:' + e.x + 'mm;top:' + e.y + 'mm;' + (vertical ? 'width:' + t + 'mm;height:' + e.len + 'mm' : 'width:' + e.len + 'mm;height:' + t + 'mm') }));
      return;
    }
    const hit = 5;
    const w = h('div', { style: 'position:absolute;' + (vertical ? 'left:' + (e.x - hit / 2) + 'mm;top:' + e.y + 'mm;width:' + hit + 'mm;height:' + e.len + 'mm' : 'left:' + e.x + 'mm;top:' + (e.y - hit / 2) + 'mm;width:' + e.len + 'mm;height:' + hit + 'mm') });
    w.append(h('div', { style: 'position:absolute;background:#555;' + (vertical ? 'left:' + (hit / 2 - t / 2) + 'mm;top:0;width:' + Math.max(t, 0.35) + 'mm;height:100%' : 'top:' + (hit / 2 - t / 2) + 'mm;left:0;height:' + Math.max(t, 0.35) + 'mm;width:100%') }));
    w.append(h('div', { class: 'handle', 'data-h': key, style: vertical ? 'left:' + (hit / 2) + 'mm;bottom:0;transform:translate(-50%,50%)' : 'right:0;top:' + (hit / 2) + 'mm;transform:translate(50%,-50%)' }));
    page.appendChild(ed(w, key, e.visible));
  }

  for (let pi = 0; pi < pageCount; pi++) {
    const first = pi === 0, last = pi === pageCount - 1;
    const page = h('div', { class: 'rx-page', style: 'position:relative;width:' + L.pageW + 'mm;height:' + L.pageH + 'mm;background:#fff;overflow:hidden;font-family:' + FONT + ';color:#000;flex:none' });

    const we = L.items.watermark;
    if (c.watermarkUrl && (we.visible || edit)) {
      const img = h('img', { src: c.watermarkUrl, style: 'position:absolute;left:' + we.x + 'mm;top:' + we.y + 'mm;width:' + (we.w > 0 ? we.w : 100) + 'mm;opacity:' + Math.min(1, Math.max(0.02, L.wmOpacity)) + ';' });
      page.appendChild(ed(img, K.WATERMARK, we.visible));
    } else if (edit && we.visible) {
      page.appendChild(ed(h('div', { style: 'position:absolute;left:' + we.x + 'mm;top:' + we.y + 'mm;width:' + (we.w || 100) + 'mm;height:' + ((we.w || 100) * 0.4) + 'mm;background:rgba(136,136,136,.15);font-size:9pt;color:#888;display:flex;align-items:center;justify-content:center' }, 'watermark (choose an image)'), K.WATERMARK, true));
    }

    for (const im of (L.images || [])) {
      const ie = L.items['img:' + im.id];
      if (!ie || !im.placed || (!im.allPages && !first) || (!ie.visible && !edit)) continue;
      const pic = h('img', { src: 'api.php?action=file&kind=img_' + im.id + '&t=' + (c.imgVer || 0), draggable: 'false',
        style: 'position:absolute;left:' + ie.x + 'mm;top:' + ie.y + 'mm;width:' + ie.w + 'mm;height:' + ie.len + 'mm;opacity:' + Math.min(1, Math.max(0.05, im.opacity)) + ';object-fit:fill;display:block' });
      page.appendChild(ed(pic, 'img:' + im.id, ie.visible));
      if (edit) page.appendChild(h('div', { class: 'handle', 'data-h': 'img:' + im.id, style: 'left:' + (ie.x + ie.w) + 'mm;top:' + (ie.y + ie.len) + 'mm;transform:translate(-50%,-50%);cursor:nwse-resize' }));
    }

    if (first) {
      tplBlock(page, K.DOCTOR, 'font-size:' + (base * 0.95) + 'pt;');
      tplBlock(page, K.CHAMBER, 'font-size:' + (base * 0.95) + 'pt;');
      const pe = L.items.photo;
      if ((pe.visible || edit)) {
        const sz = pe.w > 0 ? pe.w : 24;
        const box = h('div', { style: 'position:absolute;left:' + pe.x + 'mm;top:' + pe.y + 'mm;width:' + sz + 'mm;height:' + sz + 'mm;border-radius:50%;overflow:hidden;background:#e0e0e0;color:#888;font-size:8pt;display:flex;align-items:center;justify-content:center' });
        if (c.photoUrl) box.append(h('img', { src: c.photoUrl, style: 'width:100%;height:100%;object-fit:cover;display:block' })); else if (edit) box.append('photo');
        if (c.photoUrl || edit) page.appendChild(ed(box, K.PHOTO, pe.visible));
      }
      const field = (key, text) => {
        if (!text.trim()) return;
        const e = L.items[key];
        page.appendChild(ed(h('div', { style: 'position:absolute;left:' + e.x + 'mm;top:' + e.y + 'mm;width:' + (L.pageW - e.x - L.marginR) + 'mm;color:#000;' + lh + fontCss(L, key) }, text), key, true));
      };
      field(K.NAME, (L.showNameLabel ? 'Name: ' : '') + c.patient.name + ' (' + c.patient.id + ')');
      field(K.AGE, ageText ? (L.showAgeLabel ? 'Age: ' : '') + ageText : '');
      field(K.DATE, (L.showDateLabel ? 'Date: ' : '') + dateText);
      lineEl(page, K.H1, false);
      if (edit) {
        const b = L.items.body;
        page.appendChild(ed(h('div', { style: 'position:absolute;left:' + L.marginL + 'mm;top:' + b.y + 'mm;width:' + (L.pageW - L.marginL - L.marginR) + 'mm;background:rgba(0,105,92,.1);color:#00695C;font-size:8pt;padding:.4mm 1mm' }, '▼ body starts here'), K.BODY, true));
      }
    }

    (leftPages[pi] || []).forEach(([b, y]) => { b.el.style.left = leftX + 'mm'; b.el.style.top = y + 'pt'; page.appendChild(b.el); });
    (rightPages[pi] || []).forEach(([b, y]) => { b.el.style.left = rightX + 'mm'; b.el.style.top = y + 'pt'; page.appendChild(b.el); });
    (advPages[pi] || []).forEach(([b, y]) => { b.el.style.left = advEl.x + 'mm'; b.el.style.top = y + 'pt'; page.appendChild(b.el); });
    if (edit && L.adviceFixed && first) {
      page.appendChild(ed(h('div', { style: 'position:absolute;left:' + advEl.x + 'mm;top:' + advEl.y + 'mm;width:' + (advEl.w > 0 ? advEl.w : 122) + 'mm;height:' + advEl.len + 'mm;border:1px dashed #ff9800;pointer-events:auto;background:rgba(255,152,0,.05)' }), K.ADVICE, true));
    }

    const v = L.items.v;
    if (v.visible || edit) {
      const top = first ? v.y : 15, len = first ? v.len : (bottom / MM - 15);
      if (first || !edit) {
        if (edit) { lineEl(page, K.V, true); }
        else page.appendChild(h('div', { style: 'position:absolute;background:#5a5a5a;left:' + v.x + 'mm;top:' + top + 'mm;width:' + v.thick + 'mm;height:' + len + 'mm' }));
      }
    }
    if (L.items.h2.visible || edit) lineEl(page, K.H2, false);

    // QR + ID
    const qe = L.items.qr;
    const blockW = Math.max(40, L.qrSize + 6);
    const qrBox = h('div', { style: 'position:absolute;left:' + qe.x + 'mm;top:' + qe.y + 'mm;width:' + blockW + 'mm;text-align:center;color:#000' });
    if ((c.qrCaption || '').trim()) qrBox.append(h('div', { style: 'font-size:' + (base * 0.6) + 'pt;color:#444;padding-bottom:2pt;line-height:1.2' }, c.qrCaption));
    qrBox.append(h('div', { style: 'width:' + L.qrSize + 'mm;height:' + L.qrSize + 'mm;margin:0 auto', html: qrSvg(patientQrText(c.patient, rx, c.doctor, c.chamber, dateText), L.qrSize + 'mm') }));
    qrBox.append(h('div', { style: 'font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;letter-spacing:.1em;font-size:' + (base * 0.75) + 'pt;padding-top:2pt' }, c.patient.id));
    page.appendChild(ed(qrBox, K.QR, true));

    if (last) {
      const se = L.items.signature;
      if (se.visible || edit) {
        const w = se.w > 0 ? se.w : 60;
        if (L.sigLine && (se.visible || edit)) {
          const lw = Math.min(w, 40);
          const lx = se.align === 1 ? se.x + (w - lw) / 2 : se.align === 2 ? se.x + w - lw : se.x;
          page.appendChild(h('div', { style: 'position:absolute;background:#000;left:' + lx + 'mm;top:' + se.y + 'mm;width:' + lw + 'mm;height:0.3mm' + (edit && !se.visible ? ';opacity:.3' : '') }));
        }
        tplBlock(page, K.SIGN, 'font-size:' + (base * 0.95) + 'pt;', L.sigLine ? 3 : 0);
      }
    }
    tplBlock(page, K.FOOTER, 'font-size:' + (base * 0.85) + 'pt;color:#444;');
    pages.push(page);
  }
  hostEl.innerHTML = '';
  return pages;
}

function abbreviateForm(form) {
  const f = (form || '').trim().toLowerCase();
  if (!f) return '';
  const m = [['tablet', 'TAB'], ['capsule', 'CAP'], ['syrup', 'SYP'], ['suspension', 'SUSP'], ['injection', 'INJ'], ['drop', 'DROP'], ['cream', 'CREAM'],
    ['ointment', 'OINT'], ['gel', 'GEL'], ['inhaler', 'INH'], ['suppository', 'SUPP'], ['sachet', 'SACHET']];
  for (const [p, a] of m) if (f.startsWith(p)) return a;
  return form.trim().toUpperCase();
}

/* ===== PDF (image per page) and print ===== */
async function toDataUrl(url) {
  if (!url || url.startsWith('data:')) return url;
  const r = await fetch(url, { credentials: 'same-origin' });
  const b = await r.blob();
  return await readDataUrl(b);
}
async function pageToCanvas(page, scale) {
  const clone = page.cloneNode(true);
  for (const img of clone.querySelectorAll('img')) img.setAttribute('src', await toDataUrl(img.getAttribute('src')));
  const W = Math.round(page.offsetWidth || 210 * PX_PER_MM), H = Math.round(page.offsetHeight || 297 * PX_PER_MM);
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><foreignObject x="0" y="0" width="100%" height="100%">' + xhtml + '</foreignObject></svg>';
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Could not draw the page')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}
function jpegBytes(cv) {
  const d = cv.toDataURL('image/jpeg', 0.92);
  const bin = atob(d.slice(d.indexOf(',') + 1));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return { data: u, w: cv.width, h: cv.height };
}
function makePdf(imgs) {
  const enc = new TextEncoder();
  const chunks = []; let len = 0; const offs = [];
  const put = x => { const u = typeof x === 'string' ? enc.encode(x) : x; chunks.push(u); len += u.length; };
  const obj = (n, body) => { offs[n] = len; put(n + ' 0 obj\n'); put(body); put('\nendobj\n'); };
  const PW = 595.28, PH = 841.89;
  put('%PDF-1.4\n');
  const n = imgs.length;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + imgs.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] /Count ' + n + ' >>');
  imgs.forEach((im, i) => {
    const p = 3 + i * 3, c = p + 1, x = p + 2;
    obj(p, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 ' + x + ' 0 R >> >> /Contents ' + c + ' 0 R >>');
    const cs = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
    obj(c, '<< /Length ' + cs.length + ' >>\nstream\n' + cs + '\nendstream');
    offs[x] = len; put(x + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length + ' >>\nstream\n');
    put(im.data); put('\nendstream\nendobj\n');
  });
  const total = 3 + n * 3;
  const xr = len;
  put('xref\n0 ' + total + '\n0000000000 65535 f \n');
  for (let i = 1; i < total; i++) put(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  put('trailer\n<< /Size ' + total + ' /Root 1 0 R >>\nstartxref\n' + xr + '\n%%EOF');
  return new Blob(chunks, { type: 'application/pdf' });
}
async function pagesToPdf(pages) {
  const imgs = [];
  for (const p of pages) imgs.push(jpegBytes(await pageToCanvas(p, 2)));
  return makePdf(imgs);
}
function blobToBase64(blob) { return readDataUrl(blob).then(d => d.slice(d.indexOf(',') + 1)); }

function printPages(pages) {
  let root = $('#print-root');
  if (!root) { root = h('div', { id: 'print-root' }); document.body.appendChild(root); }
  clear(root);
  pages.forEach(p => root.appendChild(p.cloneNode(true)));
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); clear(root); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/** Scaled preview of pages inside a container of given width (px). */
function scaledPages(pages, widthPx) {
  const pw = pages[0] ? 210 * PX_PER_MM : 794;
  const s = widthPx / pw;
  const wrap = h('div', { style: 'display:flex;flex-direction:column;gap:12px;align-items:center' });
  pages.forEach(p => {
    const outer = h('div', { style: 'width:' + widthPx + 'px;height:' + (297 * PX_PER_MM * s) + 'px;position:relative;box-shadow:0 1px 6px rgba(0,0,0,.35);background:#fff;overflow:hidden' });
    p.style.transformOrigin = 'top left'; p.style.transform = 'scale(' + s + ')';
    outer.append(p); wrap.append(outer);
  });
  return wrap;
}
