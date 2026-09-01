/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Fixes a real, site-wide bug (2026-09-02, Rees: seeing stale data on
    // multiple pages -- Weight Tuning, Top Players -- until a manual
    // refresh). Root cause: Next.js's client-side Router Cache holds onto a
    // dynamically-rendered page's RSC payload for 30s by default after a
    // client-side <Link> navigation, so navigating to a page you already
    // visited earlier in the session can silently show what the server
    // returned back THEN, not what it returns now -- exactly what "stale
    // until refresh" looks like on data that changes underneath the page
    // during a session (every admin/report page here, plus Top Players).
    // staleTimes.dynamic: 0 disables that cache for every dynamically-
    // rendered route site-wide, so a client-side navigation always
    // re-fetches fresh from the server -- the general fix, instead of
    // adding a router.refresh()-on-mount workaround to every page
    // individually (done once already, on Weight Tuning, before finding
    // this -- harmless left in place, just redundant now).
    staleTimes: { dynamic: 0 },
  },
};
export default nextConfig;
