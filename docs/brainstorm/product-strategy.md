# Product Strategy — BoomBigNose Company OS

BoomBigNose AI (founder + 2 junior devs, lean runway) is building an AI-native **operational layer** for a Thai AI-education and workflow-automation studio: CRM, project delivery, finance visibility, automation, and management dashboards. It is explicitly **not an ERP** — accounting/tax stays in FlowAccount/PEAK/Xero. This doc fixes the MVP scope, ICPs, roadmap, and the open-core boundary. (Note: the repo is named `boombignose-erp` for historical reasons; the product is a Company OS, not an ERP.)

## 1. Three product directions

| Direction | Pro | Con |
|---|---|---|
| **A. Internal Company OS** — we run our own studio on it first | Solves a problem we feel daily; demo data + dogfooding double as the sales pitch; zero external onboarding burden; ships within current 3-person capacity | No direct revenue yet; risk of building only for ourselves if module seams aren't kept generic |
| **B. SME SaaS** — multi-tenant hosted product from day one | Largest market (Thai SMEs, creators, education); recurring revenue | A 3-person team can't carry multi-tenant ops + sales + Thai-language onboarding + support now; premature for current runway |
| **C. Open-core licensed product** — Community (self-host) + Pro (hosted) | Distribution via open source; community contributions; Pro upsell funds the team | Requires a hardened, documented, genuinely multi-tenant core — months of work before it pays off |

## 2. Recommendation

**Pursue A (Internal Company OS) as the MVP, architected so it becomes C (open-core) later.** We dogfood the six modules running our own studio; the working instance is our proof and our demo. Crucially, we build it **multi-tenant-ready now** (`org_id` on every table, clean module boundaries, no hard-coded single-org assumptions) so the leap to open-core is a packaging exercise, not a rewrite. **B is the trap**: multi-tenant SaaS plus sales plus support exceeds what 3 people on lean runway can sustain today — we earn the right to it through C, not before. Decision: ship A, design for C, skip standalone B.

## 3. ICPs / personas

| Persona | Who | Core jobs-to-be-done |
|---|---|---|
| **Founder-operator** (primary) | The founder running the studio | "Show me pipeline, project health, and cash-in/cash-out on one dashboard"; "stop deals and follow-ups from slipping"; "see which projects are late or over-budget without a spreadsheet" |
| **Junior delivery dev** (primary) | One of the 2 developers delivering client work | "Know what's assigned to me and what's due"; "log activities and update tasks/milestones fast"; "trigger an n8n automation from a template without writing glue code" |
| **Future SME owner** (secondary, for C) | Thai SME / creator / education-business owner | "Track clients and invoices in THB in one place"; "self-host or buy hosted without an IT team"; "automate repetitive ops via prebuilt templates" |

The two primary personas are *us* — we are the first customer. The SME owner shapes architecture decisions today but is not a V1 user.

## 4. Roadmap

**V1 (now) — dogfood the studio**
- CRM: clients, contacts, deals, activities/follow-ups
- Projects: projects, tasks, milestones
- Finance: invoices, payments, costs (visibility only, THB)
- Templates: automation_templates, template_categories
- Automation: n8n webhooks
- Dashboard: pipeline, project health, cash snapshot
- Foundations: Supabase Auth, roles (owner/admin/member), `org_id` everywhere, demo data (fake Thai SMEs)

**V2 — hardening + accounting integration**
- FlowAccount/PEAK/Xero one-way sync (invoices/payments out)
- Richer dashboards, saved views, basic reporting/exports
- More automation templates + a template gallery
- AI assists: follow-up drafting, deal/project summaries

**V3 — open-core readiness**
- Real multi-org switching UX + org-level admin
- Self-host packaging, docs, seed/migration tooling
- Pro tier: hosted, SSO, support SLA, advanced automation
- Thai-language polish for external SMEs

## 5. What NOT to build (non-goals)

Guard hard against ERP scope creep. V1 will **not** include:
- Inventory or warehouse management
- Procurement / purchase orders
- Payroll
- A legal accounting/tax/GL engine — defer entirely to FlowAccount/PEAK/Xero
- Manufacturing, POS, or supply-chain modules
- Multi-org switching **UX** in V1 (data model is ready; UI stays single-org)
- Native mobile apps (responsive web only)
- Per-client custom forks or bespoke one-off features
- Heavy BI / custom report-builder (basic dashboards only)

If a request implies double-entry bookkeeping or stock tracking, it is out of scope by definition.

## 6. Community vs Pro boundary

High-level split, gated on **what 3 people can maintain**:

| | Community (free / open, self-host) | Pro (paid / hosted) |
|---|---|---|
| **Core modules** | CRM, Projects, Finance visibility, Templates, Dashboard | Same, fully managed |
| **Automation** | n8n webhooks, basic templates | Advanced/premium templates, AI automations |
| **Tenancy** | Single-org self-host | Multi-org, org admin, role management at scale |
| **Auth** | Supabase email/password | SSO / SAML |
| **Ops** | Community support, docs | Hosting, backups, support SLA, onboarding |

Principle: the **self-hostable core is free** to drive adoption and contributions; **convenience, scale, and assurance are paid**. Nothing in V1 needs the Pro line decided in detail — only that the seams (auth, tenancy, automation tiers) are kept clean so the boundary can be drawn later without a rewrite.
