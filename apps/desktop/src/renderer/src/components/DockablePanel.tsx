import React, { useCallback, useEffect, useRef, useState } from 'react'
import { DockablePanelContext, DockablePanelContextValue } from './DockablePanelContext'

interface DockablePanelProps {
  children: React.ReactNode
  defaultWidth?: number
  defaultHeight?: number
  panelType: 'chat' | 'notebook' | 'browser' | 'overlay'
  panelBg?: string
  frameTransparent?: boolean
  extraWidthLeft?: number
  extraWidth?: number
  extraWidthRight?: number
  disableResize?: boolean
  mouseEventBoundary?: 'panel' | 'children'
  defaultPositionPreset?: 'center' | 'bottom-center'
}

const MIN_PANEL_SIZE = 300

type DockedEdge = 'left' | 'right' | 'top' | 'bottom' | null

interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

const STORAGE_KEY_PREFIX = 'overlay-dockable-panel-'
const UNDOCK_THRESHOLD = 80 // px drag away from edge to undock
const SETTINGS_KEY = 'overlay-settings'
const OVERLAY_LEGACY_POS_STORAGE_KEY = 'overlay-widget-pos'
const DEFAULT_BOTTOM_OFFSET = 40

interface EdgeInsets {
  top: number
  right: number
  bottom: number
  left: number
}

const ZERO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 }

function readOverlaySettings(): {
  snapToEdges: boolean
  floatPillAboveDock: boolean
} {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as {
        snapToEdges?: boolean
        floatPillAboveDock?: boolean
        expandBottomOverlay?: boolean
      }
      const floatPillAboveDock =
        typeof parsed.floatPillAboveDock === 'boolean'
          ? parsed.floatPillAboveDock
          : typeof parsed.expandBottomOverlay === 'boolean'
            ? parsed.expandBottomOverlay
            : true
      return {
        snapToEdges: parsed.snapToEdges !== false,
        floatPillAboveDock
      }
    }
  } catch {
    /* ignore */
  }
  return { snapToEdges: true, floatPillAboveDock: true }
}

function isSnapToEdgesEnabled(): boolean {
  return readOverlaySettings().snapToEdges
}

function isFloatPillAboveDockEnabled(): boolean {
  return readOverlaySettings().floatPillAboveDock
}

function insetsFromBounds(
  bounds: DisplayBounds,
  workArea?: DisplayBounds | null
): EdgeInsets {
  if (!workArea) return ZERO_INSETS
  return {
    top: Math.max(0, Math.round(workArea.y - bounds.y)),
    left: Math.max(0, Math.round(workArea.x - bounds.x)),
    bottom: Math.max(
      0,
      Math.round(bounds.y + bounds.height - (workArea.y + workArea.height))
    ),
    right: Math.max(
      0,
      Math.round(bounds.x + bounds.width - (workArea.x + workArea.width))
    )
  }
}

function computeDockedPosition(
  edge: DockedEdge,
  currentX: number,
  currentY: number,
  winW: number,
  winH: number,
  panelW: number,
  panelH: number,
  insets: EdgeInsets,
  floatAboveDock: boolean,
  extraLeft = 0,
  extraRight = 0
): { x: number; y: number } {
  const bottomInset = floatAboveDock ? insets.bottom : 0
  const minimumX = insets.left + extraLeft
  const maximumX = Math.max(minimumX, winW - panelW - extraRight - insets.right)
  switch (edge) {
    case 'left':
      return {
        x: minimumX,
        y: Math.max(insets.top, Math.min(currentY, winH - panelH - bottomInset))
      }
    case 'right':
      return {
        x: maximumX,
        y: Math.max(insets.top, Math.min(currentY, winH - panelH - bottomInset))
      }
    case 'top':
      return {
        x: Math.max(minimumX, Math.min(currentX, maximumX)),
        y: insets.top
      }
    case 'bottom':
      return {
        x: Math.max(minimumX, Math.min(currentX, maximumX)),
        y: winH - panelH - bottomInset
      }
    default:
      return { x: currentX, y: currentY }
  }
}

const DockablePanelInner: React.FC<DockablePanelProps> = ({
  children,
  defaultWidth = 600,
  defaultHeight = 600,
  panelType,
  panelBg = 'rgba(19, 19, 19, 0.95)',
  frameTransparent = false,
  extraWidthLeft = 0,
  extraWidth = 0,
  extraWidthRight = 0,
  disableResize = false,
  mouseEventBoundary = 'panel',
  defaultPositionPreset = 'center'
}) => {
  const [panelWidth, setPanelWidth] = useState(defaultWidth)
  const [panelHeight, setPanelHeight] = useState(defaultHeight)

  // Position state — pixel coordinates within the BrowserWindow
  const [panelX, setPanelX] = useState<number | null>(null)
  const [panelY, setPanelY] = useState<number | null>(null)

  // Docking state
  const [dockedEdge, setDockedEdge] = useState<DockedEdge>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // Phase 3: Snap preview during drag
  const [snapPreviewEdge, setSnapPreviewEdge] = useState<DockedEdge>(null)
  const [snapProximity, setSnapProximity] = useState(0) // 0–1, how close to snapping

  // Resize state
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef<{
    mouseX: number
    mouseY: number
    panelX: number
    panelY: number
    panelW: number
    panelH: number
    edges: { top: boolean; bottom: boolean; left: boolean; right: boolean }
  } | null>(null)

  const panelRef = useRef<HTMLDivElement>(null)
  const isMouseOverPanel = useRef(false)
  const dragStartRef = useRef<{
    mouseX: number
    mouseY: number
    panelX: number
    panelY: number
  } | null>(null)
  const displayBoundsRef = useRef<DisplayBounds | null>(null)
  const edgeInsetsRef = useRef<EdgeInsets>({ ...ZERO_INSETS })
  const currentDisplayIdRef = useRef<number | null>(null)
  const allDisplaysRef = useRef<
    Array<{ id: number; bounds: DisplayBounds; workArea?: DisplayBounds }>
  >([])
  const dockedEdgeRef = useRef<DockedEdge>(null)
  // Synchronous refs for drag/resize — avoids race where async state hasn't updated
  // yet when handleMouseLeave fires (critical for small panels like the overlay)
  const isDraggingRef = useRef(false)
  const isResizingRef = useRef(false)
  // Track latest panelX/panelY in refs for use in event listeners without stale closures
  const panelXRef = useRef<number | null>(null)
  const panelYRef = useRef<number | null>(null)
  panelXRef.current = panelX
  panelYRef.current = panelY
  dockedEdgeRef.current = dockedEdge

  const getDefaultPosition = useCallback(
    (winW: number, winH: number, width: number, height: number): { x: number; y: number } => {
      const centeredX = Math.round((winW - width) / 2)
      if (defaultPositionPreset === 'bottom-center') {
        const bottomOffset = isFloatPillAboveDockEnabled()
          ? edgeInsetsRef.current.bottom || DEFAULT_BOTTOM_OFFSET
          : 0
        return {
          x: centeredX,
          y: Math.max(0, winH - height - bottomOffset)
        }
      }
      return {
        x: centeredX,
        y: Math.round((winH - height) / 2)
      }
    },
    [defaultPositionPreset]
  )

  const clampToViewport = useCallback(
    (x: number, y: number, width: number, height: number): { x: number; y: number } => {
      const winW = window.innerWidth
      const winH = window.innerHeight
      return {
        x: Math.max(0, Math.min(x, winW - width)),
        y: Math.max(0, Math.min(y, winH - height))
      }
    },
    []
  )

  // Load saved panel size and position from localStorage
  useEffect(() => {
    if (!disableResize) {
      const savedSize = localStorage.getItem(`${STORAGE_KEY_PREFIX}${panelType}-size`)
      if (savedSize) {
        try {
          const { width, height } = JSON.parse(savedSize)
          if (width && width >= 300) setPanelWidth(width)
          if (height && height >= 300) setPanelHeight(height)
        } catch {
          // ignore corrupt data
        }
      }
    }
    const savedPos = localStorage.getItem(`${STORAGE_KEY_PREFIX}${panelType}-pos`)
    if (savedPos) {
      try {
        const { x, y, edge } = JSON.parse(savedPos)
        if (typeof x === 'number' && typeof y === 'number') {
          setPanelX(x)
          setPanelY(y)
        }
        if (edge) setDockedEdge(edge)
      } catch {
        // ignore corrupt data
      }
    }
  }, [panelType, disableResize])

  // Fetch display info on mount and cache it
  useEffect(() => {
    let disposed = false
    let retryTimer: number | null = null

    const fetchDisplays = async (): Promise<void> => {
      try {
        const [screenRes, allRes] = await Promise.all([
          window.bridge.getScreenBounds(),
          window.bridge.getAllDisplays()
        ])
        const bounds = screenRes.success ? (screenRes.bounds ?? screenRes.workArea) : null
        const workArea = screenRes.success
          ? (screenRes.workArea ?? screenRes.bounds ?? null)
          : null
        if (bounds) {
          displayBoundsRef.current = bounds
          edgeInsetsRef.current = insetsFromBounds(bounds, workArea)
        }
        if (allRes.success && allRes.displays) {
          allDisplaysRef.current = allRes.displays.map((d) => ({
            id: d.id,
            bounds: d.bounds,
            workArea: d.workArea
          }))
          if (bounds) {
            const match = allRes.displays.find(
              (d) => d.bounds.x === bounds.x && d.bounds.y === bounds.y
            )
            if (match) {
              currentDisplayIdRef.current = match.id
              edgeInsetsRef.current = insetsFromBounds(bounds, match.workArea)
            }
          }
        }
        // Check saved position against screen bounds; dock to nearest edge if out of bounds
        if (bounds) {
          const winW = bounds.width
          const winH = bounds.height

          // Read saved state to check bounds (state may not be committed yet)
          let pW = defaultWidth
          let pH = defaultHeight
          const savedSize = disableResize
            ? null
            : localStorage.getItem(`${STORAGE_KEY_PREFIX}${panelType}-size`)
          if (savedSize) {
            try {
              const parsed = JSON.parse(savedSize)
              if (parsed.width >= MIN_PANEL_SIZE) pW = parsed.width
              if (parsed.height >= MIN_PANEL_SIZE) pH = parsed.height
            } catch {
              /* ignore */
            }
          }

          const savedPosKey = `${STORAGE_KEY_PREFIX}${panelType}-pos`
          let savedPos = localStorage.getItem(savedPosKey)
          if (!savedPos && panelType === 'overlay') {
            const legacyPos = localStorage.getItem(OVERLAY_LEGACY_POS_STORAGE_KEY)
            if (legacyPos) {
              try {
                const { x, y } = JSON.parse(legacyPos)
                if (typeof x === 'number' && typeof y === 'number') {
                  const migrated = clampToViewport(x - pW / 2, y - pH, pW, pH)
                  const migratedValue = JSON.stringify({ x: migrated.x, y: migrated.y, edge: null })
                  localStorage.setItem(savedPosKey, migratedValue)
                  localStorage.removeItem(OVERLAY_LEGACY_POS_STORAGE_KEY)
                  savedPos = migratedValue
                }
              } catch {
                /* ignore */
              }
            }
          }

          let corrected = false
          if (savedPos) {
            try {
              const { x, y, edge } = JSON.parse(savedPos)
              if (typeof x === 'number' && typeof y === 'number') {
                const oob = x < 0 || y < 0 || x + pW > winW || y + pH > winH
                if (oob) {
                  // Find nearest edge and dock there
                  const dists: Array<{ edge: DockedEdge; dist: number }> = [
                    { edge: 'left', dist: Math.abs(x) },
                    { edge: 'right', dist: Math.abs(winW - (x + pW)) },
                    { edge: 'top', dist: Math.abs(y) },
                    { edge: 'bottom', dist: Math.abs(winH - (y + pH)) }
                  ]
                  const nearest = dists.reduce((a, b) => (a.dist < b.dist ? a : b))
                  const snapped = computeDockedPosition(
                    nearest.edge,
                    x,
                    y,
                    winW,
                    winH,
                    pW,
                    pH,
                    edgeInsetsRef.current,
                    panelType === 'overlay' ? isFloatPillAboveDockEnabled() : false,
                    extraWidthLeft,
                    extraWidth + extraWidthRight
                  )
                  setPanelX(snapped.x)
                  setPanelY(snapped.y)
                  setDockedEdge(nearest.edge)
                  corrected = true
                } else if (edge) {
                  // Position is valid and was docked — re-apply docked position to handle
                  // notch / dock insets and screen geometry changes
                  const snapped = computeDockedPosition(
                    edge,
                    x,
                    y,
                    winW,
                    winH,
                    pW,
                    pH,
                    edgeInsetsRef.current,
                    panelType === 'overlay' ? isFloatPillAboveDockEnabled() : false,
                    extraWidthLeft,
                    extraWidth + extraWidthRight
                  )
                  setPanelX(snapped.x)
                  setPanelY(snapped.y)
                  setDockedEdge(edge)
                  corrected = true
                }
              }
            } catch {
              /* ignore */
            }
          }

          if (!corrected) {
            // No correction needed — use saved position or default preset if none
            const initialPos = getDefaultPosition(winW, winH, pW, pH)
            setPanelX((prev) => prev ?? initialPos.x)
            setPanelY((prev) => prev ?? initialPos.y)
          }
        }
      } catch (error) {
        if (disposed) return
        console.warn('[DockablePanel] Display initialization failed; retrying', error)
        retryTimer = window.setTimeout(() => {
          retryTimer = null
          void fetchDisplays()
        }, 100)
      }
    }

    void fetchDisplays()
    return () => {
      disposed = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [
    defaultWidth,
    defaultHeight,
    panelType,
    disableResize,
    clampToViewport,
    getDefaultPosition,
    extraWidthLeft,
    extraWidth,
    extraWidthRight
  ])

  // Save position to localStorage when it changes
  useEffect(() => {
    if (panelX !== null && panelY !== null) {
      localStorage.setItem(
        `${STORAGE_KEY_PREFIX}${panelType}-pos`,
        JSON.stringify({ x: panelX, y: panelY, edge: dockedEdge })
      )
    }
  }, [panelX, panelY, dockedEdge, panelType])

  // Enable mouse events when cursor enters the panel or resize handles.
  // Browser panels still need this for their renderer chrome; the native
  // WebContentsView area is handled separately by browser-manager polling.
  const handleMouseEnter = useCallback(() => {
    isMouseOverPanel.current = true
    window.bridge.setIgnoreMouseEvents(false)
  }, [])

  // Restore click-through when cursor leaves the panel (but not during drag or resize)
  const handleMouseLeave = useCallback(() => {
    isMouseOverPanel.current = false
    if (!isDraggingRef.current && !isResizingRef.current) {
      window.bridge.setIgnoreMouseEvents(true)
    }
  }, [])

  // Save panel size to localStorage when it changes
  useEffect(() => {
    if (disableResize) return
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${panelType}-size`,
      JSON.stringify({ width: panelWidth, height: panelHeight })
    )
  }, [panelWidth, panelHeight, panelType, disableResize])

  // Ensure click-through is restored when component unmounts
  useEffect(() => {
    return () => {
      if (isMouseOverPanel.current) {
        window.bridge.setIgnoreMouseEvents(true)
      }
    }
  }, [])

  // Keep panels within bounds when the fullscreen window resizes or moves displays.
  useEffect(() => {
    const handleResize = (): void => {
      const edge = dockedEdgeRef.current
      const curX = panelXRef.current
      const curY = panelYRef.current
      if (curX === null || curY === null) return

      let newX = curX
      let newY = curY
      if (edge) {
        const snapped = computeDockedPosition(
          edge,
          curX,
          curY,
          window.innerWidth,
          window.innerHeight,
          panelWidth,
          panelHeight,
          edgeInsetsRef.current,
          panelType === 'overlay' ? isFloatPillAboveDockEnabled() : false,
          extraWidthLeft,
          extraWidth + extraWidthRight
        )
        newX = snapped.x
        newY = snapped.y
      } else {
        const clamped = clampToViewport(curX, curY, panelWidth, panelHeight)
        newX = clamped.x
        newY = clamped.y
      }

      if (newX !== curX || newY !== curY) {
        setIsAnimating(true)
        setPanelX(newX)
        setPanelY(newY)
        setTimeout(() => setIsAnimating(false), 300)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [panelWidth, panelHeight, clampToViewport, panelType, extraWidthLeft, extraWidth, extraWidthRight])

  // For browser panels, send the complete shell bounds to the main process so
  // WebContentsView positioning and click-through detection include side panels.
  useEffect(() => {
    if (panelType === 'browser' && panelX !== null && panelY !== null) {
      // Native view has no border radius — the React shell's CSS handles visual
      // corner rounding via the FRAME_INSET gap around the WebContentsView.
      window.bridge.browser.setPanelBounds({
        x: Math.round(panelX - extraWidthLeft),
        y: Math.round(panelY),
        width: Math.round(panelWidth + extraWidthLeft + extraWidth + extraWidthRight),
        height: Math.round(panelHeight),
        borderRadius: 0
      })
    }
  }, [panelType, panelX, panelY, panelWidth, panelHeight, extraWidthLeft, extraWidth, extraWidthRight])

  // Compute docked position for a given edge, honoring notch / dock safe-area insets
  const getDockedPosition = useCallback(
    (edge: DockedEdge, currentX: number, currentY: number): { x: number; y: number } => {
      return computeDockedPosition(
        edge,
        currentX,
        currentY,
        window.innerWidth,
        window.innerHeight,
        panelWidth,
        panelHeight,
        edgeInsetsRef.current,
        panelType === 'overlay' ? isFloatPillAboveDockEnabled() : false,
        extraWidthLeft,
        extraWidth + extraWidthRight
      )
    },
    [panelWidth, panelHeight, panelType, extraWidthLeft, extraWidth, extraWidthRight]
  )

  // Side surfaces grow away from the base panel. When the panel is docked,
  // translate the base panel so the expanded shell remains inside the display:
  // a left sidebar pushes a left-docked panel right, while a right assistant
  // pushes a right-docked panel left.
  useEffect(() => {
    if (!dockedEdge) return
    const currentX = panelXRef.current
    const currentY = panelYRef.current
    if (currentX === null || currentY === null) return

    const snapped = getDockedPosition(dockedEdge, currentX, currentY)
    if (snapped.x === currentX && snapped.y === currentY) return

    setIsAnimating(true)
    setPanelX(snapped.x)
    setPanelY(snapped.y)
    const timer = window.setTimeout(() => setIsAnimating(false), 300)
    return () => window.clearTimeout(timer)
  }, [dockedEdge, getDockedPosition])

  // Phase 3: Detect nearest edge + proximity (0 = far, 1 = at threshold)
  // Uses a wider detection zone (SNAP_GLOW_ZONE) for the glow preview.
  // Distances are measured to the safe-area edge (notch / dock) so the glimmer
  // lines up with where the panel will actually dock.
  const detectEdgeWithProximity = useCallback(
    (x: number, y: number): { edge: DockedEdge; proximity: number } => {
      const winW = window.innerWidth
      const winH = window.innerHeight
      const GLOW_ZONE = 200 // start showing glow at 200px from edge
      const insets = edgeInsetsRef.current
      const bottomInset =
        panelType === 'overlay' && isFloatPillAboveDockEnabled() ? insets.bottom : 0

      const distLeft = x - extraWidthLeft - insets.left
      const distRight = winW - insets.right - (x + panelWidth + extraWidth + extraWidthRight)
      const distTop = y - insets.top
      const distBottom = winH - bottomInset - (y + panelHeight)

      // Find closest edge within glow zone
      const edges: { edge: DockedEdge; dist: number }[] = [
        { edge: 'left', dist: distLeft },
        { edge: 'right', dist: distRight },
        { edge: 'top', dist: distTop },
        { edge: 'bottom', dist: distBottom }
      ]

      const closest = edges.reduce((a, b) => (a.dist < b.dist ? a : b))

      if (closest.dist <= GLOW_ZONE) {
        // proximity: 1 when at edge (dist=0), 0 when at GLOW_ZONE boundary
        const proximity = Math.max(0, 1 - closest.dist / GLOW_ZONE)
        return { edge: closest.edge, proximity }
      }

      return { edge: null, proximity: 0 }
    },
    [panelWidth, panelHeight, panelType, extraWidthLeft, extraWidth, extraWidthRight]
  )

  // Check if the drag has moved the panel to a different monitor.
  // When the BrowserWindow moves to a new display, adjust dragStartRef
  // so the panel stays under the cursor.
  const checkDisplayBoundary = useCallback(
    async (screenMouseX: number, screenMouseY: number): Promise<void> => {
      if (!displayBoundsRef.current) return
      const oldBounds = displayBoundsRef.current
      const isOutside =
        screenMouseX < oldBounds.x ||
        screenMouseX > oldBounds.x + oldBounds.width ||
        screenMouseY < oldBounds.y ||
        screenMouseY > oldBounds.y + oldBounds.height

      if (isOutside) {
        const result = await window.bridge.moveToDisplay(screenMouseX, screenMouseY)
        if (result.success && result.bounds) {
          const newBounds = result.bounds
          displayBoundsRef.current = newBounds

          // Adjust dragStartRef so panel stays under cursor after display switch
          if (dragStartRef.current) {
            dragStartRef.current.panelX += oldBounds.x - newBounds.x
            dragStartRef.current.panelY += oldBounds.y - newBounds.y
          }

          const match = allDisplaysRef.current.find(
            (d) => d.bounds.x === newBounds.x && d.bounds.y === newBounds.y
          )
          if (match) {
            currentDisplayIdRef.current = match.id
            edgeInsetsRef.current = insetsFromBounds(newBounds, match.workArea)
          }
        }
      }
    },
    []
  )

  // Drag start — exposed via context so headers and Option+drag can call it
  const startDrag = useCallback((e: React.MouseEvent) => {
    const curX = panelXRef.current
    const curY = panelYRef.current
    if (curX === null || curY === null) return
    e.preventDefault()
    setIsDragging(true)
    isDraggingRef.current = true
    setIsAnimating(false)
    dragStartRef.current = {
      mouseX: e.screenX,
      mouseY: e.screenY,
      panelX: curX,
      panelY: curY
    }
    window.bridge.setIgnoreMouseEvents(false)
  }, [])

  // Drag move — use window-level listeners to track even outside the panel
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent): void => {
      if (!dragStartRef.current) return
      const deltaX = e.screenX - dragStartRef.current.mouseX
      const deltaY = e.screenY - dragStartRef.current.mouseY
      let newX = dragStartRef.current.panelX + deltaX
      let newY = dragStartRef.current.panelY + deltaY
      const winW = window.innerWidth
      const winH = window.innerHeight
      const currentEdge = dockedEdgeRef.current

      if (currentEdge) {
        // Currently docked — check if should undock (perpendicular drag)
        const insets = edgeInsetsRef.current
        const bottomInset =
          panelType === 'overlay' && isFloatPillAboveDockEnabled() ? insets.bottom : 0
        let perpDist = 0
        switch (currentEdge) {
          case 'left':
            perpDist = newX - extraWidthLeft - insets.left
            break
          case 'right':
            perpDist = winW - panelWidth - extraWidth - extraWidthRight - insets.right - newX
            break
          case 'top':
            perpDist = newY - insets.top
            break
          case 'bottom':
            perpDist = winH - panelHeight - bottomInset - newY
            break
        }

        if (perpDist > UNDOCK_THRESHOLD) {
          setDockedEdge(null)
          dockedEdgeRef.current = null
        } else {
          // Constrain to edge — slide along it only
          const snapped = getDockedPosition(currentEdge, newX, newY)
          newX = snapped.x
          newY = snapped.y
        }
      } else if (isSnapToEdgesEnabled()) {
        // Not docked — check if panel edge touches safe-area edge
        const insets = edgeInsetsRef.current
        const bottomInset =
          panelType === 'overlay' && isFloatPillAboveDockEnabled() ? insets.bottom : 0
        let touchEdge: DockedEdge = null
        if (newX - extraWidthLeft <= insets.left) touchEdge = 'left'
        else if (newX + panelWidth + extraWidth + extraWidthRight >= winW - insets.right) touchEdge = 'right'
        if (!touchEdge && newY <= insets.top) touchEdge = 'top'
        else if (!touchEdge && newY + panelHeight >= winH - bottomInset) touchEdge = 'bottom'

        if (touchEdge) {
          const snapped = getDockedPosition(touchEdge, newX, newY)
          newX = snapped.x
          newY = snapped.y
          setDockedEdge(touchEdge)
          dockedEdgeRef.current = touchEdge
          // Clear edge glow once docked
          setSnapPreviewEdge(null)
          setSnapProximity(0)
        }
      }

      setPanelX(newX)
      setPanelY(newY)

      // Phase 3: Update snap preview during drag — skip when already docked or snap disabled
      if (!dockedEdgeRef.current && isSnapToEdgesEnabled()) {
        const preview = detectEdgeWithProximity(newX, newY)
        setSnapPreviewEdge(preview.edge)
        setSnapProximity(preview.proximity)
      } else if (!isSnapToEdgesEnabled()) {
        setSnapPreviewEdge(null)
        setSnapProximity(0)
      }

      checkDisplayBoundary(e.screenX, e.screenY)
    }

    const handleMouseUp = (e: MouseEvent): void => {
      setIsDragging(false)
      isDraggingRef.current = false
      setSnapPreviewEdge(null)
      setSnapProximity(0)
      dragStartRef.current = null

      const finalX = panelXRef.current ?? 0
      const finalY = panelYRef.current ?? 0
      const currentEdge = dockedEdgeRef.current

      if (currentEdge) {
        // Still docked — animate to clean final position
        setIsAnimating(true)
        const snapped = getDockedPosition(currentEdge, finalX, finalY)
        setPanelX(snapped.x)
        setPanelY(snapped.y)
        setTimeout(() => setIsAnimating(false), 300)
      }

      // Restore click-through if mouse left the panel during drag
      if (!isMouseOverPanel.current) {
        window.bridge.setIgnoreMouseEvents(true)
      }

      checkDisplayBoundary(e.screenX, e.screenY)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [
    isDragging,
    panelWidth,
    panelHeight,
    dockedEdge,
    detectEdgeWithProximity,
    getDockedPosition,
    checkDisplayBoundary,
    panelType,
    extraWidthLeft,
    extraWidth,
    extraWidthRight
  ])

  // Overlay pill: swap hit-box dimensions only after a side dock is committed
  // (not while dragging near the edge — that caused vertical/horizontal flicker).
  useEffect(() => {
    if (panelType !== 'overlay') return
    if (isDragging) return
    const vertical = dockedEdge === 'left' || dockedEdge === 'right'
    const nextW = vertical ? defaultHeight : defaultWidth
    const nextH = vertical ? defaultWidth : defaultHeight
    if (panelWidth === nextW && panelHeight === nextH) return
    setPanelWidth(nextW)
    setPanelHeight(nextH)
  }, [
    panelType,
    dockedEdge,
    isDragging,
    defaultWidth,
    defaultHeight,
    panelWidth,
    panelHeight
  ])

  // Keep docked overlay flush to notch / dock after size or setting changes
  useEffect(() => {
    if (!dockedEdge || isDragging) return
    if (panelX === null || panelY === null) return
    const snapped = getDockedPosition(dockedEdge, panelX, panelY)
    if (snapped.x !== panelX || snapped.y !== panelY) {
      setPanelX(snapped.x)
      setPanelY(snapped.y)
    }
  }, [dockedEdge, panelWidth, panelHeight, panelX, panelY, getDockedPosition, isDragging])

  // Reposition bottom-docked pill when "Float Pill Above Dock" changes.
  // Settings live in the main window; the overlay is a separate BrowserWindow,
  // so we listen for IPC (+ storage) rather than same-window custom events only.
  useEffect(() => {
    if (panelType !== 'overlay') return

    const reposition = (floatAboveDock?: boolean): void => {
      const edge = dockedEdgeRef.current
      if (!edge) return
      const curX = panelXRef.current
      const curY = panelYRef.current
      if (curX === null || curY === null) return
      const float =
        typeof floatAboveDock === 'boolean'
          ? floatAboveDock
          : isFloatPillAboveDockEnabled()
      const snapped = computeDockedPosition(
        edge,
        curX,
        curY,
        window.innerWidth,
        window.innerHeight,
        panelWidth,
        panelHeight,
        edgeInsetsRef.current,
        float,
        extraWidthLeft,
        extraWidth + extraWidthRight
      )
      if (snapped.x !== curX || snapped.y !== curY) {
        setPanelX(snapped.x)
        setPanelY(snapped.y)
      }
    }

    const onLocalSettingsChanged = (event: Event): void => {
      const detail = (event as CustomEvent<{ key?: string; value?: unknown }>).detail
      if (detail?.key && detail.key !== 'floatPillAboveDock') return
      reposition(typeof detail?.value === 'boolean' ? detail.value : undefined)
    }

    const onIpcSettingsChanged = (payload: { key?: string; value?: unknown }): void => {
      if (payload?.key && payload.key !== 'floatPillAboveDock') return
      reposition(typeof payload?.value === 'boolean' ? payload.value : undefined)
    }

    const onStorage = (event: StorageEvent): void => {
      if (event.key !== SETTINGS_KEY) return
      reposition()
    }

    window.addEventListener('overlay:settings-changed', onLocalSettingsChanged)
    window.addEventListener('storage', onStorage)
    const removeIpc =
      window.bridge?.onSettingsChanged?.(onIpcSettingsChanged) ?? (() => undefined)
    return () => {
      window.removeEventListener('overlay:settings-changed', onLocalSettingsChanged)
      window.removeEventListener('storage', onStorage)
      removeIpc()
    }
  }, [panelType, panelWidth, panelHeight, extraWidthLeft, extraWidth, extraWidthRight])

  // Border-radius: flatten corners that touch screen edges.
  // A corner is flattened if either of its adjacent screen edges is touched.
  // This handles single-edge docking AND corner-docking (2 edges → 3 flat corners).
  const getNotchRadius = useCallback((): string => {
    const r = 16
    if (panelX === null || panelY === null) return `${r}px`
    const winW = window.innerWidth
    const winH = window.innerHeight

    const touchTop = panelY <= 0
    const touchBottom = panelY + panelHeight >= winH
    const touchLeft = panelX - extraWidthLeft <= 0
    const touchRight = panelX + panelWidth + extraWidth + extraWidthRight >= winW

    if (!touchTop && !touchBottom && !touchLeft && !touchRight) return `${r}px`

    // CSS order: top-left, top-right, bottom-right, bottom-left
    const tl = touchTop || touchLeft ? 0 : r
    const tr = touchTop || touchRight ? 0 : r
    const br = touchBottom || touchRight ? 0 : r
    const bl = touchBottom || touchLeft ? 0 : r

    return `${tl}px ${tr}px ${br}px ${bl}px`
  }, [panelX, panelY, panelWidth, panelHeight, extraWidthLeft, extraWidth, extraWidthRight])

  // Per-edge border: remove only the border on the edge touching the screen
  const getDockBorderWidth = useCallback((): string => {
    if (!dockedEdge && panelX !== null && panelY !== null) {
      // Also check raw touch for corner-docked panels that aren't in "dockedEdge" state
      const winW = window.innerWidth
      const winH = window.innerHeight
      const touchTop = panelY <= 0
      const touchBottom = panelY + panelHeight >= winH
      const touchLeft = panelX - extraWidthLeft <= 0
      const touchRight = panelX + panelWidth + extraWidth + extraWidthRight >= winW
      if (touchTop || touchBottom || touchLeft || touchRight) {
        const t = touchTop ? 0 : 1
        const r = touchRight ? 0 : 1
        const b = touchBottom ? 0 : 1
        const l = touchLeft ? 0 : 1
        return `${t}px ${r}px ${b}px ${l}px`
      }
      return '1px'
    }
    if (!dockedEdge) return '1px'
    // Single-edge docking
    if (dockedEdge === 'top') return '0 1px 1px 1px'
    if (dockedEdge === 'bottom') return '1px 1px 0 1px'
    if (dockedEdge === 'left') return '1px 1px 1px 0'
    if (dockedEdge === 'right') return '1px 0 1px 1px'
    return '1px'
  }, [dockedEdge, panelX, panelY, panelWidth, panelHeight, extraWidthLeft, extraWidth, extraWidthRight])

  // Resize start — called by resize handle mousedowns
  const startResize = useCallback(
    (
      e: React.MouseEvent,
      edges: { top: boolean; bottom: boolean; left: boolean; right: boolean }
    ) => {
      const curX = panelXRef.current
      const curY = panelYRef.current
      if (curX === null || curY === null) return
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      isResizingRef.current = true
      resizeStartRef.current = {
        mouseX: e.screenX,
        mouseY: e.screenY,
        panelX: curX,
        panelY: curY,
        panelW: panelWidth,
        panelH: panelHeight,
        edges
      }
      window.bridge.setIgnoreMouseEvents(false)
    },
    [panelWidth, panelHeight]
  )

  // Resize move/up — window-level listeners
  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent): void => {
      if (!resizeStartRef.current) return
      const {
        mouseX,
        mouseY,
        panelX: startX,
        panelY: startY,
        panelW,
        panelH,
        edges
      } = resizeStartRef.current
      const deltaX = e.screenX - mouseX
      const deltaY = e.screenY - mouseY

      let newW = panelW
      let newH = panelH
      let newX = startX
      let newY = startY

      if (edges.right) {
        newW = Math.max(MIN_PANEL_SIZE, panelW + deltaX)
      }
      if (edges.left) {
        const dw = Math.min(deltaX, panelW - MIN_PANEL_SIZE)
        newW = panelW - dw
        newX = startX + dw
      }
      if (edges.bottom) {
        newH = Math.max(MIN_PANEL_SIZE, panelH + deltaY)
      }
      if (edges.top) {
        const dh = Math.min(deltaY, panelH - MIN_PANEL_SIZE)
        newH = panelH - dh
        newY = startY + dh
      }

      setPanelWidth(newW)
      setPanelHeight(newH)
      setPanelX(newX)
      setPanelY(newY)
    }

    const handleMouseUp = (): void => {
      setIsResizing(false)
      isResizingRef.current = false
      resizeStartRef.current = null
      if (!isMouseOverPanel.current) {
        window.bridge.setIgnoreMouseEvents(true)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  const contextValue: DockablePanelContextValue = { startDrag, isDragging, dockedEdge }

  // If position not yet initialized, don't render
  if (panelX === null || panelY === null) {
    return null
  }

  // Phase 3: Edge glow — non-uniform, brightest near the panel's projected position.
  // Drawn on the safe-area edge (dock / notch) so it matches the actual dock target.
  const renderEdgeGlow = (): React.ReactNode => {
    if (!isDragging || !snapPreviewEdge || panelX === null || panelY === null) return null
    const intensity = snapProximity
    const glowAlpha = intensity * 0.9
    const spreadRadius = 160 + intensity * 140 // glow spread grows as panel approaches
    const isHorizontal = snapPreviewEdge === 'top' || snapPreviewEdge === 'bottom'
    const insets = edgeInsetsRef.current
    const bottomInset =
      panelType === 'overlay' && isFloatPillAboveDockEnabled() ? insets.bottom : 0

    // Center of the glow = center of the panel projected onto the edge
    const centerX = panelX + panelWidth / 2
    const centerY = panelY + panelHeight / 2

    const style: React.CSSProperties = {
      position: 'absolute',
      pointerEvents: 'none',
      opacity: Math.min(intensity * 1.2, 1),
      transition: 'opacity 0.15s ease-out',
      zIndex: 1
    }

    if (isHorizontal) {
      Object.assign(style, {
        left: centerX - spreadRadius,
        width: spreadRadius * 2,
        height: 20,
        ...(snapPreviewEdge === 'top'
          ? { top: insets.top }
          : { bottom: bottomInset }),
        background: `radial-gradient(ellipse ${spreadRadius}px 20px at 50% ${snapPreviewEdge === 'top' ? '0%' : '100%'}, rgba(255, 255, 255, ${glowAlpha}), rgba(220, 220, 220, ${glowAlpha * 0.6}), rgba(180, 180, 180, ${glowAlpha * 0.3}), transparent)`
      })
    } else {
      Object.assign(style, {
        top: centerY - spreadRadius,
        height: spreadRadius * 2,
        width: 20,
        ...(snapPreviewEdge === 'left'
          ? { left: insets.left }
          : { right: insets.right }),
        background: `radial-gradient(ellipse 20px ${spreadRadius}px at ${snapPreviewEdge === 'left' ? '0%' : '100%'} 50%, rgba(255, 255, 255, ${glowAlpha}), rgba(220, 220, 220, ${glowAlpha * 0.6}), rgba(180, 180, 180, ${glowAlpha * 0.3}), transparent)`
      })
    }

    return <div style={style} />
  }

  // Resize handle thickness — large for easy grabbing
  const HANDLE = 14
  const CORNER = 20

  // Resize handle helper: generates style + cursor for an edge/corner handle
  const resizeHandle = (
    cursor: string,
    pos: React.CSSProperties,
    edges: { top: boolean; bottom: boolean; left: boolean; right: boolean }
  ): React.ReactNode => (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={(e) => startResize(e, edges)}
      style={{
        position: 'absolute',
        ...pos,
        cursor,
        pointerEvents: 'auto',
        zIndex: 2,
        // Near-invisible background so macOS treats these as opaque for click-through
        background: 'rgba(0,0,0,0.01)'
      }}
    />
  )

  return (
    <DockablePanelContext.Provider value={contextValue}>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          overflow: 'hidden'
        }}
      >
        {/* Phase 3: Edge glow indicator */}
        {renderEdgeGlow()}

        {/* Panel container with resize handles */}
        <div
          ref={panelRef}
          onMouseEnter={mouseEventBoundary === 'panel' ? handleMouseEnter : undefined}
          onMouseLeave={mouseEventBoundary === 'panel' ? handleMouseLeave : undefined}
          style={{
            position: 'absolute',
            width: panelWidth + extraWidthLeft + extraWidth + extraWidthRight,
            height: panelHeight,
            left: panelX - extraWidthLeft,
            top: panelY,
            pointerEvents: mouseEventBoundary === 'children' ? 'none' : 'auto',
            borderRadius: getNotchRadius(),
            overflow: mouseEventBoundary === 'children' ? 'visible' : 'hidden',
            background: frameTransparent ? 'transparent' : dockedEdge ? panelBg : 'transparent',
            ['--dockable-border-radius' as string]: getNotchRadius(),
            ['--dockable-border-width' as string]: getDockBorderWidth(),
            transition: isAnimating
              ? 'left 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), top 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), height 0.3s cubic-bezier(0.25, 0.1, 0.25, 1), border-radius 0.3s ease'
              : isDragging || isResizing
                ? 'none'
                : 'left 0.3s ease, width 0.3s ease, border-radius 0.3s ease'
          }}
        >
          <div
            className="dockable-panel-zoom-content"
            style={{
              width: '100%',
              height: '100%',
              overflow: mouseEventBoundary === 'children' ? 'visible' : 'hidden',
              zoom: 'var(--app-zoom, 1)',
              pointerEvents: mouseEventBoundary === 'children' ? 'none' : 'auto'
            }}
          >
            {children}
          </div>
        </div>

        {!disableResize && (
          <>
            {/* Resize handles — positioned around the panel */}
            {resizeHandle(
              'ns-resize',
              {
                left: panelX - extraWidthLeft + HANDLE,
                top: panelY - HANDLE / 2,
                width: panelWidth + extraWidthLeft + extraWidth + extraWidthRight - HANDLE * 2,
                height: HANDLE
              },
              { top: true, bottom: false, left: false, right: false }
            )}
            {resizeHandle(
              'ns-resize',
              {
                left: panelX - extraWidthLeft + HANDLE,
                top: panelY + panelHeight - HANDLE / 2,
                width: panelWidth + extraWidthLeft + extraWidth + extraWidthRight - HANDLE * 2,
                height: HANDLE
              },
              { top: false, bottom: true, left: false, right: false }
            )}
            {resizeHandle(
              'ew-resize',
              {
                left: panelX - extraWidthLeft - HANDLE / 2,
                top: panelY + HANDLE,
                width: HANDLE,
                height: panelHeight - HANDLE * 2
              },
              { top: false, bottom: false, left: true, right: false }
            )}
            {resizeHandle(
              'ew-resize',
              {
                left: panelX + panelWidth + extraWidth + extraWidthRight - HANDLE / 2,
                top: panelY + HANDLE,
                width: HANDLE,
                height: panelHeight - HANDLE * 2
              },
              { top: false, bottom: false, left: false, right: true }
            )}
            {resizeHandle(
              'nwse-resize',
              {
                left: panelX - extraWidthLeft - HANDLE / 2,
                top: panelY - HANDLE / 2,
                width: CORNER,
                height: CORNER
              },
              { top: true, bottom: false, left: true, right: false }
            )}
            {resizeHandle(
              'nesw-resize',
              {
                left: panelX + panelWidth + extraWidth + extraWidthRight - CORNER + HANDLE / 2,
                top: panelY - HANDLE / 2,
                width: CORNER,
                height: CORNER
              },
              { top: true, bottom: false, left: false, right: true }
            )}
            {resizeHandle(
              'nesw-resize',
              {
                left: panelX - extraWidthLeft - HANDLE / 2,
                top: panelY + panelHeight - CORNER + HANDLE / 2,
                width: CORNER,
                height: CORNER
              },
              { top: false, bottom: true, left: true, right: false }
            )}
            {resizeHandle(
              'nwse-resize',
              {
                left: panelX + panelWidth + extraWidth + extraWidthRight - CORNER + HANDLE / 2,
                top: panelY + panelHeight - CORNER + HANDLE / 2,
                width: CORNER,
                height: CORNER
              },
              { top: false, bottom: true, left: false, right: true }
            )}
          </>
        )}
      </div>
    </DockablePanelContext.Provider>
  )
}

const DockablePanel: React.FC<DockablePanelProps> = (props) => <DockablePanelInner {...props} />

export default DockablePanel
