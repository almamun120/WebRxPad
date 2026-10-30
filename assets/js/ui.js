'use strict';
/* ===== reusable UI components (Material-like) ===== */
function Btn(label, o) {
  o = o || {};
  const b = h('button', { class: 'btn ' + (o.kind || '') + (o.block ? ' block' : '') + (o.sm ? ' sm' : ''), type: o.submit ? 'submit' : 'button', onClick: o.onClick, disabled: o.disabled },
    o.icon ? icon(o.icon) : null, label);
  return b;
}
function Card(title, kids, cls) {
  return h('section', { class: 'card ' + (cls || '') }, title ? h('h3', null, title) : null, kids);
}
function Chip(label, on, onClick, sm) {
  return h('button', { class: 'chip' + (on ? ' on' : '') + (sm ? ' sm' : ''), type: 'button', onClick }, label);
}
function Switch(checked, onChange) {
  const i = h('input', { type: 'checkbox', role: 'switch' });
  i.checked = !!checked;
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 'sw' }, i, h('i'));
}
function SwitchRow(label, checked, onChange, sub) {
  return h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', null, label), sub ? h('div', { class: 'small muted' }, sub) : null), Switch(checked, onChange));
}
function CheckRow(label, checked, onChange) {
  const i = h('input', { type: 'checkbox', class: 'cb' });
  i.checked = !!checked;
  i.addEventListener('change', () => onChange(i.checked));
  return h('label', { class: 'row', style: 'cursor:pointer' }, i, h('span', { class: 'small' }, label));
}

/** Outlined text field with a floating label. el.inp is the input element. */
function Field(o) {
  const tag = o.multiline ? 'textarea' : 'input';
  const inp = h(tag, { class: 'inp', type: o.multiline ? null : (o.type || 'text'), rows: o.multiline ? (o.rows || 3) : null,
    placeholder: o.placeholder || '', autocomplete: o.autocomplete || 'off', readonly: o.readonly, disabled: o.disabled, inputmode: o.inputmode, spellcheck: o.spellcheck === undefined ? null : String(o.spellcheck) });
  inp.value = o.value == null ? '' : o.value;
  if (o.onInput) inp.addEventListener('input', () => o.onInput(inp.value));
  if (o.onEnter) inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); o.onEnter(inp.value); } });
  if (o.onChange) inp.addEventListener('change', () => o.onChange(inp.value));
  const w = h('div', { class: 'field' + (o.end ? ' has-btn' : '') + (o.disabled ? ' dis' : ''), style: o.style }, inp, h('label', null, o.label || ''), o.end || null);
  w.inp = inp;
  return w;
}
function endBtn(iconName, title, onClick) { return h('button', { class: 'iconbtn endbtn', type: 'button', title, 'aria-label': title, onClick }, icon(iconName)); }

/** Text field + drop-down of ready choices (custom text allowed). choices may be an array or a function. */
function ChoiceField(label, value, choices, onChange, style) {
  let f;
  const btn = endBtn('drop', 'Choose', () => {
    const list = typeof choices === 'function' ? choices() : choices;
    if (!list.length) { toast('No saved choices yet'); return; }
    menuAt(btn, list.map(c => ({ label: c, onClick: () => { f.inp.value = c; onChange(c); } })));
  });
  f = Field({ label, value, onInput: onChange, end: btn, style });
  return f;
}
/** Read-only drop-down (native select). */
function SelectField(label, options, selectedIndex, onSelect) {
  const sel = h('select', { class: 'inp' }, options.map((t, i) => h('option', { value: i }, t)));
  sel.value = String(Math.max(0, selectedIndex));
  sel.addEventListener('change', () => onSelect(+sel.value));
  return h('div', { class: 'field' }, sel, h('label', null, label), h('span', { class: 'arrow' }, icon('drop')));
}
function RichText(html, prefix, extraStyle) {
  const d = h('div', { class: 'rich', style: extraStyle });
  const body = h('div', { class: 'grow', html: Rich.sanitize(html) });
  if (prefix) d.append(h('div', { class: 'bul' }, h('span', { class: 'g' }, prefix), body)); else d.append(body);
  return d;
}
function AdviceBullets(a, showCaption) {
  const d = h('div');
  if (showCaption !== false && a.c) d.append(h('div', { class: 'rich', html: '<b>' + Rich.sanitize(a.c) + '</b>' }));
  for (const [lvl, html] of Advice.bullets(a)) d.append(RichText(html, Advice.glyph(lvl), 'margin-left:' + (lvl * 14) + 'px;font-size:14.5px'));
  return d;
}

/** Multi-line text field with tag buttons (B I U S A+ a- Red Blue br), optional variables and indent buttons. */
function HtmlField(o) {
  const ta = h('textarea', { class: 'inp', rows: o.minLines || 3, spellcheck: 'false' });
  ta.value = o.value || '';
  const fire = () => o.onChange && o.onChange(ta.value);
  ta.addEventListener('input', fire);
  const sel = () => [Math.min(ta.selectionStart, ta.selectionEnd), Math.max(ta.selectionStart, ta.selectionEnd)];
  const wrap = (a, b) => {
    const [s, e] = sel(); const t = ta.value;
    ta.value = t.slice(0, s) + a + t.slice(s, e) + b + t.slice(e);
    ta.focus(); ta.setSelectionRange(s + a.length, e + a.length); fire();
  };
  const ins = x => { const [s, e] = sel(); const t = ta.value; ta.value = t.slice(0, s) + x + t.slice(e); ta.focus(); ta.setSelectionRange(s + x.length, s + x.length); fire(); };
  const shift = indent => {
    const t = ta.value; const [a, b] = sel();
    const ls = a === 0 ? 0 : t.lastIndexOf('\n', a - 1) + 1;
    let le = t.indexOf('\n', b); if (le < 0) le = t.length;
    const blk = t.slice(ls, le);
    const moved = blk.split('\n').map(ln => indent ? '  ' + ln : ln.replace(/^ {1,2}/, '')).join('\n');
    ta.value = t.slice(0, ls) + moved + t.slice(le);
    ta.focus();
    if (a === b) { const p = Math.max(ls, Math.min(ta.value.length, a + moved.length - blk.length)); ta.setSelectionRange(p, p); } else ta.setSelectionRange(ls, ls + moved.length);
    fire();
  };
  const tb = (label, fn, style) => h('button', { class: 'tbtn', type: 'button', onMousedown: e => e.preventDefault(), onClick: fn, style }, label);
  const bar = h('div', { class: 'scrollx' },
    o.indentButtons ? [tb('⇥ Indent', () => shift(true)), tb('⇤ Outdent', () => shift(false))] : null,
    tb('B', () => wrap('<b>', '</b>'), 'font-weight:700'), tb('I', () => wrap('<i>', '</i>'), 'font-style:italic'),
    tb('U', () => wrap('<u>', '</u>'), 'text-decoration:underline'), tb('S', () => wrap('<s>', '</s>'), 'text-decoration:line-through'),
    tb('A+', () => wrap('<big>', '</big>')), tb('a-', () => wrap('<small>', '</small>')),
    tb('Red', () => wrap('<font color="#CC0000">', '</font>'), 'color:#CC0000'), tb('Blue', () => wrap('<font color="#0D6EFD">', '</font>'), 'color:#0D6EFD'),
    tb('⏎ br', () => ins('<br>')));
  const vars = o.variables && o.variables.length ? h('div', { class: 'scrollx' }, o.variables.map(v =>
    h('button', { class: 'chip sm', type: 'button', onMousedown: e => e.preventDefault(), onClick: () => ins('{' + v + '}') }, v))) : null;
  const w = h('div', { class: 'col', style: 'gap:4px;width:100%' }, bar, vars, h('div', { class: 'field' }, ta, h('label', null, o.label || '')));
  w.ta = ta;
  w.get = () => ta.value;
  w.set = v => { ta.value = v; };
  return w;
}

/* ---- list-like editors used in the prescription ---- */
function suggestBox(getSuggestions, onPick, renderItem) {
  const box = h('div');
  let seq = 0;
  const run = debounce(async q => {
    const my = ++seq;
    if (!q.trim()) { clear(box); return; }
    let items = [];
    try { items = await getSuggestions(q); } catch (e) { items = []; }
    if (my !== seq) return;
    clear(box);
    items.forEach(it => box.append(renderItem(it, () => onPick(it))));
  }, 300);
  box.query = q => { if (!q.trim()) { seq++; clear(box); } else run(q); };
  box.refresh = () => clear(box);
  return box;
}

/** A list of free-text points (complaints, history, ...). model: array of html strings. */
function ListEditor(title, model, type) {
  const root = Card(title, null);
  const listEl = h('div');
  const have = () => new Set(model);
  const commit = v => { const t = v.trim(); if (t && !have().has(t)) model.push(t); inp.inp.value = ''; sb.refresh(); draw(); };
  const sb = suggestBox(async q => (await api('lists_suggest', { type, q })).items.filter(x => !have().has(x)),
    commit, (s, pick) => h('div', { class: 'sugg', onClick: pick, style: 'color:var(--primary)' }, RichText(s)));
  const addBtn = endBtn('add', 'Add', () => commit(inp.inp.value));
  const inp = Field({ label: 'Add ' + title + ' (new line = next line of the same point)', multiline: true, rows: 1, end: addBtn,
    onInput: v => sb.query(v), onEnter: v => commit(v) });
  function edit(i) {
    const hf = HtmlField({ label: 'Text (HTML tags allowed)', value: model[i] });
    modal({ title: 'Edit', body: hf, actions: [{ label: 'Cancel' }, { label: 'OK', onClick: () => { const t = hf.get().trim(); if (t) { model[i] = t; draw(); } } }] });
  }
  function draw() {
    clear(listEl);
    model.forEach((s, i) => listEl.append(h('div', { class: 'li' },
      h('div', { class: 't', style: 'cursor:pointer', onClick: () => edit(i) }, RichText(s, '•')),
      iconBtn('edit', 'Edit', () => edit(i)), iconBtn('close', 'Remove', () => { model.splice(i, 1); draw(); }))));
  }
  draw();
  root.append(listEl, inp, sb);
  return root;
}

/** Advice: search by caption, each block edited in place (caption, print tick, bullet lines). */
function AdviceEditor(title, model) {
  const root = Card(title, null);
  const listEl = h('div', { class: 'col', style: 'gap:10px' });
  const have = () => new Set(model.map(Advice.captionPlain).map(x => x.toLowerCase()));
  const addRaw = raw => { model.push(raw); search.inp.value = ''; sb.refresh(); draw(); };
  const sb = suggestBox(async q => (await api('lists_suggest', { type: 'advice', q })).items.filter(x => !have().has(Advice.captionPlain(x).toLowerCase())),
    s => { const a = Advice.decode(s); a.s = false; addRaw(Advice.encode(a)); },
    (s, pick) => { const a = Advice.decode(s); const d = h('div', { class: 'sugg', onClick: pick }, h('div', { class: 'nm', html: Rich.sanitize(a.c) }));
      Advice.bullets(a).slice(0, 2).forEach(([, t]) => d.append(RichText(t, '•', 'font-size:13px'))); return d; });
  const search = Field({ label: 'Search advice by caption name', onInput: v => sb.query(v) });
  function draw() {
    clear(listEl);
    model.forEach((raw, i) => {
      const a = Advice.decode(raw);
      const save = () => { model[i] = Advice.encode(a); };
      const prev = h('div');
      const redraw = () => { clear(prev); prev.append(AdviceBullets(a, false)); };
      const cap = Field({ label: 'Caption name', value: a.c, onInput: v => { a.c = v; save(); } });
      const hf = HtmlField({ label: 'Details – every line = one bullet', value: a.b, minLines: 3, indentButtons: true, onChange: v => { a.b = v; save(); redraw(); } });
      redraw();
      listEl.append(h('div', { class: 'col', style: 'gap:6px' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, cap), iconBtn('close', 'Remove', () => { model.splice(i, 1); draw(); })),
        CheckRow('Print the caption (bold)', a.s, v => { a.s = v; save(); }),
        hf, prev, h('hr')));
    });
  }
  draw();
  root.append(listEl, search, sb, h('div', null, Btn('New advice', { kind: 'outline', icon: 'add', onClick: () => { addRaw(Advice.encode({ c: search.inp.value.trim(), b: '', s: false })); } })));
  return root;
}
