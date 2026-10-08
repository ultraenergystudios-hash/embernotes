// window.ember: the same API the windows used under Electron, backed by Tauri commands/events.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
document.documentElement.dataset.platform = isMac ? 'mac' : 'win';

// Accelerator → label. "Command+Shift+J" → "⌘ ⇧ J" on Mac, "Ctrl + Shift + J" elsewhere.
const MAC = { Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘', Command: '⌘', Cmd: '⌘', CommandOrControl: '⌘', CmdOrCtrl: '⌘' };
const WIN = { Control: 'Ctrl', CommandOrControl: 'Ctrl', CmdOrCtrl: 'Ctrl', Super: 'Win', Command: 'Win' };
const keyParts = (acc) => (acc || '').split('+').filter(Boolean).map((k) => (isMac ? MAC : WIN)[k] || k);

window.ember = {
  isMac,
  keyParts,
  modKey: isMac ? '⌘' : 'Ctrl',
  get: () => invoke('db_get'),
  add: (task) => invoke('task_add', { task }),
  update: (id, patch) => invoke('task_update', { id, patch }),
  remove: (id) => invoke('task_delete', { id }),
  restore: (task) => invoke('task_restore', { task }),
  setSettings: (patch) => invoke('settings_set', { patch }),
  suspendHotkeys: (on) => invoke('hotkeys_suspend', { on }),
  open: (view) => invoke('open_main', { view }),
  hideCapture: () => invoke('capture_hide'),
  resizeCapture: (h) => invoke('capture_resize', { h }),
  sizeReminder: (h) => invoke('reminder_size', { h }),
  hideReminder: () => invoke('reminder_hide'),
  pullReminders: () => invoke('reminders_pull'),
  on: (ch, fn) => listen(ch, (e) => (ch === 'reminders' ? fn(...e.payload) : fn(e.payload))),
};
if (import.meta.env.DEV) window.ember._invoke = invoke; // used by the debug self-test
