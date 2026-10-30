'use strict';
const SEPARATORS = [['New line', '\n'], ['Comma ,', ','], ['Semicolon ;', ';'], ['Pipe |', '|'], ['Tab', '\t'], ['Custom', '']];

function findingView(raw) {
  const d = FindingDef.parse(raw);
  return h('div', null, h('div', { style: 'font-weight:600' }, d.name), FindingDef.summary(d) ? h('div', { class: 'small muted' }, FindingDef.summary(d)) : null);
}

function AdviceInlineEditor(initial, saveText, onSave, onCancel) {
  const a = Object.assign({ c: '', b: '', s: false }, initial);
  const cap = Field({ label: 'Caption name', value: a.c, onInput: v => { a.c = v; } });
  const prev = h('div');
  const redraw = () => { clear(prev); prev.append(AdviceBullets(a, false)); };
  const hf = HtmlField({ label: 'Details – every line = one bullet', value: a.b, minLines: 4, indentButtons: true, onChange: v => { a.b = v; redraw(); } });
  redraw();
  return h('div', { class: 'col', style: 'gap:6px' }, cap, hf, prev,
    h('div', { class: 'row' }, Btn(saveText, { onClick: () => onSave({ c: a.c.trim(), b: a.b.replace(/\s+$/, ''), s: false }) }), Btn('Cancel', { kind: 'outline', onClick: onCancel })));
}

function FindingInlineEditor(initial, saveText, onSave, onCancel) {
  const d = Object.assign({ name: '', unit: '', options: [], multi: false }, initial);
  let dropdown = d.options.length > 0, optText = d.options.join('\n');
  const box = h('div', { class: 'col', style: 'gap:6px' });
  const nameF = Field({ label: 'Finding name (e.g. BP, Dengue IgM)', value: d.name, onInput: v => { d.name = v; } });
  function draw() {
    clear(box);
    box.append(nameF, h('div', { class: 'row' }, Chip('Text box (+ unit)', !dropdown, () => { dropdown = false; draw(); }), Chip('Dropdown', dropdown, () => { dropdown = true; draw(); })));
    if (!dropdown) box.append(Field({ label: 'Unit (optional, e.g. mmHg)', value: d.unit, onInput: v => { d.unit = v; } }));
    else {
      const ta = h('textarea', { class: 'inp', rows: 4 }); ta.value = optText; ta.addEventListener('input', () => { optText = ta.value; });
      box.append(h('div', { class: 'field' }, ta, h('label', null, 'Dropdown options – one per line')), SwitchRow('Allow choosing several values', d.multi, v => { d.multi = v; }));
    }
    box.append(h('div', { class: 'row' }, Btn(saveText, { onClick: () => onSave({ name: d.name.trim(), unit: dropdown ? '' : d.unit.trim(), options: dropdown ? optText.split(/[\n;]/).map(x => x.trim()).filter(Boolean) : [], multi: dropdown && d.multi }) }), Btn('Cancel', { kind: 'outline', onClick: onCancel })));
  }
  draw();
  return box;
}

/** Suggestion lists manager. opts.readonlyUser: admin viewing a doctor's lists (no editing). */
Screens.settings_lists = async () => {
  let tab = 0, items = [], filter = '', shown = 100, newAdvice = false, newFinding = false, editing = null, sepIndex = 0, customSep = '', includeShared = false;
  const type = () => LIST_TYPES[tab];
  const isAdvice = () => type() === 'advice';
  const isFinding = () => type() === 'findings';
  const root = h('div', { class: 'col' });
  const sep = () => sepIndex === SEPARATORS.length - 1 ? (customSep || ',') : SEPARATORS[sepIndex][1];
  const plainOf = raw => isAdvice() ? Advice.captionPlain(raw) : isFinding() ? FindingDef.nameOf(raw) : Rich.plain(raw);

  async function load() { items = (await api('lists_items', { type: type() })).items; draw(); }

  async function runBulk(text) {
    if (!text.trim()) { toast('Nothing to add'); return; }
    try {
      const r = await api('lists_add_many', { type: type(), text, sep: sep() });
      toast('Added ' + r.added + ', skipped ' + r.skipped + ' (empty or already in the list)', 5000);
      bulk.value = ''; await load();
    } catch (e) { toast(e.message); }
  }
  const bulk = h('textarea', { class: 'inp', rows: 4 });

  function draw() {
    clear(root);
    const tabs = h('div', { class: 'tabs' }, LIST_TYPES.map((t, i) => h('button', { class: i === tab ? 'on' : '', onClick: () => { tab = i; filter = ''; shown = 100; newAdvice = false; newFinding = false; editing = null; load(); } }, LIST_LABELS[t])));
    root.append(tabs);

    // add
    const add = Card('Add to ' + LIST_LABELS[type()], null);
    if (isAdvice()) {
      if (newAdvice) add.append(AdviceInlineEditor({}, 'Save to list', async a => {
        if (!a.c && !a.b) { toast('Empty'); return; }
        const r = await api('lists_add', { type: 'advice', name: Advice.encode(a) });
        if (r.ok) { newAdvice = false; load(); } else toast('Empty or already in the list');
      }, () => { newAdvice = false; draw(); }));
      else add.append(h('div', null, Btn('New advice', { kind: 'outline', icon: 'add', onClick: () => { newAdvice = true; draw(); } })));
    } else if (isFinding()) {
      if (newFinding) add.append(FindingInlineEditor({}, 'Save to list', async d => {
        const r = await api('lists_add', { type: 'findings', name: FindingDef.encode(d) });
        if (r.ok) { newFinding = false; load(); } else toast('Empty or already in the list');
      }, () => { newFinding = false; draw(); }));
      else add.append(h('div', null, Btn('New finding', { kind: 'outline', icon: 'add', onClick: () => { newFinding = true; draw(); } })));
      add.append(h('div', { class: 'small muted' }, 'A finding is a name with an optional unit (BP → mmHg) or a dropdown of values (Dengue IgM → Positive / Negative); one or several can be chosen.'));
    } else {
      const hf = HtmlField({ label: 'New entry (several lines and HTML tags allowed)', value: '' });
      add.append(hf, h('div', null, Btn('Add', { onClick: async () => {
        const r = await api('lists_add', { type: type(), name: hf.get() });
        if (r.ok) { hf.set(''); load(); } else toast('Empty or already in the list');
      } })));
    }
    // add many
    const many = Card('Add many at once / text file', null);
    if (isAdvice()) many.append(h('div', { class: 'small muted' }, 'Paste several advices. A line starting with ## is a caption; the lines below it are its bullets (spaces = indent).'));
    else {
      if (isFinding()) many.append(h('div', { class: 'small muted' }, 'One finding per line. Add a unit or options like:  BP | unit=mmHg   or   Dengue IgM | options=Positive;Negative | multi   (use “New line” as the separator).'));
      many.append(h('div', { class: 'small muted' }, 'Paste many entries, separated by the separator you choose. A text file works the same way.'));
      many.append(h('div', { class: 'scrollx' }, SEPARATORS.map(([l], i) => Chip(l, sepIndex === i, () => { sepIndex = i; draw(); }))));
      if (sepIndex === SEPARATORS.length - 1) many.append(Field({ label: 'Custom separator (e.g. ## or ::)', value: customSep, onInput: v => { customSep = v; } }));
    }
    bulk.placeholder = isAdvice() ? '## Caption\n  bullet lines…' : 'Entry 1 ; Entry 2 ; Entry 3 …';
    many.append(h('div', { class: 'field' }, bulk, h('label', null, isAdvice() ? 'Advice blocks' : 'Entries')),
      CheckRow('Include the admin’s shared entries in the export', includeShared, v => { includeShared = v; }),
      h('div', { class: 'row wrap-r' },
        Btn('Add all', { onClick: () => runBulk(bulk.value) }),
        Btn('From text file', { kind: 'outline', onClick: async () => { const f = await pickFile('.txt,.csv,text/*'); if (f) runBulk(await readText(f)); } }),
        Btn('Export to file', { kind: 'outline', onClick: async () => {
          const r = await api('lists_export_text', { type: type(), sep: sep(), scope: includeShared ? 'all' : 'own' });
          download(type() + '.txt', r.text); toast('Exported');
        } })));
    root.append(h('div', { class: 'grid2' }, add, many));

    // list
    const q = filter.trim().toLowerCase();
    const numbered = items.map((it, i) => ({ n: i + 1, it })).filter(x => !q || plainOf(x.it.name).toLowerCase().includes(q));
    const own = items.filter(x => !x.shared).length;
    const listCard = h('div', { class: 'col' });
    listCard.append(h('div', { class: 'title-m' }, LIST_LABELS[type()] + ': ' + items.length + ' entries' + (own !== items.length ? ' (' + own + ' yours, ' + (items.length - own) + ' shared by the admin)' : '') + (numbered.length !== items.length ? ' — showing ' + numbered.length : '')),
      Field({ label: 'Search in this list', value: filter, onInput: debounce(v => { filter = v; shown = 100; drawList(); }, 200) }));
    const rows = h('div', { class: 'grid2' });
    listCard.append(rows);
    root.append(listCard);
    function drawList() {
      clear(rows);
      const nq = filter.trim().toLowerCase();
      const nn = items.map((it, i) => ({ n: i + 1, it })).filter(x => !nq || plainOf(x.it.name).toLowerCase().includes(nq));
      nn.slice(0, shown).forEach(({ n, it }) => rows.append(entry(n, it)));
      if (nn.length > shown) rows.append(h('div', { style: 'grid-column:1/-1;text-align:center' }, Btn('Show more (' + (nn.length - shown) + ' more)', { kind: 'outline', onClick: () => { shown += 200; drawList(); } })));
    }
    function entry(n, it) {
      const c = h('div', { class: 'card flat' });
      if (isAdvice() && editing === it.name && !it.shared) {
        c.append(AdviceInlineEditor(Advice.decode(it.name), 'Save', async a => {
          const r = await api('lists_update', { type: 'advice', old: it.name, new: Advice.encode(a) });
          if (r.ok) { editing = null; load(); } else toast('Empty or already exists');
        }, () => { editing = null; drawList(); }));
        return c;
      }
      if (isFinding() && editing === it.name && !it.shared) {
        c.append(FindingInlineEditor(FindingDef.parse(it.name), 'Save', async d => {
          const r = await api('lists_update', { type: 'findings', old: it.name, new: FindingDef.encode(d) });
          if (r.ok) { editing = null; load(); } else toast('Empty or already exists');
        }, () => { editing = null; drawList(); }));
        return c;
      }
      c.append(h('div', { class: 'row', style: 'align-items:flex-start' },
        h('div', { style: 'flex:0 0 44px;color:var(--primary);font-weight:600' }, n + '.'),
        h('div', { class: 'grow' }, isAdvice() ? AdviceBullets(Advice.decode(it.name), true) : isFinding() ? findingView(it.name) : RichText(it.name), it.shared ? h('div', { class: 'small muted' }, '🔒 shared by the admin (read-only)') : null),
        it.shared ? null : [iconBtn('edit', 'Edit', () => { if (isAdvice() || isFinding()) { editing = it.name; drawList(); } else editDialog(it); }),
          iconBtn('close', 'Delete', () => confirmDialog('Delete entry', 'Delete “' + plainOf(it.name).slice(0, 80) + '” from the list?', async () => { await api('lists_delete', { type: type(), name: it.name }); load(); }))]));
      return c;
    }
    drawList();
  }
  function editDialog(it) {
    const hf = HtmlField({ label: 'Text', value: it.name });
    modal({ title: 'Edit entry', body: hf, actions: [{ label: 'Cancel' }, { label: 'Save', onClick: async () => {
      const r = await api('lists_update', { type: type(), old: it.name, new: hf.get() });
      if (r.ok) load(); else { toast('Empty or already exists'); return false; }
    } }] });
  }
  await load();
  const note = State.user.role === 'admin' ? h('div', { class: 'small muted' }, 'Entries you add here as admin are shared with all doctors (they can use them but not change or delete them).') : null;
  return { title: 'Suggestion lists', back: true, backTo: '#/settings', wide: true, el: h('div', { class: 'wrap' }, note, root), nopad: false };
};
