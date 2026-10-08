const { ICONS, esc, chips, dueClass } = EmberUI;
const { parse, unparse, startOfDay, addDays } = EmberParse;
const $ = (id) => document.getElementById(id);
const mod = (e) => (ember.isMac ? e.metaKey : e.ctrlKey);
const kbds = (acc) => ember.keyParts(acc).map((x) => `<kbd>${esc(x)}</kbd>`).join(ember.isMac ? '' : '+');

let db = { tasks: [], settings: {} };
let view = 'today';
let query = '';
let sel = null; // selected task id
let editing = null; // task id being edited
const completing = new Set(); // ids animating out after being checked
const undoStack = [];

const VIEWS = [
  { id: 'today', name: 'Today', icon: 'sun', key: '1' },
  { id: 'inbox', name: 'Inbox', icon: 'inbox', key: '2' },
  { id: 'upcoming', name: 'Upcoming', icon: 'upcoming', key: '3' },
  { id: 'waiting', name: 'Waiting on', icon: 'wait', key: '4' },
  { id: 'done', name: 'Done', icon: 'check', key: '5' },
];

// ---------- data shaping ----------
const endOfToday = () => { const d = startOfDay(new Date()); d.setDate(d.getDate() + 1); return d; };
const open = () => db.tasks.filter((t) => !t.done || completing.has(t.id));
const byDue = (a, b) => (a.star !== b.star ? (a.star ? -1 : 1) : new Date(a.due) - new Date(b.due) || a.created.localeCompare(b.created));
const byStarThenNew = (a, b) => (a.star !== b.star ? (a.star ? -1 : 1) : b.created.localeCompare(a.created));

function isOverdue(t) { return dueClass(t) === 'overdue'; }

const filters = {
  today: (t) => t.due && new Date(t.due) < endOfToday(),
  inbox: (t) => !t.due && !t.waiting,
  upcoming: (t) => t.due && new Date(t.due) >= endOfToday(),
  waiting: (t) => t.waiting,
};

function dayLabel(d) {
  const days = Math.round((startOfDay(d) - startOfDay(new Date())) / 864e5);
  if (days === 1) return 'Tomorrow';
  if (days > 1 && days < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Returns [{ label, cls, items }]
function groups() {
  if (query) {
    const q = query.toLowerCase();
    const hit = (t) => [t.title, t.notes, t.person, ...(t.tags || [])].some((x) => x && x.toLowerCase().includes(q));
    const all = db.tasks.filter(hit);
    return [
      { label: 'Open', items: all.filter((t) => !t.done).sort(byStarThenNew) },
      { label: 'Done', items: all.filter((t) => t.done).sort((a, b) => b.done.localeCompare(a.done)) },
    ];
  }
  if (view.startsWith('tag:')) {
    const tag = view.slice(4);
    return [{ items: open().filter((t) => (t.tags || []).includes(tag)).sort(byStarThenNew) }];
  }
  if (view === 'today') {
    const items = open().filter(filters.today);
    return [
      { label: 'Overdue', cls: 'overdue', items: items.filter(isOverdue).sort(byDue) },
      { label: 'Today', items: items.filter((t) => !isOverdue(t)).sort(byDue) },
    ];
  }
  if (view === 'inbox') return [{ items: open().filter(filters.inbox).sort(byStarThenNew) }];
  if (view === 'upcoming') {
    const m = new Map();
    open().filter(filters.upcoming).sort(byDue).sort((a, b) => new Date(a.due) - new Date(b.due)).forEach((t) => {
      const k = startOfDay(new Date(t.due)).getTime();
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return [...m].map(([k, items]) => ({ label: dayLabel(new Date(k)), items }));
  }
  if (view === 'waiting') {
    const m = new Map();
    open().filter(filters.waiting).sort((a, b) => (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity)).forEach((t) => {
      const k = t.person || 'Someone';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([label, items]) => ({ label, items }));
  }
  if (view === 'done') {
    const m = new Map();
    db.tasks.filter((t) => t.done).sort((a, b) => b.done.localeCompare(a.done)).slice(0, 300).forEach((t) => {
      const d = startOfDay(new Date(t.done));
      const days = Math.round((startOfDay(new Date()) - d) / 864e5);
      const k = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return [...m].map(([label, items]) => ({ label, items }));
  }
  return [];
}

const visible = () => groups().flatMap((g) => g.items);

// ---------- rendering ----------
function renderNav() {
  const o = db.tasks.filter((t) => !t.done);
  const n = {
    today: o.filter(filters.today).length,
    inbox: o.filter(filters.inbox).length,
    upcoming: o.filter(filters.upcoming).length,
    waiting: o.filter(filters.waiting).length,
    done: '',
  };
  const overdue = o.filter(isOverdue).length;
  $('nav').innerHTML = VIEWS.map((v) => `
    <button class="navbtn ${view === v.id && !query ? 'active' : ''}" data-view="${v.id}">
      ${ICONS[v.icon]}<span>${v.name}</span>
      <span class="n ${v.id === 'today' && overdue ? 'hot' : ''}">${n[v.id] || ''}</span><span class="k">${v.key}</span>
    </button>`).join('');

  const tagCounts = {};
  o.forEach((t) => (t.tags || []).forEach((x) => { tagCounts[x] = (tagCounts[x] || 0) + 1; }));
  const tags = Object.keys(tagCounts).sort();
  $('tagsH').hidden = !tags.length;
  $('tags').innerHTML = tags.map((x) => `
    <button class="navbtn ${view === 'tag:' + x && !query ? 'active' : ''}" data-view="tag:${esc(x)}">
      ${ICONS.tag}<span>${esc(x)}</span><span class="n">${tagCounts[x]}</span>
    </button>`).join('');

  $('settingsBtn').className = 'navbtn' + (view === 'settings' ? ' active' : '');
  $('settingsBtn').innerHTML = `${ICONS.gear}<span>Settings</span>`;
  $('hotkeyHint').innerHTML = `Quick add anywhere: ${kbds(db.settings.hotkey)}<br>Open Ember: ${kbds(db.settings.openHotkey)}<br>Shortcuts: <kbd>?</kbd>`;
}

function renderHeader() {
  const o = db.tasks.filter((t) => !t.done);
  let title, sub = '';
  if (query) { title = `Search`; sub = `Results for “${esc(query)}”`; }
  else if (view.startsWith('tag:')) { title = '#' + esc(view.slice(4)); }
  else if (view === 'settings') { title = 'Settings'; }
  else {
    title = VIEWS.find((v) => v.id === view).name;
    if (view === 'today') {
      const overdue = o.filter(isOverdue).length;
      const today = o.filter(filters.today).length - overdue;
      const w = o.filter((t) => t.waiting).length;
      const bits = [new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })];
      if (overdue) bits.push(`<b>${overdue} overdue</b>`);
      bits.push(`${today} due today`);
      if (w) bits.push(`${w} waiting on others`);
      sub = bits.join(' · ');
    } else if (view === 'inbox') sub = 'Things without a date. Give them one, or just do them.';
    else if (view === 'upcoming') sub = 'Scheduled for later.';
    else if (view === 'waiting') sub = 'Delegated or waiting for someone. <kbd>Tab</kbd> in quick add, or “wait:”.';
    else if (view === 'done') sub = 'Nice work.';
  }
  $('title').innerHTML = title;
  $('sub').innerHTML = sub;
  $('searchIcon').innerHTML = ICONS.search;
  $('plus').innerHTML = ICONS.plus;
  $('addWrap').hidden = view === 'settings' || view === 'done';
}

function rowHtml(t) {
  const cls = ['row', t.id === sel && 'sel', t.done && !completing.has(t.id) && 'done', completing.has(t.id) && 'completing', t.star && 'star'].filter(Boolean).join(' ');
  if (t.id === editing) {
    return `<div class="${cls}" data-id="${t.id}">
      <div class="box">${ICONS.check}</div>
      <div class="edit">
        <input id="editIn" value="${esc(unparse(t))}" spellcheck="false">
        <div class="chips" id="editPrev">${chips(t)}</div>
        <textarea id="editNotes" placeholder="Notes…">${esc(t.notes || '')}</textarea>
        <div class="eh"><kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel · <kbd>Tab</kbd> notes</div>
      </div></div>`;
  }
  return `<div class="${cls}" data-id="${t.id}">
    <div class="box" data-act="toggle">${ICONS.check}</div>
    <div class="body">
      <div class="line"><span class="t">${esc(t.title)}</span><span class="chips">${chips(view === 'waiting' && !query ? { ...t, waiting: false, person: null } : t)}</span></div>
      ${t.notes ? `<div class="notes">${esc(t.notes)}</div>` : ''}
    </div></div>`;
}

const EMPTY = {
  today: ['Nothing due today', 'Clear runway. Press <kbd>N</kbd> to add, or use quick add from anywhere.'],
  inbox: ['Inbox zero', 'Anything you add without a date lands here.'],
  upcoming: ['Nothing scheduled', 'Add a date like “tomorrow”, “fri 14”, “next week” or “12/11”.'],
  waiting: ['Not waiting on anyone', 'Track things you’ve delegated or need to chase: <code>wait: @Sam budget numbers fri</code>'],
  done: ['Nothing done yet', 'It’ll fill up.'],
};

function renderList() {
  const $list = $('list');
  $('settings').hidden = view !== 'settings';
  $list.hidden = view === 'settings';
  if (view === 'settings') return renderSettings();
  const gs = groups().filter((g) => g.items.length);
  if (!gs.length) {
    const [a, b] = query ? ['No matches', 'Try another word.'] : EMPTY[view] || ['Nothing here', ''];
    $list.innerHTML = `<div class="empty">${ICONS[view === 'waiting' ? 'wait' : 'check']}<div class="big">${a}</div>${b}</div>`;
    return;
  }
  const many = gs.length > 1 || gs[0].label;
  $list.innerHTML = gs.map((g) => `
    ${many && g.label ? `<div class="group ${g.cls || ''}">${esc(g.label)}<span class="c">${g.items.length}</span></div>` : ''}
    ${g.items.map(rowHtml).join('')}`).join('');
  if (editing) {
    const inp = $('editIn');
    if (inp && document.activeElement !== inp && document.activeElement?.id !== 'editNotes') { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

function render() {
  renderNav();
  renderHeader();
  renderList();
}

function scrollSelIntoView() {
  const el = document.querySelector(`.row[data-id="${sel}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// ---------- actions ----------
const find = (id) => db.tasks.find((t) => t.id === id);

async function update(id, patch, label) {
  const t = find(id);
  if (!t) return;
  const before = {};
  Object.keys(patch).forEach((k) => { before[k] = t[k] ?? null; });
  undoStack.push({ type: 'update', id, before });
  Object.assign(t, patch); // optimistic
  render();
  await ember.update(id, patch);
  if (label) toast(label);
}

async function toggleDone(id) {
  const t = find(id);
  if (!t) return;
  if (t.done) return update(id, { done: null }, 'Marked as not done');
  completing.add(id);
  render();
  await update(id, { done: new Date().toISOString() });
  toast(`Completed “${t.title}”`);
  setTimeout(() => {
    const idx = visible().findIndex((x) => x.id === id);
    completing.delete(id);
    if (sel === id) {
      const rest = visible();
      sel = rest.length ? rest[Math.min(idx, rest.length - 1)].id : null;
    }
    render();
  }, 950);
}

async function remove(id) {
  const t = find(id);
  if (!t) return;
  const items = visible();
  const i = items.findIndex((x) => x.id === id);
  sel = (items[i + 1] || items[i - 1] || {}).id || null;
  db.tasks = db.tasks.filter((x) => x.id !== id);
  undoStack.push({ type: 'delete', task: t });
  render();
  await ember.remove(id);
  toast(`Deleted “${t.title}”`);
}

async function undo() {
  const u = undoStack.pop();
  if (!u) return toast('Nothing to undo');
  if (u.type === 'update') { Object.assign(find(u.id) || {}, u.before); await ember.update(u.id, u.before); sel = u.id; }
  if (u.type === 'delete') { db.tasks.push(u.task); await ember.restore(u.task); sel = u.task.id; }
  if (u.type === 'add') { db.tasks = db.tasks.filter((x) => x.id !== u.id); await ember.remove(u.id); }
  render();
  toast('Undone');
}

// Move a task to another day, keeping its time of day (and its reminder) if it had one.
function reschedule(id, days) {
  const t = find(id);
  if (!t) return;
  if (days === null) return update(id, { due: null, hasTime: false, remindAt: null }, 'Date cleared');
  const target = addDays(startOfDay(new Date()), days);
  const patch = {};
  if (t.due && t.hasTime) {
    const old = new Date(t.due);
    target.setHours(old.getHours(), old.getMinutes());
  }
  patch.due = target.toISOString();
  patch.hasTime = !!(t.due && t.hasTime);
  if (t.remindAt) {
    const r = new Date(t.remindAt);
    const nr = new Date(target);
    nr.setHours(r.getHours(), r.getMinutes(), 0, 0);
    patch.remindAt = nr.toISOString();
  }
  update(id, patch, `Moved to ${EmberParse.formatDue(patch.due, patch.hasTime)}`);
}

function nextMondayOffset() {
  const d = new Date().getDay();
  return ((8 - d) % 7) || 7;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undoStack.length && msg !== 'Undone' && msg !== 'Nothing to undo' ? '<button id="undoBtn">Undo</button>' : ''}`;
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  const b = $('undoBtn'); if (b) b.onclick = undo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

function moveSel(dir) {
  const items = visible().filter((t) => !completing.has(t.id) || t.id === sel);
  if (!items.length) { sel = null; return; }
  let i = items.findIndex((t) => t.id === sel);
  if (i === -1) i = dir > 0 ? -1 : items.length;
  i = Math.max(0, Math.min(items.length - 1, i + dir));
  sel = items[i].id;
  render();
  scrollSelIntoView();
}

function setView(v) {
  cancelRecording();
  view = v;
  query = '';
  $('search').value = '';
  editing = null;
  sel = visible()[0]?.id || null;
  render();
  $('list').scrollTop = 0;
}

// ---------- add bar ----------
const $add = $('add');
function addParsed() {
  const p = parse($add.value, { defaultHour: db.settings.defaultHour });
  // Adding while looking at a view should make the task show up there
  if (view === 'waiting') p.waiting = true;
  if (view === 'today' && !p.due) { p.due = startOfDay(new Date()).toISOString(); }
  if (view.startsWith('tag:') && !p.tags.includes(view.slice(4))) p.tags.push(view.slice(4));
  return p;
}
$add.addEventListener('input', () => {
  $('addPrev').innerHTML = $add.value.trim() ? chips(addParsed(), { preview: true }) : '';
});
$add.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { $add.value = ''; $('addPrev').innerHTML = ''; $add.blur(); return; }
  if (e.key === 'ArrowDown') { $add.blur(); moveSel(1); return; }
  if (e.key !== 'Enter') return;
  const p = addParsed();
  if (!p.title) return;
  const t = await ember.add(p);
  undoStack.push({ type: 'add', id: t.id });
  $add.value = '';
  $('addPrev').innerHTML = '';
  sel = t.id;
  if (!visible().some((x) => x.id === t.id)) toast(`Added to ${p.waiting ? 'Waiting on' : p.due ? 'Upcoming' : 'Inbox'}`);
});

// ---------- search ----------
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim();
  sel = visible()[0]?.id || null;
  render();
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.target.value = ''; query = ''; e.target.blur(); render(); }
  if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); e.target.blur(); if (!sel) moveSel(1); }
});

// ---------- editing ----------
function startEdit(id) {
  editing = id;
  sel = id;
  render();
}
async function commitEdit() {
  const t = find(editing);
  const inp = $('editIn');
  if (!t || !inp) { editing = null; return render(); }
  const p = parse(inp.value, { defaultHour: db.settings.defaultHour });
  const notes = $('editNotes').value.trim();
  editing = null;
  if (!p.title) return render();
  // If the date text is unchanged, keep the stored due and reminder exactly as they are:
  // the edit text only has minute precision and doesn't show snoozes, and resending a
  // different remindAt would bring back a reminder the user already dismissed.
  const patch = { ...p, notes };
  const sameMinute = (a, b) => (a && b ? Math.floor(Date.parse(a) / 6e4) === Math.floor(Date.parse(b) / 6e4) : a === b);
  if (sameMinute(p.due, t.due) && p.hasTime === !!t.hasTime) {
    patch.due = t.due;
    if (t.remindAt) patch.remindAt = t.remindAt;
  }
  await update(t.id, patch);
  $('list').focus();
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'editIn') {
    const p = parse(e.target.value, { defaultHour: db.settings.defaultHour });
    $('editPrev').innerHTML = chips(p, { preview: true });
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id !== 'editIn' && e.target.id !== 'editNotes') return;
  if (e.key === 'Escape') { e.preventDefault(); editing = null; render(); $('list').focus(); }
  else if (e.key === 'Enter' && (e.target.id === 'editIn' || mod(e))) { e.preventDefault(); commitEdit(); }
  e.stopPropagation();
}, true);
document.addEventListener('focusout', (e) => {
  if (!editing) return;
  if (e.target.id !== 'editIn' && e.target.id !== 'editNotes') return;
  setTimeout(() => {
    const a = document.activeElement?.id;
    if (editing && a !== 'editIn' && a !== 'editNotes') commitEdit();
  }, 0);
});

// ---------- mouse ----------
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) return setView(nav.dataset.view);
  const tag = e.target.closest('.chip.tag');
  if (tag && tag.dataset.tag) return setView('tag:' + tag.dataset.tag);
  const row = e.target.closest('.row');
  if (!row || row.dataset.id === editing) return;
  if (e.target.closest('[data-act="toggle"]')) { sel = row.dataset.id; return toggleDone(row.dataset.id); }
  sel = row.dataset.id;
  render();
});
document.addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row');
  if (row && !e.target.closest('[data-act]') && row.dataset.id !== editing) startEdit(row.dataset.id);
});

// ---------- keyboard ----------
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || recording;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('help').hidden) { $('help').hidden = true; return; }
  if (mod(e) && e.key.toLowerCase() === 'z' && !typing()) { e.preventDefault(); return undo(); }
  if (mod(e) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); $('search').select(); return; }
  if (mod(e) && e.key.toLowerCase() === 'n') { e.preventDefault(); if (view === 'settings' || view === 'done') setView('inbox'); $add.focus(); return; }
  if (typing() || e.ctrlKey || e.altKey || e.metaKey) return;

  const v = VIEWS.find((x) => x.key === e.key);
  if (v) return setView(v.id);
  const k = e.key;
  if (k === 'n' || k === 'a') { e.preventDefault(); if (view === 'settings' || view === 'done') setView('inbox'); return $add.focus(); }
  if (k === '/') { e.preventDefault(); return $('search').focus(); }
  if (k === '?') { return showHelp(); }
  if (k === ',') { return setView('settings'); }
  if (k === 'Escape') { if (query) { $('search').value = ''; query = ''; render(); } return; }
  if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); return moveSel(1); }
  if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); return moveSel(-1); }
  if (!sel || !find(sel)) return;
  const t = find(sel);
  if (k === 'x' || k === ' ') { e.preventDefault(); return toggleDone(sel); }
  if (k === 'Enter' || k === 'e') { e.preventDefault(); return startEdit(sel); }
  if (k === 'Delete' || k === 'Backspace') return remove(sel);
  if (k === 's' || k === 'f' || k === '*') return update(sel, { star: !t.star });
  if (k === 'w') return update(sel, { waiting: !t.waiting }, t.waiting ? 'No longer waiting' : 'Moved to Waiting on');
  if (k === 't') return reschedule(sel, 0);
  if (k === 'm') return reschedule(sel, 1);
  if (k === 'M') return reschedule(sel, nextMondayOffset());
  if (k === '0') return reschedule(sel, null);
});

function showHelp() {
  const row = (k, d) => `<div>${k}</div><div>${d}</div>`;
  $('help').innerHTML = `<div class="helpbox">
    <h2>Shortcuts</h2>
    <div class="kgrid">
      ${row(kbds(db.settings.hotkey), 'Quick add from any app')}
      ${row('<kbd>N</kbd>', 'Add task')}
      ${row('<kbd>J</kbd> <kbd>K</kbd> / arrows', 'Move selection')}
      ${row('<kbd>X</kbd> / <kbd>Space</kbd>', 'Complete')}
      ${row('<kbd>E</kbd> / <kbd>Enter</kbd> / double-click', 'Edit (incl. notes)')}
      ${row('<kbd>T</kbd> <kbd>M</kbd> <kbd>Shift</kbd>+<kbd>M</kbd> <kbd>0</kbd>', 'Move to today · tomorrow · next Monday · no date')}
      ${row('<kbd>S</kbd>', 'Star (stays on top)')}
      ${row('<kbd>W</kbd>', 'Toggle “waiting on”')}
      ${row('<kbd>Del</kbd>', 'Delete')}
      ${row(`<kbd>${ember.modKey}</kbd>${ember.isMac ? '' : '+'}<kbd>Z</kbd>`, 'Undo')}
      ${row('<kbd>1</kbd>–<kbd>5</kbd>', 'Today · Inbox · Upcoming · Waiting · Done')}
      ${row('<kbd>/</kbd>', 'Search')}
    </div>
    <h3>Writing tasks</h3>
    <div class="kgrid">
      ${row('<code>tomorrow</code> <code>fri</code> <code>next mon</code> <code>12/11</code> <code>3 nov</code>', 'Due date (shows in Today on that day)')}
      ${row('<code>14:30</code> <code>at 9</code> <code>2pm</code> <code>fri 14</code> <code>in 2h</code> <code>eod</code>', 'A time → you get a reminder pop-up')}
      ${row('<code>remind</code> + a date', `Reminder at ${String(db.settings.defaultHour).padStart(2, '0')}:00 that day`)}
      ${row('<code>@Alex</code>', 'Person')}
      ${row('<code>wait:</code> or <kbd>Tab</kbd> in quick add', 'Waiting on someone / follow up')}
      ${row('<code>#onboarding</code>', 'Tag')}
      ${row('<code>!</code>', 'Star')}
      ${row('<code>i morgen</code> <code>fredag</code> <code>kl 10</code>', 'Danish works too')}
    </div></div>`;
  $('help').hidden = false;
}
$('help').addEventListener('click', (e) => { if (e.target.id === 'help') $('help').hidden = true; });

// ---------- settings ----------
let recording = null;
let settingsError = '';

// Recording suspends the global hotkeys and captures every key in this window, so it
// must end whenever the user leaves Settings or the window loses focus.
function cancelRecording() {
  if (!recording) return;
  recording = null;
  settingsError = '';
  ember.suspendHotkeys(false);
  if (view === 'settings') renderSettings();
}
window.addEventListener('blur', cancelRecording);

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);
function renderSettings() {
  const s = db.settings;
  const pretty = (a) => (a ? ember.keyParts(a).join(ember.isMac ? ' ' : ' + ') : 'Not set');
  $('settings').innerHTML = `<div class="set">
    <div class="card">
      <div class="item"><div class="lbl"><div>Quick add hotkey</div><div>Works from any app. Click and press a new combination.</div></div>
        <button class="keyrec ${recording === 'hotkey' ? 'rec' : ''}" data-rec="hotkey">${recording === 'hotkey' ? 'Press keys…' : esc(pretty(s.hotkey))}</button></div>
      <div class="item"><div class="lbl"><div>Open Ember hotkey</div><div>Show or hide this window.</div></div>
        <button class="keyrec ${recording === 'openHotkey' ? 'rec' : ''}" data-rec="openHotkey">${recording === 'openHotkey' ? 'Press keys…' : esc(pretty(s.openHotkey))}</button></div>
      ${settingsError ? `<div class="item"><div class="err">${esc(settingsError)}</div></div>` : ''}
    </div>
    <div class="card">
      <div class="item"><div class="lbl"><div>${ember.isMac ? 'Open at login' : 'Start with Windows'}</div><div>Runs quietly in the ${ember.isMac ? 'menu bar' : 'tray'} so the hotkey and reminders always work.</div></div>
        <button class="switch ${s.openAtLogin ? 'on' : ''}" data-toggle="openAtLogin"></button></div>
      <div class="item"><div class="lbl"><div>Default reminder time</div><div>Used for “remind … tomorrow” without a specific time.</div></div>
        <select id="defHour">${HOURS.map((h) => `<option value="${h}" ${h === s.defaultHour ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
    </div>
    <div class="card"><div class="item"><div class="lbl"><div>Shortcuts & syntax</div><div>Press <kbd>?</kbd> anywhere.</div></div></div></div>
  </div>`;
}

$('settings').addEventListener('click', async (e) => {
  const rec = e.target.closest('[data-rec]');
  if (rec) { recording = rec.dataset.rec; settingsError = ''; ember.suspendHotkeys(true); renderSettings(); return; }
  const tog = e.target.closest('[data-toggle]');
  if (tog) { const k = tog.dataset.toggle; await ember.setSettings({ [k]: !db.settings[k] }); }
});
$('settings').addEventListener('change', (e) => {
  if (e.target.id === 'defHour') ember.setSettings({ defaultHour: +e.target.value });
});

// Physical key codes, so Option+letter on a Mac records "J" rather than "∆"
const CODENAMES = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter' };
['Backquote', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash'].forEach((c) => { CODENAMES[c] = c; });
document.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault(); e.stopPropagation();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
  const which = recording;
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey) { recording = null; ember.suspendHotkeys(false); return renderSettings(); }
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  if (!mods.length || (mods.length === 1 && mods[0] === 'Shift')) { settingsError = `Use at least ${ember.isMac ? '⌘, ⌥ or ⌃' : 'Ctrl or Alt'} so it doesn’t clash with typing.`; return renderSettings(); }
  const key = CODENAMES[e.code] || (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit\d$/.test(e.code) ? e.code.slice(5) : /^F\d+$/.test(e.code) ? e.code : null);
  if (!key) { settingsError = 'That key can’t be used in a hotkey.'; return renderSettings(); }
  const acc = [...mods, key].join('+');
  recording = null;
  const res = await ember.setSettings({ [which]: acc });
  settingsError = res.ok ? '' : `Couldn’t register ${ember.keyParts(acc).join(' ')} — another app is probably using it.`;
  renderSettings();
}, true);

// ---------- boot ----------
ember.on('db:changed', (d) => {
  // Keep optimistic completing state; otherwise take main's copy as truth
  db = d;
  if (!editing) render(); else { renderNav(); renderHeader(); }
});
ember.on('nav', (v) => setView(v));
window.addEventListener('focus', () => { if (!editing && !typing()) render(); });

ember.get().then((d) => {
  db = d;
  sel = visible()[0]?.id || null;
  render();
  if (!db.tasks.length) showHelp();
});
