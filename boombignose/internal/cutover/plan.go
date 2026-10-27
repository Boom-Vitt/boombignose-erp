// Package cutover prints the local switch plan. It never opens a database
// connection and it never copies or deletes rows.
package cutover

import (
	"fmt"
	"strings"
)

// Plan is the operator checklist for moving a browser session to the
// BoomBigNose shell. Only one program may listen on port 3100.
func Plan() string {
	lines := []string{
		"BoomBigNose ERP Harness AI cutover plan (no data is read or written)",
		"1. Stop the program that is already listening on 127.0.0.1:3100.",
		"2. Keep the existing local database. Do not export, reset, or restore it for this switch.",
		"3. Start the ERP on http://127.0.0.1:3100.",
		"4. Run `boombignose check` and refuse the start if a cloud key or a non-loopback URL is set.",
		"5. Open the webview to that loopback URL. Do not point it at GitHub Pages.",
		"6. Leave cloud model keys unset. Local rules stay on this machine.",
	}
	return strings.Join(lines, "\n") + "\n"
}

// RefuseApply reports that applying a cutover against a database is out of scope.
func RefuseApply() error {
	return fmt.Errorf("refusing to apply a cutover: this command does not connect to a database")
}
