import { redirect } from "next/navigation";

/**
 * Root entry point. The product lives under the (dashboard) route group; the
 * bare "/" path performs a hard redirect to the dashboard so deep links and
 * bookmarks resolve to a stable, canonical URL.
 */
export default function RootPage() {
  redirect("/dashboard");
}
