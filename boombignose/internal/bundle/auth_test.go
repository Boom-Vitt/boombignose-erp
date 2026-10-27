package bundle

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuthDBURLSetsTheAuthSearchPath(t *testing.T) {
	t.Setenv("BOOMBIGNOSE_PG_PORT", "54329")
	got := authDBURL()
	if !strings.Contains(got, "options=-csearch_path%3Dauth%2Cpublic") {
		t.Fatal(got)
	}
	if strings.Contains(localDBURL(), "search_path") {
		t.Fatal(localDBURL())
	}
}

func TestAuthMigrationsUseTheirOwnBook(t *testing.T) {
	if migrationTable("prelude-after-auth.sql") != "public.erp_schema_migrations" {
		t.Fatal(migrationTable("prelude-after-auth.sql"))
	}
	if migrationTable("prelude.sql") != "public.schema_migrations" {
		t.Fatal(migrationTable("prelude.sql"))
	}
}

func TestAuthBootstrapCreatesThePostgresRole(t *testing.T) {
	sql := strings.Join(authBootstrapSQL(), "\n")
	if !strings.Contains(sql, "create extension if not exists pgcrypto") {
		t.Fatal("pgcrypto missing")
	}
	if !strings.Contains(sql, "create schema if not exists auth") {
		t.Fatal("auth schema missing")
	}
	if !strings.Contains(sql, "create role postgres nologin") {
		t.Fatal("postgres role missing")
	}
}

func TestMintRoleJWTSignsTheRole(t *testing.T) {
	token, err := mintRoleJWT("test-secret", "anon")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[2] == "" {
		t.Fatalf("token = %s", token)
	}
	if strings.Contains(token, "service_role") {
		t.Fatal("anon token must not carry the service role")
	}
}

func TestEnsureLocalKeysStayOnDisk(t *testing.T) {
	dir := t.TempDir()
	first, err := ensureLocalKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	if first.anon == "" || first.service == "" || first.secret == "" {
		t.Fatal("missing key material")
	}
	if first.anon == first.service {
		t.Fatal("anon and service tokens must differ")
	}
	info, err := os.Stat(filepath.Join(dir, "service.key"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("service key mode = %o", info.Mode().Perm())
	}
	second, err := ensureLocalKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	if second.secret != first.secret || second.anon != first.anon {
		t.Fatal("a second launch must keep the same local keys")
	}
}

func TestWithLocalKeysReplacesThePlaceholder(t *testing.T) {
	dir := t.TempDir()
	keys, err := ensureLocalKeys(dir)
	if err != nil {
		t.Fatal(err)
	}
	parent := []string{
		"PATH=/usr/bin",
		"NEXT_PUBLIC_SUPABASE_ANON_KEY=local-anon-not-a-secret",
	}
	got := strings.Join(withLocalKeys(parent, dir), "\n")
	if strings.Contains(got, "local-anon-not-a-secret") || !strings.Contains(got, "PATH=/usr/bin") {
		t.Fatalf("env = %s", got)
	}
	if !strings.Contains(got, "NEXT_PUBLIC_SUPABASE_ANON_KEY="+keys.anon) {
		t.Fatal("anon key was not installed")
	}
	if !strings.Contains(got, "http://127.0.0.1:54321") {
		t.Fatal("local api url missing")
	}
}

func TestEnsurePostgresSkipsMigrationsWhenAuthIsBundled(t *testing.T) {
	layout, data := postgresFixture(t)
	layout.Auth = filepath.Join(t.TempDir(), "auth")
	sawMigration := false
	err := ensurePostgres(context.Background(), layout, data, func() bool { return false }, func(cmd Command) error {
		if strings.Contains(cmd.Name, "initdb") {
			return os.WriteFile(filepath.Join(data, "PG_VERSION"), []byte("16\n"), 0o644)
		}
		return nil
	}, func(_ context.Context, _, _, _, sql string) ([][]string, error) {
		if strings.Contains(sql, "schema_migrations") || strings.Contains(sql, "to_regclass") {
			sawMigration = true
		}
		return nil, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if sawMigration {
		t.Fatal("bundled auth must migrate after the auth server starts")
	}
}

func TestPrefixProxyStripsTheAuthPrefix(t *testing.T) {
	var got string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	u, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	proxy := newPrefixProxy("/auth/v1", u)
	req := httptest.NewRequest(http.MethodGet, "http://launcher/auth/v1/health", nil)
	rec := httptest.NewRecorder()
	proxy.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if got != "/health" {
		t.Fatalf("upstream path = %s", got)
	}
}
