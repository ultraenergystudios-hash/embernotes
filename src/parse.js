// Natural-language capture parser. Shared by renderer windows and tests (UMD).
//
//   "Send budget to @Alex fri 14 #onboarding !"
//   -> { title: "Send budget to Alex", person: "Alex", due: <fri>, hasTime: true,
//        tags: ["onboarding"], star: true }
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EmberParse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAYS = {
    sun: 0, sunday: 0, søndag: 0,
    mon: 1, monday: 1, mandag: 1,
    tue: 2, tues: 2, tuesday: 2, tirsdag: 2,
    wed: 3, weds: 3, wednesday: 3, onsdag: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, torsdag: 4,
    fri: 5, friday: 5, fredag: 5,
    sat: 6, saturday: 6, lørdag: 6,
  };
  const MONTHS = {
    jan: 0, january: 0, januar: 0, feb: 1, february: 1, februar: 1, mar: 2, march: 2, marts: 2,
    apr: 3, april: 3, may: 4, maj: 4, jun: 5, june: 5, juni: 5, jul: 6, july: 6, juli: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, okt: 9, oktober: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const DAYMARK = ' \u0001 '; // left where a day word was, so "fri 14" can claim the hour
  const L = '[a-zæøå]'; // letters, incl. Danish
  const B = `(?<!${L})`; // word start
  const E = `(?!${L})`; // word end
  const dayAlt = Object.keys(DAYS).sort((a, b) => b.length - a.length).join('|');
  const monAlt = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function nextWeekday(now, wd, forceNext) {
    let diff = (wd - now.getDay() + 7) % 7;
    if (diff === 0 || forceNext) diff = diff === 0 ? 7 : diff + (forceNext ? 7 : 0);
    return addDays(startOfDay(now), diff);
  }

  function parseClock(h, m, ampm) {
    h = parseInt(h, 10); m = m ? parseInt(m, 10) : 0;
    if (ampm) {
      ampm = ampm.toLowerCase();
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
    }
    if (h > 23 || m > 59) return null;
    return { h, m };
  }

  function parse(input, opts = {}) {
    const now = opts.now ? new Date(opts.now) : new Date();
    const defaultHour = opts.defaultHour ?? 9;
    let s = ' ' + input + ' ';
    const out = { title: '', tags: [], person: null, star: false, waiting: false, remind: false, date: null, time: null, relative: null };

    const take = (re, fn) => {
      s = s.replace(re, (...m) => { const r = fn(...m); return r === false ? m[0] : typeof r === 'string' ? r : ' '; });
    };

    // Mode markers
    take(new RegExp(`${B}(wait|waiting|wf):?\\s`, 'i'), () => { out.waiting = true; });
    take(new RegExp(`${B}(remind( me)?( to)?|r:)\\s`, 'i'), () => { out.remind = true; });

    // Tags / person / star
    take(/(^|\s)#([\wæøåÆØÅ\-\/]+)/g, (_, pre, t) => { out.tags.push(t.toLowerCase()); });
    take(/(^|\s)@([A-Za-zæøåÆØÅ][\wæøåÆØÅ\-\.]*)/, (_, pre, p) => { out.person = p.replace(/\.$/, ''); return ` ${out.person}`; });
    take(/(^|\s)!+(?=\s)/g, () => { out.star = true; });

    // Relative: in 20m / in 2 hours / om 3 dage
    take(new RegExp(`${B}(in|om)\\s+(\\d+|an?|en|et)\\s*(m|min|mins|minutes?|minutter|h|hr|hrs|hours?|timer?|d|days?|dage?|w|wk|weeks?|uger?)${E}`, 'i'),
      (_, __, n, unit) => {
        n = /^\d+$/.test(n) ? parseInt(n, 10) : 1;
        unit = unit.toLowerCase();
        const ms = unit.startsWith('m') ? 6e4 : (unit.startsWith('h') || unit.startsWith('t')) ? 36e5
          : unit.startsWith('d') ? 864e5 : 6048e5;
        if (ms >= 864e5) out.date = addDays(startOfDay(now), (n * ms) / 864e5);
        else out.relative = new Date(now.getTime() + n * ms);
      });

    // Explicit dates
    take(/(^|\s)(\d{4})-(\d{1,2})-(\d{1,2})(?=\s)/, (_, p, y, mo, d) => { out.date = new Date(+y, mo - 1, +d); });
    take(/(^|\s)(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?=\s)/, (_, p, d, mo, y) => {
      if (+mo > 12 || +d > 31) return false;
      let yr = y ? (+y < 100 ? 2000 + +y : +y) : now.getFullYear();
      let dt = new Date(yr, mo - 1, +d);
      if (!y && dt < startOfDay(now)) dt = new Date(yr + 1, mo - 1, +d);
      out.date = dt;
    });
    const monthDate = (d, mo) => {
      let dt = new Date(now.getFullYear(), MONTHS[mo.toLowerCase()], +d);
      if (dt < startOfDay(now)) dt.setFullYear(dt.getFullYear() + 1);
      out.date = dt;
    };
    take(new RegExp(`${B}(\\d{1,2})\\.?\\s+(${monAlt})${E}`, 'i'), (_, d, mo) => monthDate(d, mo));
    take(new RegExp(`${B}(${monAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])`, 'i'), (_, mo, d) => monthDate(d, mo));

    // Named days
    take(new RegExp(`${B}(today|idag|i dag)${E}`, 'i'), () => { out.date = startOfDay(now); return DAYMARK; });
    take(new RegExp(`${B}(tonight|i aften)${E}`, 'i'), () => { out.date = startOfDay(now); out.time = out.time || { h: 18, m: 0 }; });
    take(new RegExp(`${B}(tomorrow|tmrw|tmw|imorgen|i morgen)${E}`, 'i'), () => { out.date = addDays(startOfDay(now), 1); return DAYMARK; });
    take(new RegExp(`${B}(eod)${E}`, 'i'), () => { out.date = out.date || startOfDay(now); out.time = { h: 16, m: 0 }; });
    take(new RegExp(`${B}(eow)${E}`, 'i'), () => { out.date = nextWeekday(now, 5, false); if (now.getDay() === 5) out.date = startOfDay(now); out.time = { h: 15, m: 0 }; });
    take(new RegExp(`${B}(next week|næste uge)${E}`, 'i'), () => { out.date = nextWeekday(now, 1, false); });
    take(new RegExp(`${B}(this weekend|weekend|weekenden)${E}`, 'i'), () => { out.date = nextWeekday(now, 6, false); if (now.getDay() === 6) out.date = startOfDay(now); });
    take(new RegExp(`${B}(?:(next|næste|on|på)\\s+)?(${dayAlt})${E}`, 'i'), (_, nx, d) => {
      out.date = nextWeekday(now, DAYS[d.toLowerCase()], /next|næste/i.test(nx || ''));
      return DAYMARK;
    });

    // Times: at 14, at 2pm, 14:30, kl 9, 9am
    take(new RegExp(`${B}(?:at|kl\\.?)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?${E}`, 'i'), (_, h, m, ap) => {
      const t = parseClock(h, m, ap); if (!t) return false; out.time = t;
    });
    take(/(^|\s)(\d{1,2})[:.](\d{2})\s*(am|pm)?(?=\s)/i, (_, p, h, m, ap) => {
      const t = parseClock(h, m, ap); if (!t) return false; out.time = t;
    });
    take(/(^|\s)(\d{1,2})\s*(am|pm)(?=\s)/i, (_, p, h, ap) => {
      const t = parseClock(h, null, ap); if (!t) return false; out.time = t;
    });
    // Bare hour directly after a day word: "fri 14", "tomorrow 9"
    if (!out.time) {
      take(/\u0001\s*(\d{1,2})(?=\s)/, (_, h) => {
        const t = parseClock(h, null, null); if (!t) return false; out.time = t;
      });
    }
    s = s.split('\u0001').join(' ');

    // Resolve
    let due = null;
    if (out.relative) due = out.relative;
    else if (out.date || out.time) {
      due = new Date(out.date || startOfDay(now));
      if (out.time) due.setHours(out.time.h, out.time.m, 0, 0);
      if (!out.date && out.time && due <= now) due = addDays(due, 1); // "at 9" past today -> tomorrow
    }
    const hasTime = !!(out.relative || out.time);
    let remindAt = null;
    if (due && hasTime) remindAt = due;
    else if (due && out.remind) { remindAt = new Date(due); remindAt.setHours(defaultHour, 0, 0, 0); }

    const title = s.replace(/\s+/g, ' ').trim().replace(/^[-–:,]\s*/, '').replace(/\s+(on|at|by|in|kl|på)$/i, '');
    return {
      title: title ? title[0].toUpperCase() + title.slice(1) : '',
      tags: out.tags,
      person: out.person,
      star: out.star,
      waiting: out.waiting,
      due: due ? due.toISOString() : null,
      hasTime,
      remindAt: remindAt ? remindAt.toISOString() : null,
    };
  }

  // Turn a task back into editable text that parse() round-trips.
  function unparse(t) {
    const parts = [];
    if (t.waiting) parts.push('wait:');
    let title = t.title;
    if (t.person) {
      const re = new RegExp(`(^|\\s)${t.person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`);
      title = re.test(title) ? title.replace(re, `$1@${t.person}`) : `${title} @${t.person}`;
    }
    parts.push(title);
    if (t.due) {
      const d = new Date(t.due);
      const p = (n) => String(n).padStart(2, '0');
      parts.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
      if (t.hasTime) parts.push(`${p(d.getHours())}:${p(d.getMinutes())}`);
      else if (t.remindAt) parts.unshift('remind');
    }
    (t.tags || []).forEach((x) => parts.push('#' + x));
    if (t.star) parts.push('!');
    return parts.join(' ');
  }

  // Friendly due labels: "Today 14:00", "Tomorrow", "Fri 9:00", "12 Oct"
  function formatDue(iso, hasTime, now = new Date()) {
    if (!iso) return '';
    const d = new Date(iso);
    const days = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
    const time = hasTime ? ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    let day;
    if (days === 0) day = 'Today';
    else if (days === 1) day = 'Tomorrow';
    else if (days === -1) day = 'Yesterday';
    else if (days > 1 && days < 7) day = d.toLocaleDateString('en-GB', { weekday: 'short' });
    else day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
    return day + time;
  }

  return { parse, unparse, formatDue, startOfDay, addDays };
});
