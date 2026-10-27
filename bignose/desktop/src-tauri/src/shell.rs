// The one native window: the ERP as a top-level webview and the BigNose panel docked on its right.
// Both are Tauri multiwebview children of the same window ("unstable" feature). The ERP is a plain first-party page at
// http://127.0.0.1:3100 (so Supabase cookies work) and has no IPC capability; the panel is the BigNose UI (desktop/src).
// Layout, toggle state, the View menu and the link policy are pure and unit-tested.
use crate::launcher::{erp_url, ERP_PORT};
use crate::lifecycle::Quitting;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::window::WindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Url, WebviewUrl, Window, Wry};

pub const WINDOW: &str = "main";
pub const ERP: &str = "erp";
pub const PANEL: &str = "panel";
pub const PANEL_OPEN_W: f64 = 420.0;
/// Closed, the panel is a slim rail that still shows the toggle button.
pub const PANEL_RAIL_W: f64 = 40.0;
const MIN_ERP_W: f64 = 360.0;
const SLIDE_STEPS: usize = 8;

// ---- layout (logical pixels)

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Layout {
    /// None until the ERP answers: the panel then fills the window and shows the startup screen.
    pub erp: Option<Frame>,
    pub panel: Frame,
}

/// The panel docks on the right with `panel_w`; the ERP gets the rest. A narrow window keeps the ERP usable.
pub fn layout(win_w: f64, win_h: f64, panel_w: Option<f64>) -> Layout {
    let Some(pw) = panel_w else {
        return Layout { erp: None, panel: Frame { x: 0.0, y: 0.0, w: win_w, h: win_h } };
    };
    let pw = pw.min((win_w - MIN_ERP_W).max(PANEL_RAIL_W)).max(PANEL_RAIL_W).min(win_w);
    Layout {
        erp: Some(Frame { x: 0.0, y: 0.0, w: win_w - pw, h: win_h }),
        panel: Frame { x: win_w - pw, y: 0.0, w: pw, h: win_h },
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Dock {
    /// Starting up: no ERP yet, the panel is the whole window.
    Full,
    Open,
    Rail,
}

impl Dock {
    pub fn toggle(self) -> Dock {
        match self {
            Dock::Full => Dock::Full,
            Dock::Open => Dock::Rail,
            Dock::Rail => Dock::Open,
        }
    }
    pub fn panel_width(self) -> Option<f64> {
        match self {
            Dock::Full => None,
            Dock::Open => Some(PANEL_OPEN_W),
            Dock::Rail => Some(PANEL_RAIL_W),
        }
    }
}

/// Eased widths from `from` to `to`, ending exactly on `to`.
pub fn slide_frames(from: f64, to: f64, steps: usize) -> Vec<f64> {
    (1..=steps)
        .map(|i| {
            let t = i as f64 / steps as f64;
            let eased = 1.0 - (1.0 - t).powi(3);
            if i == steps { to } else { from + (to - from) * eased }
        })
        .collect()
}

// ---- the ERP webview

pub struct WebviewSpec {
    pub label: &'static str,
    pub url: String,
}

/// The primary content: the ERP, served on loopback. No capability names its label (see capabilities/), so it has no IPC.
pub fn main_webview() -> WebviewSpec {
    WebviewSpec { label: ERP, url: erp_url() }
}

/// The ERP stays in-app; a link to anywhere else opens in the default browser instead of replacing the ERP.
pub fn is_erp_origin(url: &Url) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1") && url.port() == Some(ERP_PORT)
}

fn open_in_browser(url: &Url) {
    let _ = std::process::Command::new("open").arg(url.as_str()).spawn(); // fixed argv, no shell
}

fn allow_navigation(url: &Url) -> bool {
    if is_erp_origin(url) || url.as_str() == "about:blank" {
        return true;
    }
    if matches!(url.scheme(), "http" | "https") {
        open_in_browser(url);
    }
    false
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum NewWindow {
    /// An ERP page (quote and invoice PDF, print view) opens in its own window, with the ERP's session cookie.
    InApp,
    Browser,
    Deny,
}

/// `target="_blank"` and `window.open`: only the ERP itself opens in the app; other web links go to the browser.
pub fn new_window_action(url: &Url) -> NewWindow {
    if is_erp_origin(url) {
        NewWindow::InApp
    } else if matches!(url.scheme(), "http" | "https") {
        NewWindow::Browser
    } else {
        NewWindow::Deny
    }
}

fn allow_new_window(url: Url) -> NewWindowResponse<Wry> {
    match new_window_action(&url) {
        // WebKit gives the new window the same configuration, so it shares the ERP webview's cookies
        NewWindow::InApp => NewWindowResponse::Allow,
        NewWindow::Browser => {
            open_in_browser(&url);
            NewWindowResponse::Deny
        }
        NewWindow::Deny => NewWindowResponse::Deny,
    }
}

// ---- menu

pub struct MenuItemSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub accelerator: &'static str,
}

pub const TOGGLE_PANEL: MenuItemSpec = MenuItemSpec { id: "toggle_panel", label: "Toggle BigNose Panel", accelerator: "CmdOrCtrl+J" };
pub const QUIT: MenuItemSpec = MenuItemSpec { id: "quit", label: "Quit BoomBigNose", accelerator: "CmdOrCtrl+Q" };

pub fn view_menu_items() -> Vec<&'static MenuItemSpec> {
    vec![&TOGGLE_PANEL]
}

fn item(app: &AppHandle, spec: &MenuItemSpec) -> tauri::Result<tauri::menu::MenuItem<Wry>> {
    MenuItemBuilder::with_id(spec.id, spec.label).accelerator(spec.accelerator).build(app)
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = SubmenuBuilder::new(app, "BoomBigNose")
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item(app, &QUIT)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let mut view = SubmenuBuilder::new(app, "View");
    for spec in view_menu_items() {
        view = view.item(&item(app, spec)?);
    }
    let view = view.separator().fullscreen().build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().close_window().build()?;
    Menu::with_items(app, &[&app_menu, &edit, &view, &window])
}

pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        i if i == TOGGLE_PANEL.id => {
            toggle_panel(app);
        }
        i if i == QUIT.id => {
            app.state::<Quitting>().set();
            app.exit(0);
        }
        _ => {}
    }
}

// ---- window and webviews

pub struct Shell {
    dock: Mutex<Dock>,
    slide: AtomicU64, // a newer toggle retires an older slide
}

impl Default for Shell {
    fn default() -> Self {
        Shell { dock: Mutex::new(Dock::Full), slide: AtomicU64::new(0) }
    }
}

fn frame_rect(f: Frame) -> Rect {
    Rect { position: LogicalPosition::new(f.x, f.y).into(), size: LogicalSize::new(f.w, f.h).into() }
}

fn logical_size(window: &Window) -> Option<(f64, f64)> {
    let size = window.inner_size().ok()?.to_logical::<f64>(window.scale_factor().ok()?);
    Some((size.width, size.height))
}

fn apply(window: &Window, panel_w: Option<f64>) {
    let Some((w, h)) = logical_size(window) else { return };
    let l = layout(w, h, panel_w);
    if let Some(panel) = window.get_webview(PANEL) {
        let _ = panel.set_bounds(frame_rect(l.panel));
    }
    if let (Some(erp), Some(f)) = (window.get_webview(ERP), l.erp) {
        let _ = erp.set_bounds(frame_rect(f));
    }
}

fn dock(app: &AppHandle) -> Dock {
    app.state::<Shell>().dock.lock().map(|d| *d).unwrap_or(Dock::Full)
}

/// Called at startup: the window with the BigNose UI filling it (startup screen), and the menu.
pub fn create(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();
    app.set_menu(build_menu(handle)?)?;
    let config = handle.config().app.windows.iter().find(|w| w.label == WINDOW).cloned().expect("window config");
    let window = WindowBuilder::from_config(handle, &config)?.build()?;
    let (w, h) = logical_size(&window).unwrap_or((config.width, config.height));
    // `__BIGNOSE_OS__` tells the UI it runs as the panel of BoomBigNose
    let panel = WebviewBuilder::new(PANEL, WebviewUrl::App("index.html".into())).initialization_script("window.__BIGNOSE_OS__ = true;");
    window.add_child(panel, LogicalPosition::new(0.0, 0.0), LogicalSize::new(w, h))?;
    Ok(())
}

/// The ERP answered: dock the panel on the right and open the ERP in the space that frees up (or reload it).
pub fn erp_ready(app: &AppHandle) {
    let Some(window) = app.get_window(WINDOW) else { return };
    if let Some(erp) = window.get_webview(ERP) {
        let _ = erp.reload();
        return;
    }
    if let Ok(mut d) = app.state::<Shell>().dock.lock() {
        *d = Dock::Open;
    }
    apply(&window, Some(PANEL_OPEN_W));
    let Some((w, h)) = logical_size(&window) else { return };
    let Some(f) = layout(w, h, Some(PANEL_OPEN_W)).erp else { return };
    let spec = main_webview();
    let Ok(url) = Url::parse(&spec.url) else { return };
    let erp = WebviewBuilder::new(spec.label, WebviewUrl::External(url)).on_navigation(allow_navigation).on_new_window(|url, _| allow_new_window(url));
    if let Err(e) = window.add_child(erp, LogicalPosition::new(f.x, f.y), LogicalSize::new(f.w, f.h)) {
        eprintln!("cannot open the ERP webview: {e}");
    }
}

/// Slide the panel in or out. Returns whether it is now open.
pub fn toggle_panel(app: &AppHandle) -> bool {
    let shell = app.state::<Shell>();
    let (from, to) = match shell.dock.lock() {
        Ok(mut d) => {
            let from = *d;
            *d = d.toggle();
            (from, *d)
        }
        Err(_) => return false,
    };
    if let (Some(from_w), Some(to_w), Some(window)) = (from.panel_width(), to.panel_width(), app.get_window(WINDOW)) {
        let id = shell.slide.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            for w in slide_frames(from_w, to_w, SLIDE_STEPS) {
                if app.state::<Shell>().slide.load(Ordering::SeqCst) != id {
                    return;
                }
                apply(&window, Some(w));
                std::thread::sleep(Duration::from_millis(16));
            }
        });
    }
    to == Dock::Open
}

pub fn on_resized(window: &Window) {
    apply(window, dock(window.app_handle()).panel_width());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_toggle_shows_and_hides_the_panel() {
        // startup: the panel is the whole window and the toggle does nothing yet
        assert_eq!(Dock::Full.toggle(), Dock::Full);
        let full = layout(1180.0, 780.0, Dock::Full.panel_width());
        assert_eq!(full.erp, None);
        assert_eq!(full.panel, Frame { x: 0.0, y: 0.0, w: 1180.0, h: 780.0 });
        // open: 420 px docked on the right, the ERP gets the rest
        let open = layout(1180.0, 780.0, Dock::Open.panel_width());
        assert_eq!(open.panel, Frame { x: 760.0, y: 0.0, w: 420.0, h: 780.0 });
        assert_eq!(open.erp, Some(Frame { x: 0.0, y: 0.0, w: 760.0, h: 780.0 }));
        // toggled: only the rail with the toggle button stays, the ERP takes the room
        let closed = Dock::Open.toggle();
        assert_eq!(closed, Dock::Rail);
        let rail = layout(1180.0, 780.0, closed.panel_width());
        assert_eq!(rail.panel, Frame { x: 1140.0, y: 0.0, w: PANEL_RAIL_W, h: 780.0 });
        assert_eq!(rail.erp, Some(Frame { x: 0.0, y: 0.0, w: 1140.0, h: 780.0 }));
        assert_eq!(closed.toggle(), Dock::Open);
    }

    #[test]
    fn a_narrow_window_keeps_the_erp_usable() {
        let l = layout(820.0, 540.0, Some(PANEL_OPEN_W));
        assert_eq!(l.panel.w, PANEL_OPEN_W);
        assert!(l.erp.unwrap().w >= MIN_ERP_W);
        let tiny = layout(300.0, 300.0, Some(PANEL_OPEN_W));
        assert!(tiny.panel.w <= 300.0 && tiny.panel.w >= PANEL_RAIL_W);
        assert_eq!(tiny.panel.x + tiny.panel.w, 300.0);
    }

    #[test]
    fn the_slide_ends_exactly_on_the_target() {
        let up = slide_frames(PANEL_RAIL_W, PANEL_OPEN_W, SLIDE_STEPS);
        assert_eq!(up.len(), SLIDE_STEPS);
        assert_eq!(up.last().copied(), Some(PANEL_OPEN_W));
        assert!(up.windows(2).all(|p| p[0] < p[1]));
        let down = slide_frames(PANEL_OPEN_W, PANEL_RAIL_W, SLIDE_STEPS);
        assert_eq!(down.last().copied(), Some(PANEL_RAIL_W));
        assert!(down.windows(2).all(|p| p[0] > p[1]));
    }

    #[test]
    fn main_webview_is_the_erp_on_127_0_0_1_3100() {
        let spec = main_webview();
        assert_eq!((spec.label, spec.url.as_str()), ("erp", "http://127.0.0.1:3100"));
        assert!(is_erp_origin(&Url::parse(&spec.url).unwrap()));
    }

    #[test]
    fn links_to_other_sites_do_not_take_over_the_erp_window() {
        let erp = |s: &str| is_erp_origin(&Url::parse(s).unwrap());
        assert!(erp("http://127.0.0.1:3100/dashboard?x=1"));
        assert!(!erp("http://127.0.0.1:3101/"));
        assert!(!erp("https://127.0.0.1:3100/"));
        assert!(!erp("http://localhost:3100/"));
        assert!(!erp("http://127.0.0.1.evil.example:3100/"));
    }

    #[test]
    fn new_windows_open_in_app_for_the_erp_and_in_the_browser_for_other_web_links() {
        let action = |s: &str| new_window_action(&Url::parse(s).unwrap());
        assert_eq!(action("http://127.0.0.1:3100/quotes/abc/pdf"), NewWindow::InApp);
        assert_eq!(action("http://127.0.0.1:3100/reports/print"), NewWindow::InApp);
        assert_eq!(action("https://example.com/docs"), NewWindow::Browser);
        assert_eq!(action("http://localhost:3100/"), NewWindow::Browser);
        assert_eq!(action("http://127.0.0.1:3101/"), NewWindow::Browser);
        assert_eq!(action("file:///etc/passwd"), NewWindow::Deny);
        assert_eq!(action("tauri://localhost/index.html"), NewWindow::Deny);
        assert_eq!(action("about:blank"), NewWindow::Deny);
        assert_eq!(action("javascript:alert(1)"), NewWindow::Deny);
    }

    #[test]
    fn view_menu_has_the_panel_toggle_with_a_shortcut() {
        let items = view_menu_items();
        let toggle = items.iter().find(|i| i.id == "toggle_panel").expect("the View menu has the panel toggle");
        assert_eq!(toggle.label, "Toggle BigNose Panel");
        // a shortcut: known modifiers, then one key
        let parts: Vec<&str> = toggle.accelerator.split('+').collect();
        let (key, mods) = parts.split_last().unwrap();
        assert!(!key.is_empty() && !mods.is_empty());
        assert!(mods.iter().all(|m| ["CmdOrCtrl", "Cmd", "Ctrl", "Alt", "Shift"].contains(m)), "{}", toggle.accelerator);
        // and it does not shadow the quit shortcut
        assert_ne!(toggle.accelerator, QUIT.accelerator);
    }
}
