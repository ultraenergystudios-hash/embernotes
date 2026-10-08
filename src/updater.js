// Silent update check on launch (same flow Ember used): GitHub Releases latest.json,
// verified against the pubkey in tauri.conf.json.
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';

async function run() {
  try {
    const update = await check();
    if (!update) return;
    const ok = await ask(`Ember ${update.version} is available (you're on ${update.currentVersion}).\n\nInstall now? The app will restart.`, {
      title: 'Update available', kind: 'info', okLabel: 'Install and restart', cancelLabel: 'Later',
    });
    if (!ok) return;
    await update.downloadAndInstall();
    await relaunch();
  } catch (e) {
    console.warn('Update check failed', e);
  }
}

if (!import.meta.env.DEV) setTimeout(run, 5000);
