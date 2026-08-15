import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Exported as `proxy`, not as a default.
 *
 * Next 16 renamed the `middleware` convention to `proxy`, and its runtime reads
 * the two exports differently: the default export is treated as the *adapter*
 * that the build injects, while the request handler is looked up as the named
 * `proxy` (or legacy `middleware`) export -
 *
 *   const adapterFn = middlewareModule.default || middlewareModule;
 *   adapterFn({ handler: middlewareModule.proxy || middlewareModule.middleware ... })
 *
 * A lone default export therefore gets called with the adapter's argument shape
 * instead of a request, which surfaces as `TypeError: adapterFn is not a
 * function` and a 404 on every route.
 */
export const proxy = clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
