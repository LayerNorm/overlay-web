(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/apps/admin/src/features/admin/OperatorLockup.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "OperatorLockup",
    ()=>OperatorLockup
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$ui$2f$src$2f$components$2f$orb$2f$Orb$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/overlay-ui/src/components/orb/Orb.tsx [app-client] (ecmascript)");
'use client';
;
;
function OperatorLockup() {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex items-center justify-center gap-2",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$ui$2f$src$2f$components$2f$orb$2f$Orb$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["OverlayMark"], {
                size: 10
            }, void 0, false, {
                fileName: "[project]/apps/admin/src/features/admin/OperatorLockup.tsx",
                lineNumber: 9,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "text-lg font-medium lowercase tracking-tight text-(--foreground)",
                style: {
                    fontFamily: 'var(--font-serif)'
                },
                children: "overlay"
            }, void 0, false, {
                fileName: "[project]/apps/admin/src/features/admin/OperatorLockup.tsx",
                lineNumber: 10,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/admin/src/features/admin/OperatorLockup.tsx",
        lineNumber: 8,
        columnNumber: 5
    }, this);
}
_c = OperatorLockup;
var _c;
__turbopack_context__.k.register(_c, "OperatorLockup");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/overlay-ui/src/components/orb/Orb.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "OVERLAY_ORB_DEFAULT_COLOR",
    ()=>OVERLAY_ORB_DEFAULT_COLOR,
    "Orb",
    ()=>Orb,
    "OverlayMark",
    ()=>OverlayMark
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
/**
 * Parameterized orb renderer for the Overlay chrome mark. Pure SVG + CSS, no
 * WebGL, no new dependencies. Shared across the web app and the chat/modules
 * packages so every surface renders the same mark at any size.
 *
 * Styles live in `../../styles.css` (`ovorb-*` classes).
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$ui$2f$src$2f$utils$2f$cn$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/overlay-ui/src/utils/cn.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
;
;
const OVERLAY_ORB_DEFAULT_COLOR = '#71717a';
function hexToRgb(hex) {
    const normalized = hex.trim().replace(/^#/, '');
    const full = normalized.length === 3 ? normalized.split('').map((c)=>c + c).join('') : normalized;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
    return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16)
    };
}
function mix(a, b, t) {
    return {
        r: Math.round(a.r + (b.r - a.r) * t),
        g: Math.round(a.g + (b.g - a.g) * t),
        b: Math.round(a.b + (b.b - a.b) * t)
    };
}
function css(c, alpha = 1) {
    return alpha >= 1 ? `rgb(${c.r} ${c.g} ${c.b})` : `rgb(${c.r} ${c.g} ${c.b} / ${alpha})`;
}
const WHITE = {
    r: 255,
    g: 255,
    b: 255
};
const BLACK = {
    r: 0,
    g: 0,
    b: 0
};
function glowPalette(base) {
    const mid = hexToRgb(base) ?? hexToRgb(OVERLAY_ORB_DEFAULT_COLOR);
    return {
        hi: css(mix(mid, WHITE, 0.88)),
        light: css(mix(mid, WHITE, 0.52)),
        mid: css(mid),
        dark: css(mix(mid, BLACK, 0.42)),
        deep: css(mix(mid, BLACK, 0.72)),
        halo: css(mid, 0.45)
    };
}
const METAL = {
    hi: '#ffffff',
    light: '#eceef1',
    mid: '#a8adb5',
    dark: '#4c5158',
    deep: '#17191d'
};
const STATE_CLASS = {
    idle: 'ovorb-drift',
    working: 'ovorb-spin',
    waiting: 'ovorb-breathe',
    offline: ''
};
function Orb({ variant = 'glow', color = OVERLAY_ORB_DEFAULT_COLOR, size = 32, state = 'idle', animated = true, glow = false, label, className }) {
    _s();
    const rawId = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useId"])().replace(/[^a-zA-Z0-9]/g, '');
    const p = variant === 'metal' ? METAL : glowPalette(color);
    const motion = !animated || state === 'offline' ? '' : STATE_CLASS[state];
    const dimmed = state === 'offline' ? 'ovorb-dim' : '';
    const decorative = label === '';
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
        role: decorative ? undefined : 'img',
        "aria-label": decorative ? undefined : label ?? (variant === 'metal' ? 'Overlay' : 'Agent orb'),
        "aria-hidden": decorative || undefined,
        className: (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$ui$2f$src$2f$utils$2f$cn$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["cn"])('ovorb-root', motion, dimmed, className),
        style: {
            width: size,
            height: size,
            filter: glow && variant === 'glow' && state !== 'offline' ? `drop-shadow(0 0 ${Math.max(6, size / 4)}px ${glowPalette(color).halo})` : undefined
        },
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
                width: size,
                height: size,
                viewBox: "0 0 200 200",
                "aria-hidden": "true",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("defs", {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("radialGradient", {
                                id: `${rawId}-body`,
                                cx: "38%",
                                cy: "28%",
                                r: "78%",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "0%",
                                        stopColor: p.hi
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 129,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "22%",
                                        stopColor: p.light
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 130,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "46%",
                                        stopColor: p.mid
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 131,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "72%",
                                        stopColor: p.dark
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 132,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "100%",
                                        stopColor: p.deep
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 133,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 128,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("linearGradient", {
                                id: `${rawId}-rim`,
                                x1: "0",
                                y1: "0",
                                x2: "0",
                                y2: "1",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "52%",
                                        stopColor: "#ffffff",
                                        stopOpacity: "0"
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 136,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "80%",
                                        stopColor: "#ffffff",
                                        stopOpacity: "0.75"
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 137,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("stop", {
                                        offset: "100%",
                                        stopColor: "#ffffff",
                                        stopOpacity: "0"
                                    }, void 0, false, {
                                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                        lineNumber: 138,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 135,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("filter", {
                                id: `${rawId}-soft6`,
                                x: "-40%",
                                y: "-40%",
                                width: "180%",
                                height: "180%",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("feGaussianBlur", {
                                    stdDeviation: "6"
                                }, void 0, false, {
                                    fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                    lineNumber: 141,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 140,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("filter", {
                                id: `${rawId}-soft2`,
                                x: "-40%",
                                y: "-40%",
                                width: "180%",
                                height: "180%",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("feGaussianBlur", {
                                    stdDeviation: "2"
                                }, void 0, false, {
                                    fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                    lineNumber: 144,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 143,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("filter", {
                                id: `${rawId}-soft14`,
                                x: "-60%",
                                y: "-60%",
                                width: "220%",
                                height: "220%",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("feGaussianBlur", {
                                    stdDeviation: "14"
                                }, void 0, false, {
                                    fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                    lineNumber: 147,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 146,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("clipPath", {
                                id: `${rawId}-clip`,
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                    cx: "100",
                                    cy: "100",
                                    r: "96"
                                }, void 0, false, {
                                    fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                    lineNumber: 150,
                                    columnNumber: 13
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 149,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                        lineNumber: 127,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("g", {
                        clipPath: `url(#${rawId}-clip)`,
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                cx: "100",
                                cy: "100",
                                r: "96",
                                fill: `url(#${rawId}-body)`
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 154,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                                cx: "138",
                                cy: "142",
                                rx: "44",
                                ry: "34",
                                fill: "#000000",
                                opacity: "0.22",
                                filter: `url(#${rawId}-soft14)`
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 155,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                                cx: "80",
                                cy: "72",
                                rx: "54",
                                ry: "42",
                                fill: "#ffffff",
                                opacity: "0.26",
                                filter: `url(#${rawId}-soft14)`,
                                transform: "rotate(-20 80 72)"
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 156,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("circle", {
                                cx: "100",
                                cy: "100",
                                r: "88",
                                fill: "none",
                                stroke: `url(#${rawId}-rim)`,
                                strokeWidth: "7",
                                filter: `url(#${rawId}-soft6)`
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 157,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                                cx: "100",
                                cy: "168",
                                rx: "54",
                                ry: "13",
                                fill: "#ffffff",
                                opacity: "0.3",
                                filter: `url(#${rawId}-soft6)`
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 158,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                                cx: "73",
                                cy: "59",
                                rx: "27",
                                ry: "17",
                                fill: "#ffffff",
                                opacity: "0.9",
                                filter: `url(#${rawId}-soft6)`,
                                transform: "rotate(-24 73 59)"
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 159,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ellipse", {
                                cx: "67",
                                cy: "51",
                                rx: "10",
                                ry: "7",
                                fill: "#ffffff",
                                opacity: "0.95",
                                filter: `url(#${rawId}-soft2)`,
                                transform: "rotate(-24 67 51)"
                            }, void 0, false, {
                                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                                lineNumber: 160,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                        lineNumber: 153,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                lineNumber: 126,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: "ovorb-sheen",
                "aria-hidden": "true"
            }, void 0, false, {
                fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
                lineNumber: 163,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
        lineNumber: 113,
        columnNumber: 5
    }, this);
}
_s(Orb, "xfMyHNFebGjSN1/YPqrD8z5EdLc=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useId"]
    ];
});
_c = Orb;
function OverlayMark({ size = 20, label = 'Overlay', className }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Orb, {
        variant: "metal",
        size: size,
        state: "idle",
        animated: false,
        label: label,
        className: className
    }, void 0, false, {
        fileName: "[project]/packages/overlay-ui/src/components/orb/Orb.tsx",
        lineNumber: 178,
        columnNumber: 10
    }, this);
}
_c1 = OverlayMark;
var _c, _c1;
__turbopack_context__.k.register(_c, "Orb");
__turbopack_context__.k.register(_c1, "OverlayMark");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/overlay-ui/src/utils/cn.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "cn",
    ()=>cn
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/clsx/dist/clsx.mjs [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/tailwind-merge/dist/bundle-mjs.mjs [app-client] (ecmascript)");
;
;
function cn(...values) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$tailwind$2d$merge$2f$dist$2f$bundle$2d$mjs$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["twMerge"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$clsx$2f$dist$2f$clsx$2e$mjs__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clsx"])(...values));
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=_0ca1f53._.js.map