// Debug-only harness: `EMBER_SELFTEST=1 EMBER_DATA=<tmp> EMBER_SHOTS=<dir> yarn tauri dev`
// Seeds sample data, drives every window, screenshots them (Windows) and prints
// PASS/FAIL lines for the behaviour checks, then exits.

#[cfg(debug_assertions)]
use std::time::Duration;
#[cfg(debug_assertions)]
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn selftest_report(msg: String) {
    // Registered in every build (generate_handler! can't be cfg-gated per command),
    // but only does anything in debug builds.
    if cfg!(debug_assertions) {
        println!("SELFTEST {msg}");
    }
}

#[cfg(debug_assertions)]
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        run(&app);
        std::thread::sleep(Duration::from_millis(500));
        app.exit(0);
    });
}

#[cfg(debug_assertions)]
fn wait(ms: u64) {
    std::thread::sleep(Duration::from_millis(ms));
}

#[cfg(debug_assertions)]
fn eval(app: &AppHandle, label: &str, js: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let wrapped = format!(
            "(async () => {{ try {{ {js} }} catch (e) {{ ember._invoke('selftest_report', {{ msg: 'FAIL js error: ' + e }}); }} }})()"
        );
        let _ = w.eval(&wrapped);
    }
}

#[cfg(debug_assertions)]
fn shot(app: &AppHandle, label: &str, name: &str) {
    let Ok(dir) = std::env::var("EMBER_SHOTS") else { return };
    let Some(w) = app.get_webview_window(label) else { return };
    let (Ok(p), Ok(s)) = (w.outer_position(), w.outer_size()) else { return };
    let out = std::path::Path::new(&dir).join(format!("{name}.png"));
    let _ = std::fs::create_dir_all(&dir);
    let ps = format!(
        "Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap {w},{h}; \
         $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen({x},{y},0,0,$b.Size); \
         $b.Save('{out}'); $g.Dispose(); $b.Dispose()",
        w = s.width, h = s.height, x = p.x, y = p.y, out = out.display()
    );
    let _ = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &ps]).status();
}

#[cfg(debug_assertions)]
const CHECK: &str = "const check = (name, ok) => ember._invoke('selftest_report', { msg: (ok ? 'PASS ' : 'FAIL ') + name });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
const rowOf = (title) => [...document.querySelectorAll('.row')].find((r) => r.textContent.includes(title));
const view = (v) => document.querySelector(`[data-view=\"${v}\"]`).click();";

#[cfg(debug_assertions)]
fn run(app: &AppHandle) {
    wait(4000);
    eval(app, "main", r#"
        document.getElementById('help').hidden = true;
        const P = (s) => EmberParse.parse(s);
        const add = async (s, extra = {}) => ember.add({ ...P(s), ...extra });
        const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
        await add('Sign NDA and IT policy !', { due: ago(30), hasTime: false });
        await add('1:1 with @Alex today 23:30 #1on1');
        await add('Read the Q3 strategy deck today #onboarding');
        await add('Book intro meetings with all team leads today #onboarding !');
        await add('wait: @Sam Jira + Confluence access today');
        await add('Prepare first all-hands talk fri 10 #team');
        await add('Ask HR about onboarding buddy program tomorrow');
        await add('Review open headcount next mon #hiring');
        await add('Figure out expense system');
        await add('Coffee with each direct report #team');
        await add('wait: @Jamie budget numbers for 2027 next week');
        await add('wait: @Åsa org chart draft');
    "#);
    wait(1200);
    eval(app, "main", &format!("{CHECK}\n rowOf('Book intro').click();"));
    wait(400);
    shot(app, "main", "1-today");
    eval(app, "main", &format!("{CHECK}\n view('waiting');"));
    wait(400);
    shot(app, "main", "2-waiting");
    eval(app, "main", &format!("{CHECK}\n view('settings');"));
    wait(400);
    shot(app, "main", "3-settings");

    super::toggle_capture(app);
    wait(600);
    eval(app, "capture", "const i = document.getElementById('in'); i.value = 'Send onboarding plan to @Alex fri 14 #onboarding !'; i.dispatchEvent(new Event('input'));");
    wait(600);
    shot(app, "capture", "4-capture");
    eval(app, "capture", "const i = document.getElementById('in'); i.value = 'quick one tomorrow 9'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));");
    wait(800);
    let capture_hidden = !app.get_webview_window("capture").unwrap().is_visible().unwrap_or(true);
    selftest_report(format!("{} capture closes after Enter", if capture_hidden { "PASS" } else { "FAIL" }));

    eval(app, "main", r#"
        await ember.add({ ...EmberParse.parse('Call back IT support #it'), remindAt: new Date(Date.now() - 1000).toISOString() });
        await ember.add({ ...EmberParse.parse('Prep for skip-level with @Kim'), remindAt: new Date(Date.now() - 2000).toISOString() });
    "#);
    wait(1500);
    shot(app, "reminder", "5-reminder");
    let rem_visible = app.get_webview_window("reminder").unwrap().is_visible().unwrap_or(false);
    selftest_report(format!("{} reminder window appears", if rem_visible { "PASS" } else { "FAIL" }));

    eval(app, "reminder", r#"
        const db = () => ember.get();
        const before = (await db()).tasks.find((t) => t.title === 'Call back IT support');
        document.querySelector(`[data-id="${before.id}"] [data-act="1h"]`).click();
        await new Promise((r) => setTimeout(r, 500));
        const after = (await db()).tasks.find((t) => t.id === before.id);
        ember._invoke('selftest_report', { msg: (new Date(after.remindAt) - Date.now() > 50 * 6e4 ? 'PASS' : 'FAIL') + ' reminder snooze 1h' });
        document.querySelector('[data-act="done"]').click();
        await new Promise((r) => setTimeout(r, 500));
        const done = (await db()).tasks.find((t) => t.title.startsWith('Prep for skip'));
        ember._invoke('selftest_report', { msg: (done.done ? 'PASS' : 'FAIL') + ' reminder done' });
    "#);
    wait(1500);
    let rem_hidden = !app.get_webview_window("reminder").unwrap().is_visible().unwrap_or(true);
    selftest_report(format!("{} reminder window hides when empty", if rem_hidden { "PASS" } else { "FAIL" }));

    eval(app, "main", &format!(r#"{CHECK}
        view('inbox');
        await wait(300);
        rowOf('Figure out expense').click();
        const id = (await ember.get()).tasks.find((t) => t.title === 'Figure out expense system').id;
        key('x'); await wait(1300);
        check('x completes selected task', !!(await ember.get()).tasks.find((t) => t.id === id).done);
        key('z', {{ ctrlKey: !ember.isMac, metaKey: ember.isMac }}); await wait(400);
        check('undo restores it', !(await ember.get()).tasks.find((t) => t.id === id).done);
        rowOf('Figure out expense').click();
        key('m'); await wait(400);
        const moved = (await ember.get()).tasks.find((t) => t.id === id);
        check('m moves to tomorrow', moved.due && new Date(moved.due).getDate() === new Date(Date.now() + 864e5).getDate());
        const q = (await ember.get()).tasks.find((t) => t.title === 'Quick one');
        check('capture added task with reminder', !!(q && q.remindAt));
        view('settings'); await wait(300);
        check('settings shows platform hotkey', document.querySelector('.keyrec').textContent.trim().length > 0);
    "#));
    wait(4000);
    let data = std::fs::read_to_string(&app.state::<super::AppState>().path).unwrap_or_default();
    selftest_report(format!("{} data file written ({} bytes)", if data.contains("Quick one") { "PASS" } else { "FAIL" }, data.len()));

    eval(app, "main", &format!(r#"{CHECK}
        // Leaving Settings mid-recording must hand the keyboard back.
        document.querySelector('[data-rec="hotkey"]').click(); await wait(200);
        view('today'); await wait(200);
        key('2'); await wait(200);
        check('leaving settings cancels hotkey recording', !!document.querySelector('[data-view="inbox"].active'));

        // Editing an overdue timed task must not bring back its dismissed reminder,
        // even when its due time has seconds the edit text can't show.
        const due = new Date(Date.now() - 90e3).toISOString();
        const t = await ember.add({{ title: 'Edit keeps dismissal', due, hasTime: true, remindAt: due }});
        await wait(300);
        await ember.update(t.id, {{ dismissedFor: due }});
        view('today'); await wait(300);
        rowOf('Edit keeps dismissal').click();
        key('e'); await wait(200);
        const inp = document.getElementById('editIn');
        inp.value = inp.value.replace('Edit keeps dismissal', 'Edit keeps dismissal (renamed)');
        inp.dispatchEvent(new KeyboardEvent('keydown', {{ key: 'Enter', bubbles: true }})); await wait(400);
        const after = (await ember.get()).tasks.find((x) => x.id === t.id);
        check('edit renames the task', after.title === 'Edit keeps dismissal (renamed)');
        check('edit keeps a dismissed reminder dismissed', after.dismissedFor === due && after.remindAt === due);
    "#));
    wait(2500);
    let rem_hidden = !app.get_webview_window("reminder").unwrap().is_visible().unwrap_or(true);
    selftest_report(format!("{} dismissed reminder stays hidden after edit", if rem_hidden { "PASS" } else { "FAIL" }));
}
