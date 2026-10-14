// Starts the ERP for BigNose OS: finds the ERP folder, then runs `node <erp>/scripts/local/stack.mjs doctor|up|serve`
// as managed children (stream local-supabase) and publishes progress for the startup screen.
// The pure parts (folder choice, .env key, status, commands) are unit-tested; the child handling is tested against
// a fake stack.mjs.
use crate::sidecar::{home_dir, node_runtime, NodeRuntime};
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{DirBuilder, File, OpenOptions};
use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

pub const ERP_PORT: u16 = 3100;
const STACK_SCRIPT: &str = "scripts/local/stack.mjs";
const MCP_SCRIPT: &str = "lib/mcp/erp-server.mjs";
const TAIL_LINES: usize = 12;

/// The ERP's address; matches `site_url` in the ERP's supabase/config.toml.
pub fn erp_url() -> String {
    format!("http://127.0.0.1:{ERP_PORT}")
}

// ---- status shown by the startup screen

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "phase", rename_all = "kebab-case")]
pub enum Status {
    Starting { step: &'static str, detail: Option<String> },
    DockerStopped { installed: bool },
    Failed { title: String, message: String },
    Ready { url: String },
}

impl Default for Status {
    fn default() -> Self {
        Status::Starting { step: "check", detail: None }
    }
}

#[derive(Debug, PartialEq, Clone)]
pub struct Failure {
    pub title: String,
    pub message: String,
}

impl From<Failure> for Status {
    fn from(f: Failure) -> Self {
        Status::Failed { title: f.title, message: f.message }
    }
}

// ---- where the ERP lives

fn compiled_root() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    root.canonicalize().unwrap_or(root)
}

/// `erpDir` in os.json, else BIGNOSE_OS_ERP_DIR, else the repo this app was built from.
pub fn erp_dir_from(os_json: Option<&str>, env_dir: Option<&str>, compiled: &Path) -> PathBuf {
    let from_json = os_json
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
        .and_then(|v| v["erpDir"].as_str().map(str::to_string));
    let chosen = [from_json.as_deref(), env_dir].into_iter().flatten().map(str::trim).find(|s| !s.is_empty()).map(PathBuf::from);
    chosen.unwrap_or_else(|| compiled.to_path_buf())
}

pub fn erp_dir(home: &Path) -> PathBuf {
    let os_json = std::fs::read_to_string(home.join("os.json")).ok();
    let env_dir = std::env::var("BIGNOSE_OS_ERP_DIR").ok();
    erp_dir_from(os_json.as_deref(), env_dir.as_deref(), &compiled_root())
}

pub fn mcp_server_path(erp: &Path) -> PathBuf {
    erp.join(MCP_SCRIPT)
}

fn permission_failure(dir: &Path, home: &Path, detail: &str) -> Failure {
    Failure {
        title: "macOS is blocking access to the ERP folder".into(),
        message: format!(
            "macOS did not let BigNose OS read {} ({detail}). Allow access to your Desktop folder: System Settings > \
             Privacy & Security > Files & Folders (or Full Disk Access), turn on BigNose OS, then press Retry. \
             Or keep the ERP somewhere else and set \"erpDir\" in {}.",
            dir.display(),
            home.join("os.json").display()
        ),
    }
}

fn missing_failure(dir: &Path, home: &Path) -> Failure {
    Failure {
        title: "ERP folder not found".into(),
        message: format!(
            "BigNose OS could not find {STACK_SCRIPT} in {}. Point it at your boombignose-erp folder: set \"erpDir\" in {} \
             or set BIGNOSE_OS_ERP_DIR, then press Retry.",
            dir.display(),
            home.join("os.json").display()
        ),
    }
}

/// EPERM (macOS folder privacy under ~/Desktop) is told apart from a folder that is simply missing.
pub fn check_erp_dir(dir: &Path, home: &Path) -> Result<(), Failure> {
    match std::fs::metadata(dir.join(STACK_SCRIPT)) {
        Ok(m) if m.is_file() => Ok(()),
        Ok(_) => Err(missing_failure(dir, home)),
        Err(e) if e.kind() == ErrorKind::NotFound => Err(missing_failure(dir, home)),
        Err(e) => Err(permission_failure(dir, home, &e.to_string())),
    }
}

/// A failed child that mentions EPERM is the same privacy block, seen from inside Node.
fn failure_from_output(title: &str, tail: &[String], dir: &Path, home: &Path) -> Failure {
    let text = tail.join("\n");
    if text.contains("EPERM") || text.to_lowercase().contains("operation not permitted") {
        return permission_failure(dir, home, "operation not permitted");
    }
    let message = if text.trim().is_empty() { "No output. See the ERP log in the BigNose home folder.".into() } else { text };
    Failure { title: title.into(), message }
}

// ---- the OpenRouter key

/// Reads `NAME=value` lines the way the daemon's own .env reader does: last one wins, matching quotes are removed.
pub fn read_env_key(text: &str, key: &str) -> Option<String> {
    let mut found = None;
    for line in text.lines() {
        let Some((name, value)) = line.split_once('=') else { continue };
        if name != key {
            continue;
        }
        let mut v = value.trim();
        let b = v.as_bytes();
        if b.len() >= 2 && (b[0] == b'"' || b[0] == b'\'') && b[b.len() - 1] == b[0] {
            v = &v[1..v.len() - 1];
        }
        found = Some(v.to_string()).filter(|v| !v.is_empty());
    }
    found
}

fn openrouter_key(home: &Path) -> Option<String> {
    read_env_key(&std::fs::read_to_string(home.join(".env")).ok()?, "OPENROUTER_API_KEY")
}

// ---- commands

/// `scripts/local/stack.mjs serve --port 3100 --cache-dir <home>/erp`, after the script path.
pub fn serve_args(port: u16, home: &Path) -> Vec<String> {
    vec!["serve".into(), "--port".into(), port.to_string(), "--cache-dir".into(), home.join("erp").display().to_string()]
}

#[derive(Clone)]
pub struct Plan {
    pub node: String,
    pub path: String,
    pub erp_dir: PathBuf,
    pub home: PathBuf,
    pub port: u16,
    /// Passed to the ERP server through its environment only; never logged.
    pub openrouter_key: Option<String>,
}

impl Plan {
    pub fn resolve() -> Result<Plan, Failure> {
        let home = home_dir().map_err(|e| Failure { title: "BigNose home not found".into(), message: e })?;
        let erp_dir = erp_dir(&home);
        check_erp_dir(&erp_dir, &home)?;
        let NodeRuntime { node, path } = node_runtime().map_err(|e| Failure { title: "Node is required".into(), message: e })?;
        let openrouter_key = openrouter_key(&home);
        Ok(Plan { node, path, erp_dir, home, port: ERP_PORT, openrouter_key })
    }

    fn command(&self, args: &[String]) -> Command {
        let mut cmd = Command::new(&self.node);
        cmd.arg(self.erp_dir.join(STACK_SCRIPT)).args(args).current_dir(&self.erp_dir).env("PATH", &self.path);
        cmd
    }
}

/// `docker` field of `stack.mjs doctor`: "running", "stopped" or "missing".
fn docker_state(lines: &[String]) -> Option<String> {
    lines.iter().find_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()?["docker"].as_str().map(str::to_string))
}

/// SIGTERM to the whole group (stack.mjs and the Next server under it), SIGKILL after 3 s.
fn terminate_group(child: &mut Child) {
    let group = format!("-{}", child.id());
    let _ = Command::new("kill").args(["-TERM", "--", &group]).status();
    for _ in 0..30 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = Command::new("kill").args(["-KILL", "--", &group]).status();
    let _ = child.kill();
    let _ = child.wait();
}

fn open_log(home: &Path) -> Option<File> {
    let dir = home.join("logs");
    DirBuilder::new().recursive(true).mode(0o700).create(&dir).ok()?;
    OpenOptions::new().create(true).append(true).mode(0o600).open(dir.join("erp.log")).ok()
}

// ---- the launcher

#[derive(Default)]
struct Inner {
    status: Mutex<Status>,
    generation: AtomicU64,           // a newer start() or stop() retires an older run
    child: Mutex<Option<(u64, Child)>>, // the one stack.mjs child that belongs to a run
}

#[derive(Clone, Default)]
pub struct Launcher(Arc<Inner>);

struct Outcome {
    code: Option<i32>,
    tail: Vec<String>,
}

type OnReady = Arc<dyn Fn() + Send + Sync>;

impl Launcher {
    pub fn status(&self) -> Status {
        self.0.status.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// True while a stack.mjs child this app started is running.
    pub fn running(&self) -> bool {
        match self.0.child.lock() {
            Ok(mut g) => g.as_mut().is_some_and(|(_, c)| matches!(c.try_wait(), Ok(None))),
            Err(_) => false,
        }
    }

    /// Start (or restart) the whole sequence; `on_ready` runs once the ERP answers.
    pub fn start(&self, on_ready: impl Fn() + Send + Sync + 'static) {
        self.start_with(Plan::resolve, Arc::new(on_ready));
    }

    fn start_with(&self, plan: impl FnOnce() -> Result<Plan, Failure> + Send + 'static, on_ready: OnReady) {
        self.stop();
        let gen = self.0.generation.load(Ordering::SeqCst);
        self.set(gen, Status::default());
        let me = self.clone();
        std::thread::spawn(move || match plan() {
            Ok(plan) => me.sequence(gen, &plan, &on_ready),
            Err(f) => me.set(gen, f.into()),
        });
    }

    /// Retire the current run and stop its child (and the Next server under it).
    pub fn stop(&self) {
        self.0.generation.fetch_add(1, Ordering::SeqCst);
        let taken = self.0.child.lock().ok().and_then(|mut c| c.take());
        if let Some((_, mut c)) = taken {
            terminate_group(&mut c);
        }
    }

    fn current(&self, gen: u64) -> bool {
        self.0.generation.load(Ordering::SeqCst) == gen
    }

    fn set(&self, gen: u64, status: Status) {
        if self.current(gen) {
            if let Ok(mut s) = self.0.status.lock() {
                *s = status;
            }
        }
    }

    fn sequence(&self, gen: u64, plan: &Plan, on_ready: &OnReady) {
        let mut log = open_log(&plan.home);
        let fail = |title: &str, out: &Outcome| self.set(gen, failure_from_output(title, &out.tail, &plan.erp_dir, &plan.home).into());

        // 1. Docker
        self.set(gen, Status::Starting { step: "docker", detail: None });
        let mut doctor: Vec<String> = Vec::new();
        let out = match self.run_child(gen, plan.command(&["doctor".into()]), &mut log, |l| doctor.push(l.to_string())) {
            Ok(o) => o,
            Err(e) => return self.set(gen, Failure { title: "The ERP launcher did not start".into(), message: e }.into()),
        };
        if !self.current(gen) {
            return;
        }
        match (out.code, docker_state(&doctor).as_deref()) {
            (Some(0), Some("running")) => {}
            (Some(0), Some("stopped")) => return self.set(gen, Status::DockerStopped { installed: true }),
            (Some(0), Some("missing")) => return self.set(gen, Status::DockerStopped { installed: false }),
            _ => return fail("Could not check Docker", &out),
        }

        // 2. the local database (non-destructive: stack.mjs up never resets)
        self.set(gen, Status::Starting { step: "database", detail: None });
        let out = match self.run_child(gen, plan.command(&["up".into()]), &mut log, |l| self.set(gen, Status::Starting { step: "database", detail: Some(short(l)) })) {
            Ok(o) => o,
            Err(e) => return self.set(gen, Failure { title: "The ERP launcher did not start".into(), message: e }.into()),
        };
        if !self.current(gen) {
            return;
        }
        match out.code {
            Some(0) => {}
            Some(3) => return self.set(gen, Status::DockerStopped { installed: true }), // Docker went away after the doctor
            _ => return fail("The local database did not start", &out),
        }

        // 3. the ERP server; it keeps running until the app quits
        self.set(gen, Status::Starting { step: "erp", detail: None });
        let ready = format!("ready {}", erp_url_for(plan.port));
        let mut cmd = plan.command(&serve_args(plan.port, &plan.home));
        if let Some(key) = &plan.openrouter_key {
            cmd.env("OPENROUTER_API_KEY", key);
        }
        let mut announced = false;
        let out = match self.run_child(gen, cmd, &mut log, |l| {
            if l == ready {
                announced = true;
                self.set(gen, Status::Ready { url: erp_url_for(plan.port) });
                if self.current(gen) {
                    on_ready();
                }
            } else {
                self.set(gen, Status::Starting { step: "erp", detail: Some(short(l)) });
            }
        }) {
            Ok(o) => o,
            Err(e) => return self.set(gen, Failure { title: "The ERP launcher did not start".into(), message: e }.into()),
        };
        if !self.current(gen) {
            return;
        }
        let title = if announced { "The ERP server stopped" } else { "The ERP server did not start" };
        fail(title, &out);
    }

    /// Run one child to its end, feeding every output line to `on_line`. Returns early (and kills it) when retired.
    fn run_child(&self, gen: u64, mut cmd: Command, log: &mut Option<File>, mut on_line: impl FnMut(&str)) -> Result<Outcome, String> {
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
        let mut child = cmd.spawn().map_err(|e| format!("Cannot start {:?}: {e}", cmd.get_program()))?;
        let (tx, rx) = mpsc::channel::<String>();
        let mut readers = Vec::new();
        if let Some(out) = child.stdout.take() {
            readers.push((Box::new(out) as Box<dyn std::io::Read + Send>, tx.clone()));
        }
        if let Some(err) = child.stderr.take() {
            readers.push((Box::new(err) as Box<dyn std::io::Read + Send>, tx.clone()));
        }
        drop(tx);
        for (stream, tx) in readers {
            std::thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
        }
        if !self.current(gen) {
            terminate_group(&mut child);
            return Err("stopped".into());
        }
        *self.0.child.lock().map_err(|_| "internal lock error".to_string())? = Some((gen, child));

        let mut tail: VecDeque<String> = VecDeque::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(line) => {
                    if let Some(f) = log.as_mut() {
                        let _ = writeln!(f, "{line}");
                    }
                    if tail.len() == TAIL_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line.clone());
                    on_line(&line);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            if !self.current(gen) {
                break;
            }
        }
        // only take our own child back: a newer run may already have put its own in the slot
        let mine = {
            let mut slot = self.0.child.lock().map_err(|_| "internal lock error".to_string())?;
            if slot.as_ref().is_some_and(|(g, _)| *g == gen) { slot.take() } else { None }
        };
        let Some((_, mut child)) = mine else { return Err("stopped".into()) };
        if !self.current(gen) {
            terminate_group(&mut child);
            return Err("stopped".into());
        }
        let code = child.wait().map_err(|e| e.to_string())?.code();
        Ok(Outcome { code, tail: tail.into() })
    }
}

fn erp_url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn short(line: &str) -> String {
    line.chars().take(160).collect()
}

/// `open -a Docker`; fixed arguments, nothing from the UI reaches a shell.
pub fn open_docker() -> Result<(), String> {
    let status = Command::new("open").args(["-a", "Docker"]).status().map_err(|e| format!("Cannot run open: {e}"))?;
    if status.success() { Ok(()) } else { Err("Docker Desktop was not found. Install it from docker.com.".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    use std::time::Instant;

    fn temp_dir(name: &str) -> PathBuf {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("bn-launcher-{name}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn main_webview_is_the_erp_on_127_0_0_1_3100() {
        assert_eq!(ERP_PORT, 3100);
        assert_eq!(erp_url(), "http://127.0.0.1:3100");
        assert_eq!(erp_url_for(ERP_PORT), erp_url());
        let home = Path::new("/h");
        assert_eq!(serve_args(ERP_PORT, home), ["serve", "--port", "3100", "--cache-dir", "/h/erp"]);
    }

    #[test]
    fn reads_openrouter_key_from_bignose_home_env() {
        let env = "# secrets\nLINE_TOKEN=abc\nOPENROUTER_API_KEY=old-key-1\nOPENROUTER_API_KEY=\"new-key-2\"\nOTHER=x\n";
        assert_eq!(read_env_key(env, "OPENROUTER_API_KEY").as_deref(), Some("new-key-2"));
        assert_eq!(read_env_key("OPENROUTER_API_KEY=\n", "OPENROUTER_API_KEY"), None);
        assert_eq!(read_env_key("XOPENROUTER_API_KEY=v\n# OPENROUTER_API_KEY=v\n", "OPENROUTER_API_KEY"), None);
        // through the file, as the launcher reads it
        let home = temp_dir("env");
        std::fs::write(home.join(".env"), "OPENROUTER_API_KEY='fake-key-3'\r\n").unwrap();
        assert_eq!(openrouter_key(&home).as_deref(), Some("fake-key-3"));
        assert_eq!(openrouter_key(&temp_dir("noenv")), None);
    }

    #[test]
    fn missing_erp_dir_names_the_dir_and_the_override() {
        let home = temp_dir("home");
        let missing = temp_dir("missing").join("no-such-erp");
        let f = check_erp_dir(&missing, &home).unwrap_err();
        assert!(f.message.contains(&missing.display().to_string()), "{}", f.message);
        assert!(f.message.contains("BIGNOSE_OS_ERP_DIR"));
        assert!(f.message.contains(&home.join("os.json").display().to_string()));
        // a folder without the script is the same error
        let empty = temp_dir("empty");
        assert_eq!(check_erp_dir(&empty, &home).unwrap_err().title, "ERP folder not found");
        // a real ERP folder passes
        let erp = temp_dir("erp");
        std::fs::create_dir_all(erp.join("scripts/local")).unwrap();
        std::fs::write(erp.join(STACK_SCRIPT), "").unwrap();
        assert_eq!(check_erp_dir(&erp, &home), Ok(()));
    }

    #[test]
    fn macos_folder_privacy_gets_a_desktop_access_message() {
        let home = Path::new("/h");
        let f = permission_failure(Path::new("/Users/me/Desktop/erp"), home, "Operation not permitted (os error 1)");
        assert!(f.message.contains("Desktop"));
        assert!(f.message.contains("Files & Folders"));
        assert!(f.message.contains("/Users/me/Desktop/erp"));
        // EPERM from inside node reads the same
        let tail = vec!["Error: EPERM: operation not permitted, scandir '/x'".to_string()];
        let g = failure_from_output("Could not check Docker", &tail, Path::new("/x"), home);
        assert_eq!(g.title, "macOS is blocking access to the ERP folder");
        let plain = failure_from_output("Could not check Docker", &["boom".to_string()], Path::new("/x"), home);
        assert_eq!((plain.title.as_str(), plain.message.as_str()), ("Could not check Docker", "boom"));
    }

    #[test]
    fn erp_dir_order_is_os_json_then_env_then_compiled_root() {
        let compiled = Path::new("/built/erp");
        assert_eq!(erp_dir_from(Some(r#"{"erpDir":"/a"}"#), Some("/b"), compiled), Path::new("/a"));
        assert_eq!(erp_dir_from(Some(r#"{"other":1}"#), Some("/b"), compiled), Path::new("/b"));
        assert_eq!(erp_dir_from(Some("not json"), Some(" "), compiled), compiled);
        assert_eq!(erp_dir_from(None, None, compiled), compiled);
        assert!(compiled_root().join(STACK_SCRIPT).is_file(), "the compile-time root is the repo root");
    }

    #[test]
    fn status_serializes_for_the_startup_screen() {
        let json = |s: Status| serde_json::to_string(&s).unwrap();
        assert_eq!(json(Status::DockerStopped { installed: true }), r#"{"phase":"docker-stopped","installed":true}"#);
        assert_eq!(json(Status::Ready { url: erp_url() }), r#"{"phase":"ready","url":"http://127.0.0.1:3100"}"#);
        assert_eq!(json(Status::default()), r#"{"phase":"starting","step":"check","detail":null}"#);
    }

    // ---- the child handling, against a fake stack.mjs

    fn fake_plan(script: &str, port: u16) -> Plan {
        let erp = temp_dir("fake-erp");
        std::fs::create_dir_all(erp.join("scripts/local")).unwrap();
        std::fs::write(erp.join(STACK_SCRIPT), script).unwrap();
        let NodeRuntime { node, path } = node_runtime().expect("tests need Node");
        Plan { node, path, erp_dir: erp, home: temp_dir("fake-home"), port, openrouter_key: Some("fake-key-4".into()) }
    }

    fn wait_for(launcher: &Launcher, what: &str, ok: impl Fn(&Status) -> bool) -> Status {
        let deadline = Instant::now() + Duration::from_secs(20);
        while Instant::now() < deadline {
            let s = launcher.status();
            if ok(&s) {
                return s;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        panic!("timed out waiting for {what}; status is {:?}", launcher.status());
    }

    const FAKE: &str = r#"
const cmd = process.argv[2];
if (cmd === 'doctor') { console.log(JSON.stringify({ docker: process.env.FAKE_DOCKER ?? 'running' })); }
else if (cmd === 'up') { console.log('migrations applied'); }
else if (cmd === 'serve') {
  console.error('building');
  console.log('key:' + (process.env.OPENROUTER_API_KEY ? 'set' : 'unset') + ' port:' + process.argv[4]);
  console.log('ready http://127.0.0.1:' + process.argv[4]);
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
}
"#;

    #[test]
    fn launch_runs_doctor_up_serve_and_reports_ready() {
        let plan = fake_plan(FAKE, 3187);
        let log_path = plan.home.join("logs/erp.log");
        let launcher = Launcher::default();
        let readied = Arc::new(AtomicUsize::new(0));
        let r = readied.clone();
        launcher.start_with(move || Ok(plan), Arc::new(move || { r.fetch_add(1, Ordering::SeqCst); }));
        let s = wait_for(&launcher, "ready", |s| matches!(s, Status::Ready { .. }));
        assert_eq!(s, Status::Ready { url: "http://127.0.0.1:3187".into() });
        assert_eq!(readied.load(Ordering::SeqCst), 1);
        assert!(launcher.running());
        // the key reached the child's environment, and the log has output but never the key
        let log = std::fs::read_to_string(&log_path).unwrap();
        assert!(log.contains("key:set port:3187"));
        assert!(!log.contains("fake-key-4"));
        // quit: the serve child (and its group) goes away
        launcher.stop();
        assert!(!launcher.running());
    }

    #[test]
    fn docker_stopped_is_reported_not_failed() {
        let mut plan = fake_plan(&FAKE.replace("process.env.FAKE_DOCKER ?? 'running'", "'stopped'"), 3188);
        plan.openrouter_key = None;
        let launcher = Launcher::default();
        launcher.start_with(move || Ok(plan), Arc::new(|| {}));
        assert_eq!(wait_for(&launcher, "docker", |s| matches!(s, Status::DockerStopped { .. })), Status::DockerStopped { installed: true });
        let plan = fake_plan(&FAKE.replace("process.env.FAKE_DOCKER ?? 'running'", "'missing'"), 3189);
        launcher.start_with(move || Ok(plan), Arc::new(|| {}));
        assert_eq!(wait_for(&launcher, "missing", |s| matches!(s, Status::DockerStopped { installed: false })), Status::DockerStopped { installed: false });
        launcher.stop();
    }

    #[test]
    fn up_exit_3_means_docker_stopped_and_other_exits_fail_with_the_output() {
        let up3 = FAKE.replace("console.log('migrations applied');", "process.exit(3);");
        let launcher = Launcher::default();
        let plan = fake_plan(&up3, 3190);
        launcher.start_with(move || Ok(plan), Arc::new(|| {}));
        wait_for(&launcher, "docker via up", |s| matches!(s, Status::DockerStopped { installed: true }));
        let broken = FAKE.replace("console.log('migrations applied');", "console.error('migration 0026 failed'); process.exit(1);");
        let plan = fake_plan(&broken, 3191);
        launcher.start_with(move || Ok(plan), Arc::new(|| {}));
        match wait_for(&launcher, "failed", |s| matches!(s, Status::Failed { .. })) {
            Status::Failed { title, message } => {
                assert_eq!(title, "The local database did not start");
                assert!(message.contains("migration 0026 failed"));
            }
            other => panic!("{other:?}"),
        }
        launcher.stop();
    }

    #[test]
    fn a_missing_erp_dir_is_a_failed_status() {
        let launcher = Launcher::default();
        let home = temp_dir("nohome");
        launcher.start_with(move || Err(check_erp_dir(Path::new("/definitely/not/here"), &home).unwrap_err()), Arc::new(|| {}));
        match wait_for(&launcher, "failed", |s| matches!(s, Status::Failed { .. })) {
            Status::Failed { title, .. } => assert_eq!(title, "ERP folder not found"),
            other => panic!("{other:?}"),
        }
    }
}
