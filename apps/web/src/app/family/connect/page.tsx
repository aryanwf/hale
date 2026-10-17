"use client";

import { FamilyConnection } from "@/components/family-connection";
import { useWorkspace } from "@/components/providers";
import { EmptyState } from "@/components/ui";

export default function ConnectPage() {
  const { mode } = useWorkspace();
  return mode === "live" ? <FamilyConnection /> : <EmptyState title="A connection, not a pretend code." description="In live mode, your private family code appears here. The patient enters it in the Android app to share their memories with you." />;
}
