// Package launch starts the local ERP when the desktop window cannot see it.
// It only accepts a loopback URL. It does not embed Node, Docker, or a model.
package launch

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose/internal/policy"
)

// ErrNotCheckout means the directory is not this ERP tree.
var ErrNotCheckout = errors.New("erp checkout not found")

// ProjectID is the local Supabase project id. It is not the GitHub repository slug.
const ProjectID = "boombignose-erp"

// Addr returns host:port for a loopback ERP URL.
func Addr(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || u.Port() == "" {
		return "", errors.New("erp url needs a host and port")
	}
	return net.JoinHostPort(u.Hostname(), u.Port()), nil
}

// Listening reports whether something accepts TCP on the ERP address.
// A refused connection is a false result, not an error.
func Listening(raw string) (bool, error) {
	addr, err := Addr(raw)
	if err != nil {
		return false, err
	}
	conn, err := net.DialTimeout("tcp", addr, 400*time.Millisecond)
	if err != nil {
		return false, nil
	}
	_ = conn.Close()
	return true, nil
}

// ValidCheckout reports whether dir contains the local stack script and the
// expected Supabase project id.
func ValidCheckout(dir string) bool {
	if dir == "" {
		return false
	}
	script := filepath.Join(dir, "scripts", "local", "stack.mjs")
	if _, err := os.Stat(script); err != nil {
		return false
	}
	config, err := os.ReadFile(filepath.Join(dir, "supabase", "config.toml"))
	if err != nil {
		return false
	}
	return strings.Contains(string(config), `project_id = "`+ProjectID+`"`)
}

// FindCheckout returns explicit when it is a checkout. Otherwise it walks
// upward from each start path. It does not search the whole disk.
func FindCheckout(explicit string, starts []string) string {
	if ValidCheckout(explicit) {
		return explicit
	}
	for _, start := range starts {
		dir := start
		if dir == "" {
			continue
		}
		for i := 0; i < 8; i++ {
			if ValidCheckout(dir) {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return ""
}

// ServeCommand is `node scripts/local/stack.mjs serve --port <port>`.
func ServeCommand(dir, node, rawURL string) (string, []string, error) {
	if err := policy.AllowEndpoint(rawURL); err != nil {
		return "", nil, err
	}
	if !ValidCheckout(dir) {
		return "", nil, ErrNotCheckout
	}
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Port() == "" {
		return "", nil, errors.New("erp url needs a port")
	}
	if node == "" {
		node = "node"
	}
	args := []string{
		filepath.Join(dir, "scripts", "local", "stack.mjs"),
		"serve",
		"--port",
		u.Port(),
	}
	return node, args, nil
}

// WaitUntil returns when ready is true, when the start process exits, or when
// ctx ends. A nil exited channel waits only for ready or ctx.
func WaitUntil(ctx context.Context, every time.Duration, ready func() bool, exited <-chan error) error {
	if ready == nil {
		return errors.New("missing ready check")
	}
	if every <= 0 {
		every = 200 * time.Millisecond
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		if ready() {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err, ok := <-exited:
			if !ok {
				return errors.New("local stack stopped")
			}
			if err != nil {
				return fmt.Errorf("local stack exited: %w", err)
			}
			return errors.New("local stack exited before it was ready")
		case <-tick.C:
		}
	}
}

// Runner starts a process and returns a wait function and a kill function.
type Runner func(name string, args []string, dir string) (wait func() error, kill func(), err error)

func defaultRunner(name string, args []string, dir string) (func() error, func(), error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	return cmd.Wait, func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}, nil
}

// Ensure opens an ERP that is already listening, or starts the local stack
// from a checkout and waits until the port accepts a connection.
// On timeout the start process is left running so a long build can finish.
func Ensure(ctx context.Context, dir, node, rawURL string, run Runner) error {
	up, err := Listening(rawURL)
	if err != nil {
		return err
	}
	if up {
		return nil
	}
	if dir == "" {
		return ErrNotCheckout
	}
	name, args, err := ServeCommand(dir, node, rawURL)
	if err != nil {
		return err
	}
	if run == nil {
		run = defaultRunner
	}
	wait, _, err := run(name, args, dir)
	if err != nil {
		return err
	}
	exited := make(chan error, 1)
	go func() { exited <- wait() }()
	return WaitUntil(ctx, 200*time.Millisecond, func() bool {
		ok, _ := Listening(rawURL)
		return ok
	}, exited)
}
