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
"[project]/apps/admin/src/app/auth/sign-out/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "GET",
    ()=>GET
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/session.ts [app-route] (ecmascript)");
;
;
async function GET(request) {
    const response = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].redirect(new URL('/sign-in', request.nextUrl.origin));
    response.headers.append('Set-Cookie', (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["clearSessionCookie"])());
    return response;
}
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
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0wn5ef3._.js.map