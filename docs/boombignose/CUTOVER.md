# Cutover to the BoomBigNose ERP Harness AI shell

`boombignose cutover` with no subcommand prints the plan. It does not connect to Postgres.

These subcommands move data only between two databases on `127.0.0.1` or `::1`. A password in the URL is refused, and the error does not include the URL. A host other than loopback is refused before any tool starts.

```sh
boombignose cutover dry-run --source 'postgresql://USER@127.0.0.1:PORT/DATABASE' --target 'postgresql://USER@127.0.0.1:PORT/DATABASE'
boombignose cutover apply --source 'postgresql://USER@127.0.0.1:PORT/DATABASE' --target 'postgresql://USER@127.0.0.1:PORT/DATABASE' --backup /absolute/path/target.dump
boombignose cutover rollback --target 'postgresql://USER@127.0.0.1:PORT/DATABASE' --backup /absolute/path/target.dump
```

`dry-run` lists base-table names and writes no file. `apply` runs that read first. It then writes a Postgres custom-format dump of the target to `--backup`. That file is the rollback copy. It dumps the source to a temporary file, restores that dump into the target, and deletes the temporary file. If the restore fails, it restores `--backup` into the target. `rollback` restores `--backup` and leaves the file in place. The backup path must be absolute, end in `.dump`, and must not already exist when `apply` starts.

The tools are `psql`, `pg_dump`, and `pg_restore`. `BOOMBIGNOSE_PG_BIN` selects their directory. Otherwise they come from `PATH`. The child environment is `PATH` and `LC_ALL=C`. No password is forwarded.

The harness test starts two throwaway clusters on `127.0.0.1`. The source row says `moved` and the target row says `original`. Dry-run does not create the backup. Apply leaves `moved` on the target. Rollback puts `original` back. The source row stays `moved`. That test does not read a hosted database and does not move an ERP schema.

After the data move, start the ERP on `http://127.0.0.1:3100` and run `boombignose check`. Leave cloud model keys unset.
