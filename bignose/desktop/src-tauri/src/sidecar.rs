// Starts or attaches to the BigNose daemon. Std only: a raw TcpStream is enough for the health probe.
use serde::Serialize;
use std::fs::{DirBuilder, OpenOptions};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_PORT: u16 = 47821;
const START_TIMEOUT: Duration = Duration::from_secs(15);
const MIN_NODE_MAJOR: u32 = 24;

#[derive(Serialize, Clone)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
    pub spawned: bool,
}

#[derive(Default)]
struct Shared {
    gate: Mutex<()>,            // one start/attach at a time
    child: Mutex<Option<Child>>, // only a daemon this app spawned
}

#[derive(Clone, Default)]
pub struct Sidecar(Arc<Shared>);

impl Sidecar {
    /// Attach to a healthy daemon, else spawn one and wait for it. Safe to call again after an error.
    pub fn ensure(&self, core: &Path) -> Result<DaemonInfo, String> {
        let _gate = self.0.gate.lock().map_err(|_| "internal lock error".to_string())?;
        let home = home_dir()?;
        if let Some(info) = self.probe(&home) {
            return Ok(info);
        }
        if !self.child_alive() {
            let child = spawn_daemon(&home, core)?;
            *self.0.child.lock().map_err(|_| "internal lock error".to_string())? = Some(child);
        }
        let deadline = Instant::now() + START_TIMEOUT;
        while Instant::now() < deadline {
            if let Some(info) = self.probe(&home) {
                return Ok(info);
            }
            if !self.child_alive() {
                return Err(format!(
                    "The BigNose daemon exited during start. See {}",
                    home.join("logs/daemon.log").display()
                ));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Err(format!(
            "The BigNose daemon did not answer within {} s. See {}",
            START_TIMEOUT.as_secs(),
            home.join("logs/daemon.log").display()
        ))
    }

    /// True while a daemon this app spawned is running.
    pub fn spawned(&self) -> bool {
        self.child_alive()
    }

    /// Stop the daemon only if this app spawned it.
    pub fn stop(&self) {
        let child = self.0.child.lock().ok().and_then(|mut c| c.take());
        if let Some(mut c) = child {
            terminate(&mut c);
        }
    }

    fn child_alive(&self) -> bool {
        match self.0.child.lock() {
            Ok(mut g) => match g.as_mut() {
                Some(c) => matches!(c.try_wait(), Ok(None)),
                None => false,
            },
            Err(_) => false,
        }
    }

    fn probe(&self, home: &Path) -> Option<DaemonInfo> {
        let token = read_token(home)?;
        let port = port_for(home);
        if !health(port, &token) {
            return None;
        }
        Some(DaemonInfo { port, token, spawned: self.child_alive() })
    }
}

fn home_dir() -> Result<PathBuf, String> {
    if let Some(h) = std::env::var_os("BIGNOSE_HOME").filter(|h| !h.is_empty()) {
        return Ok(PathBuf::from(h));
    }
    let user = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(user).join(".bignose"))
}

fn read_token(home: &Path) -> Option<String> {
    let token = std::fs::read_to_string(home.join("api-token")).ok()?.trim().to_string();
    // the token goes into a header: refuse anything that is not plain alphanumerics
    (!token.is_empty() && token.chars().all(|c| c.is_ascii_alphanumeric())).then_some(token)
}

fn read_json(file: PathBuf) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(file).ok()?).ok()
}

/// `daemon.json` port, else config `api.port`, else 47821.
fn port_for(home: &Path) -> u16 {
    let from_daemon = read_json(home.join("daemon.json")).and_then(|v| v["port"].as_u64());
    let from_config = || read_json(home.join("config.json")).and_then(|v| v["api"]["port"].as_u64());
    from_daemon
        .or_else(from_config)
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p > 0)
        .unwrap_or(DEFAULT_PORT)
}

/// Raw `GET /api/health` with the bearer token; true only for a 200.
fn health(port: u16, token: &str) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(2)));
    let req = format!(
        "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n"
    );
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut status = [0u8; 12];
    s.read_exact(&mut status).is_ok() && &status == b"HTTP/1.1 200"
}

struct Shell {
    path: Option<String>,
    node: Option<String>,
}

/// One login-shell probe gives both PATH and `node` (a Finder launch has neither).
fn login_shell() -> Shell {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out = Command::new("/bin/zsh")
            .args(["-lc", r#"printf 'BN_PATH=%s\nBN_NODE=%s\n' "$PATH" "$(command -v node)""#])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(out);
    });
    let mut shell = Shell { path: None, node: None };
    // a hung rc file must not hang the app
    if let Ok(Ok(out)) = rx.recv_timeout(Duration::from_secs(5)) {
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(p) = line.strip_prefix("BN_PATH=") {
                shell.path = Some(p.to_string()).filter(|p| !p.is_empty());
            } else if let Some(n) = line.strip_prefix("BN_NODE=") {
                shell.node = Some(n.to_string()).filter(|n| n.starts_with('/'));
            }
        }
    }
    shell
}

fn node_major(node: &str) -> Option<u32> {
    let out = Command::new(node).arg("--version").stdin(Stdio::null()).output().ok()?;
    let v = String::from_utf8_lossy(&out.stdout);
    v.trim().strip_prefix('v')?.split('.').next()?.parse().ok()
}

/// BIGNOSE_NODE, then the login shell's node, then Homebrew; must be >= 24.
fn find_node(shell: &Shell) -> Result<String, String> {
    let mut candidates: Vec<String> = Vec::new();
    candidates.extend(std::env::var("BIGNOSE_NODE").ok().filter(|n| !n.is_empty()));
    candidates.extend(shell.node.clone());
    candidates.push("/opt/homebrew/bin/node".into());
    candidates.push("/usr/local/bin/node".into());
    let mut tried: Vec<String> = Vec::new();
    let mut too_old: Vec<String> = Vec::new();
    for c in candidates {
        if tried.contains(&c) {
            continue;
        }
        match node_major(&c) {
            Some(m) if m >= MIN_NODE_MAJOR => return Ok(c),
            Some(m) => too_old.push(format!("Node {m} at {c}")),
            None => {}
        }
        tried.push(c);
    }
    let found = if too_old.is_empty() { String::new() } else { format!(" Found: {}.", too_old.join(", ")) };
    Err(format!(
        "Node {MIN_NODE_MAJOR} or newer is required. Install it, or set BIGNOSE_NODE to its path.{found}"
    ))
}

fn spawn_daemon(home: &Path, core: &Path) -> Result<Child, String> {
    let cli = core.join("src/cli.ts");
    if !cli.is_file() {
        return Err(format!("BigNose core not found at {}", cli.display()));
    }
    let shell = login_shell();
    let node = find_node(&shell)?;
    let node_dir = Path::new(&node).parent().map(|p| p.display().to_string()).unwrap_or_default();
    let base = shell
        .path
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_else(|| "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin".into());
    let path = format!("{node_dir}:{base}");

    let logs = home.join("logs");
    DirBuilder::new().recursive(true).mode(0o700).create(&logs).map_err(|e| format!("Cannot create {}: {e}", logs.display()))?;
    let log_file = logs.join("daemon.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&log_file)
        .map_err(|e| format!("Cannot open {}: {e}", log_file.display()))?;
    let err = log.try_clone().map_err(|e| e.to_string())?;
    Command::new(&node)
        .arg(&cli)
        .arg("daemon")
        .env("PATH", path)
        .current_dir(home)
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(err)
        .spawn()
        .map_err(|e| format!("Cannot start {node}: {e}"))
}

/// SIGTERM so the daemon shuts down cleanly; SIGKILL after 2 s.
fn terminate(child: &mut Child) {
    let _ = Command::new("kill").arg("-TERM").arg(child.id().to_string()).status();
    for _ in 0..20 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}
