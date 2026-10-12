## What changed

Describe the outcome and the affected surfaces.

## Risk and rollback

- Security or tenant-boundary impact:
- Billing or provider-cost impact:
- Data migration impact:
- Rollback plan:

## Verification

### Preview evidence

- Canonical PR URL:
- Current PR head SHA:
- Verified deployment SHA and Convex backend:
- Routes and authenticated actions checked:
- Screenshots or execution evidence:

- [ ] `needs-staging`: third-party callbacks, billing, migrations, or combined behavior need staging QA after merge
- [ ] Schema changed: expand/contract compatibility and backfill/rollback steps are documented

Production promotion uses the exact revision verified on staging and remains a
manual release-owner decision. A successful preview build still needs feature QA.

- [ ] I own this contribution or have written authority to submit it, and I identified all third-party material
- [ ] CLA Signatures check is green (outside contributors must comment `I have read the CLA Document and I hereby sign the CLA`; this checkbox is not a signature)
- [ ] Relevant focused tests pass
- [ ] Typecheck passes when contracts changed
- [ ] Living documentation was updated when required
- [ ] No credentials or customer data are included
- [ ] Browser or deployment evidence is attached when behavior depends on a hosted environment
