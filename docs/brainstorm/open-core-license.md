# Open-Core & License Strategy — BoomBigNose Company OS

> **Status:** Draft recommendation for review. The founder makes the final call.
> **Context:** Internal-first AI-native Company OS / lightweight ERP. Possible future open-core play: free **Community Edition** + paid **Pro Edition** (hosted SaaS, advanced AI agents, automation packs, multi-tenant admin, advanced permissions, client portal, FlowAccount/PEAK integration, white-label, support/SLA).
> **Goal of this doc:** compare license options, recommend one primary strategy, draw the Community/Pro line, and list open-core hygiene practices. Nothing here is legal advice — confirm with a Thai-qualified lawyer before publishing a license.

---

## 1. License comparison

| License / model | What it allows | Copyleft / network clause | Competitor can host as SaaS? | Friendly to a future paid hosted edition? | Community-adoption friction | Notes |
|---|---|---|---|---|---|---|
| **AGPLv3** | Use, modify, redistribute; full OSI open source | **Strong copyleft + network clause (§13):** anyone who *runs a modified version over a network* must offer the **complete corresponding source** to those users | **Yes, but** they must open-source their modifications and offer source to their users | **High (as the open core of a dual-license)** — the network clause deters closed SaaS forks and pushes commercial users toward your commercial license | **Medium–High:** many companies' policies ban AGPL; can scare some enterprise/legal teams | True open source (FSF/OSI approved). The standard "protect against cloud free-riders while staying genuinely open" choice. Pairs naturally with a dual license. |
| **Apache-2.0 / MIT** (permissive) | Use, modify, redistribute, **including in closed/proprietary products**; Apache adds an explicit patent grant | **None.** No copyleft, no network clause | **Yes — freely, with no obligation to share anything back** | **Low protection:** a cloud provider can take your Community Edition and run a competing hosted service with zero reciprocity | **Lowest:** maximum adoption, trusted by everyone, no policy blockers | Best for libraries/SDKs and pure ecosystem growth. Worst for protecting a hosted-SaaS business model. Apache-2.0 ≫ MIT for a product (patent + trademark clarity). |
| **PolyForm Noncommercial 1.0.0** | Use, modify, share **for any non-commercial purpose only** | No copyleft; instead a **field-of-use restriction** — commercial use is prohibited without a separate license | **No** — hosting it commercially is not permitted | **Medium:** protects the paid edition (commercial users *must* buy a license), but the restriction *is* the product gate, not a copyleft mechanism | **High:** **not** OSI open source; businesses can't use it in commercial ops, which kills a lot of organic adoption and most ecosystem contribution | "Source-available." Good when you want code visible + free for hobbyists/eval but every business must pay. Heavier adoption tax than AGPL. |
| **BUSL 1.1 / source-available** | Source is public; use allowed **except** the use the **Additional Use Grant** carves out — typically "non-production" or "not a competing hosted service" | No traditional copyleft. **Time-delayed conversion:** each release auto-relicenses to a stated **Change License** (commonly Apache-2.0/GPL) on the **Change Date** (max 4 years out) | **No, during the restricted window** (the grant forbids competing production/SaaS use); **Yes, later**, once that version converts | **High:** explicitly designed to block cloud free-riders *now* while promising eventual openness | **Medium–High:** **not** OSI open source during the window; some users/distros avoid it; perceived as "fake open source" by purists | You control the Additional Use Grant wording (e.g., "production use up to N users free; competing hosted service prohibited"). Used by HashiCorp, Sentry, CockroachDB. Most flexible knob; most explaining required. |
| **Dual-license** (e.g., **AGPLv3 OR Commercial**) | Users pick a lane: comply with the open license (AGPL), **or** buy a commercial license that waives copyleft | Inherits the open side's clause (AGPL network copyleft) until the buyer opts into the commercial terms | Only under the open terms (so they inherit AGPL obligations); buying the commercial license is what removes them | **Highest:** this *is* the monetization lever — the open license's obligations are uncomfortable enough that serious commercial users pay to escape them | **Medium:** same as the open half; needs a **CLA** so you hold the rights to relicense | Requires you to own/aggregate copyright (via CLA) to sell commercial exceptions. The proven open-core money model (MySQL, GitLab, Grafana-style). |

**Accuracy notes:** AGPL's defining feature is the §13 network-use clause — interacting with the software *over a network* triggers the source-offer duty (closing the "SaaS loophole" in GPL). BUSL is **source-available, not open source**, and its hallmark is the automatic time-delayed conversion to an open Change License on the Change Date. PolyForm Noncommercial bans **all** commercial use, not just hosting. Apache/MIT impose **no** reciprocity at all.

---

## 2. Recommendation

**Primary strategy: dual-license the Community Edition under AGPLv3, with a commercial license available; keep the Pro Edition proprietary in a separate repo.** (often written **"AGPLv3 OR Commercial"**.)

**Why this fits BoomBigNose's situation:**
- **Community adoption with a moat.** AGPL is *genuine* open source, so it earns trust, GitHub stars, and contributors — but the §13 network clause means a cloud provider can't quietly wrap the Community Edition into a competing hosted service without open-sourcing their changes and offering source to users. That neutralizes the "AWS-clones-your-product" risk that pure Apache/MIT leaves wide open.
- **Built-in upgrade path to revenue.** The companies who *can't* live with AGPL's reciprocity (agencies, white-label resellers, anyone embedding it in a closed product) are exactly your commercial-license / Pro buyers. The license does the qualifying for you.
- **Small-team friendly.** AGPL is off-the-shelf, well-understood, and needs no custom legal drafting — unlike BUSL's Additional Use Grant, which you'd have to write, defend, and explain. Lower legal-maintenance burden matters with a small team.
- **Internal-first is fine today.** While the product is internal-only you can stay all-rights-reserved/private and decide the public license at first release. Adopt a **DCO or CLA from day one** so the dual-license option stays open later (you can't easily relicense contributions you don't have rights to).

**Main trade-off:** AGPL carries real adoption friction — a meaningful slice of enterprises have blanket "no AGPL" policies, so you trade some top-of-funnel reach for protection and a clean monetization lever. If maximizing raw adoption mattered more than protecting a hosted business, permissive Apache-2.0 would win; if you wanted to *guarantee* no competing hosted service at all (not merely make it unattractive) and accept "not open source," **BUSL** is the alternative — keep it as plan B.

*The founder makes the final call; this is a recommendation, not a commitment.*

---

## 3. Community vs Pro boundary

| Capability | Community Edition (free / open, AGPL) | Pro Edition (paid, proprietary) |
|---|---|---|
| Core CRM (contacts, companies) | ✅ | ✅ |
| Deals / pipeline | ✅ | ✅ |
| Projects & tasks | ✅ | ✅ |
| Finance / expense tracker | ✅ | ✅ |
| Dashboard & reporting | ✅ (standard) | ✅ + advanced/custom analytics |
| Template library | ✅ | ✅ + premium/curated packs |
| Single-org / self-hosted | ✅ (single tenant, self-managed) | — |
| **Hosted multi-tenant SaaS** | — | ✅ (we run it; nothing to self-host) |
| **Advanced AI agents** (autonomous workflows, deep automations) | basic/assistive only | ✅ full agent suite |
| **Automation packs** (prebuilt industry workflows) | — | ✅ |
| **Multi-tenant admin & advanced permissions / RBAC** | basic roles | ✅ granular RBAC, org/tenant admin |
| **Client portal** | — | ✅ |
| **Accounting integrations** (FlowAccount / PEAK) | — | ✅ |
| **White-label / custom branding** | — | ✅ |
| **Support & SLA** | community / best-effort | ✅ priced SLA tiers |

**Boundary principle:** Community = a genuinely useful single-org Company OS that a solo founder or small team can self-host and love. Pro = anything that is **(a)** operationally expensive for us to run (hosted multi-tenant, SLA), **(b)** high-leverage automation (advanced agents, automation packs), or **(c)** sold to businesses serving *other* businesses (white-label, client portal, accounting integrations). Don't cripple the core to sell Pro — protect the *hosting and the advanced automation*, not the basics.

---

## 4. Open-core hygiene

- **Keep Pro code out of the open repo.** The AGPL obligation only attaches to code you actually distribute under AGPL. Put Pro-only modules in a **separate private repository** (cleanest) or, at minimum, a clearly separated `ee/` (enterprise edition) directory/package with its **own proprietary `LICENSE`**, the way GitLab/Grafana do. Never let AGPL'd and proprietary code share a compiled artifact in a way that could be argued to create a derivative work — keep the boundary at a plugin/API/extension-point seam.
- **CLA vs DCO — decide before the first external contributor.**
  - **DCO** (`Signed-off-by` per commit): lightweight, no rights transfer; fine for a *single*-license project, but **does not** by itself give you the right to relicense contributions into the commercial half of a dual license.
  - **CLA** (contributors grant you a broad license / copyright assignment): heavier process, but **required** to safely run the dual-license / commercial-exception model, because you must hold sufficient rights to relicense. **For the recommended AGPL-OR-commercial strategy, use a CLA.**
  - Adopt whichever you choose **from the first public commit** — retrofitting consent from past contributors is painful or impossible.
- **Trademark — separate the code license from the name.** Open-sourcing the code does **not** open-source the **"BoomBigNose"** name or logo. State explicitly that the trademark is **not** licensed under the AGPL, that forks must be **renamed/rebranded** and may not imply endorsement, and reserve "BoomBigNose" for official builds. **Register the BoomBigNose word mark** (and logo) in Thailand, and in any other target market, before a public launch. Apache-2.0 already disclaims trademark grants; with AGPL, add an explicit `TRADEMARK.md` / `NOTICE` to make the same point.
- **Make the edition split legible.** Ship a top-level `LICENSE` (AGPL) + `LICENSE.commercial` (or a "Commercial license available — contact …" note), a short `COMMUNITY-vs-PRO.md`, and per-directory license headers so contributors and users always know which terms apply to the file in front of them.

---

*Prepared for internal review. Not legal advice. Confirm license choice, CLA wording, and trademark filings with qualified Thai counsel before any public release.*
