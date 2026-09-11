import { redirect } from "next/navigation";

// /prospects retired (2026-09-10, Step 3 of the multi-league migration) --
// this was already an orphaned page: SiteNav's own "Top Prospects" nav item
// pointed at the guest-facing /TBL/prospects, not here, since 2026-08-27
// ("match the guest view for now"), so nothing actually linked to this URL
// anymore. Once /TBL/prospects became /[league]/prospects (one shared
// route for both leagues), keeping this separate, subtly-different variant
// alive (showRankings=true, no owner-preview check) would have meant either
// a second near-duplicate page or a real naming collision with the new
// /TBL/prospects. Redirecting old links/bookmarks here, same pattern
// already used for /report -> /TBL/prospects.
export default function ProspectsRedirect() {
  redirect("/TBL/prospects");
}
