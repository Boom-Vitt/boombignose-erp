package cutover

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseLocalURLRejectsSecretsAndRemoteHosts(t *testing.T) {
	cases := []string{
		"postgresql://boombignose:secret-value@127.0.0.1:54329/boombignose",
		"postgresql://boombignose@db.example.com:5432/boombignose",
		"postgresql://boombignose@127.0.0.1/boombignose",
		"postgres://boombignose@10.1.2.3:5432/boombignose",
		"https://127.0.0.1:5432/boombignose",
	}
	for _, raw := range cases {
		_, err := ParseLocalURL(raw)
		if err == nil {
			t.Fatalf("accepted %s", raw)
		}
		if strings.Contains(err.Error(), "secret-value") || strings.Contains(err.Error(), "example.com") || strings.Contains(err.Error(), "10.1.2.3") {
			t.Fatalf("error includes the URL: %s", err)
		}
	}
	ep, err := ParseLocalURL("postgresql://boombignose@localhost:54329/boombignose")
	if err != nil {
		t.Fatal(err)
	}
	if ep.Host != "127.0.0.1" || ep.Port != 54329 || ep.Database != "boombignose" {
		t.Fatalf("%+v", ep)
	}
}

func TestDryRunDoesNotDump(t *testing.T) {
	var calls []string
	run := func(_ context.Context, cmd Command) ([]byte, error) {
		calls = append(calls, filepath.Base(cmd.Name))
		if filepath.Base(cmd.Name) != "psql" {
			t.Fatalf("dry-run ran %s", cmd.Name)
		}
		if strings.Contains(strings.Join(cmd.Args, " "), "--host=127.0.0.1") && strings.Contains(strings.Join(cmd.Args, " "), "--port=54329") {
			return []byte("public.cutover_probe\n"), nil
		}
		return []byte("\n"), nil
	}
	var buf bytes.Buffer
	err := execute(context.Background(), []string{
		"dry-run",
		"--source", "postgresql://boombignose@127.0.0.1:54329/boombignose",
		"--target", "postgresql://boombignose@127.0.0.1:54330/boombignose",
	}, &buf, &toolPaths{psql: "/usr/bin/psql"}, "", run)
	if err != nil {
		t.Fatal(err)
	}
	text := buf.String()
	if !strings.Contains(text, "source=127.0.0.1:54329/boombignose tables=public.cutover_probe") {
		t.Fatal(text)
	}
	if !strings.Contains(text, "target=127.0.0.1:54330/boombignose tables=none") || !strings.Contains(text, "no backup written") {
		t.Fatal(text)
	}
	if strings.Join(calls, ",") != "psql,psql" {
		t.Fatal(calls)
	}
}

func TestApplyDumpsTheTargetBeforeRestore(t *testing.T) {
	backup := filepath.Join(t.TempDir(), "target.dump")
	var files []string
	run := func(_ context.Context, cmd Command) ([]byte, error) {
		base := filepath.Base(cmd.Name)
		switch base {
		case "psql":
			joined := strings.Join(cmd.Args, " ")
			if strings.Contains(joined, "--port=54329") {
				return []byte("public.cutover_probe\n"), nil
			}
			return []byte("\n"), nil
		case "pg_dump":
			file := strings.TrimPrefix(cmd.Args[len(cmd.Args)-1], "--file=")
			files = append(files, file)
			if err := os.WriteFile(file, []byte("PGDMPrest"), 0o600); err != nil {
				return nil, err
			}
			return nil, nil
		case "pg_restore":
			files = append(files, "restore:"+cmd.Args[len(cmd.Args)-1])
			return nil, nil
		default:
			t.Fatalf("unexpected %s", cmd.Name)
			return nil, nil
		}
	}
	var buf bytes.Buffer
	err := execute(context.Background(), []string{
		"apply",
		"--source", "postgresql://boombignose@127.0.0.1:54329/boombignose",
		"--target", "postgresql://boombignose@127.0.0.1:54330/boombignose",
		"--backup", backup,
	}, &buf, &toolPaths{psql: "/usr/bin/psql", dump: "/usr/bin/pg_dump", restore: "/usr/bin/pg_restore"}, "", run)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 3 || files[0] != backup || !strings.HasPrefix(files[1], filepath.Dir(backup)) || files[2] != "restore:"+files[1] {
		t.Fatalf("%#v", files)
	}
	if !strings.Contains(buf.String(), "no backup written") || !strings.Contains(buf.String(), "backup "+backup) {
		t.Fatal(buf.String())
	}
	if _, err := os.Stat(backup); err != nil {
		t.Fatal(err)
	}
}

func TestApplyRollsBackWhenRestoreFails(t *testing.T) {
	backup := filepath.Join(t.TempDir(), "target.dump")
	restores := 0
	run := func(_ context.Context, cmd Command) ([]byte, error) {
		switch filepath.Base(cmd.Name) {
		case "psql":
			return []byte("\n"), nil
		case "pg_dump":
			file := strings.TrimPrefix(cmd.Args[len(cmd.Args)-1], "--file=")
			return nil, os.WriteFile(file, []byte("PGDMPrest"), 0o600)
		case "pg_restore":
			restores++
			if restores == 1 {
				return nil, os.ErrInvalid
			}
			if cmd.Args[len(cmd.Args)-1] != backup {
				t.Fatalf("rollback used %s", cmd.Args[len(cmd.Args)-1])
			}
			return nil, nil
		default:
			t.Fatal(cmd.Name)
			return nil, nil
		}
	}
	err := execute(context.Background(), []string{
		"apply",
		"--source", "postgresql://boombignose@127.0.0.1:54329/boombignose",
		"--target", "postgresql://boombignose@127.0.0.1:54330/boombignose",
		"--backup", backup,
	}, &bytes.Buffer{}, &toolPaths{psql: "/usr/bin/psql", dump: "/usr/bin/pg_dump", restore: "/usr/bin/pg_restore"}, "", run)
	if err == nil || !strings.Contains(err.Error(), "rolled back") {
		t.Fatal(err)
	}
	if restores != 2 {
		t.Fatal(restores)
	}
}

func TestRollbackRefusesAPlainFile(t *testing.T) {
	backup := filepath.Join(t.TempDir(), "target.dump")
	if err := os.WriteFile(backup, []byte("not a dump"), 0o600); err != nil {
		t.Fatal(err)
	}
	called := false
	run := func(context.Context, Command) ([]byte, error) {
		called = true
		return nil, nil
	}
	err := execute(context.Background(), []string{
		"rollback",
		"--target", "postgresql://boombignose@127.0.0.1:54330/boombignose",
		"--backup", backup,
	}, &bytes.Buffer{}, &toolPaths{restore: "/usr/bin/pg_restore"}, "", run)
	if err == nil {
		t.Fatal("plain file was restored")
	}
	if called {
		t.Fatal("tool ran")
	}
}

func TestAllowExecRejectsAPublicHost(t *testing.T) {
	err := allowExec(Command{
		Name: "/usr/bin/psql",
		Args: []string{
			"--no-password",
			"--tuples-only",
			"--no-align",
			"--host=10.1.2.3",
			"--port=5432",
			"--username=boombignose",
			"--dbname=boombignose",
			"--command=" + listTablesSQL,
		},
	})
	if err == nil || strings.Contains(err.Error(), "10.1.2.3") {
		t.Fatal(err)
	}
}
