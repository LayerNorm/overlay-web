module.exports = [
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/apps/admin/src/app/auth/touch/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$operator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/admin/src/server/operator.ts [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/session.ts [app-route] (ecmascript)");
;
;
;
async function POST(request) {
    const outcome = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$operator$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["resolveOperator"])(request.cookies.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ADMIN_SESSION_COOKIE"])?.value);
    if (outcome.kind === 'anonymous') {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Unauthorized'
        }, {
            status: 401
        });
    }
    if (outcome.kind === 'denied') {
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: 'Forbidden'
        }, {
            status: 403
        });
    }
    const session = {
        ...outcome.session,
        lastActiveAt: Date.now()
    };
    const response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
        ok: true
    });
    response.headers.append('Set-Cookie', (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["serializeCookie"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["ADMIN_SESSION_COOKIE"], (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sealPayload"])(session), Math.floor(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["SESSION_ABSOLUTE_TTL_MS"] / 1000)));
    return response;
}
}),
"[project]/apps/admin/src/server/convex-admin.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ConvexAdminError",
    ()=>ConvexAdminError,
    "adminConvexClient",
    ()=>adminConvexClient,
    "adminConvexMutation",
    ()=>adminConvexMutation,
    "adminConvexQuery",
    ()=>adminConvexQuery,
    "runWithOperatorAccessToken",
    ()=>runWithOperatorAccessToken
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$async_hooks__$5b$external$5d$__$28$node$3a$async_hooks$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:async_hooks [external] (node:async_hooks, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-route] (ecmascript)");
;
;
;
/**
 * Carries the authenticated operator's WorkOS access token through the
 * request lifecycle so Convex `admin/console:*` functions can verify it via
 * `requireOperator` (Convex auth + JWKS). Routes run inside
 * `runWithOperatorAccessToken`.
 */ const operatorTokenStore = new __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$async_hooks__$5b$external$5d$__$28$node$3a$async_hooks$2c$__cjs$29$__["AsyncLocalStorage"]();
function runWithOperatorAccessToken(accessToken, run) {
    return operatorTokenStore.run({
        accessToken
    }, run);
}
class ConvexAdminError extends Error {
    status;
    constructor(message, status){
        super(message), this.status = status;
        this.name = 'ConvexAdminError';
    }
}
/**
 * The ONLY module in this app that talks to Convex. Every call injects
 * `serverSecret` from `ADMIN_API_SECRET`; callers never handle the secret.
 * Calls target the `admin/console:*` functions, which also verify the
 * forwarded operator WorkOS token (requireOperator).
 */ async function post(type, path, args) {
    const sanitized = {
        ...args
    };
    delete sanitized.serverSecret;
    const accessToken = operatorTokenStore.getStore()?.accessToken;
    const response = await fetch(`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["convexHttpUrl"])()}/api/${type}`, {
        body: JSON.stringify({
            args: {
                ...sanitized,
                serverSecret: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["adminApiSecret"])()
            },
            format: 'json',
            path
        }),
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json',
            ...accessToken ? {
                Authorization: `Bearer ${accessToken}`
            } : {}
        },
        method: 'POST'
    });
    if (!response.ok) {
        throw new ConvexAdminError(`Convex ${type} ${path} failed (HTTP ${response.status})`, response.status);
    }
    const body = await response.json().catch(()=>null);
    if (!body || body.status !== 'success') {
        throw new ConvexAdminError(body?.errorMessage ?? `Convex ${type} ${path} returned an invalid response`);
    }
    return body.value;
}
const adminConvexClient = {
    mutation: (path, args = {}, _options)=>post('mutation', path, args),
    query: (path, args = {}, _options)=>post('query', path, args)
};
const adminConvexQuery = adminConvexClient.query;
const adminConvexMutation = adminConvexClient.mutation;
}),
"[project]/apps/admin/src/server/env.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "adminApiSecret",
    ()=>adminApiSecret,
    "adminSessionSecret",
    ()=>adminSessionSecret,
    "allowedUserIds",
    ()=>allowedUserIds,
    "composioApiKey",
    ()=>composioApiKey,
    "convexHttpUrl",
    ()=>convexHttpUrl,
    "publicConvexUrl",
    ()=>publicConvexUrl,
    "workosApiKey",
    ()=>workosApiKey,
    "workosClientId",
    ()=>workosClientId
]);
;
const isDev = ("TURBOPACK compile-time value", "development") !== 'production';
function devFallback(name) {
    return ("TURBOPACK compile-time truthy", 1) ? process.env[`DEV_${name}`] : "TURBOPACK unreachable";
}
function convexHttpUrl() {
    const url = (process.env.ADMIN_CONVEX_URL ?? devFallback('NEXT_PUBLIC_CONVEX_URL') ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? '').trim().replace(/\/+$/, '');
    if (!url) {
        throw new Error('Convex URL is not configured (set ADMIN_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL)');
    }
    return url;
}
function adminApiSecret() {
    const secret = (process.env.ADMIN_API_SECRET ?? '').trim();
    if (!secret) {
        throw new Error('ADMIN_API_SECRET is not configured');
    }
    return secret;
}
function adminSessionSecret() {
    const secret = (process.env.ADMIN_SESSION_SECRET ?? '').trim();
    if (!secret) {
        throw new Error('ADMIN_SESSION_SECRET is not configured');
    }
    return secret;
}
function allowedUserIds() {
    const raw = process.env.ADMIN_ALLOWED_USER_IDS ?? '';
    return new Set(raw.split(',').map((value)=>value.trim()).filter(Boolean));
}
function workosClientId() {
    const id = (process.env.WORKOS_CLIENT_ID ?? devFallback('WORKOS_CLIENT_ID') ?? '').trim();
    if (!id) {
        throw new Error('WORKOS_CLIENT_ID is not configured');
    }
    return id;
}
function workosApiKey() {
    const key = (process.env.WORKOS_API_KEY ?? devFallback('WORKOS_API_KEY') ?? '').trim();
    if (!key) {
        throw new Error('WORKOS_API_KEY is not configured');
    }
    return key;
}
function composioApiKey() {
    const key = (process.env.COMPOSIO_API_KEY ?? '').trim();
    return key || undefined;
}
function publicConvexUrl() {
    const url = (process.env.ADMIN_CONVEX_URL ?? devFallback('NEXT_PUBLIC_CONVEX_URL') ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? '').trim().replace(/\/+$/, '');
    return url || undefined;
}
}),
"[project]/apps/admin/src/server/operator.ts [app-route] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resolveOperator",
    ()=>resolveOperator
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/convex-admin.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/session.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$workos$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/workos.ts [app-route] (ecmascript)");
;
;
;
;
;
/**
 * WorkOS access tokens are JWTs; treat a token within this skew of expiry as
 * stale enough to refresh.
 */ const TOKEN_REFRESH_SKEW_MS = 60_000;
function accessTokenExpiring(token, now = Date.now()) {
    try {
        const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
        if (typeof payload.exp !== 'number') return false;
        return payload.exp * 1000 - now <= TOKEN_REFRESH_SKEW_MS;
    } catch  {
        return false;
    }
}
async function loadPrincipal(userId) {
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["adminConvexQuery"])('admin/console:getPrincipal', {
        userId
    });
}
async function resolveOperator(cookieValue, deps = {}) {
    const getPrincipal = deps.getPrincipal ?? loadPrincipal;
    const session = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["openSession"])(cookieValue);
    if (!session) {
        return {
            kind: 'anonymous',
            reason: cookieValue ? 'invalid' : 'missing'
        };
    }
    const status = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["sessionStatus"])(session);
    if (status !== 'active') {
        return {
            kind: 'anonymous',
            reason: status
        };
    }
    let sessionMutated = false;
    if (session.refreshToken && accessTokenExpiring(session.accessToken)) {
        try {
            const refreshed = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$workos$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["refreshSession"])(session.refreshToken);
            session.accessToken = refreshed.accessToken;
            session.refreshToken = refreshed.refreshToken ?? session.refreshToken;
            sessionMutated = true;
        } catch  {
        // The access token is only needed to forward identity to Convex in a
        // later stage; a refresh failure does not invalidate the session.
        }
    }
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["allowedUserIds"])().has(session.user.id)) {
        return {
            kind: 'denied',
            reason: 'not_allowlisted'
        };
    }
    const principal = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["runWithOperatorAccessToken"])(session.accessToken, async ()=>await getPrincipal(session.user.id)).catch(()=>null);
    if (!principal || principal.revokedAt) {
        return {
            kind: 'denied',
            reason: 'not_operator'
        };
    }
    return {
        kind: 'operator',
        principal,
        session,
        sessionMutated,
        user: session.user
    };
}
;
}),
"[project]/apps/admin/src/server/session.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ADMIN_AUTH_STATE_COOKIE",
    ()=>ADMIN_AUTH_STATE_COOKIE,
    "ADMIN_SESSION_COOKIE",
    ()=>ADMIN_SESSION_COOKIE,
    "AUTH_STATE_TTL_MS",
    ()=>AUTH_STATE_TTL_MS,
    "RECENT_SIGN_IN_WINDOW_MS",
    ()=>RECENT_SIGN_IN_WINDOW_MS,
    "SESSION_ABSOLUTE_TTL_MS",
    ()=>SESSION_ABSOLUTE_TTL_MS,
    "SESSION_IDLE_TTL_MS",
    ()=>SESSION_IDLE_TTL_MS,
    "clearAuthStateCookie",
    ()=>clearAuthStateCookie,
    "clearSessionCookie",
    ()=>clearSessionCookie,
    "hasRecentSignIn",
    ()=>hasRecentSignIn,
    "openPayload",
    ()=>openPayload,
    "openSession",
    ()=>openSession,
    "sealPayload",
    ()=>sealPayload,
    "serializeCookie",
    ()=>serializeCookie,
    "sessionCookie",
    ()=>sessionCookie,
    "sessionStatus",
    ()=>sessionStatus,
    "touchSessionCookie",
    ()=>touchSessionCookie
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-route] (ecmascript)");
;
;
;
const ADMIN_SESSION_COOKIE = '__Host-overlay_admin_session';
const ADMIN_AUTH_STATE_COOKIE = '__Host-overlay_admin_auth_state';
const SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const RECENT_SIGN_IN_WINDOW_MS = 30 * 60 * 1000;
const AUTH_STATE_TTL_MS = 10 * 60 * 1000;
const IV_LENGTH_BYTES = 12;
const GCM_TAG_LENGTH_BYTES = 16;
function cryptoKey() {
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["createHash"])('sha256').update((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["adminSessionSecret"])()).digest();
}
function signature(payload) {
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["createHmac"])('sha256', cryptoKey()).update(payload).digest('base64url');
}
function signatureMatches(payload, candidate) {
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["timingSafeEqual"])(expected, actual);
}
function sealPayload(value) {
    const iv = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomBytes"])(IV_LENGTH_BYTES);
    const cipher = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["createCipheriv"])('aes-256-gcm', cryptoKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(value), 'utf8'),
        cipher.final()
    ]);
    const payload = Buffer.concat([
        iv,
        ciphertext,
        cipher.getAuthTag()
    ]).toString('base64url');
    return `${payload}.${signature(payload)}`;
}
function openPayload(sealed) {
    if (!sealed) return null;
    const separator = sealed.lastIndexOf('.');
    if (separator <= 0) return null;
    const payload = sealed.slice(0, separator);
    if (!signatureMatches(payload, sealed.slice(separator + 1))) return null;
    try {
        const raw = Buffer.from(payload, 'base64url');
        const iv = raw.subarray(0, IV_LENGTH_BYTES);
        const tag = raw.subarray(raw.length - GCM_TAG_LENGTH_BYTES);
        const ciphertext = raw.subarray(IV_LENGTH_BYTES, raw.length - GCM_TAG_LENGTH_BYTES);
        const decipher = (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["createDecipheriv"])('aes-256-gcm', cryptoKey(), iv, {
            authTagLength: GCM_TAG_LENGTH_BYTES
        });
        decipher.setAuthTag(tag);
        return JSON.parse(Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]).toString('utf8'));
    } catch  {
        return null;
    }
}
function openSession(value) {
    const session = openPayload(value);
    if (!session?.accessToken || !session.user?.id || !session.signedInAt || !session.lastActiveAt) {
        return null;
    }
    return session;
}
function sessionStatus(session, now = Date.now()) {
    if (now - session.signedInAt > SESSION_ABSOLUTE_TTL_MS) return 'expired';
    if (now - session.lastActiveAt > SESSION_IDLE_TTL_MS) return 'idle_expired';
    return 'active';
}
function hasRecentSignIn(session, now = Date.now()) {
    return now - session.signedInAt <= RECENT_SIGN_IN_WINDOW_MS;
}
const COOKIE_FLAGS = 'Path=/; HttpOnly; Secure; SameSite=Lax';
function serializeCookie(name, value, maxAgeSeconds) {
    return `${name}=${value}; ${COOKIE_FLAGS}; Max-Age=${maxAgeSeconds}`;
}
function sessionCookie(session) {
    return serializeCookie(ADMIN_SESSION_COOKIE, sealPayload(session), Math.floor(SESSION_ABSOLUTE_TTL_MS / 1000));
}
function clearSessionCookie() {
    return serializeCookie(ADMIN_SESSION_COOKIE, '', 0);
}
function clearAuthStateCookie() {
    return serializeCookie(ADMIN_AUTH_STATE_COOKIE, '', 0);
}
function touchSessionCookie(session, now = Date.now()) {
    return sessionCookie({
        ...session,
        lastActiveAt: now
    });
}
}),
"[project]/apps/admin/src/server/workos.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "adminAuthorizationUrl",
    ()=>adminAuthorizationUrl,
    "authenticateWithCode",
    ()=>authenticateWithCode,
    "refreshSession",
    ()=>refreshSession
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$workos$2d$inc$2f$node$2f$lib$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@workos-inc/node/lib/index.mjs [app-route] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-route] (ecmascript)");
;
;
;
let cached = null;
function client() {
    return cached ??= new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$workos$2d$inc$2f$node$2f$lib$2f$index$2e$mjs__$5b$app$2d$route$5d$__$28$ecmascript$29$__$3c$locals$3e$__["WorkOS"]((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["workosApiKey"])());
}
function adminAuthorizationUrl(args) {
    return client().userManagement.getAuthorizationUrl({
        clientId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["workosClientId"])(),
        provider: 'authkit',
        redirectUri: `${args.origin}/auth/callback`,
        state: args.state
    });
}
async function authenticateWithCode(code) {
    return client().userManagement.authenticateWithCode({
        clientId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["workosClientId"])(),
        code
    });
}
async function refreshSession(refreshToken) {
    return client().userManagement.authenticateWithRefreshToken({
        clientId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["workosClientId"])(),
        refreshToken
    });
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1qehc5t._.js.map