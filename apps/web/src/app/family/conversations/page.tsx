import { Suspense } from "react";
import { ConversationsView } from "@/components/conversations";
export default function ConversationsPage() { return <Suspense fallback={<p className="loading-text">Opening conversations…</p>}><ConversationsView /></Suspense>; }
