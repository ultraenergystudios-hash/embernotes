// Small helpers shared by all windows.
(function () {
  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const ICONS = {
    cal: icon('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    bell: icon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
    user: icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    tag: icon('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    star: icon('<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" fill="currentColor"/>'),
    wait: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    inbox: icon('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>'),
    sun: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    upcoming: icon('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
    check: icon('<path d="M20 6 9 17l-5-5"/>'),
    gear: icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    plus: icon('<path d="M12 5v14M5 12h14"/>'),
    search: icon('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dueClass(t, now = new Date()) {
    if (!t.due) return '';
    const d = new Date(t.due);
    const sod = EmberParse.startOfDay(now);
    if (t.hasTime ? d < now : d < sod) return 'overdue';
    if (EmberParse.startOfDay(d).getTime() === sod.getTime()) return 'today';
    return '';
  }

  // Chips for a task (or a parse preview)
  function chips(t, { preview = false } = {}) {
    const out = [];
    if (t.waiting) out.push(`<span class="chip wait">${ICONS.wait}Waiting on${t.person ? ' ' + esc(t.person) : ''}</span>`);
    if (t.due) {
      out.push(`<span class="chip date ${dueClass(t)}">${ICONS.cal}${esc(EmberParse.formatDue(t.due, t.hasTime))}</span>`);
    }
    if (t.remindAt && (!t.hasTime || t.remindAt !== t.due)) {
      out.push(`<span class="chip remind">${ICONS.bell}${esc(EmberParse.formatDue(t.remindAt, true))}</span>`);
    } else if (t.remindAt && preview) {
      out.push(`<span class="chip remind">${ICONS.bell}Reminder</span>`);
    } else if (t.remindAt) {
      out.push(`<span class="chip remind" title="Reminder set">${ICONS.bell}</span>`);
    }
    if (t.person && !t.waiting) out.push(`<span class="chip">${ICONS.user}${esc(t.person)}</span>`);
    (t.tags || []).forEach((x) => out.push(`<span class="chip tag" data-tag="${esc(x)}">${ICONS.tag}${esc(x)}</span>`));
    if (t.star) out.push(`<span class="chip star">${ICONS.star}</span>`);
    return out.join('');
  }

  window.EmberUI = { ICONS, esc, chips, dueClass };
})();
