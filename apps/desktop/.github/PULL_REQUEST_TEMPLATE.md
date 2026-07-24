## Summary

Describe the user-visible change and the trust boundaries it touches.

## Verification

List the exact commands and manual checks performed.

## Security checklist

- [ ] I did not add secrets, private reports, customer data, machine-specific paths, or generated build output.
- [ ] Authentication, authorization, billing, model policy, and hosted usage remain server-authoritative.
- [ ] Renderer changes use only the fixed preload bridge; privileged IPC remains main-owned and validated.
- [ ] Host, browser, filesystem, network, integration, and command side effects remain permission-gated.
- [ ] I added or updated negative tests for every changed security boundary.
- [ ] Dependency, native-helper, updater, signing, or workflow changes include supply-chain evidence.
- [ ] Documentation and privacy claims still match runtime behavior.

If an item is not applicable, explain why. Never paste an embargoed
vulnerability or production secret into a pull request.
