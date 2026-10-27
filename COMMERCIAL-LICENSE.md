# Community Edition dual licensing and commercial terms

Copyright © 2026 BoomBigNose AI Co., Ltd.

Company-owned BoomBigNose Company OS Community Edition materials are available
under either of these alternatives, at your choice:

1. **AGPL-3.0-only**: the GNU Affero General Public License, version 3 only,
   reproduced in full and unmodified in [LICENSE](LICENSE). Commercial use is
   allowed under the AGPL when you comply with its terms, including applicable
   source-availability obligations for network use and distribution.
2. **BoomBigNose Commercial**: a separate written commercial license from
   BoomBigNose AI Co., Ltd., for organizations that need different terms, such
   as permission to incorporate Community code in proprietary offerings
   without the AGPL obligations. The signed agreement defines the scope,
   fees, support, and permitted deployment. This document explains the offer;
   it does not itself grant a commercial license.

Package metadata expresses this as
`AGPL-3.0-only OR LicenseRef-BoomBigNose-Commercial`.

## Scope and exclusions

The Community offer applies to company-owned repository materials except:

- **Pro (`ee/`)**: commercial source-available code governed exclusively by
  [ee/LICENSE](ee/LICENSE). It may be inspected and developed locally under
  those terms, but production use requires a written commercial agreement
  expressly covering Pro. Community's AGPL option does not cover Pro.
- **BoomBigNose (`bignose/`)**: a separate proprietary/commercial product under
  [bignose/LICENSE](bignose/LICENSE). Its code and packages are excluded from
  both Community alternatives, even though this repository contains them.
- **Third-party materials**: their own licenses/notices control; see
  [NOTICE](NOTICE). No alternative license is offered for rights the company
  does not hold.
- **Trademarks**: no rights to the BoomBigNose name or logo are granted;
  [TRADEMARK.md](TRADEMARK.md) applies to branding and forks.

The default build is Community and supports single-org setup and invitations
without Pro sources. An explicit `BBN_EDITION=pro` build includes the commercial
integrations. Importing Pro through an edition entry point does not make it AGPL.
Production deployment using Pro requires commercial rights covering the
combined application. See [the boundary inventory](docs/OPEN_CORE_BOUNDARY.md).

Contributors retain ownership and grant the company the licensing rights in
[CLA.md](CLA.md), allowing Community contributions to be offered under both
open-source and commercial terms.

For a commercial agreement, contact **https://boombignose.org**.
