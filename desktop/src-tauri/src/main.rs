#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::{DaemonInfo, Sidecar};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, RunEvent};

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
        .expect("error while building BigNose")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Sidecar>().stop();
            }
        });
}
