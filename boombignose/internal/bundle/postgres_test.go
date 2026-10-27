package bundle

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestEnsurePostgresInitsAndAppliesOnce(t *testing.T) {
	layout, data := postgresFixture(t)
	var cmds []string
	applied := false
	query := func(_ context.Context, _, _, _, sql string) ([][]string, error) {
		switch {
		case strings.HasPrefix(strings.TrimSpace(sql), "select filename"):
			if !applied {
				return nil, errors.New(`relation "public.schema_migrations" does not exist`)
			}
			return [][]string{{"001.sql"}}, nil
		case strings.Contains(sql, "to_regclass"):
			return [][]string{{"organizations"}}, nil
		case strings.HasPrefix(strings.TrimSpace(sql), "insert into public.schema_migrations"):
			applied = true
			return nil, nil
		default:
			return nil, nil
		}
	}
	run := func(cmd Command) error {
		cmds = append(cmds, filepath.Base(cmd.Name)+" "+strings.Join(cmd.Args, " "))
		if strings.Contains(cmd.Name, "initdb") {
			if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644); err != nil {
				return err
			}
		}
		return nil
	}
	ctx := context.Background()
	if err := ensurePostgres(ctx, layout, data, func() bool { return false }, run, query); err != nil {
		t.Fatal(err)
	}
	if len(cmds) < 2 || !strings.Contains(cmds[0], "initdb") || !strings.Contains(cmds[1], "pg_ctl") {
		t.Fatalf("commands = %#v", cmds)
	}
	if !strings.Contains(cmds[1], "listen_addresses=127.0.0.1") || !strings.Contains(cmds[1], "start") {
		t.Fatalf("start = %s", cmds[1])
	}
	if runtime.GOOS != "windows" && !strings.Contains(cmds[1], "unix_socket_directories=") {
		t.Fatalf("unix socket missing: %s", cmds[1])
	}
	if runtime.GOOS == "windows" && !strings.Contains(cmds[0], "--no-locale") {
		t.Fatalf("windows initdb: %s", cmds[0])
	}
	if runtime.GOOS != "windows" && !strings.Contains(cmds[0], "--locale=C") {
		t.Fatalf("unix initdb: %s", cmds[0])
	}
	if err := ensurePostgres(ctx, layout, data, func() bool { return true }, func(Command) error {
		t.Fatal("second launch must not init or start")
		return nil
	}, query); err != nil {
		t.Fatal(err)
	}
}

func TestEnsurePostgresRetriesConnectionRefused(t *testing.T) {
	layout, data := postgresFixture(t)
	if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	n := 0
	err := ensurePostgres(context.Background(), layout, data, func() bool { return true }, func(Command) error {
		t.Fatal("cluster was already up")
		return nil
	}, func(_ context.Context, _, _, _, sql string) ([][]string, error) {
		n++
		if n < 3 {
			return nil, errors.New("dial tcp 127.0.0.1:54329: connect: connection refused")
		}
		if strings.HasPrefix(strings.TrimSpace(sql), "select filename") {
			return [][]string{{"001.sql"}}, nil
		}
		if strings.Contains(sql, "to_regclass") {
			return [][]string{{"organizations"}}, nil
		}
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n < 3 {
		t.Fatalf("attempts = %d", n)
	}
}

func TestEnsurePostgresReportsMissingOrganizations(t *testing.T) {
	layout, data := postgresFixture(t)
	if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := ensurePostgres(context.Background(), layout, data, func() bool { return true }, func(Command) error {
		return nil
	}, func(_ context.Context, _, _, _, sql string) ([][]string, error) {
		if strings.HasPrefix(strings.TrimSpace(sql), "select filename") {
			return [][]string{{"001.sql"}}, nil
		}
		if strings.Contains(sql, "to_regclass") {
			return [][]string{{""}}, nil
		}
		return nil, nil
	})
	if err == nil || !strings.Contains(err.Error(), "organizations") {
		t.Fatalf("err = %v", err)
	}
}

func TestPostgresLaunchOptionsByPlatform(t *testing.T) {
	win := pgStartOptions("windows", `C:\bbn\pg`)
	if strings.Contains(win, "unix_socket") {
		t.Fatalf("windows options: %s", win)
	}
	if !strings.Contains(win, "listen_addresses=127.0.0.1") {
		t.Fatalf("windows options: %s", win)
	}
	unix := pgStartOptions("linux", "/tmp/bbnpg")
	if !strings.Contains(unix, "unix_socket_directories=/tmp/bbnpg") {
		t.Fatalf("linux options: %s", unix)
	}
	if !strings.Contains(strings.Join(initdbArgs("windows", `C:\bbn\pg`), " "), "--no-locale") {
		t.Fatal("windows initdb")
	}
	if !strings.Contains(strings.Join(initdbArgs("darwin", "/tmp/bbnpg"), " "), "--locale=C") {
		t.Fatal("darwin initdb")
	}
	layout := Layout{Postgres: filepath.Join("bundle", "postgres", "bin", exeName("postgres"))}
	has := func(env, key string) bool {
		for _, line := range strings.Split(env, "\n") {
			if strings.HasPrefix(line, key+"=") {
				return true
			}
		}
		return false
	}
	darwin := strings.Join(postgresEnvFor("darwin", layout), "\n")
	if !has(darwin, "DYLD_LIBRARY_PATH") || has(darwin, "LD_LIBRARY_PATH") {
		t.Fatalf("darwin env: %s", darwin)
	}
	linux := strings.Join(postgresEnvFor("linux", layout), "\n")
	if !has(linux, "LD_LIBRARY_PATH") || has(linux, "DYLD_LIBRARY_PATH") {
		t.Fatalf("linux env: %s", linux)
	}
	windows := strings.Join(postgresEnvFor("windows", layout), "\n")
	if has(windows, "LD_LIBRARY_PATH") || has(windows, "DYLD_LIBRARY_PATH") {
		t.Fatalf("windows env: %s", windows)
	}
}

func TestEnsurePostgresRefusesASpaceInTheDataDir(t *testing.T) {
	err := ensurePostgres(context.Background(), Layout{Postgres: "postgres"}, "/tmp/has space", func() bool { return false }, func(Command) error {
		t.Fatal("command ran")
		return nil
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "spaces") {
		t.Fatalf("err = %v", err)
	}
}

func TestEnsurePostgresSkipsWhenBinaryIsAbsent(t *testing.T) {
	err := ensurePostgres(context.Background(), Layout{}, t.TempDir(), func() bool {
		t.Fatal("probed a missing binary")
		return false
	}, func(Command) error {
		t.Fatal("command ran")
		return nil
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
}

func TestAllowedPostgresCommandRejectsAPublicListen(t *testing.T) {
	bin := t.TempDir()
	initdb := filepath.Join(bin, "initdb")
	if err := os.WriteFile(initdb, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	data := t.TempDir()
	good := []string{"-D", data, "-U", "boombignose", "--auth-local=trust", "--auth-host=trust", "--locale=C", "--encoding=UTF8"}
	if err := allowedPostgresCommand(initdb, good); err != nil {
		t.Fatal(err)
	}
	pgCtl := filepath.Join(bin, "pg_ctl")
	if err := os.WriteFile(pgCtl, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	public := []string{"-D", data, "-l", filepath.Join(data, "server.log"), "-w", "-o", "-c listen_addresses=0.0.0.0 -c port=54329 -c unix_socket_directories=" + data, "start"}
	if err := allowedPostgresCommand(pgCtl, public); err == nil {
		t.Fatal("a public listen address must be refused")
	}
}

func TestStopPostgresMissingCluster(t *testing.T) {
	err := StopPostgres(Layout{Postgres: filepath.Join(t.TempDir(), "postgres")}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
}

func TestStopPostgresRunsFastStop(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture is a shell script")
	}
	root := t.TempDir()
	bin := filepath.Join(root, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	data := t.TempDir()
	if err := os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(data, "stop.log")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" > '" + logPath + "'\n"
	if err := os.WriteFile(filepath.Join(bin, "pg_ctl"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "postgres"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := StopPostgres(Layout{Postgres: filepath.Join(bin, "postgres")}, data); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	if !strings.Contains(text, "-m fast stop") || !strings.Contains(text, data) {
		t.Fatalf("stop args = %s", text)
	}
}

func TestDefaultRunnerRecordsERPPid(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture is a shell script")
	}
	dir := t.TempDir()
	script := filepath.Join(dir, "node")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	server := filepath.Join(dir, "server.js")
	if err := os.WriteFile(server, []byte("// fixture\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	erpPIDDir = dir
	recordERP = true
	t.Cleanup(func() {
		recordERP = false
		erpPIDDir = ""
	})
	wait, kill, err := defaultRunner(Command{Name: script, Args: []string{server}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		kill()
		_ = wait()
	}()
	body, err := os.ReadFile(filepath.Join(dir, "erp.pid"))
	if err != nil {
		t.Fatal(err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(body)))
	if err != nil || pid <= 0 {
		t.Fatalf("pid file %q", body)
	}
}

func TestStopPIDStopsTheRecordedProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep fixture")
	}
	cmd := exec.Command("sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	t.Cleanup(func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
	})
	dir := t.TempDir()
	if err := writePID(dir, cmd.Process.Pid); err != nil {
		t.Fatal(err)
	}
	stopPID(dir)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("process was still running")
	}
}

func TestStartStackLeavesAnOpenERPAlone(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err = StartStack(ctx, Layout{Node: "node", Server: "server.js"}, t.TempDir(), "http://"+ln.Addr().String(), nil, func(Command) (func() error, func(), error) {
		t.Fatal("erp was already listening")
		return nil, nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func postgresFixture(t *testing.T) (Layout, string) {
	t.Helper()
	root := t.TempDir()
	bin := filepath.Join(root, "postgres", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, exeName("postgres")), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "postgres", "prelude.sql"), []byte("select 1"), 0o644); err != nil {
		t.Fatal(err)
	}
	mig := filepath.Join(root, "postgres", "migrations")
	if err := os.MkdirAll(mig, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mig, "001.sql"), []byte("select 1"), 0o644); err != nil {
		t.Fatal(err)
	}
	return Layout{Postgres: filepath.Join(bin, exeName("postgres"))}, t.TempDir()
}
