// Ember: fast-capture todos with reminders.
//
// The Rust side owns the data file and everything that must work while no window is
// visible: global hotkeys, the tray/menu-bar icon, the reminder scheduler and
// start-at-login. Windows talk to it through the commands below and listen for
// `db:changed`, `nav`, `capture:open` and `reminders` events.

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WindowEvent,
};

mod selftest; // debug-only driver for screenshots + behaviour checks (EMBER_SELFTEST=1)

type Task = Map<String, Value>;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    hotkey: String,
    open_hotkey: String,
    open_at_login: bool,
    default_hour: u32,
}

impl Default for Settings {
    fn default() -> Self {
        // Ctrl+Space is the input-source switcher on macOS, so the Mac default is
        // Option+Space (the usual launcher key).
        let (hotkey, open_hotkey) = if cfg!(target_os = "macos") {
            ("Alt+Space", "Super+Shift+J")
        } else {
            ("Control+Shift+Space", "Control+Shift+J")
        };
        Settings {
            hotkey: hotkey.into(),
            open_hotkey: open_hotkey.into(),
            open_at_login: false,
            default_hour: 9,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Db {
    #[serde(default)]
    tasks: Vec<Task>,
    #[serde(default)]
    settings: Settings,
}

pub struct AppState {
    db: Mutex<Db>,
    path: PathBuf,
    /// Was one of our own windows focused when quick-capture opened? (macOS focus handling)
    capture_from_app: AtomicBool,
    /// Last set of alerts sent to the reminder window, so we only re-render on change.
    last_alerts: Mutex<String>,
    quitting: AtomicBool,
    /// False when the data file exists but couldn't be read: nothing may be written.
    writable: AtomicBool,
}

fn data_path(app: &AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("EMBER_DATA") {
        return PathBuf::from(dir).join("ember.json");
    }
    app.path().app_data_dir().expect("no app data dir").join("ember.json")
}

/// Earlier homes of the data file, checked in order on first run: the Tauri build
/// of Jot, then the Electron prototype.
fn legacy_paths(path: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(parent) = path.parent().and_then(|d| d.parent()) {
        out.push(parent.join("io.baekgaard.jot").join("jot.json"));
    }
    if let Some(d) = dirs::config_dir() {
        out.push(d.join("jot").join("jot.json"));
    }
    out
}

/// Err means the data exists but couldn't be read safely; the caller must not save
/// anything in that case, or it would overwrite the user's data with an empty list.
fn load(path: &Path) -> Result<Db, String> {
    let source = if path.exists() {
        Some(path.to_path_buf())
    } else if std::env::var("EMBER_DATA").is_err() {
        legacy_paths(path).into_iter().find(|p| p.exists())
    } else {
        None
    };
    let Some(source) = source else { return Ok(Db::default()) };
    let text = fs::read_to_string(&source).map_err(|e| format!("Couldn't read {}: {e}", source.display()))?;
    match serde_json::from_str(&text) {
        Ok(db) => Ok(db),
        Err(e) => {
            // Never silently overwrite a file we couldn't parse: set it aside first.
            let aside = source.with_extension(format!("corrupt-{}.json", Local::now().format("%Y%m%d%H%M%S")));
            fs::copy(&source, &aside).map_err(|ce| format!("Couldn't parse {} ({e}) or copy it aside: {ce}", source.display()))?;
            eprintln!("ember: couldn't parse {}: {e}; copied to {}", source.display(), aside.display());
            Ok(Db::default())
        }
    }
}

fn save(st: &AppState, db: &Db) {
    if !st.writable.load(Ordering::Relaxed) {
        return;
    }
    let Some(dir) = st.path.parent() else { return };
    let _ = fs::create_dir_all(dir);
    // One backup per day, taken before the day's first write so it holds the
    // previous state. Keep the last 14.
    let bdir = dir.join("backups");
    let bfile = bdir.join(format!("ember-{}.json", Local::now().format("%Y-%m-%d")));
    let fresh_backup = st.path.exists() && !bfile.exists();
    if fresh_backup {
        let _ = fs::create_dir_all(&bdir);
        let _ = fs::copy(&st.path, &bfile);
    }
    let tmp = st.path.with_extension("json.tmp");
    let Ok(text) = serde_json::to_string_pretty(db) else { return };
    if fs::write(&tmp, text).is_err() || fs::rename(&tmp, &st.path).is_err() {
        eprintln!("ember: failed to save {}", st.path.display());
        return;
    }
    if fresh_backup {
        if let Ok(rd) = fs::read_dir(&bdir) {
            let mut files: Vec<_> = rd.flatten().map(|e| e.path()).collect();
            files.sort();
            let excess = files.len().saturating_sub(14);
            for f in files.into_iter().take(excess) {
                let _ = fs::remove_file(f);
            }
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn time_of(t: &Task, key: &str) -> Option<DateTime<Utc>> {
    let s = t.get(key)?.as_str()?;
    DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
}

fn is_open(t: &Task) -> bool {
    !t.get("done").map(|v| v.is_string()).unwrap_or(false)
}

fn flag(t: &Task, key: &str) -> bool {
    t.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn new_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    format!("{:x}{:03x}", Utc::now().timestamp_millis(), N.fetch_add(1, Ordering::Relaxed) % 4096)
}

/// (due today or earlier, overdue)
fn counts(db: &Db) -> (usize, usize) {
    let now = Utc::now();
    let sod = Local::now()
        .date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|d| d.and_local_timezone(Local).earliest())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or(now);
    let eod = sod + chrono::Duration::days(1);
    let (mut today, mut overdue) = (0, 0);
    for t in db.tasks.iter().filter(|t| is_open(t)) {
        let Some(due) = time_of(t, "due") else { continue };
        if due < eod {
            today += 1;
        }
        if if flag(t, "hasTime") { due < now } else { due < sod } {
            overdue += 1;
        }
    }
    (today, overdue)
}

/// Run `f` against the db, persist, then notify windows and re-check reminders.
fn mutate<R>(app: &AppHandle, f: impl FnOnce(&mut Db) -> R) -> R {
    let st = app.state::<AppState>();
    let r = {
        let mut db = st.db.lock().unwrap();
        let r = f(&mut db);
        save(&st, &db);
        r
    };
    changed(app);
    check_reminders(app);
    r
}

fn changed(app: &AppHandle) {
    let db = app.state::<AppState>().db.lock().unwrap().clone();
    let _ = app.emit("db:changed", &db);
    update_tray(app, &db);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn db_get(st: State<AppState>) -> Db {
    st.db.lock().unwrap().clone()
}

#[tauri::command]
fn task_add(app: AppHandle, task: Task) -> Task {
    let mut t: Task = json!({
        "created": now_iso(), "done": null, "title": "", "notes": "", "tags": [],
        "person": null, "star": false, "waiting": false, "due": null, "hasTime": false, "remindAt": null,
    })
    .as_object()
    .cloned()
    .unwrap();
    t.extend(task);
    t.insert("id".into(), json!(new_id()));
    let out = t.clone();
    mutate(&app, |db| db.tasks.push(t));
    out
}

#[tauri::command]
fn task_update(app: AppHandle, id: String, patch: Task) -> Option<Task> {
    mutate(&app, |db| {
        let t = db.tasks.iter_mut().find(|t| t.get("id").and_then(Value::as_str) == Some(&id))?;
        // A new reminder time should alert again; resending the same one shouldn't.
        if patch.get("remindAt").is_some_and(|r| t.get("remindAt") != Some(r)) {
            t.remove("dismissedFor");
        }
        t.extend(patch);
        Some(t.clone())
    })
}

#[tauri::command]
fn task_delete(app: AppHandle, id: String) -> Option<Task> {
    mutate(&app, |db| {
        let i = db.tasks.iter().position(|t| t.get("id").and_then(Value::as_str) == Some(&id))?;
        Some(db.tasks.remove(i))
    })
}

#[tauri::command]
fn task_restore(app: AppHandle, task: Task) -> Task {
    let out = task.clone();
    mutate(&app, |db| db.tasks.push(task));
    out
}

#[tauri::command]
fn settings_set(app: AppHandle, patch: Map<String, Value>) -> Value {
    let st = app.state::<AppState>();
    let prev = st.db.lock().unwrap().settings.clone();
    let mut merged = serde_json::to_value(&prev).unwrap();
    merged.as_object_mut().unwrap().extend(patch);
    let next: Settings = serde_json::from_value(merged).unwrap_or_else(|_| prev.clone());
    st.db.lock().unwrap().settings = next;
    let errors = register_hotkeys(&app);
    if !errors.is_empty() {
        st.db.lock().unwrap().settings = prev;
        register_hotkeys(&app);
    }
    apply_login(&app);
    save(&st, &st.db.lock().unwrap());
    changed(&app);
    json!({ "ok": errors.is_empty(), "errors": errors })
}

#[tauri::command]
fn hotkeys_suspend(app: AppHandle, on: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    if on {
        let _ = app.global_shortcut().unregister_all();
    } else {
        register_hotkeys(&app);
    }
}

#[tauri::command]
fn open_main(app: AppHandle, view: Option<String>) {
    show_main(&app, view);
}

#[tauri::command]
fn capture_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.hide();
    }
    // macOS doesn't hand focus back to the previous app when our window hides;
    // hiding the app does. Skip it if the user summoned capture from Ember itself.
    #[cfg(target_os = "macos")]
    if !app.state::<AppState>().capture_from_app.load(Ordering::Relaxed) {
        let _ = app.hide();
    }
}

#[tauri::command]
fn capture_resize(app: AppHandle, h: f64) {
    if let Some(w) = app.get_webview_window("capture") {
        let _ = w.set_size(LogicalSize::new(680.0, h.ceil()));
    }
}

#[tauri::command]
fn reminder_size(app: AppHandle, h: f64) {
    let Some(w) = app.get_webview_window("reminder") else { return };
    let Ok(Some(m)) = w.primary_monitor() else { return };
    let scale = m.scale_factor();
    let wa = m.work_area();
    let (pw, margin) = (380.0 * scale, 16.0 * scale);
    let ph = (h.ceil() * scale).min(wa.size.height as f64 - 2.0 * margin);
    let _ = w.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = w.set_position(PhysicalPosition::new(
        wa.position.x + (wa.size.width as f64 - pw - margin) as i32,
        wa.position.y + (wa.size.height as f64 - ph - margin) as i32,
    ));
    if !w.is_visible().unwrap_or(false) {
        let _ = w.show();
    }
}

#[tauri::command]
fn reminder_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("reminder") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn reminders_pull(app: AppHandle) -> (Vec<Task>, bool) {
    let (alerts, fresh) = collect_alerts(&app);
    *app.state::<AppState>().last_alerts.lock().unwrap() = alert_key(&alerts);
    (alerts, fresh)
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
// A task "fires" when remindAt <= now and we haven't fired for that exact remindAt
// yet. It stays on screen until it's done, snoozed (remindAt changes) or dismissed.

fn collect_alerts(app: &AppHandle) -> (Vec<Task>, bool) {
    let st = app.state::<AppState>();
    let mut db = st.db.lock().unwrap();
    let now = Utc::now();
    let (mut alerts, mut fresh) = (Vec::new(), false);
    for t in db.tasks.iter_mut().filter(|t| is_open(t)) {
        let Some(at) = time_of(t, "remindAt") else { continue };
        if at > now {
            continue;
        }
        let r = t.get("remindAt").cloned().unwrap();
        if t.get("firedFor") != Some(&r) {
            t.insert("firedFor".into(), r.clone());
            fresh = true;
        }
        if t.get("dismissedFor") != Some(&r) {
            alerts.push(t.clone());
        }
    }
    if fresh {
        save(&st, &db);
    }
    (alerts, fresh)
}

fn alert_key(alerts: &[Task]) -> String {
    alerts
        .iter()
        .map(|t| format!("{}|{}|{}", t["id"], t["remindAt"], t.get("title").unwrap_or(&Value::Null)))
        .collect::<Vec<_>>()
        .join(";")
}

fn check_reminders(app: &AppHandle) {
    let (alerts, fresh) = collect_alerts(app);
    let key = alert_key(&alerts);
    let st = app.state::<AppState>();
    let mut last = st.last_alerts.lock().unwrap();
    if alerts.is_empty() {
        if let Some(w) = app.get_webview_window("reminder") {
            let _ = w.hide();
        }
    } else if fresh || *last != key {
        let _ = app.emit_to("reminder", "reminders", (&alerts, fresh));
    }
    *last = key;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

fn show_main(app: &AppHandle, view: Option<String>) {
    let Some(w) = app.get_webview_window("main") else { return };
    #[cfg(target_os = "macos")]
    let _ = app.show();
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
    if let Some(v) = view {
        let _ = app.emit_to("main", "nav", v);
    }
}

fn toggle_main(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
        let _ = w.hide();
    } else {
        show_main(app, None);
    }
}

fn toggle_capture(app: &AppHandle) {
    let Some(w) = app.get_webview_window("capture") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    let from_app = app.webview_windows().values().any(|w| w.is_focused().unwrap_or(false));
    app.state::<AppState>().capture_from_app.store(from_app, Ordering::Relaxed);

    // Centre horizontally, ~22% down, on whichever screen the mouse is on
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let wa = m.work_area();
        let width = 680.0 * m.scale_factor();
        let _ = w.set_position(PhysicalPosition::new(
            wa.position.x + ((wa.size.width as f64 - width) / 2.0) as i32,
            wa.position.y + (wa.size.height as f64 * 0.22) as i32,
        ));
    }
    let _ = app.emit_to("capture", "capture:open", ());
    let _ = w.show();
    let _ = w.set_focus();
}

// ---------------------------------------------------------------------------
// Tray / menu bar
// ---------------------------------------------------------------------------

/// Draw the icon in code: a filled circle with a check mark. On macOS it's a
/// template image (black + alpha, check knocked out) so it adapts to the menu bar.
fn make_icon(size: u32, badge: bool, template: bool) -> Image<'static> {
    let n = size as usize;
    let mut buf = vec![0u8; n * n * 4];
    let s = size as f64;
    let (c, r) = (s / 2.0, s * 0.46);
    let seg = |px: f64, py: f64, ax: f64, ay: f64, bx: f64, by: f64| {
        let (dx, dy) = (bx - ax, by - ay);
        let t = (((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
        ((px - (ax + t * dx)).powi(2) + (py - (ay + t * dy)).powi(2)).sqrt()
    };
    for y in 0..n {
        for x in 0..n {
            let (fx, fy) = (x as f64 + 0.5, y as f64 + 0.5);
            let d = ((fx - c).powi(2) + (fy - c).powi(2)).sqrt();
            let cov = (r - d + 0.5).clamp(0.0, 1.0);
            if cov <= 0.0 {
                continue;
            }
            let (u, v) = (fx / s, fy / s);
            let k = seg(u, v, 0.29, 0.52, 0.44, 0.67).min(seg(u, v, 0.44, 0.67, 0.72, 0.36));
            let ink = ((0.075 - k) * s + 0.5).clamp(0.0, 1.0);
            let i = (y * n + x) * 4;
            if template {
                buf[i + 3] = (cov * (1.0 - ink) * 255.0) as u8;
                continue;
            }
            let mut col = [124.0, 92.0, 255.0].map(|a: f64| a * (1.0 - ink) + 255.0 * ink);
            if badge && ((fx - s * 0.8).powi(2) + (fy - s * 0.2).powi(2)).sqrt() < s * 0.2 {
                col = [255.0, 92.0, 92.0];
            }
            buf[i] = col[0] as u8;
            buf[i + 1] = col[1] as u8;
            buf[i + 2] = col[2] as u8;
            buf[i + 3] = (cov * 255.0) as u8;
        }
    }
    Image::new_owned(buf, size, size)
}

fn update_tray(app: &AppHandle, db: &Db) {
    let Some(tray) = app.tray_by_id("main") else { return };
    let (today, overdue) = counts(db);
    let mut tip = format!("Ember — {today} today");
    if overdue > 0 {
        tip += &format!(", {overdue} overdue");
    }
    let _ = tray.set_tooltip(Some(tip));
    #[cfg(target_os = "macos")]
    let _ = tray.set_title(if overdue > 0 { Some(overdue.to_string()) } else { None });
    #[cfg(not(target_os = "macos"))]
    let _ = tray.set_icon(Some(make_icon(32, overdue > 0, false)));
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let quick = MenuItem::with_id(app, "quick", "Quick add…", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Ember", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Ember", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&quick, &open, &sep, &quit])?;

    let builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("Ember")
        .on_menu_event(|app, e| match e.id().as_ref() {
            "quick" => toggle_capture(app),
            "open" => show_main(app, None),
            "quit" => {
                app.state::<AppState>().quitting.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        });

    // macOS convention: click shows the menu. Windows: left-click opens, right-click menu.
    #[cfg(target_os = "macos")]
    let builder = builder.icon(make_icon(44, false, true)).icon_as_template(true).show_menu_on_left_click(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.icon(make_icon(32, false, false)).show_menu_on_left_click(false).on_tray_icon_event(|tray, e| {
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            show_main(tray.app_handle(), None);
        }
    });
    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Hotkeys + login item
// ---------------------------------------------------------------------------

fn register_hotkeys(app: &AppHandle) -> Vec<String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let s = app.state::<AppState>().db.lock().unwrap().settings.clone();
    let mut errors = Vec::new();
    for acc in [s.hotkey, s.open_hotkey] {
        if !acc.is_empty() && gs.register(acc.as_str()).is_err() {
            errors.push(acc);
        }
    }
    errors
}

fn on_hotkey(app: &AppHandle, pressed: &tauri_plugin_global_shortcut::Shortcut) {
    use tauri_plugin_global_shortcut::Shortcut;
    let s = app.state::<AppState>().db.lock().unwrap().settings.clone();
    let is = |acc: &str| acc.parse::<Shortcut>().map(|k| k.id() == pressed.id()).unwrap_or(false);
    if is(&s.hotkey) {
        toggle_capture(app);
    } else if is(&s.open_hotkey) {
        toggle_main(app);
    }
}

fn apply_login(app: &AppHandle) {
    // Dev builds would register the debug binary; test runs must not touch it at all.
    if cfg!(debug_assertions) || std::env::var("EMBER_DATA").is_ok() {
        return;
    }
    use tauri_plugin_autostart::ManagerExt;
    let want = app.state::<AppState>().db.lock().unwrap().settings.open_at_login;
    let al = app.autolaunch();
    let _ = match (want, al.is_enabled().unwrap_or(false)) {
        (true, false) => al.enable(),
        (false, true) => al.disable(),
        _ => Ok(()),
    };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri_plugin_global_shortcut::ShortcutState;

    let app = tauri::Builder::default()
        // Must be first: a second launch just focuses the running one
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app, None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        on_hotkey(app, shortcut);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let path = data_path(&handle);
            let loaded = load(&path);
            app.manage(AppState {
                db: Mutex::new(loaded.as_ref().cloned().unwrap_or_default()),
                path,
                capture_from_app: AtomicBool::new(false),
                last_alerts: Mutex::new(String::new()),
                quitting: AtomicBool::new(false),
                writable: AtomicBool::new(loaded.is_ok()),
            });
            if let Err(e) = loaded {
                // Don't run on an empty list (the first save would replace the user's
                // data): explain and quit without touching anything.
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                eprintln!("ember: {e}");
                let h = handle.clone();
                handle
                    .dialog()
                    .message(format!(
                        "{e}\n\nEmber will close without changing anything. Make sure no other program is \
                         locking the file, then start Ember again."
                    ))
                    .title("Ember can't open your data")
                    .kind(MessageDialogKind::Error)
                    .show(move |_| h.exit(1));
                return Ok(());
            }
            // The windows are `"create": false` in tauri.conf.json and built here, after
            // manage(): otherwise a fast page can call a command before AppState exists.
            for cfg in app.config().app.windows.clone() {
                tauri::WebviewWindowBuilder::from_config(&handle, &cfg)?.build()?;
            }
            build_tray(&handle)?;
            let errors = register_hotkeys(&handle);
            if !errors.is_empty() {
                eprintln!("ember: couldn't register hotkeys {errors:?}");
            }
            apply_login(&handle);
            changed(&handle);
            if !std::env::args().any(|a| a == "--hidden") {
                show_main(&handle, None);
            }

            // Reminder scheduler. Also re-broadcasts once a minute so "today" rolls over.
            std::thread::spawn(move || {
                let mut tick = 0u64;
                loop {
                    std::thread::sleep(Duration::from_secs(10));
                    check_reminders(&handle);
                    tick += 1;
                    if tick.is_multiple_of(6) {
                        changed(&handle);
                    }
                }
            });

            #[cfg(debug_assertions)]
            if std::env::var("EMBER_SELFTEST").is_ok() {
                selftest::start(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|w, e| match e {
            WindowEvent::CloseRequested { api, .. }
                if w.label() == "main" && !w.app_handle().state::<AppState>().quitting.load(Ordering::Relaxed) =>
            {
                api.prevent_close();
                let _ = w.hide();
            }
            WindowEvent::Focused(false) if w.label() == "capture" => {
                let _ = w.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            db_get,
            task_add,
            task_update,
            task_delete,
            task_restore,
            settings_set,
            hotkeys_suspend,
            open_main,
            capture_hide,
            capture_resize,
            reminder_size,
            reminder_hide,
            reminders_pull,
            selftest::selftest_report,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app, _event| {
        // Clicking the Dock icon with no visible window should bring Ember back
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            show_main(_app, None);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ember-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        // Keeps load() from looking at the real legacy locations on this machine.
        std::env::set_var("EMBER_DATA", &d);
        d
    }

    fn state(path: PathBuf, writable: bool) -> AppState {
        AppState {
            db: Mutex::new(Db::default()),
            path,
            capture_from_app: AtomicBool::new(false),
            last_alerts: Mutex::new(String::new()),
            quitting: AtomicBool::new(false),
            writable: AtomicBool::new(writable),
        }
    }

    #[test]
    fn missing_file_starts_empty() {
        let d = tmp("missing");
        assert!(load(&d.join("ember.json")).unwrap().tasks.is_empty());
    }

    #[test]
    fn unreadable_file_is_an_error_not_an_empty_db() {
        let d = tmp("unreadable");
        let path = d.join("ember.json");
        fs::create_dir_all(&path).unwrap(); // a directory can't be read as a file
        assert!(load(&path).is_err());
    }

    #[test]
    fn corrupt_file_is_set_aside() {
        let d = tmp("corrupt");
        let path = d.join("ember.json");
        fs::write(&path, "{ not json").unwrap();
        assert!(load(&path).unwrap().tasks.is_empty());
        let aside = fs::read_dir(&d).unwrap().flatten().any(|e| e.file_name().to_string_lossy().contains("corrupt-"));
        assert!(aside, "corrupt file should be copied aside");
    }

    #[test]
    fn read_only_state_never_writes() {
        let d = tmp("readonly");
        let st = state(d.join("ember.json"), false);
        save(&st, &Db::default());
        assert!(!st.path.exists());
    }

    #[test]
    fn daily_backup_holds_the_state_before_the_first_write() {
        let d = tmp("backup");
        let st = state(d.join("ember.json"), true);
        let mut db = Db::default();
        db.tasks.push(json!({ "id": "a" }).as_object().cloned().unwrap());
        save(&st, &db); // first ever save: nothing to back up yet
        db.tasks.push(json!({ "id": "b" }).as_object().cloned().unwrap());
        save(&st, &db);
        let backup = fs::read_dir(d.join("backups")).unwrap().flatten().next().unwrap().path();
        let text = fs::read_to_string(backup).unwrap();
        assert!(text.contains("\"a\"") && !text.contains("\"b\""));
    }
}
