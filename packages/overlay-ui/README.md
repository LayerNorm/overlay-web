# @overlay/ui

Shared UI primitives, design tokens, hooks, and feedback components for the Overlay design system.

## Install

This package is part of the Overlay workspace. Import it from the workspace root:

```bash
npm install @overlay/ui
```

## Usage

```tsx
import { Button } from '@overlay/ui'
```

## Documentation

- [Feature Modules](../../internal/develop/feature-modules.md)
- [Customization](../../internal/develop/customization.md)

## License

AGPL-3.0-only

### Floating surfaces

`FloatingMenu` preserves the external `anchorRef` API for rich popovers; use its
optional `trigger` for native focus/expanded-state handling. Action-only menus
use `kind="menu"` plus a trigger and `MenuItem` children. Rich controls use
`Popover` / `PopoverTrigger` / `PopoverContent` from `@overlay/ui/primitives`.
`MenuSurface` is a standalone styled surface, without implied menu semantics.
Radix owns positioning, portals and dismissal; do not add document dismissal
listeners in consumers.
