#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lifecycle;
mod sidecar;

use lifecycle::{CloseAction, Quitting};
use sidecar::{DaemonInfo, Sidecar};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

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

fn main() {
    tauri::Builder::default()
        .manage(Sidecar::default())
        .manage(Quitting::default())
        .on_window_event(|window, event| {
            // the close button hides the window; the daemon and schedules keep running
            if let WindowEvent::CloseRequested { api, .. } = event {
                let quitting = window.app_handle().state::<Quitting>().get();
                if lifecycle::on_close_requested(quitting) == CloseAction::Hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // start the daemon at launch; the UI's first `daemon_info` call waits for the same result
            let sidecar = app.state::<Sidecar>().inner().clone();
            let core = core_dir(app.handle());
            std::thread::spawn(move || {
                let _ = sidecar.ensure(&core);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![daemon_info])
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
                if let Some(w) = app.get_webview_window("main") {
                    if lifecycle::on_reopen(w.is_visible().unwrap_or(false)) {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            }
            // Cmd+Q and the Quit menu item end here: stop every child this run started
            RunEvent::Exit => {
                for child in lifecycle::children_to_stop(false, app.state::<Sidecar>().spawned()) {
                    match child {
                        lifecycle::Child::Daemon => app.state::<Sidecar>().stop(),
                        lifecycle::Child::ErpLauncher => {}
                    }
                }
            }
            _ => {}
        });
}
