import { redirect } from "next/navigation";

// /report moved to /TBL/prospects (2026-08-25, Rees's URL scheme). This
// page stays only as a permanent redirect so any link already shared or
// bookmarked at the old URL keeps working, for guests and the owner alike
// (middleware.ts's own guest-redirect logic would already send an
// unauthenticated visitor to /TBL/prospects if this page didn't exist, but
// that path doesn't apply to an already-logged-in owner hitting a stale
// bookmark -- this covers both cases the same way).
export default function ReportRedirect() {
  redirect("/TBL/prospects");
}
