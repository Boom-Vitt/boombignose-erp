# Security Policy

## Supported Versions

Security fixes are made on the `main` branch. Update to the latest commit before you report.

## Reporting a Vulnerability

Please do not report security problems in public issues, discussions or pull requests.

Report them privately through GitHub Security Advisories: open the **Security** tab of this repository and choose **Report a vulnerability**, or go to <https://github.com/Boom-Vitt/boombignose-erp-harness-ai/security/advisories/new>.

If the **Report a vulnerability** button is not available, contact us privately through <https://boombignose.org> and ask for a secure channel. Leave exploit details out of that first message.

Include:

- what is affected (route, module or file) and the commit you tested
- the edition (Community or Pro)
- steps to reproduce, or a proof of concept
- the impact you expect, for example data from one organization becoming visible to another

We will confirm that we received your report, keep you informed while we work on it, and credit you in the advisory if you want. Please give us time to release a fix before you disclose the issue publicly.

## Scope

In scope: the application in this repository, its database migrations and Row Level Security policies, the Pro code in `ee/`, and the API routes under `app/api/`.

Out of scope: the demo accounts and seed data, which are public by design and meant for local development only, and problems in third-party services such as Supabase, n8n or email providers. Report those to the vendor.
