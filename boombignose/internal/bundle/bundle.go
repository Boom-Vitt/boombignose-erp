// Package bundle starts a portable local stack from files beside the desktop
// binary. It does not download Node, Postgres, Ollama, or a model, and it does
// not call Docker. A missing optional file is skipped. A cloud credential is
// not passed to the child.
package bundle

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/launch"
	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
)

const (
	// DefaultOllamaListen is the loopback address used when OLLAMA_HOST is empty.
	DefaultOllamaListen = "127.0.0.1:11434"
	// LocalModel is the documented pull. The window does not run the pull.
	LocalModel = "qwen3:4b"
)

// ErrIncomplete means the bundle has no portable Node and ERP server.
var ErrIncomplete = errors.New("portable bundle is incomplete")

// ErrNoOllama means neither the bundle nor PATH has an ollama binary.
var ErrNoOllama = errors.New("ollama binary not found")

// Command is a local process with an explicit environment.
type Command struct {
	Name string
	Args []string
	Dir  string
	Env  []string
}

// Layout is the portable tree. Postgres and Ollama may be empty.
type Layout struct {
	Root      string
	Node      string
	Server    string
	Postgres  string
	Ollama    string
	Auth      string
	PostgREST string
}

// Valid reports whether root contains the portable Node binary and ERP server.
func Valid(root string) bool {
	layout, err := Discover(root)
	return err == nil && layout.Node != "" && layout.Server != ""
}

// Discover reads the portable tree. Node and server.js are required.
// Postgres and Ollama are recorded only when their files exist.
func Discover(root string) (Layout, error) {
	if strings.TrimSpace(root) == "" {
		return Layout{}, ErrIncomplete
	}
	layout := Layout{Root: root}
	node := filepath.Join(root, exeName("node"))
	server := filepath.Join(root, "erp", "server.js")
	if _, err := os.Stat(node); err != nil {
		return Layout{}, ErrIncomplete
	}
	if _, err := os.Stat(server); err != nil {
		return Layout{}, ErrIncomplete
	}
	layout.Node = node
	layout.Server = server
	postgres := filepath.Join(root, "postgres", "bin", exeName("postgres"))
	if _, err := os.Stat(postgres); err == nil {
		layout.Postgres = postgres
	}
	ollama := filepath.Join(root, "ollama", exeName("ollama"))
	if _, err := os.Stat(ollama); err == nil {
		layout.Ollama = ollama
	}
	auth := filepath.Join(root, "auth", exeName("auth"))
	if _, err := os.Stat(auth); err == nil {
		layout.Auth = auth
	}
	postgrest := filepath.Join(root, "postgrest", exeName("postgrest"))
	if _, err := os.Stat(postgrest); err == nil {
		layout.PostgREST = postgrest
	}
	return layout, nil
}

func exeName(base string) string {
	if runtime.GOOS == "windows" {
		return base + ".exe"
	}
	return base
}

// ERPCommand runs the bundled Node on server.js. The name is the bundled
// binary, not a PATH lookup. Postgres is not started.
func ERPCommand(layout Layout, rawURL string, parent []string) (Command, error) {
	if err := policy.AllowEndpoint(rawURL); err != nil {
		return Command{}, err
	}
	if layout.Node == "" || layout.Server == "" {
		return Command{}, ErrIncomplete
	}
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Port() == "" {
		return Command{}, errors.New("erp url needs a port")
	}
	env, err := ChildEnv(parent, u.Port())
	if err != nil {
		return Command{}, err
	}
	return Command{
		Name: layout.Node,
		Args: []string{layout.Server},
		Dir:  filepath.Dir(layout.Server),
		Env:  env,
	}, nil
}

// ChildEnv keeps the process paths, local Supabase values, and a loopback
// Ollama host. Cloud model keys are dropped. A non-loopback Supabase, n8n,
// or Ollama value is an error that does not include the value.
func ChildEnv(parent []string, port string) ([]string, error) {
	port = strings.TrimSpace(port)
	if port == "" {
		return nil, errors.New("port required")
	}
	drop := map[string]bool{
		"OPENROUTER_API_KEY": true,
		"OPENROUTER_MODEL":   true,
		"OPENAI_API_KEY":     true,
		"ANTHROPIC_API_KEY":  true,
		"RESEND_API_KEY":     true,
	}
	keep := map[string]bool{
		"PATH": true, "HOME": true, "TMPDIR": true, "LANG": true,
		"SystemRoot": true, "USERPROFILE": true, "APPDATA": true, "LOCALAPPDATA": true,
		"NEXT_PUBLIC_SUPABASE_ANON_KEY": true,
		"SUPABASE_SERVICE_ROLE_KEY":     true,
	}
	vals := map[string]string{}
	for _, item := range parent {
		key, value, ok := strings.Cut(item, "=")
		if !ok || drop[key] {
			continue
		}
		switch key {
		case "NEXT_PUBLIC_SUPABASE_URL", "N8N_OUTBOUND_URL", "BOOMBIGNOSE_ERP_URL":
			if err := policy.AllowEndpoint(value); err != nil {
				return nil, fmt.Errorf("%s: %w", key, policy.ErrNotLocal)
			}
			if strings.TrimSpace(value) != "" {
				vals[key] = value
			}
		case "OLLAMA_HOST":
			if err := policy.AllowService(value); err != nil {
				return nil, fmt.Errorf("%s: %w", key, policy.ErrNotLocal)
			}
			if strings.TrimSpace(value) != "" {
				vals[key] = strings.TrimSpace(value)
			}
		case "OLLAMA_MODEL":
			if strings.TrimSpace(value) != "" {
				vals[key] = strings.TrimSpace(value)
			}
		case "LOCAL_TOTP_ENROLL":
			if value == "1" {
				vals[key] = "1"
			}
		default:
			if keep[key] && value != "" {
				vals[key] = value
			}
		}
	}
	vals["HOST"] = "127.0.0.1"
	vals["HOSTNAME"] = "127.0.0.1"
	vals["PORT"] = port
	vals["NODE_ENV"] = "production"
	keys := make([]string, 0, len(vals))
	for key := range vals {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+vals[key])
	}
	return env, nil
}

// PullArgs is the documented local model pull. Callers must not run it
// from the window start path.
func PullArgs() []string {
	return []string{"pull", LocalModel}
}

// OllamaBinary prefers the bundled binary, then PATH.
func OllamaBinary(layout Layout, pathLookup func(string) (string, error)) (string, error) {
	if layout.Ollama != "" {
		return layout.Ollama, nil
	}
	if pathLookup == nil {
		pathLookup = exec.LookPath
	}
	found, err := pathLookup("ollama")
	if err != nil || found == "" {
		return "", ErrNoOllama
	}
	return found, nil
}

// OllamaServe is `ollama serve` bound to loopback. The error never contains
// a refused host.
func OllamaServe(binary, host string) (Command, error) {
	if strings.TrimSpace(binary) == "" {
		return Command{}, ErrNoOllama
	}
	if err := policy.AllowService(host); err != nil {
		return Command{}, err
	}
	listen := DefaultOllamaListen
	if strings.TrimSpace(host) != "" {
		listen = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(host), "https://"), "http://")
	}
	return Command{
		Name: binary,
		Args: []string{"serve"},
		Env:  []string{"OLLAMA_HOST=" + listen},
	}, nil
}

// Runner starts a command. The wait function blocks until the process exits.
type Runner func(Command) (wait func() error, kill func(), err error)

func defaultRunner(cmd Command) (func() error, func(), error) {
	proc := exec.Command(cmd.Name, cmd.Args...)
	if cmd.Dir != "" {
		proc.Dir = cmd.Dir
	}
	proc.Env = cmd.Env
	proc.Stdout = os.Stdout
	proc.Stderr = os.Stderr
	if err := proc.Start(); err != nil {
		return nil, nil, err
	}
	if recordERP && erpPIDDir != "" && proc.Process != nil {
		_ = writePID(erpPIDDir, proc.Process.Pid)
	}
	return proc.Wait, func() {
		if proc.Process != nil {
			_ = proc.Process.Kill()
		}
	}, nil
}

// EnsureERP starts the bundled server when the ERP port is closed.
// It does not start Postgres and it does not pull a model.
func EnsureERP(ctx context.Context, layout Layout, rawURL string, parent []string, run Runner) error {
	up, err := launch.Listening(rawURL)
	if err != nil {
		return err
	}
	if up {
		return nil
	}
	cmd, err := ERPCommand(layout, rawURL, parent)
	if err != nil {
		return err
	}
	if run == nil {
		run = defaultRunner
	}
	wait, _, err := run(cmd)
	if err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- wait() }()
	return launch.WaitUntil(ctx, 50*time.Millisecond, func() bool {
		ok, _ := launch.Listening(rawURL)
		return ok
	}, exited)
}

// EnsureOllama starts a local daemon when a binary exists and the port is
// closed. A missing binary is success. The process arguments are only serve.
func EnsureOllama(ctx context.Context, layout Layout, host string, pathLookup func(string) (string, error), run Runner) error {
	binary, err := OllamaBinary(layout, pathLookup)
	if errors.Is(err, ErrNoOllama) {
		return nil
	}
	if err != nil {
		return err
	}
	cmd, err := OllamaServe(binary, host)
	if err != nil {
		return err
	}
	listenURL := "http://" + DefaultOllamaListen
	if len(cmd.Env) == 1 {
		if _, value, ok := strings.Cut(cmd.Env[0], "="); ok && value != "" {
			listenURL = "http://" + value
		}
	}
	up, err := launch.Listening(listenURL)
	if err != nil {
		return err
	}
	if up {
		return nil
	}
	if run == nil {
		run = defaultRunner
	}
	wait, _, err := run(cmd)
	if err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- wait() }()
	return launch.WaitUntil(ctx, 50*time.Millisecond, func() bool {
		ok, _ := launch.Listening(listenURL)
		return ok
	}, exited)
}
