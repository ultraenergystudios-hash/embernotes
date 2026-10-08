const $list = document.getElementById('list');
const { ICONS, esc } = EmberUI;
let alerts = [];
let defaultHour = 9;
ember.get().then((db) => { defaultHour = db.settings.defaultHour ?? 9; });
ember.on('db:changed', (db) => { defaultHour = db.settings.defaultHour ?? 9; });

const at = (days, h, m = 0) => { const d = EmberParse.addDays(new Date(), days); d.setHours(h, m, 0, 0); return d; };
const SNOOZE = {
  '10m': () => new Date(Date.now() + 10 * 6e4),
  '1h': () => new Date(Date.now() + 36e5),
  'tmrw': () => at(1, defaultHour),
};

function chime() {
  try {
    const ctx = new AudioContext();
    [[880, 0], [1320, 0.12]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.6);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.7);
    });
  } catch {}
}

function render() {
  $list.innerHTML = alerts.map((t) => `
    <div class="card" data-id="${t.id}">
      <div class="head">${ICONS.bell}<span>${esc(EmberParse.formatDue(t.remindAt, true))}${t.person ? ' · ' + esc(t.person) : ''}</span>
        <button class="x" data-act="dismiss" title="Dismiss">×</button></div>
      <div class="title" data-act="open">${esc(t.title)}</div>
      <div class="actions">
        <button class="done" data-act="done">Done</button>
        <button data-act="10m">10 min</button>
        <button data-act="1h">1 hour</button>
        <button data-act="tmrw">Tomorrow ${defaultHour}:00</button>
      </div>
    </div>`).join('');
  requestAnimationFrame(() => {
    if (alerts.length) ember.sizeReminder(document.body.scrollHeight);
    else ember.hideReminder();
  });
}

$list.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  const id = btn.closest('.card').dataset.id;
  const t = alerts.find((x) => x.id === id);
  const act = btn.dataset.act;
  if (act === 'done') ember.update(id, { done: new Date().toISOString() });
  else if (act === 'dismiss') ember.update(id, { dismissedFor: t.remindAt });
  else if (act === 'open') { ember.open('today'); ember.update(id, { dismissedFor: t.remindAt }); }
  else if (SNOOZE[act]) ember.update(id, { remindAt: SNOOZE[act]().toISOString(), snoozed: (t.snoozed || 0) + 1 });
  alerts = alerts.filter((x) => x.id !== id);
  render();
});

ember.on('reminders', (list, isNew) => {
  alerts = list;
  render();
  if (isNew) chime();
});

// Events sent before this page loaded are lost, so ask for anything already due.
ember.pullReminders().then(([list, isNew]) => {
  alerts = list;
  render();
  if (isNew && list.length) chime();
});
