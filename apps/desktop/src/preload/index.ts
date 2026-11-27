// One self-contained bundle: sandboxed preloads cannot require shared chunks.
// Each surface keeps its own origin/main-frame gate before exposing an API.
import './web-shell'
import './recorder'
