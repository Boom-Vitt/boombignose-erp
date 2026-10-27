package bundle

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/launch"
)

const defaultPGPort = "54329"

// DataDir is where initdb writes the cluster. It is outside the installer
// so an AppImage mount can stay read-only.
func DataDir() (string, error) {
	if dir := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_DATA")); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "share", "boombignose", "pg"), nil
}

func pgAddr() string {
	port := strings.TrimSpace(os.Getenv("BOOMBIGNOSE_PG_PORT"))
	if port == "" {
		port = defaultPGPort
	}
	return net.JoinHostPort("127.0.0.1", port)
}

func pgPort() string {
	_, port, err := net.SplitHostPort(pgAddr())
	if err != nil || port == "" {
		return defaultPGPort
	}
	return port
}

type sqlQuery func(ctx context.Context, addr, user, database, sql string) ([][]string, error)
type cmdRun func(Command) error

func safeDataDir(dir string) bool {
	return filepath.IsAbs(dir) && !strings.Contains(dir, "..") && !strings.ContainsAny(dir, " \x00\r\n")
}

func allowedPgCtl(args []string) bool {
	if len(args) == 5 && args[0] == "-D" && safeDataDir(args[1]) && args[2] == "-m" && args[3] == "fast" && args[4] == "stop" {
		return true
	}
	if len(args) != 8 || args[0] != "-D" || !safeDataDir(args[1]) || args[2] != "-l" || args[4] != "-w" || args[5] != "-o" || args[7] != "start" {
		return false
	}
	if args[3] != filepath.Join(args[1], "server.log") {
		return false
	}
	return loopbackStartOptions(args[6], args[1])
}

func initdbAllowed(args []string) bool {
	if len(args) != 8 || args[0] != "-D" || !safeDataDir(args[1]) || args[2] != "-U" || args[3] != "boombignose" {
		return false
	}
	if args[4] != "--auth-local=trust" || args[5] != "--auth-host=trust" || args[6] != "--encoding=UTF8" {
		return false
	}
	return args[7] == "--locale=C" || args[7] == "--no-locale"
}

func loopbackStartOptions(opts, dataDir string) bool {
	const prefix = "-c listen_addresses=127.0.0.1 -c port="
	rest, ok := strings.CutPrefix(opts, prefix)
	if !ok {
		return false
	}
	port := rest
	if i := strings.IndexByte(rest, ' '); i >= 0 {
		port = rest[:i]
		if rest[i+1:] != "-c unix_socket_directories="+dataDir {
			return false
		}
	}
	n, err := strconv.Atoi(port)
	return err == nil && n >= 1 && n <= 65535 && strconv.Itoa(n) == port
}

// allowedPostgresCommand accepts initdb for a new cluster and pg_ctl start/stop.
// The listen address inside pg_ctl -o must be 127.0.0.1.
func allowedPostgresCommand(name string, args []string) error {
	if !filepath.IsAbs(name) || strings.ContainsAny(name, "\x00\r\n") {
		return errors.New("refusing postgres command")
	}
	base := strings.ToLower(filepath.Base(name))
	switch base {
	case "initdb", "initdb.exe":
		if !initdbAllowed(args) {
			return errors.New("refusing postgres command")
		}
	case "pg_ctl", "pg_ctl.exe":
		if !allowedPgCtl(args) {
			return errors.New("refusing postgres command")
		}
	default:
		return errors.New("refusing postgres command")
	}
	info, err := os.Stat(name)
	if err != nil || info.IsDir() {
		return errors.New("refusing postgres command")
	}
	return nil
}

func defaultCmd(cmd Command) error {
	if err := allowedPostgresCommand(cmd.Name, cmd.Args); err != nil {
		return err
	}
	// #nosec G204 -- allowedPostgresCommand accepts only initdb or pg_ctl with the fixed local arguments
	proc := exec.Command(cmd.Name, cmd.Args...)
	proc.Dir = cmd.Dir
	proc.Env = cmd.Env
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	return proc.Run()
}

// EnsurePostgres initializes a loopback cluster on first launch, starts it,
// and applies prelude.sql plus any migration that is not yet recorded.
func EnsurePostgres(ctx context.Context, layout Layout, dataDir string) error {
	return ensurePostgres(ctx, layout, dataDir, func() bool {
		ok, _ := launch.Listening("http://" + pgAddr())
		return ok
	}, defaultCmd, queryPostgres)
}

func ensurePostgres(ctx context.Context, layout Layout, dataDir string, up func() bool, run cmdRun, query sqlQuery) error {
	if layout.Postgres == "" {
		return nil
	}
	if dataDir == "" {
		return errors.New("postgres data dir is empty")
	}
	if strings.Contains(dataDir, " ") {
		return errors.New("postgres data dir cannot contain spaces")
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	binDir := filepath.Dir(layout.Postgres)
	env := postgresEnv(layout)
	if _, err := os.Stat(filepath.Join(dataDir, "PG_VERSION")); err != nil {
		initdb := filepath.Join(binDir, exeName("initdb"))
		if err := run(Command{
			Name: initdb,
			Args: initdbArgs(runtime.GOOS, dataDir),
			Env:  env,
		}); err != nil {
			return fmt.Errorf("initdb: %w", err)
		}
	}
	if !up() {
		pgCtl := filepath.Join(binDir, exeName("pg_ctl"))
		if err := run(Command{
			Name: pgCtl,
			Args: []string{
				"-D", dataDir,
				"-l", filepath.Join(dataDir, "server.log"),
				"-w",
				"-o", pgStartOptions(runtime.GOOS, dataDir),
				"start",
			},
			Env: env,
		}); err != nil {
			return fmt.Errorf("pg_ctl start: %w", err)
		}
	}
	var last error
	for i := 0; i < 25; i++ {
		last = ensureDatabase(ctx, pgAddr(), query)
		if last == nil {
			last = applyMigrations(ctx, layout, pgAddr(), query)
		}
		if last == nil {
			return nil
		}
		if !strings.Contains(strings.ToLower(last.Error()), "connection refused") {
			return last
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return last
}

func initdbArgs(goos, dataDir string) []string {
	args := []string{"-D", dataDir, "-U", "boombignose", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8"}
	if goos == "windows" {
		return append(args, "--no-locale")
	}
	return append(args, "--locale=C")
}

func pgStartOptions(goos, dataDir string) string {
	opts := fmt.Sprintf("-c listen_addresses=127.0.0.1 -c port=%s", pgPort())
	if goos != "windows" {
		opts += " -c unix_socket_directories=" + dataDir
	}
	return opts
}

func postgresEnv(layout Layout) []string {
	return postgresEnvFor(runtime.GOOS, layout)
}

func postgresEnvFor(goos string, layout Layout) []string {
	root := filepath.Dir(filepath.Dir(layout.Postgres))
	bin := filepath.Dir(layout.Postgres)
	lib := filepath.Join(root, "lib")
	path := bin
	if goos == "windows" {
		if systemRoot := os.Getenv("SystemRoot"); systemRoot != "" {
			path = bin + ";" + filepath.Join(systemRoot, "System32")
		}
	}
	env := []string{"PATH=" + path}
	switch goos {
	case "darwin":
		env = append(env, "DYLD_LIBRARY_PATH="+lib, "DYLD_FALLBACK_LIBRARY_PATH="+lib)
	case "windows":
	default:
		env = append(env, "LD_LIBRARY_PATH="+lib)
	}
	for _, key := range []string{"HOME", "LANG", "TMPDIR", "SystemRoot", "USERPROFILE", "APPDATA", "LOCALAPPDATA"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func ensureDatabase(ctx context.Context, addr string, query sqlQuery) error {
	if query == nil {
		query = queryPostgres
	}
	_, err := query(ctx, addr, "boombignose", "postgres", "create database boombignose")
	if err == nil || strings.Contains(strings.ToLower(err.Error()), "already exists") {
		return nil
	}
	return err
}

func applyMigrations(ctx context.Context, layout Layout, addr string, query sqlQuery) error {
	if query == nil {
		query = queryPostgres
	}
	rows, err := query(ctx, addr, "boombignose", "boombignose", "select filename from public.schema_migrations")
	applied := map[string]bool{}
	if err != nil {
		if !strings.Contains(strings.ToLower(err.Error()), "schema_migrations") {
			return err
		}
		root := filepath.Dir(filepath.Dir(layout.Postgres))
		body, readErr := readBundleFile(root, "prelude.sql")
		if readErr != nil {
			return readErr
		}
		if _, err := query(ctx, addr, "boombignose", "boombignose", string(body)); err != nil {
			return fmt.Errorf("prelude: %w", err)
		}
	} else {
		for _, row := range rows {
			if len(row) > 0 && row[0] != "" {
				applied[row[0]] = true
			}
		}
	}
	dir := filepath.Join(filepath.Dir(filepath.Dir(layout.Postgres)), "migrations")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		if applied[name] {
			continue
		}
		if strings.Contains(name, "/") || strings.Contains(name, "\\") || name == ".." {
			return errors.New("refusing migration name")
		}
		body, err := readBundleFile(dir, name)
		if err != nil {
			return err
		}
		if _, err := query(ctx, addr, "boombignose", "boombignose", string(body)); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
		quoted, err := quoteLiteral(name)
		if err != nil {
			return err
		}
		insert := "insert into public.schema_migrations (filename) values (" + quoted + ")"
		if _, err := query(ctx, addr, "boombignose", "boombignose", insert); err != nil {
			return err
		}
	}
	check, err := query(ctx, addr, "boombignose", "boombignose", "select to_regclass('public.organizations')")
	if err != nil {
		return err
	}
	if len(check) == 0 || check[0][0] == "" {
		return errors.New("public.organizations was not created")
	}
	return nil
}

// StopPostgres asks the cluster in dataDir to shut down.
func StopPostgres(layout Layout, dataDir string) error {
	if layout.Postgres == "" || dataDir == "" {
		return nil
	}
	if _, err := os.Stat(filepath.Join(dataDir, "PG_VERSION")); err != nil {
		return nil
	}
	pgCtl := filepath.Join(filepath.Dir(layout.Postgres), exeName("pg_ctl"))
	stopArgs := []string{"-D", dataDir, "-m", "fast", "stop"}
	if err := allowedPostgresCommand(pgCtl, stopArgs); err != nil {
		return err
	}
	// #nosec G204 -- allowedPostgresCommand accepts only this pg_ctl stop shape
	cmd := exec.Command(pgCtl, stopArgs...)
	cmd.Env = postgresEnv(layout)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// pid helpers keep the ERP process stoppable without scanning the machine.
func writePID(dataDir string, pid int) error {
	return os.WriteFile(filepath.Join(dataDir, "erp.pid"), []byte(strconv.Itoa(pid)+"\n"), 0o600)
}

func readBundleFile(root, name string) ([]byte, error) {
	fsRoot, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer fsRoot.Close()
	f, err := fsRoot.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, 8<<20))
}

func stopPID(dataDir string) {
	body, err := readBundleFile(dataDir, "erp.pid")
	if err != nil {
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(body)))
	if err != nil || pid <= 0 {
		return
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return
	}
	_ = proc.Kill()
	_ = os.Remove(filepath.Join(dataDir, "erp.pid"))
}

var running struct {
	sync.Mutex
	layout Layout
	data   string
}

// erpPIDDir is the data directory whose erp.pid the bundled Node should write.
// recordERP limits that write to the ERP process, not ollama.
var (
	erpPIDDir string
	recordERP bool
)

// StartStack starts portable Postgres when the binary is present, applies
// migrations, then starts the bundled ERP server.
func StartStack(ctx context.Context, layout Layout, dataDir, rawURL string, parent []string, run Runner) error {
	running.Lock()
	running.layout = layout
	running.data = dataDir
	erpPIDDir = dataDir
	recordERP = true
	running.Unlock()
	defer func() {
		running.Lock()
		recordERP = false
		running.Unlock()
	}()
	if err := EnsurePostgres(ctx, layout, dataDir); err != nil {
		return err
	}
	return EnsureERP(ctx, layout, rawURL, parent, run)
}

// StopAt stops the recorded ERP pid and the portable cluster in dataDir.
func StopAt(layout Layout, dataDir string) error {
	if dataDir != "" {
		stopPID(dataDir)
	}
	return StopPostgres(layout, dataDir)
}

// StopRunning stops the stack started in this process.
func StopRunning() {
	running.Lock()
	layout := running.layout
	data := running.data
	running.Unlock()
	_ = StopAt(layout, data)
}
