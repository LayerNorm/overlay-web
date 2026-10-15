module.exports = [
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:crypto [external] (node:crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:crypto", () => require("node:crypto"));

module.exports = mod;
}),
"[project]/apps/admin/src/app/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>Page,
    "dynamic",
    ()=>dynamic
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/headers.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$api$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/next/dist/api/navigation.react-server.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/components/navigation.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$AdminConsolePage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/features/admin/AdminConsolePage.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$SessionTouch$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/features/admin/SessionTouch.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$context$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/admin/src/server/context.ts [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$operator$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/apps/admin/src/server/operator.ts [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/session.ts [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
const dynamic = 'force-dynamic';
async function Page() {
    const store = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$headers$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["cookies"])();
    const outcome = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$operator$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["resolveOperator"])(store.get(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ADMIN_SESSION_COOKIE"])?.value);
    if (outcome.kind === 'anonymous') (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["redirect"])('/sign-in');
    if (outcome.kind === 'denied') (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["redirect"])('/denied');
    const subject = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$context$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["getAdminServerContext"])().authorizationService.resolveSubject(outcome.user.id);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["Fragment"], {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$SessionTouch$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["SessionTouch"], {}, void 0, false, {
                fileName: "[project]/apps/admin/src/app/page.tsx",
                lineNumber: 24,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$AdminConsolePage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AdminConsolePage"], {
                capabilities: subject.capabilities
            }, void 0, false, {
                fileName: "[project]/apps/admin/src/app/page.tsx",
                lineNumber: 25,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/apps/admin/src/app/page.tsx",
        lineNumber: 23,
        columnNumber: 5
    }, this);
}
}),
"[project]/apps/admin/src/app/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", (function(__turbopack_context__){

__turbopack_context__.n(__turbopack_context__.i("[project]/apps/admin/src/app/page.tsx [app-rsc] (ecmascript)"));
}),
"[project]/apps/admin/src/features/admin/AdminConsolePage.tsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AdminConsolePage",
    ()=>AdminConsolePage
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const AdminConsolePage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call AdminConsolePage() from the server but AdminConsolePage is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/admin/src/features/admin/AdminConsolePage.tsx", "AdminConsolePage");
}),
"[project]/apps/admin/src/features/admin/AdminConsolePage.tsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AdminConsolePage",
    ()=>AdminConsolePage
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const AdminConsolePage = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call AdminConsolePage() from the server but AdminConsolePage is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/admin/src/features/admin/AdminConsolePage.tsx <module evaluation>", "AdminConsolePage");
}),
"[project]/apps/admin/src/features/admin/AdminConsolePage.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$AdminConsolePage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/apps/admin/src/features/admin/AdminConsolePage.tsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$AdminConsolePage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/apps/admin/src/features/admin/AdminConsolePage.tsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$AdminConsolePage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/apps/admin/src/features/admin/SessionTouch.tsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SessionTouch",
    ()=>SessionTouch
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const SessionTouch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SessionTouch() from the server but SessionTouch is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/admin/src/features/admin/SessionTouch.tsx", "SessionTouch");
}),
"[project]/apps/admin/src/features/admin/SessionTouch.tsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "SessionTouch",
    ()=>SessionTouch
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const SessionTouch = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call SessionTouch() from the server but SessionTouch is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/apps/admin/src/features/admin/SessionTouch.tsx <module evaluation>", "SessionTouch");
}),
"[project]/apps/admin/src/features/admin/SessionTouch.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$SessionTouch$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/apps/admin/src/features/admin/SessionTouch.tsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$SessionTouch$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/apps/admin/src/features/admin/SessionTouch.tsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$features$2f$admin$2f$SessionTouch$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/apps/admin/src/server/admin/AdministrativeService.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AdministrativeAuthorizationError",
    ()=>AdministrativeAuthorizationError,
    "AdministrativeService",
    ()=>AdministrativeService
]);
;
class AdministrativeAuthorizationError extends Error {
    constructor(message = 'Administrative authorization required'){
        super(message);
        this.name = 'AdministrativeAuthorizationError';
    }
}
class AdministrativeService {
    deps;
    constructor(deps){
        this.deps = deps;
    }
    async canManageAdministrators(userId) {
        return await this.activeRole(userId) === 'admin';
    }
    async canViewAudit(userId) {
        const role = await this.activeRole(userId);
        return role === 'admin' || role === 'auditor';
    }
    async canManageBilling(userId) {
        const role = await this.activeRole(userId);
        return role === 'admin' || role === 'billing_admin';
    }
    async canAccessSupportControls(userId) {
        const role = await this.activeRole(userId);
        return role === 'admin' || role === 'support';
    }
    async assertCanManageAdministrators(userId) {
        if (!await this.canManageAdministrators(userId)) throw new AdministrativeAuthorizationError();
    }
    async assertCanViewAudit(userId) {
        if (!await this.canViewAudit(userId)) throw new AdministrativeAuthorizationError();
    }
    async list(actorUserId) {
        await this.assertCanManageAdministrators(actorUserId);
        return await this.deps.repository.list();
    }
    async grant(args) {
        await this.assertCanManageAdministrators(args.actorUserId);
        const principal = await this.deps.repository.grant({
            grantedBy: args.actorUserId,
            reason: args.reason,
            role: args.role,
            userId: args.userId
        });
        await this.deps.audit.record({
            action: 'administration.principal.grant',
            actorType: 'user',
            actorUserId: args.actorUserId,
            ipAddress: args.ipAddress,
            metadata: {
                role: args.role,
                reason: args.reason
            },
            outcome: 'success',
            requestId: args.requestId,
            resourceId: args.userId,
            resourceType: 'administrative_principal'
        });
        return principal;
    }
    async revoke(args) {
        await this.assertCanManageAdministrators(args.actorUserId);
        if (args.actorUserId === args.userId) {
            throw new Error('Administrators cannot revoke their own active role');
        }
        const revoked = await this.deps.repository.revoke({
            revokedBy: args.actorUserId,
            userId: args.userId
        });
        await this.deps.audit.record({
            action: 'administration.principal.revoke',
            actorType: 'user',
            actorUserId: args.actorUserId,
            ipAddress: args.ipAddress,
            outcome: revoked ? 'success' : 'failure',
            requestId: args.requestId,
            resourceId: args.userId,
            resourceType: 'administrative_principal'
        });
        return revoked;
    }
    async activeRole(userId) {
        const principal = await this.deps.repository.get({
            userId
        });
        return principal && !principal.revokedAt ? principal.role : null;
    }
}
}),
"[project]/apps/admin/src/server/admin/AuditRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "sanitizeAuditMetadata",
    ()=>sanitizeAuditMetadata
]);
;
function sanitizeAuditMetadata(value) {
    return sanitizeObject(value, 0);
}
function sanitizeObject(value, depth) {
    if (depth > 4) return {
        truncated: true
    };
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)){
        if (/(secret|token|password|authorization|cookie|api.?key)/i.test(key)) {
            result[key] = '[REDACTED]';
        } else if (typeof item === 'string') {
            result[key] = item.slice(0, 1000);
        } else if (Array.isArray(item)) {
            result[key] = item.slice(0, 50).map((entry)=>entry && typeof entry === 'object' && !Array.isArray(entry) ? sanitizeObject(entry, depth + 1) : typeof entry === 'string' ? entry.slice(0, 1000) : entry);
        } else if (item && typeof item === 'object') {
            result[key] = sanitizeObject(item, depth + 1);
        } else {
            result[key] = item;
        }
    }
    return result;
}
}),
"[project]/apps/admin/src/server/admin/AuditService.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AuditService",
    ()=>AuditService
]);
;
class AuditService {
    repository;
    constructor(repository){
        this.repository = repository;
    }
    async record(args) {
        await this.repository.append({
            ...args,
            metadata: args.metadata ?? {}
        });
    }
    async list(args) {
        return await this.repository.list(args);
    }
}
}),
"[project]/apps/admin/src/server/admin/ConvexAdministrativeRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ConvexAdministrativeRepository",
    ()=>ConvexAdministrativeRepository
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/convex-admin.ts [app-rsc] (ecmascript)");
;
;
class ConvexAdministrativeRepository {
    async get(args) {
        return normalize(await __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].query('admin/administration:getPrincipalByServer', {
            ...args
        }, {
            throwOnError: true
        }));
    }
    async list() {
        const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].query('admin/administration:listPrincipalsByServer', {}, {
            throwOnError: true
        }) ?? [];
        return rows.map((row)=>normalize(row));
    }
    async grant(args) {
        const row = await __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].mutation('admin/administration:grantPrincipalByServer', {
            ...args
        }, {
            throwOnError: true
        });
        if (!row) throw new Error('Failed to grant administrative principal');
        return normalize(row);
    }
    async revoke(args) {
        const result = await __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].mutation('admin/administration:revokePrincipalByServer', {
            ...args
        }, {
            throwOnError: true
        });
        return result?.revoked === true;
    }
}
function normalize(row) {
    if (!row) return null;
    const { _id: _, _creationTime: __, ...principal } = row;
    return principal;
}
}),
"[project]/apps/admin/src/server/admin/ConvexAuditRepository.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ConvexAuditRepository",
    ()=>ConvexAuditRepository
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/convex-admin.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$AuditRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/admin/AuditRepository.ts [app-rsc] (ecmascript)");
;
;
;
;
class ConvexAuditRepository {
    async append(args) {
        const { id, metadata, ...event } = args;
        const row = await __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].mutation('admin/administration:appendAuditByServer', {
            ...event,
            eventId: id ?? `audit_${(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomUUID"])()}`,
            metadataJson: JSON.stringify((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$AuditRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sanitizeAuditMetadata"])(metadata)),
            createdAt: args.createdAt ?? Date.now()
        }, {
            throwOnError: true
        });
        if (!row) throw new Error('Failed to append audit event');
        return fromRow(row);
    }
    async list(args = {}) {
        const rows = await __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].query('admin/administration:listAuditByServer', {
            ...args
        }, {
            throwOnError: true
        }) ?? [];
        return rows.map(fromRow);
    }
}
function fromRow(row) {
    const { eventId, metadataJson, _id: _, _creationTime: __, ...event } = row;
    return {
        ...event,
        id: eventId,
        metadata: JSON.parse(metadataJson)
    };
}
}),
"[project]/apps/admin/src/server/authorization/AuthorizationAdministrationService.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AuthorizationAdministrationService",
    ()=>AuthorizationAdministrationService
]);
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:crypto [external] (node:crypto, cjs)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$capabilities$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/overlay-authz-contracts/src/capabilities.ts [app-rsc] (ecmascript)");
;
;
;
class AuthorizationAdministrationService {
    deps;
    constructor(deps){
        this.deps = deps;
    }
    async listCapabilities(actor) {
        await this.assertAllowed(actor, 'roles.read');
        return __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$capabilities$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AUTHORIZATION_CAPABILITY_DEFINITIONS"];
    }
    async listRoles(actor, includeArchived = false) {
        await this.assertAllowed(actor, 'roles.read');
        await this.deps.prepareAuthorization?.();
        return await this.deps.repositories.roles.list({
            includeArchived
        });
    }
    async createRole(actor, input) {
        await this.assertAllowed(actor, 'roles.manage');
        const role = await this.deps.repositories.roles.create({
            id: prefixedId('role'),
            name: input.name,
            description: input.description,
            capabilities: input.capabilities,
            createdBy: actor.actorUserId,
            isSystem: false
        });
        await this.audit(actor, 'authorization.role.create', 'authorization_role', role.id, {
            capabilities: role.capabilities,
            name: role.name
        });
        return role;
    }
    async updateRole(actor, input) {
        await this.assertAllowed(actor, 'roles.manage');
        const existing = await this.requireRole(input.roleId);
        assertMutableRole(existing);
        const role = await this.deps.repositories.roles.update({
            id: input.roleId,
            name: input.name,
            description: input.description,
            capabilities: input.capabilities
        });
        if (!role) throw new Error('Authorization role not found');
        await this.audit(actor, 'authorization.role.update', 'authorization_role', role.id, {
            capabilities: role.capabilities,
            name: role.name
        });
        return role;
    }
    async archiveRole(actor, roleId) {
        await this.assertAllowed(actor, 'roles.manage');
        const existing = await this.requireRole(roleId);
        assertMutableRole(existing);
        const archived = await this.deps.repositories.roles.archive({
            id: roleId,
            archivedBy: actor.actorUserId
        });
        await this.audit(actor, 'authorization.role.archive', 'authorization_role', roleId, {
            archived
        });
        return archived;
    }
    async listGroups(actor, includeArchived = false) {
        await this.assertAllowed(actor, 'groups.read');
        return await this.deps.repositories.groups.list({
            includeArchived
        });
    }
    async createGroup(actor, input) {
        await this.assertAllowed(actor, 'groups.manage');
        const group = await this.deps.repositories.groups.create({
            id: prefixedId('group'),
            name: input.name,
            description: input.description,
            source: 'local',
            createdBy: actor.actorUserId
        });
        await this.audit(actor, 'authorization.group.create', 'authorization_group', group.id, {
            name: group.name
        });
        return group;
    }
    async updateGroup(actor, input) {
        await this.assertAllowed(actor, 'groups.manage');
        const existing = await this.requireGroup(input.groupId);
        assertMutableGroup(existing);
        const group = await this.deps.repositories.groups.update({
            id: input.groupId,
            name: input.name,
            description: input.description
        });
        if (!group) throw new Error('Authorization group not found');
        await this.audit(actor, 'authorization.group.update', 'authorization_group', group.id, {
            name: group.name
        });
        return group;
    }
    async archiveGroup(actor, groupId) {
        await this.assertAllowed(actor, 'groups.manage');
        const existing = await this.requireGroup(groupId);
        assertMutableGroup(existing);
        const archived = await this.deps.repositories.groups.archive({
            id: groupId,
            archivedBy: actor.actorUserId
        });
        await this.audit(actor, 'authorization.group.archive', 'authorization_group', groupId, {
            archived
        });
        return archived;
    }
    async listGroupMembers(actor, groupId) {
        await this.assertAllowed(actor, 'groups.read');
        await this.requireGroup(groupId);
        return await this.deps.repositories.groups.listMembers(groupId);
    }
    async addGroupMember(actor, input) {
        await this.assertAllowed(actor, 'groups.manage');
        const group = await this.requireGroup(input.groupId);
        assertMutableGroup(group);
        const membership = await this.deps.repositories.groups.addMember({
            groupId: input.groupId,
            userId: input.userId,
            source: 'local'
        });
        await this.audit(actor, 'authorization.group_member.add', 'authorization_group', input.groupId, {
            userId: input.userId
        });
        return membership;
    }
    async removeGroupMember(actor, input) {
        await this.assertAllowed(actor, 'groups.manage');
        const group = await this.requireGroup(input.groupId);
        assertMutableGroup(group);
        const removed = await this.deps.repositories.groups.removeMember(input);
        await this.audit(actor, 'authorization.group_member.remove', 'authorization_group', input.groupId, {
            removed,
            userId: input.userId
        });
        return removed;
    }
    async listAssignments(actor, input) {
        await this.assertAllowed(actor, 'roles.read');
        if (input.subjectType === 'user') {
            return await this.deps.repositories.assignments.listForUser(input.subjectId);
        }
        await this.requireGroup(input.subjectId);
        return await this.deps.repositories.assignments.listForGroups([
            input.subjectId
        ]);
    }
    async listRoleAssignments(actor, roleId) {
        await this.assertAllowed(actor, 'roles.read');
        await this.requireRole(roleId);
        const [users, groups] = await Promise.all([
            this.deps.repositories.assignments.listUsersForRole(roleId),
            this.deps.repositories.assignments.listGroupsForRole(roleId)
        ]);
        return {
            users,
            groups
        };
    }
    async assignRole(actor, input) {
        await this.assertAllowed(actor, 'roles.manage');
        const role = await this.requireRole(input.roleId);
        if (role.archivedAt) throw new Error('Cannot assign an archived authorization role');
        const assignment = input.subjectType === 'user' ? await this.deps.repositories.assignments.assignUser({
            userId: input.subjectId,
            roleId: input.roleId,
            assignedBy: actor.actorUserId
        }) : await this.assignGroupRole(actor, input);
        await this.audit(actor, 'authorization.role.assign', 'authorization_role', input.roleId, {
            subjectId: input.subjectId,
            subjectType: input.subjectType
        });
        return assignment;
    }
    async revokeRole(actor, input) {
        await this.assertAllowed(actor, 'roles.manage');
        const revoked = input.subjectType === 'user' ? await this.deps.repositories.assignments.revokeUser({
            userId: input.subjectId,
            roleId: input.roleId
        }) : await this.deps.repositories.assignments.revokeGroup({
            groupId: input.subjectId,
            roleId: input.roleId
        });
        await this.audit(actor, 'authorization.role.revoke', 'authorization_role', input.roleId, {
            revoked,
            subjectId: input.subjectId,
            subjectType: input.subjectType
        });
        return revoked;
    }
    async listResourceGrants(actor, input) {
        await this.assertAllowed(actor, 'roles.read');
        return await this.deps.repositories.resourceGrants.listForResource(input);
    }
    async upsertResourceGrant(actor, input) {
        await this.assertAllowed(actor, 'roles.manage');
        await this.requirePrincipal(input.principalType, input.principalId);
        const grant = await this.deps.repositories.resourceGrants.upsert({
            id: prefixedId('grant'),
            ...input,
            grantedBy: actor.actorUserId
        });
        await this.audit(actor, 'authorization.resource_grant.upsert', input.resourceType, input.resourceId, {
            accessRole: input.accessRole,
            principalId: input.principalId,
            principalType: input.principalType
        });
        return grant;
    }
    async removeResourceGrant(actor, grantId) {
        await this.assertAllowed(actor, 'roles.manage');
        const removed = await this.deps.repositories.resourceGrants.remove(grantId);
        await this.audit(actor, 'authorization.resource_grant.remove', 'authorization_resource_grant', grantId, {
            removed
        });
        return removed;
    }
    async assignGroupRole(actor, input) {
        const group = await this.requireGroup(input.subjectId);
        if (group.archivedAt) throw new Error('Cannot assign a role to an archived authorization group');
        return await this.deps.repositories.assignments.assignGroup({
            groupId: input.subjectId,
            roleId: input.roleId,
            assignedBy: actor.actorUserId
        });
    }
    async requirePrincipal(type, id) {
        if (type === 'role') {
            await this.requireRole(id);
        } else if (type === 'group') {
            await this.requireGroup(id);
        }
    }
    async requireRole(roleId) {
        const role = await this.deps.repositories.roles.get(roleId);
        if (!role) throw new Error('Authorization role not found');
        return role;
    }
    async requireGroup(groupId) {
        const group = await this.deps.repositories.groups.get(groupId);
        if (!group) throw new Error('Authorization group not found');
        return group;
    }
    async assertAllowed(actor, capability) {
        await this.deps.assertCapability(actor.actorUserId, capability);
    }
    async audit(actor, action, resourceType, resourceId, metadata) {
        await this.deps.audit.record({
            action,
            actorApiKeyId: actor.actorApiKeyId,
            actorType: actor.actorType,
            actorUserId: actor.actorUserId,
            ipAddress: actor.ipAddress,
            metadata,
            outcome: 'success',
            requestId: actor.requestId,
            resourceId,
            resourceType
        });
    }
}
function prefixedId(prefix) {
    return `${prefix}_${(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["randomUUID"])()}`;
}
function assertMutableRole(role) {
    if (role.isSystem) throw new Error('System authorization roles cannot be modified');
}
function assertMutableGroup(group) {
    if (group.source === 'external') {
        throw new Error('Externally managed authorization groups cannot be modified');
    }
}
}),
"[project]/apps/admin/src/server/authorization/AuthorizationService.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AuthorizationDeniedError",
    ()=>AuthorizationDeniedError,
    "AuthorizationService",
    ()=>AuthorizationService
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/overlay-authz-contracts/src/types.ts [app-rsc] (ecmascript)");
;
;
class AuthorizationDeniedError extends Error {
    decision;
    statusCode;
    constructor(decision){
        super('Authorization denied'), this.decision = decision, this.statusCode = 403;
        this.name = 'AuthorizationDeniedError';
    }
}
class AuthorizationService {
    deps;
    constructor(deps){
        this.deps = deps;
        /** Catalog resource authorization evaluation context. */ this.evaluation = {
            mode: 'observe',
            subject: {
                userId: '',
                groupIds: [],
                roleIds: [],
                capabilities: [],
                isDeploymentOwner: false
            }
        };
    }
    evaluation;
    async resolveSubject(userId) {
        const [groups, directAssignments, isDeploymentOwner] = await Promise.all([
            this.deps.repositories.groups.listForUser(userId),
            this.deps.repositories.assignments.listForUser(userId),
            this.deps.isDeploymentOwner?.(userId) ?? false
        ]);
        const groupIds = groups.map(({ id })=>id);
        const groupAssignments = await this.deps.repositories.assignments.listForGroups(groupIds);
        const roleIds = [
            ...new Set([
                ...directAssignments.map(({ roleId })=>roleId),
                ...groupAssignments.map(({ roleId })=>roleId)
            ])
        ];
        const roles = (await Promise.all(roleIds.map((roleId)=>this.deps.repositories.roles.get(roleId)))).filter((role)=>Boolean(role && !role.archivedAt));
        const activeRoleIds = roles.map(({ id })=>id);
        const capabilities = [
            ...new Set(roles.flatMap(({ capabilities: values })=>values))
        ];
        return {
            userId,
            groupIds,
            roleIds: activeRoleIds,
            capabilities,
            isDeploymentOwner: Boolean(isDeploymentOwner)
        };
    }
    async checkCapability(args) {
        const subject = await this.resolveSubject(args.userId);
        return this.checkResolvedCapability(subject, args.capability);
    }
    checkResolvedCapability(subject, capability) {
        return this.capabilityDecision(subject, capability);
    }
    async assertCapability(args) {
        const subject = await this.resolveSubject(args.userId);
        const decision = this.checkResolvedCapability(subject, args.capability);
        if (!decision.allowed) throw new AuthorizationDeniedError(decision);
        return subject;
    }
    async checkResourceAccess(args) {
        const subject = await this.resolveSubject(args.userId);
        return this.checkResolvedResourceAccess({
            ...args,
            subject
        });
    }
    async checkResolvedResourceAccess(args) {
        const subject = args.subject;
        const capability = this.capabilityDecision(subject, args.capability);
        if (!capability.allowed) {
            return {
                ...capability,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                requiredAction: args.action
            };
        }
        if (subject.isDeploymentOwner) {
            return {
                allowed: true,
                capability: args.capability,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                requiredAction: args.action,
                effectiveAccessRole: 'owner',
                reason: 'deployment_owner'
            };
        }
        if (args.ownerUserId === subject.userId) {
            return {
                allowed: true,
                capability: args.capability,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                requiredAction: args.action,
                effectiveAccessRole: 'owner',
                reason: 'resource_owner'
            };
        }
        const grants = await this.deps.repositories.resourceGrants.listForPrincipals({
            userId: subject.userId,
            groupIds: subject.groupIds,
            roleIds: subject.roleIds,
            resourceType: args.resourceType
        });
        const effectiveAccessRole = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["strongestAccessRole"])(grants.filter(({ resourceId })=>resourceId === args.resourceId).map(({ accessRole })=>accessRole));
        const allowed = Boolean(effectiveAccessRole && (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["accessRoleAllows"])(effectiveAccessRole, args.action));
        return {
            allowed,
            capability: args.capability,
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            requiredAction: args.action,
            effectiveAccessRole,
            reason: allowed ? 'resource_access_granted' : 'resource_access_missing'
        };
    }
    async checkResolvedCatalogResourceAccess(args) {
        const capability = this.capabilityDecision(args.subject, args.capability);
        if (!capability.allowed) {
            return {
                ...capability,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                requiredAction: 'view'
            };
        }
        if (args.subject.isDeploymentOwner) {
            return {
                allowed: true,
                capability: args.capability,
                resourceType: args.resourceType,
                resourceId: args.resourceId,
                requiredAction: 'view',
                effectiveAccessRole: 'owner',
                reason: 'deployment_owner'
            };
        }
        const [exactGrants, wildcardGrants] = await Promise.all([
            this.deps.repositories.resourceGrants.listForResource({
                resourceId: args.resourceId,
                resourceType: args.resourceType
            }),
            this.deps.repositories.resourceGrants.listForResource({
                resourceId: '*',
                resourceType: args.resourceType
            })
        ]);
        return catalogGrantDecision(args, [
            ...exactGrants,
            ...wildcardGrants
        ]);
    }
    async filterCatalogResourceIds(args) {
        // Same decision as checkResolvedCatalogResourceAccess per id, but the
        // capability, owner, and wildcard-grant inputs are shared across the list,
        // so they are resolved once instead of once per resource.
        if (!this.capabilityDecision(args.subject, args.capability).allowed) return [];
        if (args.subject.isDeploymentOwner) return [
            ...args.resourceIds
        ];
        const [wildcardGrants, exactGrants] = await Promise.all([
            this.deps.repositories.resourceGrants.listForResource({
                resourceId: '*',
                resourceType: args.resourceType
            }),
            Promise.all(args.resourceIds.map((resourceId)=>this.deps.repositories.resourceGrants.listForResource({
                    resourceId,
                    resourceType: args.resourceType
                })))
        ]);
        return args.resourceIds.filter((resourceId, index)=>catalogGrantDecision({
                ...args,
                resourceId
            }, [
                ...exactGrants[index],
                ...wildcardGrants
            ]).allowed);
    }
    async getResourceOwner(args) {
        return this.deps.repositories.resourceOwners.getOwner(args);
    }
    async listAccessibleResourceIds(args) {
        const grants = await this.deps.repositories.resourceGrants.listForPrincipals({
            userId: args.subject.userId,
            groupIds: args.subject.groupIds,
            roleIds: args.subject.roleIds,
            resourceType: args.resourceType
        });
        return [
            ...new Set(grants.filter(({ accessRole })=>(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["accessRoleAllows"])(accessRole, args.action)).map(({ resourceId })=>resourceId))
        ];
    }
    async listAccessibleResources(args) {
        const resourceIds = await this.listAccessibleResourceIds(args);
        const values = await Promise.all(resourceIds.map(async (resourceId)=>({
                ownerUserId: await this.getResourceOwner({
                    resourceId,
                    resourceType: args.resourceType
                }),
                resourceId
            })));
        return values.filter((value)=>Boolean(value.ownerUserId) && value.ownerUserId !== args.subject.userId);
    }
    async assertResourceAccess(args) {
        const decision = await this.checkResourceAccess(args);
        if (!decision.allowed) throw new AuthorizationDeniedError(decision);
    }
    capabilityDecision(subject, capability) {
        if (subject.isDeploymentOwner) {
            return {
                allowed: true,
                capability,
                reason: 'deployment_owner'
            };
        }
        if (this.deps.capabilityPolicy && !this.deps.capabilityPolicy.isEnabled(capability)) {
            return {
                allowed: false,
                capability,
                reason: 'capability_disabled'
            };
        }
        if (!subject.capabilities.includes(capability)) {
            return {
                allowed: false,
                capability,
                reason: 'capability_missing'
            };
        }
        return {
            allowed: true,
            capability,
            reason: 'resource_access_granted'
        };
    }
}
function principalMatches(subject, principalType, principalId) {
    if (principalType === 'user') return principalId === subject.userId;
    if (principalType === 'group') return subject.groupIds.includes(principalId);
    return subject.roleIds.includes(principalId);
}
function catalogGrantDecision(args, policyGrants) {
    if (policyGrants.length === 0) {
        return {
            allowed: true,
            capability: args.capability,
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            requiredAction: 'view',
            reason: 'resource_unrestricted'
        };
    }
    const effectiveAccessRole = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$types$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["strongestAccessRole"])(policyGrants.filter((grant)=>principalMatches(args.subject, grant.principalType, grant.principalId)).map(({ accessRole })=>accessRole));
    return {
        allowed: Boolean(effectiveAccessRole),
        capability: args.capability,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        requiredAction: 'view',
        effectiveAccessRole,
        reason: effectiveAccessRole ? 'resource_access_granted' : 'resource_access_missing'
    };
}
}),
"[project]/apps/admin/src/server/authorization/ConvexAuthorizationRepositories.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "createConvexAuthorizationRepositories",
    ()=>createConvexAuthorizationRepositories
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/convex-admin.ts [app-rsc] (ecmascript)");
;
;
class ConvexAuthorizationRoleRepository {
    async create(input) {
        return role(await requiredMutation('createRoleByServer', {
            roleId: input.id,
            name: input.name,
            description: input.description,
            capabilities: input.capabilities,
            isSystem: input.isSystem ?? false,
            createdBy: input.createdBy
        }));
    }
    async get(id) {
        const row = await query('getRoleByServer', {
            roleId: id
        });
        return row ? role(row) : null;
    }
    async list(args = {}) {
        const rows = await query('listRolesByServer', {
            includeArchived: args.includeArchived ?? false
        }) ?? [];
        return rows.map(role);
    }
    async update(input) {
        const row = await mutation('updateRoleByServer', {
            roleId: input.id,
            name: input.name,
            description: input.description,
            capabilities: input.capabilities
        });
        return row ? role(row) : null;
    }
    async archive(args) {
        const result = await mutation('archiveRoleByServer', {
            roleId: args.id
        });
        return result?.archived === true;
    }
}
class ConvexAuthorizationGroupRepository {
    async create(input) {
        return group(await requiredMutation('createGroupByServer', {
            groupId: input.id,
            name: input.name,
            description: input.description,
            source: input.source ?? 'local',
            externalId: input.externalId,
            createdBy: input.createdBy
        }));
    }
    async get(id) {
        const row = await query('getGroupByServer', {
            groupId: id
        });
        return row ? group(row) : null;
    }
    async list(args = {}) {
        const rows = await query('listGroupsByServer', {
            includeArchived: args.includeArchived ?? false
        }) ?? [];
        return rows.map(group);
    }
    async update(input) {
        const row = await mutation('updateGroupByServer', {
            groupId: input.id,
            name: input.name,
            description: input.description
        });
        return row ? group(row) : null;
    }
    async archive(args) {
        const result = await mutation('archiveGroupByServer', {
            groupId: args.id
        });
        return result?.archived === true;
    }
    async addMember(args) {
        return clean(await requiredMutation('addGroupMemberByServer', {
            ...args,
            source: args.source ?? 'local'
        }));
    }
    async removeMember(args) {
        const result = await mutation('removeGroupMemberByServer', args);
        return result?.removed === true;
    }
    async listMembers(groupId) {
        const rows = await query('listGroupMembersByServer', {
            groupId
        }) ?? [];
        return rows.map(clean);
    }
    async listForUser(userId) {
        const rows = await query('listGroupsForUserByServer', {
            userId
        }) ?? [];
        return rows.map(group);
    }
}
class ConvexAuthorizationRoleAssignmentRepository {
    async assignUser(args) {
        return clean(await requiredMutation('assignUserRoleByServer', args));
    }
    async revokeUser(args) {
        const result = await mutation('revokeUserRoleByServer', args);
        return result?.removed === true;
    }
    async listForUser(userId) {
        const rows = await query('listUserRolesByServer', {
            userId
        }) ?? [];
        return rows.map(clean);
    }
    async listUsersForRole(roleId) {
        const rows = await query('listUsersForRoleByServer', {
            roleId
        }) ?? [];
        return rows.map(clean);
    }
    async assignGroup(args) {
        return clean(await requiredMutation('assignGroupRoleByServer', args));
    }
    async revokeGroup(args) {
        const result = await mutation('revokeGroupRoleByServer', args);
        return result?.removed === true;
    }
    async listForGroups(groupIds) {
        const rows = await query('listGroupRolesByServer', {
            groupIds
        }) ?? [];
        return rows.map(clean);
    }
    async listGroupsForRole(roleId) {
        const rows = await query('listGroupsForRoleByServer', {
            roleId
        }) ?? [];
        return rows.map(clean);
    }
}
class ConvexAuthorizationResourceGrantRepository {
    async upsert(input) {
        return grant(await requiredMutation('upsertResourceGrantByServer', {
            grantId: input.id,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            principalType: input.principalType,
            principalId: input.principalId,
            accessRole: input.accessRole,
            grantedBy: input.grantedBy
        }));
    }
    async remove(id) {
        const result = await mutation('removeResourceGrantByServer', {
            grantId: id
        });
        return result?.removed === true;
    }
    async listForResource(args) {
        const rows = await query('listResourceGrantsByServer', args) ?? [];
        return rows.map(grant);
    }
    async listForPrincipals(args) {
        const rows = await query('listPrincipalGrantsByServer', args) ?? [];
        return rows.map(grant);
    }
}
class ConvexAuthorizationResourceOwnerRepository {
    async getOwner(args) {
        const result = await query('getResourceOwnerByServer', args);
        return result?.userId ?? null;
    }
}
function createConvexAuthorizationRepositories() {
    return {
        roles: new ConvexAuthorizationRoleRepository(),
        groups: new ConvexAuthorizationGroupRepository(),
        assignments: new ConvexAuthorizationRoleAssignmentRepository(),
        resourceGrants: new ConvexAuthorizationResourceGrantRepository(),
        resourceOwners: new ConvexAuthorizationResourceOwnerRepository()
    };
}
function query(operation, args) {
    return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].query(`admin/authorization:${operation}`, {
        ...args
    }, {
        throwOnError: true
    });
}
function mutation(operation, args) {
    return __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexClient"].mutation(`admin/authorization:${operation}`, {
        ...args
    }, {
        throwOnError: true
    });
}
async function requiredMutation(operation, args) {
    const result = await mutation(operation, args);
    if (!result) throw new Error(`Convex authorization operation ${operation} returned no result`);
    return result;
}
function role(row) {
    const { roleId, ...value } = clean(row);
    return {
        ...value,
        id: roleId ?? row.id
    };
}
function group(row) {
    const { groupId, ...value } = clean(row);
    return {
        ...value,
        id: groupId ?? row.id
    };
}
function grant(row) {
    const { grantId, ...value } = clean(row);
    return {
        ...value,
        id: grantId ?? row.id
    };
}
function clean(row) {
    const { _id: _, _creationTime: __, ...value } = row;
    return value;
}
}),
"[project]/apps/admin/src/server/authorization/FixedRoleAuthorizationBridge.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "FIXED_AUTHORIZATION_ROLE_DEFINITIONS",
    ()=>FIXED_AUTHORIZATION_ROLE_DEFINITIONS,
    "FIXED_AUTHORIZATION_ROLE_IDS",
    ()=>FIXED_AUTHORIZATION_ROLE_IDS,
    "FixedRoleAuthorizationBridge",
    ()=>FixedRoleAuthorizationBridge,
    "MEMBER_AUTHORIZATION_CAPABILITIES",
    ()=>MEMBER_AUTHORIZATION_CAPABILITIES,
    "MEMBER_AUTHORIZATION_ROLE_ID",
    ()=>MEMBER_AUTHORIZATION_ROLE_ID
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$capabilities$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/overlay-authz-contracts/src/capabilities.ts [app-rsc] (ecmascript)");
;
;
const FIXED_AUTHORIZATION_ROLE_IDS = {
    admin: 'system:administrator',
    auditor: 'system:auditor',
    billing_admin: 'system:billing-administrator',
    support: 'system:support'
};
const MEMBER_AUTHORIZATION_ROLE_ID = 'system:member';
const MEMBER_AUTHORIZATION_CAPABILITIES = [
    'conversations.create',
    'conversations.read',
    'conversations.edit',
    'conversations.share',
    'conversations.delete',
    'files.upload',
    'files.read',
    'files.edit',
    'files.share',
    'files.delete',
    'notes.create',
    'notes.read',
    'notes.edit',
    'notes.delete',
    'work.use',
    'outputs.read',
    'outputs.delete',
    'models.use',
    'tools.use',
    'integrations.use',
    'skills.use',
    'mcp.use',
    'web_search.use',
    'memory.use',
    'automations.use',
    'api_keys.manage',
    'webhooks.manage'
];
const FIXED_AUTHORIZATION_ROLE_DEFINITIONS = {
    admin: {
        name: '[System] Administrator',
        description: 'Built-in compatibility role with every authorization capability.',
        capabilities: [
            ...__TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$overlay$2d$authz$2d$contracts$2f$src$2f$capabilities$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AUTHORIZATION_CAPABILITIES"]
        ]
    },
    auditor: {
        name: '[System] Auditor',
        description: 'Built-in compatibility role for read-only governance and audit access.',
        capabilities: [
            'administration.access',
            'users.read',
            'groups.read',
            'roles.read',
            'audit.read'
        ]
    },
    billing_admin: {
        name: '[System] Billing administrator',
        description: 'Built-in compatibility role for usage and budget administration.',
        capabilities: [
            'administration.access',
            'users.read',
            'usage.read',
            'usage.manage'
        ]
    },
    support: {
        name: '[System] Support',
        description: 'Built-in compatibility role for support controls.',
        capabilities: [
            'administration.access',
            'users.read',
            'support.access'
        ]
    }
};
class FixedRoleAuthorizationBridge {
    repositories;
    systemRolesReady;
    constructor(repositories){
        this.repositories = repositories;
    }
    async ensureSystemRoles() {
        this.systemRolesReady ??= this.initializeSystemRoles().catch((error)=>{
            this.systemRolesReady = undefined;
            throw error;
        });
        await this.systemRolesReady;
    }
    async initializeSystemRoles() {
        await this.ensureMemberRole();
        await Promise.all(Object.keys(FIXED_AUTHORIZATION_ROLE_IDS).map((role)=>this.ensureSystemRole(role)));
    }
    async ensureDefaultUserRole(userId, assignedBy) {
        await this.ensureSystemRoles();
        const existingAssignments = await this.repositories.assignments.listForUser(userId);
        const compatibilityRoleIds = new Set(Object.values(FIXED_AUTHORIZATION_ROLE_IDS));
        if (existingAssignments.some(({ roleId })=>!compatibilityRoleIds.has(roleId))) return;
        await this.repositories.assignments.assignUser({
            userId,
            roleId: MEMBER_AUTHORIZATION_ROLE_ID,
            assignedBy
        });
    }
    async syncPrincipal(principal) {
        await this.ensureSystemRoles();
        await this.ensureDefaultUserRole(principal.userId, principal.grantedBy);
        await this.revokeCompatibilityAssignments(principal.userId);
        if (principal.revokedAt) return;
        await this.repositories.assignments.assignUser({
            userId: principal.userId,
            roleId: FIXED_AUTHORIZATION_ROLE_IDS[principal.role],
            assignedBy: principal.grantedBy
        });
    }
    async revokePrincipal(userId) {
        await this.revokeCompatibilityAssignments(userId);
    }
    async migrate(principals) {
        await this.ensureSystemRoles();
        await Promise.all(principals.map((principal)=>this.syncPrincipal(principal)));
        const revoked = principals.filter((principal)=>principal.revokedAt).length;
        return {
            active: principals.length - revoked,
            revoked,
            total: principals.length
        };
    }
    async migrateUsers(userIds) {
        await this.ensureSystemRoles();
        const uniqueUserIds = [
            ...new Set(userIds.filter(Boolean))
        ];
        await Promise.all(uniqueUserIds.map((userId)=>this.ensureDefaultUserRole(userId)));
        return uniqueUserIds.length;
    }
    async ensureMemberRole() {
        const definition = {
            name: '[System] Default member',
            description: 'Built-in baseline role for authenticated Overlay product access.',
            capabilities: MEMBER_AUTHORIZATION_CAPABILITIES
        };
        let existing = await this.repositories.roles.get(MEMBER_AUTHORIZATION_ROLE_ID);
        if (!existing) {
            try {
                await this.repositories.roles.create({
                    id: MEMBER_AUTHORIZATION_ROLE_ID,
                    ...definition,
                    isSystem: true
                });
                return;
            } catch (error) {
                existing = await this.repositories.roles.get(MEMBER_AUTHORIZATION_ROLE_ID);
                if (!existing) throw error;
            }
        }
        if (!existing.isSystem) {
            throw new Error(`Reserved authorization role ID ${MEMBER_AUTHORIZATION_ROLE_ID} is not a system role`);
        }
        if (existing.name === definition.name && existing.description === definition.description && sameCapabilities(existing.capabilities, definition.capabilities)) {
            return;
        }
        await this.repositories.roles.update({
            id: MEMBER_AUTHORIZATION_ROLE_ID,
            ...definition
        });
    }
    async ensureSystemRole(role) {
        const id = FIXED_AUTHORIZATION_ROLE_IDS[role];
        const definition = FIXED_AUTHORIZATION_ROLE_DEFINITIONS[role];
        let existing = await this.repositories.roles.get(id);
        if (!existing) {
            try {
                await this.repositories.roles.create({
                    id,
                    ...definition,
                    isSystem: true
                });
                return;
            } catch (error) {
                existing = await this.repositories.roles.get(id);
                if (!existing) throw error;
            }
        }
        if (!existing?.isSystem) {
            throw new Error(`Reserved authorization role ID ${id} is not a system role`);
        }
        if (existing.name === definition.name && existing.description === definition.description && sameCapabilities(existing.capabilities, definition.capabilities)) {
            return;
        }
        await this.repositories.roles.update({
            id,
            name: definition.name,
            description: definition.description,
            capabilities: definition.capabilities
        });
    }
    async revokeCompatibilityAssignments(userId) {
        await Promise.all(Object.values(FIXED_AUTHORIZATION_ROLE_IDS).map((roleId)=>this.repositories.assignments.revokeUser({
                userId,
                roleId
            })));
    }
}
function sameCapabilities(left, right) {
    const rightSet = new Set(right);
    return left.length === right.length && left.every((capability)=>rightSet.has(capability));
}
}),
"[project]/apps/admin/src/server/context.ts [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "getAdminServerContext",
    ()=>getAdminServerContext
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$AdministrativeService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/admin/AdministrativeService.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$AuditService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/admin/AuditService.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$ConvexAdministrativeRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/admin/ConvexAdministrativeRepository.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$ConvexAuditRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/admin/ConvexAuditRepository.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$AuthorizationAdministrationService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/authorization/AuthorizationAdministrationService.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$AuthorizationService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/authorization/AuthorizationService.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$ConvexAuthorizationRepositories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/authorization/ConvexAuthorizationRepositories.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$FixedRoleAuthorizationBridge$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/authorization/FixedRoleAuthorizationBridge.ts [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
;
let cached = null;
function buildContext() {
    const auditService = new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$AuditService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AuditService"](new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$ConvexAuditRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ConvexAuditRepository"]());
    const administrativeService = new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$AdministrativeService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AdministrativeService"]({
        audit: auditService,
        repository: new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$admin$2f$ConvexAdministrativeRepository$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["ConvexAdministrativeRepository"]()
    });
    const repositories = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$ConvexAuthorizationRepositories$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["createConvexAuthorizationRepositories"])();
    const bridge = new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$FixedRoleAuthorizationBridge$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["FixedRoleAuthorizationBridge"](repositories);
    const authorizationService = new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$AuthorizationService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AuthorizationService"]({
        isDeploymentOwner: ()=>false,
        repositories
    });
    // Web bootstrap passes AuthorizationDeniedError through; the routes' error
    // mapper turns it into a 403. Do the same translation here.
    const assertCapability = async (userId, capability)=>{
        await authorizationService.assertCapability({
            capability,
            userId
        });
    };
    const authorizationAdministrationService = new __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$authorization$2f$AuthorizationAdministrationService$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["AuthorizationAdministrationService"]({
        assertCapability,
        audit: auditService,
        prepareAuthorization: ()=>bridge.ensureSystemRoles(),
        repositories
    });
    return {
        administrativeService,
        auditService,
        authorizationAdministrationService,
        authorizationService
    };
}
function getAdminServerContext() {
    return cached ??= buildContext();
}
;
}),
"[project]/apps/admin/src/server/convex-admin.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "ConvexAdminError",
    ()=>ConvexAdminError,
    "adminConvexClient",
    ()=>adminConvexClient,
    "adminConvexMutation",
    ()=>adminConvexMutation,
    "adminConvexQuery",
    ()=>adminConvexQuery
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-rsc] (ecmascript)");
;
;
class ConvexAdminError extends Error {
    status;
    constructor(message, status){
        super(message), this.status = status;
        this.name = 'ConvexAdminError';
    }
}
/**
 * The ONLY module in this app that talks to Convex. Every call injects
 * `serverSecret` from `ADMIN_CONVEX_SECRET`; callers never handle the secret.
 * Stage 2 swaps the function paths/secret name behind this file's API.
 */ async function post(type, path, args) {
    const sanitized = {
        ...args
    };
    delete sanitized.serverSecret;
    const response = await fetch(`${(0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["convexHttpUrl"])()}/api/${type}`, {
        body: JSON.stringify({
            args: {
                ...sanitized,
                serverSecret: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexSecret"])()
            },
            format: 'json',
            path
        }),
        cache: 'no-store',
        headers: {
            'Content-Type': 'application/json'
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
"[project]/apps/admin/src/server/env.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "adminConvexSecret",
    ()=>adminConvexSecret,
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
function adminConvexSecret() {
    const secret = (process.env.ADMIN_CONVEX_SECRET ?? '').trim();
    if (!secret) {
        throw new Error('ADMIN_CONVEX_SECRET is not configured');
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
"[project]/apps/admin/src/server/operator.ts [app-rsc] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resolveOperator",
    ()=>resolveOperator
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/convex-admin.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/session.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$workos$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/workos.ts [app-rsc] (ecmascript)");
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
    return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$convex$2d$admin$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminConvexQuery"])('admin/administration:getPrincipalByServer', {
        userId
    });
}
async function resolveOperator(cookieValue, deps = {}) {
    const getPrincipal = deps.getPrincipal ?? loadPrincipal;
    const session = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["openSession"])(cookieValue);
    if (!session) {
        return {
            kind: 'anonymous',
            reason: cookieValue ? 'invalid' : 'missing'
        };
    }
    const status = (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$session$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["sessionStatus"])(session);
    if (status !== 'active') {
        return {
            kind: 'anonymous',
            reason: status
        };
    }
    let sessionMutated = false;
    if (session.refreshToken && accessTokenExpiring(session.accessToken)) {
        try {
            const refreshed = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$workos$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["refreshSession"])(session.refreshToken);
            session.accessToken = refreshed.accessToken;
            session.refreshToken = refreshed.refreshToken ?? session.refreshToken;
            sessionMutated = true;
        } catch  {
        // The access token is only needed to forward identity to Convex in a
        // later stage; a refresh failure does not invalidate the session.
        }
    }
    if (!(0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["allowedUserIds"])().has(session.user.id)) {
        return {
            kind: 'denied',
            reason: 'not_allowlisted'
        };
    }
    const principal = await getPrincipal(session.user.id).catch(()=>null);
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
"[project]/apps/admin/src/server/session.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
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
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-rsc] (ecmascript)");
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
    return (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$crypto__$5b$external$5d$__$28$node$3a$crypto$2c$__cjs$29$__["createHash"])('sha256').update((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["adminSessionSecret"])()).digest();
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
"[project]/apps/admin/src/server/workos.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "adminAuthorizationUrl",
    ()=>adminAuthorizationUrl,
    "authenticateWithCode",
    ()=>authenticateWithCode,
    "refreshSession",
    ()=>refreshSession
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$workos$2d$inc$2f$node$2f$lib$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/node_modules/@workos-inc/node/lib/index.mjs [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/admin/src/server/env.ts [app-rsc] (ecmascript)");
;
;
;
let cached = null;
function client() {
    return cached ??= new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f40$workos$2d$inc$2f$node$2f$lib$2f$index$2e$mjs__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__["WorkOS"]((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["workosApiKey"])());
}
function adminAuthorizationUrl(args) {
    return client().userManagement.getAuthorizationUrl({
        clientId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["workosClientId"])(),
        provider: 'authkit',
        redirectUri: `${args.origin}/auth/callback`,
        state: args.state
    });
}
async function authenticateWithCode(code) {
    return client().userManagement.authenticateWithCode({
        clientId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["workosClientId"])(),
        code
    });
}
async function refreshSession(refreshToken) {
    return client().userManagement.authenticateWithRefreshToken({
        clientId: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$admin$2f$src$2f$server$2f$env$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["workosClientId"])(),
        refreshToken
    });
}
}),
"[project]/packages/overlay-authz-contracts/src/capabilities.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AUTHORIZATION_CAPABILITIES",
    ()=>AUTHORIZATION_CAPABILITIES,
    "AUTHORIZATION_CAPABILITY_DEFINITIONS",
    ()=>AUTHORIZATION_CAPABILITY_DEFINITIONS,
    "getAuthorizationCapabilityDefinition",
    ()=>getAuthorizationCapabilityDefinition,
    "isAuthorizationCapability",
    ()=>isAuthorizationCapability
]);
const AUTHORIZATION_CAPABILITY_DEFINITIONS = [
    {
        key: 'administration.access',
        category: 'administration',
        label: 'Access administration'
    },
    {
        key: 'users.read',
        category: 'identity',
        label: 'View users'
    },
    {
        key: 'users.manage',
        category: 'identity',
        label: 'Manage users'
    },
    {
        key: 'groups.read',
        category: 'identity',
        label: 'View groups'
    },
    {
        key: 'groups.manage',
        category: 'identity',
        label: 'Manage groups'
    },
    {
        key: 'roles.read',
        category: 'identity',
        label: 'View roles'
    },
    {
        key: 'roles.manage',
        category: 'identity',
        label: 'Manage roles'
    },
    {
        key: 'audit.read',
        category: 'governance',
        label: 'View audit events'
    },
    {
        key: 'usage.read',
        category: 'governance',
        label: 'View usage and budgets'
    },
    {
        key: 'usage.manage',
        category: 'governance',
        label: 'Manage usage and budgets'
    },
    {
        key: 'support.access',
        category: 'governance',
        label: 'Access support controls'
    },
    {
        key: 'conversations.create',
        category: 'content',
        label: 'Create conversations'
    },
    {
        key: 'conversations.read',
        category: 'content',
        label: 'View conversations'
    },
    {
        key: 'conversations.edit',
        category: 'content',
        label: 'Edit conversations'
    },
    {
        key: 'conversations.share',
        category: 'content',
        label: 'Share conversations'
    },
    {
        key: 'conversations.delete',
        category: 'content',
        label: 'Delete conversations'
    },
    {
        key: 'files.upload',
        category: 'content',
        label: 'Upload files'
    },
    {
        key: 'files.read',
        category: 'content',
        label: 'View files'
    },
    {
        key: 'files.edit',
        category: 'content',
        label: 'Edit files'
    },
    {
        key: 'files.share',
        category: 'content',
        label: 'Share files'
    },
    {
        key: 'files.delete',
        category: 'content',
        label: 'Delete files'
    },
    {
        key: 'notes.create',
        category: 'content',
        label: 'Create notes'
    },
    {
        key: 'notes.read',
        category: 'content',
        label: 'View notes'
    },
    {
        key: 'notes.edit',
        category: 'content',
        label: 'Edit notes'
    },
    {
        key: 'notes.delete',
        category: 'content',
        label: 'Delete notes'
    },
    {
        key: 'work.use',
        category: 'content',
        label: 'Use work (tasks, board, timeline)'
    },
    {
        key: 'outputs.read',
        category: 'content',
        label: 'View generated outputs'
    },
    {
        key: 'outputs.delete',
        category: 'content',
        label: 'Delete generated outputs'
    },
    {
        key: 'models.use',
        category: 'ai',
        label: 'Use models'
    },
    {
        key: 'tools.use',
        category: 'ai',
        label: 'Use tools'
    },
    {
        key: 'integrations.use',
        category: 'ai',
        label: 'Use integrations'
    },
    {
        key: 'skills.use',
        category: 'ai',
        label: 'Use skills'
    },
    {
        key: 'mcp.use',
        category: 'ai',
        label: 'Use MCP servers'
    },
    {
        key: 'web_search.use',
        category: 'ai',
        label: 'Use web search'
    },
    {
        key: 'memory.use',
        category: 'ai',
        label: 'Use memory'
    },
    {
        key: 'automations.use',
        category: 'ai',
        label: 'Use automations'
    },
    {
        key: 'api_keys.manage',
        category: 'governance',
        label: 'Manage API keys'
    },
    {
        key: 'webhooks.manage',
        category: 'governance',
        label: 'Manage webhooks'
    }
];
const CAPABILITY_SET = new Set(AUTHORIZATION_CAPABILITY_DEFINITIONS.map(({ key })=>key));
const AUTHORIZATION_CAPABILITIES = AUTHORIZATION_CAPABILITY_DEFINITIONS.map(({ key })=>key);
function isAuthorizationCapability(value) {
    return typeof value === 'string' && CAPABILITY_SET.has(value);
}
function getAuthorizationCapabilityDefinition(capability) {
    return AUTHORIZATION_CAPABILITY_DEFINITIONS.find(({ key })=>key === capability);
}
}),
"[project]/packages/overlay-authz-contracts/src/types.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AUTHORIZATION_PRINCIPAL_TYPES",
    ()=>AUTHORIZATION_PRINCIPAL_TYPES,
    "RESOURCE_ACCESS_ROLES",
    ()=>RESOURCE_ACCESS_ROLES,
    "RESOURCE_ACTIONS",
    ()=>RESOURCE_ACTIONS,
    "accessRoleAllows",
    ()=>accessRoleAllows,
    "isAuthorizationPrincipalType",
    ()=>isAuthorizationPrincipalType,
    "isResourceAccessRole",
    ()=>isResourceAccessRole,
    "strongestAccessRole",
    ()=>strongestAccessRole
]);
const AUTHORIZATION_PRINCIPAL_TYPES = [
    'user',
    'group',
    'role'
];
const RESOURCE_ACCESS_ROLES = [
    'viewer',
    'editor',
    'owner'
];
const RESOURCE_ACTIONS = [
    'view',
    'execute',
    'edit',
    'delete',
    'share'
];
const ACCESS_ROLE_RANK = {
    viewer: 1,
    editor: 2,
    owner: 3
};
const ACTION_MINIMUM_ROLE = {
    view: 'viewer',
    execute: 'editor',
    edit: 'editor',
    delete: 'owner',
    share: 'owner'
};
function isAuthorizationPrincipalType(value) {
    return typeof value === 'string' && AUTHORIZATION_PRINCIPAL_TYPES.includes(value);
}
function isResourceAccessRole(value) {
    return typeof value === 'string' && RESOURCE_ACCESS_ROLES.includes(value);
}
function accessRoleAllows(role, action) {
    return ACCESS_ROLE_RANK[role] >= ACCESS_ROLE_RANK[ACTION_MINIMUM_ROLE[action]];
}
function strongestAccessRole(roles) {
    return roles.reduce((strongest, role)=>!strongest || ACCESS_ROLE_RANK[role] > ACCESS_ROLE_RANK[strongest] ? role : strongest, undefined);
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__00iue5q._.js.map