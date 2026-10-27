package bundle

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/launch"
)

const (
	localAPIPort  = "54321"
	localAuthPort = "54323"
	localRESTPort = "54324"
)

// EnsureAuth starts the bundled Auth server and PostgREST when those binaries
// exist, then applies ERP migrations. A bundle without them keeps the prelude
// path and does not listen on the local API port.
func EnsureAuth(ctx context.Context, layout Layout, dataDir string) error {
	if layout.Auth == "" || layout.PostgREST == "" {
		return nil
	}
	keys, err := ensureLocalKeys(dataDir)
	if err != nil {
		return err
	}
	for _, stmt := range authBootstrapSQL() {
		if _, err := queryPostgres(ctx, pgAddr(), "boombignose", "boombignose", stmt); err != nil {
			return fmt.Errorf("auth bootstrap: %w", err)
		}
	}
	if err := startAuthServer(ctx, layout, dataDir, keys.secret); err != nil {
		return err
	}
	if err := applyMigrationsFrom(ctx, layout, pgAddr(), nil, "prelude-after-auth.sql"); err != nil {
		return err
	}
	if err := startPostgREST(ctx, layout, dataDir, keys.secret); err != nil {
		return err
	}
	return startLocalAPI(ctx)
}

type localKeys struct {
	secret  string
	anon    string
	service string
}

func ensureLocalKeys(dataDir string) (localKeys, error) {
	secret, secretErr := readBundleFile(dataDir, "jwt.secret")
	anon, anonErr := readBundleFile(dataDir, "anon.key")
	service, serviceErr := readBundleFile(dataDir, "service.key")
	if secretErr == nil && anonErr == nil && serviceErr == nil {
		return localKeys{
			secret:  strings.TrimSpace(string(secret)),
			anon:    strings.TrimSpace(string(anon)),
			service: strings.TrimSpace(string(service)),
		}, nil
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return localKeys{}, err
	}
	keys := localKeys{secret: hex.EncodeToString(buf)}
	var err error
	keys.anon, err = mintRoleJWT(keys.secret, "anon")
	if err != nil {
		return localKeys{}, err
	}
	keys.service, err = mintRoleJWT(keys.secret, "service_role")
	if err != nil {
		return localKeys{}, err
	}
	if err := writeDataFile(dataDir, "jwt.secret", []byte(keys.secret+"\n")); err != nil {
		return localKeys{}, err
	}
	if err := writeDataFile(dataDir, "anon.key", []byte(keys.anon+"\n")); err != nil {
		return localKeys{}, err
	}
	if err := writeDataFile(dataDir, "service.key", []byte(keys.service+"\n")); err != nil {
		return localKeys{}, err
	}
	return keys, nil
}

func mintRoleJWT(secret, role string) (string, error) {
	if strings.TrimSpace(secret) == "" || strings.TrimSpace(role) == "" {
		return "", errors.New("jwt secret and role are required")
	}
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	now := time.Now().Unix()
	payload := fmt.Sprintf(`{"role":%q,"iss":"supabase","iat":%d,"exp":%d}`, role, now, now+10*365*24*3600)
	body := base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(header + "." + body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return header + "." + body + "." + sig, nil
}

// authBootstrapSQL prepares a cluster whose only superuser is boombignose.
// Auth migrations grant to the role named postgres, which initdb does not create.
func authBootstrapSQL() []string {
	return []string{
		"create extension if not exists pgcrypto",
		"create schema if not exists auth",
		"do $$ begin create role postgres nologin; exception when duplicate_object then null; end $$",
	}
}

func startAuthServer(ctx context.Context, layout Layout, dataDir, secret string) error {
	migrations := filepath.Join(filepath.Dir(layout.Auth), "migrations")
	if _, err := os.Stat(migrations); err != nil {
		return fmt.Errorf("auth migrations: %w", err)
	}
	cmd := Command{
		Name: layout.Auth,
		Dir:  filepath.Dir(layout.Auth),
		Env: []string{
			"GOTRUE_DB_DRIVER=postgres",
			"GOTRUE_DB_DATABASE_URL=" + authDBURL(),
			"DATABASE_URL=" + authDBURL(),
			"GOTRUE_DB_MIGRATIONS_PATH=" + migrations,
			"GOTRUE_JWT_SECRET=" + secret,
			"GOTRUE_JWT_EXP=3600",
			"GOTRUE_API_HOST=127.0.0.1",
			"GOTRUE_API_PORT=" + localAuthPort,
			"API_EXTERNAL_URL=http://127.0.0.1:" + localAPIPort + "/auth/v1",
			"GOTRUE_API_EXTERNAL_URL=http://127.0.0.1:" + localAPIPort + "/auth/v1",
			"GOTRUE_API_API_EXTERNAL_URL=http://127.0.0.1:" + localAPIPort + "/auth/v1",
			"GOTRUE_SITE_URL=http://127.0.0.1:3100",
			"GOTRUE_DISABLE_SIGNUP=false",
			"GOTRUE_MAILER_AUTOCONFIRM=true",
			"GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
		},
	}
	cmd.Env = append(cmd.Env, copiedProcessEnv()...)
	if err := startLogged(cmd, dataDir, "auth.log", "auth.pid"); err != nil {
		return err
	}
	waitCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var reason string
	err := launch.WaitUntil(waitCtx, 500*time.Millisecond, func() bool {
		ok, why := authReady(waitCtx)
		reason = why
		return ok
	}, nil)
	if err != nil {
		return fmt.Errorf("auth did not become ready: %s\n%s", reason, tailRedacted(dataDir, "auth.log", secret))
	}
	return nil
}

func authReady(ctx context.Context) (bool, string) {
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(probe, http.MethodGet, "http://127.0.0.1:"+localAuthPort+"/health", nil)
	if err != nil {
		return false, err.Error()
	}
	client := http.Client{
		Timeout:   2 * time.Second,
		Transport: &http.Transport{Proxy: nil},
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, "health: " + err.Error()
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Sprintf("health status %d", resp.StatusCode)
	}
	return true, ""
}

func startPostgREST(ctx context.Context, layout Layout, dataDir, secret string) error {
	cmd := Command{
		Name: layout.PostgREST,
		Dir:  filepath.Dir(layout.PostgREST),
		Env: []string{
			"PGRST_DB_URI=" + localDBURL(),
			"PGRST_DB_SCHEMAS=public,storage",
			"PGRST_DB_ANON_ROLE=anon",
			"PGRST_JWT_SECRET=" + secret,
			"PGRST_SERVER_HOST=127.0.0.1",
			"PGRST_SERVER_PORT=" + localRESTPort,
		},
	}
	cmd.Env = append(cmd.Env, copiedProcessEnv()...)
	if err := startLogged(cmd, dataDir, "postgrest.log", "postgrest.pid"); err != nil {
		return err
	}
	waitCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	err := launch.WaitUntil(waitCtx, 200*time.Millisecond, func() bool {
		ok, _ := launch.Listening("http://127.0.0.1:" + localRESTPort)
		return ok
	}, nil)
	if err != nil {
		return fmt.Errorf("postgrest did not become ready: %s", tailRedacted(dataDir, "postgrest.log", secret))
	}
	return nil
}

func localDBURL() string {
	return "postgres://boombignose@" + pgAddr() + "/boombignose?sslmode=disable"
}

// authDBURL puts the auth schema first. GoTrue queries unqualified table
// names such as identities. The cluster default stays public so ERP
// migrations create their tables there.
func authDBURL() string {
	return localDBURL() + "&options=-csearch_path%3Dauth%2Cpublic"
}

func copiedProcessEnv() []string {
	var env []string
	for _, key := range []string{"HOME", "LANG", "TMPDIR", "SystemRoot", "USERPROFILE", "PATH"} {
		if value := os.Getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func allowLoggedCommand(name string, args []string) (string, error) {
	if strings.ContainsAny(name, "\x00\r\n") || len(args) != 0 {
		return "", errors.New("refusing local api command")
	}
	path := name
	if !filepath.IsAbs(path) {
		abs, err := filepath.Abs(path)
		if err != nil {
			return "", errors.New("refusing local api command")
		}
		path = abs
	}
	path = filepath.Clean(path)
	switch filepath.Base(path) {
	case "auth", "auth.exe", "postgrest", "postgrest.exe":
		return path, nil
	default:
		return "", errors.New("refusing local api command")
	}
}

func startLogged(cmd Command, dataDir, logName, pidName string) error {
	bin, err := allowLoggedCommand(cmd.Name, cmd.Args)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(dataDir)
	if err != nil {
		return err
	}
	logFile, err := root.OpenFile(logName, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		_ = root.Close()
		return err
	}
	// #nosec G204 -- allowLoggedCommand allows only the absolute auth or postgrest binary and no arguments
	proc := exec.Command(bin)
	proc.Dir = cmd.Dir
	proc.Env = cmd.Env
	proc.Stdout = logFile
	proc.Stderr = logFile
	if err := proc.Start(); err != nil {
		_ = logFile.Close()
		_ = root.Close()
		return err
	}
	pidFile, err := root.OpenFile(pidName, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		_ = proc.Process.Kill()
		_ = logFile.Close()
		_ = root.Close()
		return err
	}
	if _, err := pidFile.Write([]byte(fmt.Sprintf("%d\n", proc.Process.Pid))); err != nil {
		_ = pidFile.Close()
		_ = proc.Process.Kill()
		_ = logFile.Close()
		_ = root.Close()
		return err
	}
	_ = pidFile.Close()
	go func() {
		_ = proc.Wait()
		_ = logFile.Close()
		_ = root.Close()
	}()
	return nil
}

func tailRedacted(dataDir, name, secret string) string {
	body, err := readBundleFile(dataDir, name)
	if err != nil {
		return "log unavailable"
	}
	text := string(body)
	if secret != "" {
		text = strings.ReplaceAll(text, secret, "[redacted]")
	}
	lines := strings.Split(text, "\n")
	if len(lines) > 20 {
		lines = lines[len(lines)-20:]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func startLocalAPI(ctx context.Context) error {
	addr := net.JoinHostPort("127.0.0.1", localAPIPort)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("local api: %w", err)
	}
	authURL, err := url.Parse("http://127.0.0.1:" + localAuthPort)
	if err != nil {
		_ = ln.Close()
		return err
	}
	restURL, err := url.Parse("http://127.0.0.1:" + localRESTPort)
	if err != nil {
		_ = ln.Close()
		return err
	}
	mux := http.NewServeMux()
	mux.Handle("/auth/v1/", newPrefixProxy("/auth/v1", authURL))
	mux.Handle("/rest/v1/", newPrefixProxy("/rest/v1", restURL))
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	apiMu.Lock()
	apiSrv = srv
	apiMu.Unlock()
	go func() { _ = srv.Serve(ln) }()
	err = launch.WaitUntil(ctx, 50*time.Millisecond, func() bool {
		ok, _ := launch.Listening("http://" + addr + "/auth/v1/health")
		return ok
	}, nil)
	if err != nil {
		stopLocalAPI()
		return errors.New("local api did not become ready")
	}
	return nil
}

func newPrefixProxy(prefix string, upstream *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.Director = func(r *http.Request) {
		r.URL.Scheme = upstream.Scheme
		r.URL.Host = upstream.Host
		r.Host = upstream.Host
		path := strings.TrimPrefix(r.URL.Path, prefix)
		if path == "" {
			path = "/"
		}
		r.URL.Path = path
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "local api unavailable", http.StatusBadGateway)
	}
	return proxy
}

var (
	apiMu  sync.Mutex
	apiSrv *http.Server
)

func stopLocalAPI() {
	apiMu.Lock()
	srv := apiSrv
	apiSrv = nil
	apiMu.Unlock()
	if srv == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func stopExtraPIDs(dataDir string) {
	if dataDir == "" {
		return
	}
	for _, name := range []string{"auth.pid", "postgrest.pid"} {
		stopOnePID(dataDir, name)
	}
}

func stopOnePID(dataDir, name string) {
	body, err := readBundleFile(dataDir, name)
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
	_ = os.Remove(filepath.Join(dataDir, name))
}

func withLocalKeys(parent []string, dataDir string) []string {
	anon, err := readBundleFile(dataDir, "anon.key")
	if err != nil {
		return parent
	}
	service, err := readBundleFile(dataDir, "service.key")
	if err != nil {
		return parent
	}
	drop := map[string]bool{
		"NEXT_PUBLIC_SUPABASE_URL":      true,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY": true,
		"SUPABASE_SERVICE_ROLE_KEY":     true,
	}
	out := make([]string, 0, len(parent)+3)
	for _, item := range parent {
		key, _, ok := strings.Cut(item, "=")
		if ok && drop[key] {
			continue
		}
		out = append(out, item)
	}
	return append(out,
		"NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:"+localAPIPort,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY="+strings.TrimSpace(string(anon)),
		"SUPABASE_SERVICE_ROLE_KEY="+strings.TrimSpace(string(service)),
	)
}
