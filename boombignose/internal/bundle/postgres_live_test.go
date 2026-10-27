package bundle

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestApplyMigrationsOnPortablePostgres(t *testing.T) {
	tree := os.Getenv("BOOMBIGNOSE_PG_TREE")
	if tree == "" {
		t.Skip("set BOOMBIGNOSE_PG_TREE to a portable postgres tree")
	}
	root := t.TempDir()
	for _, name := range []string{"bin", "lib", "share"} {
		if err := os.Symlink(filepath.Join(tree, name), filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}
	repo := filepath.Join("..", "..", "..")
	if err := copyFile(filepath.Join(repo, "packaging", "postgres", "prelude.sql"), filepath.Join(root, "prelude.sql")); err != nil {
		t.Fatal(err)
	}
	migDir := filepath.Join(root, "migrations")
	if err := os.MkdirAll(migDir, 0o755); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(repo, "supabase", "migrations"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 70 {
		t.Fatalf("migrations = %d", len(entries))
	}
	for _, entry := range entries {
		if entry.IsDir() || !stringsHasSQL(entry.Name()) {
			continue
		}
		if err := copyFile(filepath.Join(repo, "supabase", "migrations", entry.Name()), filepath.Join(migDir, entry.Name())); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.MkdirTemp("/tmp", "bbnpg")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(data) })
	ln, err := net.Listen("tcp", "127.0.0.1:54341")
	if err != nil {
		t.Fatal(err)
	}
	_ = ln.Close()
	t.Setenv("BOOMBIGNOSE_PG_PORT", "54341")
	layout := Layout{Postgres: filepath.Join(root, "bin", "postgres")}
	t.Cleanup(func() { _ = StopPostgres(layout, data) })
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	if err := EnsurePostgres(ctx, layout, data); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(data, "PG_VERSION")); err != nil {
		t.Fatal(err)
	}
	copied := 0
	for _, entry := range entries {
		if !entry.IsDir() && stringsHasSQL(entry.Name()) {
			copied++
		}
	}
	rows, err := queryPostgres(ctx, "127.0.0.1:54341", "boombignose", "boombignose", "select count(*)::text from public.schema_migrations")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0][0] != strconv.Itoa(copied) {
		t.Fatalf("applied %v, copied %d", rows, copied)
	}
}

func stringsHasSQL(name string) bool {
	return len(name) > 4 && name[len(name)-4:] == ".sql"
}

func copyFile(src, dst string) error {
	body, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, body, 0o644)
}
