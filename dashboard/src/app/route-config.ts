// Force all routes in this app to be dynamically rendered (no static prerendering).
// This is required because all pages use browser APIs (localStorage, cookies) via
// the auth context and cannot be statically rendered.
export const dynamic = 'force-dynamic';
