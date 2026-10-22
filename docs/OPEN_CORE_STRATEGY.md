# Open-Core & License Strategy

> Summary of `docs/brainstorm/open-core-license.md`, elevated to a product
> decision doc. **Not legal advice** — confirm with Thai counsel before any public
> release. The founder makes the final call; nothing here is hardcoded into the code.

## Decision (2026-10-22): **AGPL-3.0-only OR Commercial**

The owner selected this model. Community is licensed under `LICENSE` or a
separate commercial agreement; Pro implementations were separated into `ee/`
before relicensing. `bignose/` remains a separate proprietary product.
See [OPEN_CORE_BOUNDARY.md](OPEN_CORE_BOUNDARY.md) for the source inventory,
shared database-contract interpretation, and packaging limits.

The comparison below records the strategy rationale.

License the open **Community Edition** under **AGPL-3.0-only**, and offer a separate
**Commercial license** for anyone who can't accept copyleft.

- **Why AGPL:** its network-use clause (§13) requires operators of modified
  versions to offer corresponding source to remote users. Compliant commercial
  hosting is permitted; the license does not ban competing SaaS. See
  [AGPL §13](https://www.gnu.org/licenses/agpl-3.0.html#section13).
- **Why dual:** the commercial license is the built-in monetization lever and the
  escape hatch for enterprises with "no-AGPL" policies.
- **Main trade-off:** AGPL deters some enterprises (smaller top-of-funnel) in
  exchange for protection + a clean upsell. **Plan B:** BUSL (source-available,
  time-delayed open-source conversion) if you want to outright forbid competing
  hosted use; **Apache-2.0** if raw adoption outweighs protection.

## License options compared

| License | Copyleft / network clause | Competitor can host as SaaS? | Friendly to paid hosted edition? | Adoption friction |
|---|---|---|---|---|
| **AGPLv3** | Strong + network (§13) | Must open their changes | Yes (via dual-license) | Medium |
| Apache-2.0 / MIT | None | Freely | Weakest protection | Lowest |
| PolyForm Noncommercial | Bans all commercial use | No | N/A (not OSS) | High for adopters |
| BUSL / source-available | Time-delayed → OSS later | No (until Change Date) | Strong | Medium-High |
| **Dual (AGPL OR Commercial)** | AGPL unless commercial terms are agreed | Yes, with AGPL compliance or a commercial agreement | **Best fit** | Medium |

## Community vs Pro boundary

| Community (free, self-host) | Pro (paid / hosted) |
|---|---|
| Core CRM, deals, projects, finance tracker | Hosted multi-tenant SaaS |
| Dashboard, template library | Advanced AI agents + automation packs |
| Single org, owner/admin/member | Real multi-org UX, SSO, advanced RBAC |
| n8n webhook hooks | Client portal, white-label |
| | FlowAccount/PEAK/Xero accounting integrations |
| | Support / SLA |

**Principle:** protect the *hosting and advanced automation*, not the basics.
Keep the seams clean in V1 (the `org_id` everywhere + module boundaries already
do this) so the split is repackaging, not a rewrite.

## Open-core hygiene

- Keep Pro-only code out of the open repo (a separate private repo or an `ee/`
  package with its own license).
- Adopt a **CLA from day one** — a DCO alone can't support relicensing for the
  dual-license model.
- Treat **"BoomBigNose" as an unlicensed trademark**: register the word mark in
  Thailand and require forks to rebrand.
