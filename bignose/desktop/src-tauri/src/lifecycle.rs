// Window and process lifecycle decisions (fixes shell-01). Pure: no window or app handle, so they are unit-tested.
// Closing the window only hides it, so the daemon, the ERP server, LINE and schedules keep running.
// Only an explicit quit (Cmd+Q or the Quit menu item) stops what the app started.
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum CloseAction {
    Hide,
    Close,
}

/// The close button, Cmd+W and the red traffic light hide the window; they never end the app.
pub fn on_close_requested(quitting: bool) -> CloseAction {
    if quitting { CloseAction::Close } else { CloseAction::Hide }
}

/// An exit request that no quit asked for (for example the last window going away) is refused.
pub fn on_exit_requested(quitting: bool) -> bool {
    !quitting
}

/// A Dock click brings the window back when it is not already on screen.
pub fn on_reopen(window_visible: bool) -> bool {
    !window_visible
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Child {
    ErpLauncher,
    Daemon,
}

/// Children this run started, in stop order: the ERP launcher (it owns the Next server), then the daemon.
/// A daemon the app only attached to, and the Supabase stack, are not ours to stop.
pub fn children_to_stop(erp_launcher_started: bool, daemon_spawned: bool) -> Vec<Child> {
    let mut stop = Vec::new();
    if erp_launcher_started {
        stop.push(Child::ErpLauncher);
    }
    if daemon_spawned {
        stop.push(Child::Daemon);
    }
    stop
}

/// Set once a quit was asked for, so the close and exit guards let it through.
#[derive(Default)]
pub struct Quitting(AtomicBool);

impl Quitting {
    pub fn set(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn get(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn close_request_hides_the_window() {
        assert_eq!(on_close_requested(false), CloseAction::Hide);
        assert_eq!(on_close_requested(true), CloseAction::Close);
    }

    #[test]
    fn exit_request_is_prevented_unless_quitting() {
        assert!(on_exit_requested(false));
        assert!(!on_exit_requested(true));
    }

    #[test]
    fn quit_stops_children_the_app_started() {
        assert_eq!(children_to_stop(true, true), vec![Child::ErpLauncher, Child::Daemon]);
        assert_eq!(children_to_stop(true, false), vec![Child::ErpLauncher]);
        // a daemon we only attached to keeps running
        assert_eq!(children_to_stop(false, false), vec![]);
    }

    #[test]
    fn dock_click_shows_a_hidden_window_only() {
        assert!(on_reopen(false));
        assert!(!on_reopen(true));
    }

    #[test]
    fn quitting_flag_is_sticky() {
        let q = Quitting::default();
        assert!(!q.get());
        q.set();
        assert!(q.get());
    }
}
