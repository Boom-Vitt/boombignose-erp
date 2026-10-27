package bundle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWindowsUninstallLeavesTheDataDirectory(t *testing.T) {
	script := windowsInstallerScript(t)
	section := nsisSection(t, script, "Uninstall")
	for _, line := range strings.Split(section, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "Delete ") && !strings.HasPrefix(trimmed, "RMDir ") {
			continue
		}
		if !strings.Contains(trimmed, "$INSTDIR") && !strings.Contains(trimmed, "$SMPROGRAMS") {
			t.Fatalf("uninstall path is outside the install directory: %s", trimmed)
		}
	}
	for _, forbidden := range []string{"BOOMBIGNOSE_DATA", ".local", "USERPROFILE", "postmaster.pid", "PG_VERSION", "server.log"} {
		if strings.Contains(section, forbidden) {
			t.Fatalf("uninstall section mentions %s", forbidden)
		}
	}
	for _, required := range []string{
		`Delete "$INSTDIR\BoomBigNose.exe"`,
		`RMDir /r "$INSTDIR\bundle"`,
		`RMDir "$INSTDIR"`,
	} {
		if !strings.Contains(section, required) {
			t.Fatalf("uninstall section missing %s", required)
		}
	}
	for _, line := range strings.Split(section, "\n") {
		if strings.TrimSpace(line) == `RMDir /r "$INSTDIR"` {
			t.Fatal("uninstall must not recursively delete the install directory")
		}
	}
}

func windowsInstallerScript(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		candidate := filepath.Join(dir, "packaging", "windows", "boombignose.nsi")
		body, err := os.ReadFile(candidate)
		if err == nil {
			return string(body)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("boombignose.nsi not found")
		}
		dir = parent
	}
}

func nsisSection(t *testing.T, script, name string) string {
	t.Helper()
	marker := `Section "` + name + `"`
	start := strings.Index(script, marker)
	if start < 0 {
		t.Fatalf("missing section %s", name)
	}
	rest := script[start:]
	end := strings.Index(rest, "SectionEnd")
	if end < 0 {
		t.Fatalf("section %s has no SectionEnd", name)
	}
	return rest[:end]
}
