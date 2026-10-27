# Cutover to the Bumik shell

`bumik cutover` prints this plan. It does not connect to Postgres, and it does not read or write rows.

1. Stop whatever is already bound to `127.0.0.1:3100`. BigNose OS serves the ERP on that port. Leave its local database running.
2. Do not run `supabase db reset`, do not restore a dump, and do not point the app at a hosted Supabase project.
3. Start the ERP on `http://127.0.0.1:3100` with cloud model keys unset.
4. Run `bumik check`. It exits non-zero if a refused key is set or if `NEXT_PUBLIC_SUPABASE_URL`, `N8N_OUTBOUND_URL`, or `BUMIK_ERP_URL` is not loopback.
5. Open the milestone 1 window to that loopback URL only.

There is no data migration. The same local database remains the database.
