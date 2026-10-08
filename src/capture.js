const $in = document.getElementById('in');
const $preview = document.getElementById('preview');
const $mode = document.getElementById('mode');
const $foot = document.getElementById('foot');
const { ICONS, chips } = EmberUI;

let waiting = false;
let settings = { defaultHour: 9 };
ember.get().then((db) => { settings = db.settings; });
ember.on('db:changed', (db) => { settings = db.settings; });

const FOOT = $foot.innerHTML;

function parsed() {
  const p = EmberParse.parse($in.value, { defaultHour: settings.defaultHour });
  if (waiting) p.waiting = true;
  return p;
}

function render() {
  const p = parsed();
  $mode.className = 'mode' + (p.waiting ? ' waiting' : '');
  $mode.innerHTML = p.waiting ? `${ICONS.wait}Waiting on` : `${ICONS.check}Todo`;
  $preview.innerHTML = $in.value.trim() ? chips(p, { preview: true }) : '';
  fit();
}

function fit() {
  requestAnimationFrame(() => ember.resizeCapture(document.body.scrollHeight));
}

async function submit(keepOpen) {
  const p = parsed();
  if (!p.title) return;
  await ember.add(p);
  $in.value = '';
  waiting = false;
  render();
  $foot.innerHTML = `<span class="flash">✓ Added “${EmberUI.esc(p.title)}”</span>`;
  setTimeout(() => { $foot.innerHTML = FOOT; }, keepOpen ? 1400 : 200);
  if (!keepOpen) setTimeout(() => ember.hideCapture(), 120);
}

$in.addEventListener('input', render);
$in.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submit(e.shiftKey); }
  else if (e.key === 'Escape') { e.preventDefault(); ember.hideCapture(); }
  else if (e.key === 'Tab') { e.preventDefault(); waiting = !waiting; render(); }
});
$mode.addEventListener('click', () => { waiting = !waiting; render(); $in.focus(); });

ember.on('capture:open', () => {
  $foot.innerHTML = FOOT;
  // Re-trigger the pop animation
  const box = document.getElementById('box');
  box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
  $in.focus();
  $in.select();
  render();
});

render();
