#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod launcher;
mod lifecycle;
mod shell;
mod sidecar;

use launcher::{Launcher, Status};
use lifecycle::{CloseAction, Quitting};
use serde::Serialize;
use shell::Shell;
use sidecar::{DaemonInfo, Sidecar};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, RunEvent, State, WindowEvent};

/// Bundled `core/` resource, else the repo's `core/` (dev).
fn core_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .map(|d| d.join("core"))
        .ok()
        .filter(|d| d.join("src/cli.ts").is_file())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../core"))
}

#[tauri::command]
async fn daemon_info(app: AppHandle) -> Result<DaemonInfo, String> {
    let sidecar = app.state::<Sidecar>().inner().clone();
    let core = core_dir(&app);
    tauri::async_runtime::spawn_blocking(move || sidecar.ensure(&core))
        .await
        .map_err(|e| e.to_string())?
}

/// Where the startup screen and the ERP connector find Node and the ERP folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OsInfo {
    node: String,
    erp_dir: String,
    mcp_server: String,
}

#[tauri::command]
async fn os_info() -> Result<OsInfo, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let erp = launcher::erp_dir(&sidecar::home_dir()?);
        Ok(OsInfo {
            node: sidecar::node_runtime()?.node,
            erp_dir: erp.display().to_string(),
            mcp_server: launcher::mcp_server_path(&erp).display().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn os_status(launcher: State<Launcher>) -> Status {
    launcher.status()
}

#[tauri::command]
fn os_retry(app: AppHandle) {
    start_launcher(&app);
}

#[tauri::command]
fn os_open_docker() -> Result<(), String> {
    launcher::open_docker()
}

#[tauri::command]
fn os_toggle_panel(app: AppHandle) -> bool {
    shell::toggle_panel(&app)
}

/// (Re)start doctor -> up -> serve; the ERP opens beside the panel once the server answers.
fn start_launcher(app: &AppHandle) {
    let handle = app.clone();
    app.state::<Launcher>().start(move || shell::erp_ready(&handle));
}

fn main() {
    tauri::Builder::default()
        .manage(Sidecar::default())
        .manage(Quitting::default())
        .manage(Launcher::default())
        .manage(Shell::default())
        .on_window_event(|window, event| {
            // the close button hides the window; the daemon and schedules keep running
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let quitting = window.app_handle().state::<Quitting>().get();
                    if lifecycle::on_close_requested(quitting) == CloseAction::Hide {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                WindowEvent::Resized(_) => shell::on_resized(window),
                _ => {}
            }
        })
        .on_menu_event(|app, event| shell::on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            shell::create(app)?;
            // start the daemon at launch; the UI's first `daemon_info` call waits for the same result
            let sidecar = app.state::<Sidecar>().inner().clone();
            let core = core_dir(app.handle());
            std::thread::spawn(move || {
                let _ = sidecar.ensure(&core);
            });
            start_launcher(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![daemon_info, os_info, os_status, os_retry, os_open_docker, os_toggle_panel])
        .build(tauri::generate_context!())
        .expect("error while building BigNose OS")
        .run(|app, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                if lifecycle::on_exit_requested(app.state::<Quitting>().get()) {
                    api.prevent_exit();
                }
            }
            // a Dock click brings the hidden window back
            RunEvent::Reopen { .. } => {
                if let Some(w) = app.get_window(shell::WINDOW) {
                    if lifecycle::on_reopen(w.is_visible().unwrap_or(false)) {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
            // Cmd+Q and the Quit menu item end here: stop every child this run started
            RunEvent::Exit => {
                let launcher = app.state::<Launcher>();
                let sidecar = app.state::<Sidecar>();
                for child in lifecycle::children_to_stop(launcher.running(), sidecar.spawned()) {
                    match child {
                        lifecycle::Child::ErpLauncher => launcher.stop(),
                        lifecycle::Child::Daemon => sidecar.stop(),
                    }
                }
                launcher.stop(); // also retires a run that is still between steps
            }
            _ => {}
        });
}
