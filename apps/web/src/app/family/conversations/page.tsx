import { Suspense } from "react";
import { ConversationsMockupView } from "@/components/conversations-mockup";
export default function ConversationsPage() { return <Suspense fallback={<p className="loading-text">Opening conversations…</p>}><ConversationsMockupView /></Suspense>; }
