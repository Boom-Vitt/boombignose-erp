// Package cutover moves rows between two loopback Postgres databases.
// The bare plan does not open a connection. dry-run only reads table names.
// apply writes a backup of the target before it restores the source.
package cutover

import (
	"fmt"
	"strings"
)

// Plan is the operator checklist. It does not connect to a database.
func Plan() string {
	lines := []string{
		"BoomBigNose ERP Harness AI cutover plan",
		"1. Stop the program that is already listening on 127.0.0.1:3100.",
		"2. `boombignose cutover` with no subcommand does not connect to a database.",
		"3. `boombignose cutover dry-run --source URL --target URL` reads table names on two loopback databases and writes nothing.",
		"4. `boombignose cutover apply --source URL --target URL --backup FILE.dump` dumps the target to FILE first, then restores the source into the target. FILE is the rollback copy.",
		"5. `boombignose cutover rollback --target URL --backup FILE.dump` restores that file into the target.",
		"6. A URL must be postgresql://user@127.0.0.1:port/database or postgresql://user@::1:port/database, with no password. Any other host is refused.",
		"7. Start the ERP on http://127.0.0.1:3100 and run `boombignose check`.",
		"8. Leave cloud model keys unset. Local rules stay on this machine.",
	}
	return strings.Join(lines, "\n") + "\n"
}

// RefuseApply reports that a database move was not requested.
func RefuseApply() error {
	return fmt.Errorf("refusing to apply a cutover: pass dry-run, apply, or rollback")
}
