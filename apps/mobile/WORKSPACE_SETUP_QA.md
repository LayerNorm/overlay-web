# Workspace setup gate

Native bootstrap HTTP 409 `workspace_setup_required` means the resolved workspace wallet is not configured. The session gate renders the existing WorkspaceGate with its getoverlay.io setup copy, rather than treating this as an unavailable server. Other 409, 401 and 500 responses retain their error paths. Retry and sign-out reset the setup classification.

Acceptance: sign in with an existing account without a configured workspace wallet. Confirm the setup gate appears. Complete workspace setup on web, then sign in again. Confirm normal bootstrap opens the app. Live Preview and device acceptance remain pending deployment of the web change.
