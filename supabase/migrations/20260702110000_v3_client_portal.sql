-- BoomBigNose Company OS — V3 Batch 3: client portal share tokens.
-- A per-client, opt-in, unguessable token grants a read-only portal at
-- /portal/[token] where the client can see their quotes, invoices, and projects
-- and take a couple of actions (accept a quote, mark an invoice paid). The portal
-- is served server-side with the service-role client, scoped strictly to the
-- token's client_id — so no new RLS policy is required. Portal is OFF until an
-- org member explicitly enables it and a token is minted.

alter table clients add column portal_enabled boolean not null default false;
alter table clients add column portal_token   text unique;

create index on clients (portal_token);
