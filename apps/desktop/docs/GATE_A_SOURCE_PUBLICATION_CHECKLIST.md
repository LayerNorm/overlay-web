# Gate A — source publication

**Gate status:** PENDING

**Candidate source commit:** _unset_

**History-free public root commit:** _unset_

**Decision date:** _unset_

This file is a sign-off record template. Its presence is not approval.

## Required approvals

- [ ] Security owner confirms every Critical is fixed and every High is fixed or
      accepted under the documented exception policy.
- [ ] Independent reviewer signs the source/backend scope and the desktop-chat
      unsandboxed Full access exception.
- [ ] Legal owner approves AGPL/Apache licensing, notices, trademark policy,
      contributor terms, and every distributed asset/model/native component.
- [ ] Repository administrator verifies branch protection, required checks and
      reviews, CODEOWNERS, maintainer 2FA, secret scanning, push protection,
      Dependabot, private vulnerability reporting, and protected environments.
- [ ] Operations owner verifies provider hard caps, paid-operation kill switch,
      auth abuse monitoring, reservation reconciliation, and incident contacts.

## Required evidence

- [ ] `npm run public:export` created the candidate from the approved private
      source commit, and the public remote contains no private history.
- [ ] Clean exported checkout passed `npm ci`, standalone/license/security
      checks, tests, build, and unsigned arm64 packaging.
- [ ] Approved scanners found no secret, private data, internal report, or
      private dependency in the exported tree or private history.
- [ ] Canonical server hostile-client tests passed for every enabled provider
      and supported Convex/Postgres configuration.
- [ ] Private vulnerability intake was tested end to end.

## Signatures

| Role | Name | Evidence link | Date | Decision |
| --- | --- | --- | --- | --- |
| Security owner | _unset_ | _unset_ | _unset_ | PENDING |
| Independent reviewer | _unset_ | _unset_ | _unset_ | PENDING |
| Legal/asset owner | _unset_ | _unset_ | _unset_ | PENDING |
| Repository administrator | _unset_ | _unset_ | _unset_ | PENDING |
| Operations owner | _unset_ | _unset_ | _unset_ | PENDING |
