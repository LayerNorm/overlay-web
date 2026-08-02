# @overlay/authz-contracts

Provider-neutral authorization contracts for Overlay roles, groups, capabilities,
role assignments, and resource grants.

Authentication establishes who a user is. This package defines what that user may
do after authentication. It contains no database, framework, or industry-specific
dependencies so the same contracts can be implemented by Convex and Postgres.

The deployment capability configuration remains an upper bound. Database-backed
roles can grant only capabilities supported and enabled by the running deployment.
