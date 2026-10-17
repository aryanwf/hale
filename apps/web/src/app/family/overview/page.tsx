import { Suspense } from "react";
import { Overview } from "@/components/overview";

export default function OverviewPage() {
  return <Suspense fallback={<div className="archive-loading" role="status">Opening the archive…</div>}><div className="overview-page"><Overview /></div></Suspense>;
}
