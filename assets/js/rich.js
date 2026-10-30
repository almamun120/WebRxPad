'use strict';
/* ===== Rich text (HTML subset), advice entries, QR text — same rules as the Android app ===== */
const Rich = (() => {
  const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'BIG', 'SMALL', 'FONT', 'BR', 'SUB', 'SUP', 'SPAN', 'DIV', 'P',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'TT', 'CODE', 'CITE', 'DFN', 'INS', 'MARK', 'A']);
  const STYLE_OK = /^(color|background-color|font-size|font-weight|font-style|text-decoration|text-align)$/;
  const VARIABLES = ['doctor_name', 'degrees', 'specialty', 'bmdc', 'doctor_phone', 'doctor_email',
    'clinic_name', 'chamber_address', 'chamber_phone', 'chamber_gps', 'chamber_note'];

  function clean(node) {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1 || !TAGS.has(c.tagName)) {
        if (c.nodeType === 1 && /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED)$/.test(c.tagName)) { c.remove(); continue; }
        // unknown tag: keep its text/children
        clean(c);
        while (c.firstChild) node.insertBefore(c.firstChild, c);
        c.remove();
        continue;
      }
      for (const a of Array.from(c.attributes)) {
        const n = a.name.toLowerCase();
        if (n === 'color' && c.tagName === 'FONT') continue;
        if (n === 'size' && c.tagName === 'FONT') continue;
        if (n === 'align') continue;
        if (n === 'style') {
          const keep = [];
          a.value.split(';').forEach(p => { const i = p.indexOf(':'); if (i > 0) { const k = p.slice(0, i).trim().toLowerCase(), v = p.slice(i + 1).trim(); if (STYLE_OK.test(k) && !/url\(|expression|javascript/i.test(v)) keep.push(k + ':' + v); } });
          if (keep.length) c.setAttribute('style', keep.join(';')); else c.removeAttribute('style');
          continue;
        }
        if (n === 'href' && c.tagName === 'A') { if (!/^https?:/i.test(a.value)) c.removeAttribute('href'); else { c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener'); } continue; }
        c.removeAttribute(a.name);
      }
      clean(c);
    }
  }
  function trimTail(html) { return html.replace(/(?:\s|<br\s*\/?>|&nbsp;)+$/gi, ''); }
  function sanitize(html) {
    const src = String(html == null ? '' : html).replace(/\r/g, '').replace(/\n/g, '<br>');
    const doc = new DOMParser().parseFromString('<body>' + src + '</body>', 'text/html');
    clean(doc.body);
    return trimTail(doc.body.innerHTML);
  }
  function plain(html) {
    const doc = new DOMParser().parseFromString('<body>' + String(html == null ? '' : html).replace(/\r/g, '').replace(/\n/g, '<br>') + '</body>', 'text/html');
    doc.body.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    doc.body.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach(b => b.append('\n'));
    return doc.body.textContent.replace(/\s+$/, '');
  }
  const PH = /\{([a-z_]+)\}/g;
  /** Fills a template; lines whose placeholders are all empty are dropped. Returns '' when nothing is left. */
  function template(tpl, vars) {
    if (!tpl || !tpl.trim()) return '';
    const lines = [];
    for (const piece of tpl.split(/<br\s*\/?>|\r?\n/i)) {
      const holders = [...piece.matchAll(PH)].map(m => m[1]);
      if (holders.length && holders.every(k => !String(vars[k] || '').trim())) continue;
      lines.push(piece.replace(PH, (m, k) => esc(vars[k] || '')));
    }
    const html = sanitize(lines.join('<br>'));
    return plain(html).trim() ? html : '';
  }
  function vars(doctor, chamber, patient, rx, dateText) {
    const age = rx.age || patient.age || '';
    const c = chamber || {};
    return {
      doctor_name: doctor.name || '', degrees: doctor.degrees || '', specialty: doctor.specialty || '', bmdc: doctor.bmdc || '',
      doctor_phone: doctor.phone || '', doctor_email: doctor.email || '',
      clinic_name: c.name || '', chamber_address: c.address || '', chamber_phone: c.phone || '',
      chamber_gps: (c.lat && c.lon) ? c.lat + ', ' + c.lon : '', chamber_note: c.note || '',
      patient_name: patient.name || '', patient_id: patient.id || '',
      patient_age: (age && /^\d+$/.test(age)) ? age + 'Y' : age, patient_sex: patient.sex || '', date: dateText || ''
    };
  }
  return { sanitize, plain, template, vars, VARIABLES };
})();

/** Findings list entry: "Name | unit=mmHg" or "Name | options=A;B;C | multi". */
const FindingDef = {
  parse(raw) {
    const parts = String(raw || '').split('|').map(x => x.trim());
    const name = parts.shift() || '';
    let unit = '', options = [], multi = false;
    parts.forEach(p => {
      if (/^unit=/i.test(p)) unit = p.slice(5).trim();
      else if (/^options=/i.test(p)) options = p.slice(8).split(';').map(x => x.trim()).filter(Boolean);
      else if (/^multi$/i.test(p)) multi = true;
    });
    return { name, unit, options, multi: multi && options.length > 0 };
  },
  encode(d) {
    const cl = x => String(x || '').replace(/\|/g, '/').replace(/\n/g, ' ').trim();
    let o = cl(d.name);
    if (cl(d.unit)) o += ' | unit=' + cl(d.unit);
    const opts = (d.options || []).map(x => cl(x).replace(/;/g, ',')).filter(Boolean);
    if (opts.length) { o += ' | options=' + opts.join(';'); if (d.multi) o += ' | multi'; }
    return o;
  },
  summary(d) {
    const a = [];
    if (d.unit) a.push('unit: ' + d.unit);
    if (d.options.length) a.push('options: ' + d.options.join(', ') + (d.multi ? ' (many can be chosen)' : ''));
    return a.join('  ·  ');
  },
  nameOf(raw) { return Rich.plain(FindingDef.parse(raw).name); },
  values(v) { return String(v || '').split(',').map(x => x.trim()).filter(Boolean); }
};

const Advice = (() => {
  function decode(raw) {
    const t = String(raw || '').trim();
    if (t.startsWith('{')) {
      try { const o = JSON.parse(t); if ('c' in o || 'b' in o) return { c: o.c || '', b: o.b || '', s: !!o.s }; } catch (e) { /* plain text */ }
    }
    const first = (t.split(/\r?\n/).find(l => l.trim()) || '');
    return { c: Rich.plain(first).slice(0, 80), b: t, s: false };
  }
  const encode = a => JSON.stringify({ c: a.c, b: a.b, s: !!a.s });
  function bullets(a) {
    const out = [];
    for (const line of String(a.b || '').replace(/\r/g, '').split('\n')) {
      if (!line.trim()) continue;
      const x = line.replace(/\t/g, '    ');
      const lead = x.length - x.trimStart().length;
      let t = x.trim();
      if (t.length > 1 && '•-*–·'.includes(t[0]) && t[1] === ' ') t = t.slice(2).trim();
      out.push([Math.min(Math.floor(lead / 2), 4), t]);
    }
    return out;
  }
  const glyph = level => ['•', '–', '◦', '·'][Math.min(level, 3)] || '·';
  function normalize(raw) {
    const a = decode(raw);
    let cap = a.c;
    if (!cap.trim()) { const b = bullets(a)[0]; cap = b ? Rich.plain(b[1]).slice(0, 80) : ''; }
    return encode({ c: cap, b: a.b, s: false });
  }
  const captionPlain = raw => Rich.plain(decode(raw).c);
  return { decode, encode, bullets, glyph, normalize, captionPlain };
})();

/** Text inside the printed QR code (same lines as the Android app). */
function patientQrText(patient, rx, doctor, chamber, dateText) {
  const age = rx.age || patient.age || '';
  const lines = ['ID: ' + patient.id, 'Date: ' + dateText];
  const who = [patient.name, age ? age + 'Y' : '', patient.sex].filter(x => x).join(' / ');
  lines.push('Patient: ' + who);
  if (doctor.name) lines.push('Doctor: ' + doctor.name);
  if (doctor.specialty) lines.push('Speciality: ' + doctor.specialty);
  if (doctor.degrees) lines.push('Degree: ' + Rich.plain(doctor.degrees).replace(/\n/g, ', '));
  if (doctor.bmdc) lines.push('BMDC Reg No: ' + doctor.bmdc);
  if (chamber) {
    if (chamber.name) lines.push('Chamber: ' + chamber.name);
    if (chamber.address) lines.push('Address: ' + chamber.address.replace(/\n/g, ', '));
    if (chamber.phone) lines.push('Phone: ' + chamber.phone);
    if (chamber.lat && chamber.lon) lines.push('GPS: ' + chamber.lat + ', ' + chamber.lon);
  }
  return lines.join('\n');
}

/** QR code as a compact SVG path string; returns {n, d}. */
function qrMatrix(text) {
  const bin = unescape(encodeURIComponent(text));
  const q = new window.QRCodeLib(0, 1);   // auto size, error correction L
  q.addData(bin); q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (q.isDark(r, c)) { let e = c; while (e < n && q.isDark(r, e)) e++; d += 'M' + c + ' ' + r + 'h' + (e - c) + 'v1h-' + (e - c) + 'z'; c = e; } else c++;
    }
  }
  return { n, d };
}
function qrSvg(text, sizeCss) {
  const m = qrMatrix(text);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + m.n + ' ' + m.n + '" width="' + sizeCss + '" height="' + sizeCss + '" shape-rendering="crispEdges" style="display:block"><path d="' + m.d + '" fill="#000"/></svg>';
}

/** prescription_<date-time>_<doctor>_<patient>_<age>_<id> */
function rxBase(doctor, patient, age, id) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  const part = s => String(s || '').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
  const a = (age && /^\d+$/.test(age)) ? age + 'Y' : age;
  return ['prescription', stamp, part(doctor), part(patient), part(a), id].filter(x => x).join('_');
}
