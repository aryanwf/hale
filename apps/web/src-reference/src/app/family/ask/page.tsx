import { Suspense } from "react";
import { AskMockupView } from "@/components/ask-mockup";
export default function AskPage() { return <Suspense fallback={<p className="loading-text">Opening Ask Hale…</p>}><AskMockupView /></Suspense>; }
