(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push(["chunks/_1spylcq._.js",
"[project]/apps/admin/src/instrumentation.ts [instrumentation-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "register",
    ()=>register
]);
function register() {}
}),
"[project]/node_modules/next/dist/esm/build/templates/edge-wrapper.js { MODULE => \"[project]/apps/admin/src/instrumentation.ts [instrumentation-edge] (ecmascript)\" } [instrumentation-edge] (ecmascript)", ((__turbopack_context__, module, exports) => {

// The wrapped module could be an async module, we handle that with the proxy
// here. The comma expression makes sure we don't call the function with the
// module as the "this" arg.
// Turn exports into functions that are also a thenable. This way you can await the whole object
// or  exports (e.g. for Components) or call them directly as though they are async functions
// (e.g. edge functions/middleware, this is what the Edge Runtime does).
// Catch promise to prevent UnhandledPromiseRejectionWarning, this will be propagated through
// the awaited export(s) anyway.
self._ENTRIES ||= {};
const modProm = Promise.resolve().then(()=>__turbopack_context__.i("[project]/apps/admin/src/instrumentation.ts [instrumentation-edge] (ecmascript)"));
modProm.catch(()=>{});
self._ENTRIES["middleware_instrumentation"] = new Proxy(modProm, {
    get (innerModProm, name) {
        if (name === 'then') {
            return (res, rej)=>innerModProm.then(res, rej);
        }
        let result = (...args)=>innerModProm.then((mod)=>(0, mod[name])(...args));
        result.then = (res, rej)=>innerModProm.then((mod)=>mod[name]).then(res, rej);
        return result;
    }
});
}),
]);

//# sourceMappingURL=_1spylcq._.js.map