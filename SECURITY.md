# Security Policy

## Supported Versions

This project currently supports security fixes on the latest code in the default branch.
Older snapshots, forks, and unpublished local environments should be treated as unsupported
unless maintainers explicitly say otherwise.

## Reporting a Vulnerability

Please do not open a public GitHub issue for security problems.

Use one of these private channels instead:

1. GitHub Private Vulnerability Reporting, if it is enabled for the repository.
2. A direct private channel with the maintainers if you already have one.

When reporting, include:

- A short description of the issue and affected surface.
- Reproduction steps or a proof of concept.
- Impact assessment.
- Any relevant environment assumptions.
- Whether the issue has been disclosed anywhere else.

## Response Expectations

- We aim to acknowledge reports promptly.
- We may ask for clarification, logs, or a reduced repro.
- Please allow time for investigation, remediation, and coordinated disclosure before
  sharing details publicly.

## Scope

High-priority areas for this repository include:

- Authentication and session handling.
- Convex authorization boundaries and data ownership checks.
- Server-to-server secrets and provider credentials.
- Slack, Stripe, and WorkOS integrations.
- Desktop/mobile session transfer flows.
- AI interaction and tool execution surfaces.

## Enterprise Launch Controls

Enterprise launch readiness is blocked on the checklist in
[`docs/deploy-operate/enterprise-security-launch-checklist.mdx`](docs/deploy-operate/enterprise-security-launch-checklist.mdx).
That checklist covers the required cloud-side controls for Vercel, Cloudflare R2, Daytona,
Convex, WorkOS, Stripe, and security telemetry.

## Secret Handling Expectations

- Never commit real API keys, webhook secrets, JWTs, refresh tokens, or production hostnames
  that are not already intentionally public.
- Use placeholders in docs and examples.
- Keep `SESSION_SECRET` and `INTERNAL_API_SECRET` distinct.
- Treat `NEXT_PUBLIC_*` variables as public by definition.

## Safe Testing Guidance

- Prefer test credentials and sandbox projects.
- Avoid using production customer data in repro steps.
- If a report requires privileged access, describe the minimum permissions needed.
- Review CSP violation reports and security event alerts before enabling enforced CSP in production.
