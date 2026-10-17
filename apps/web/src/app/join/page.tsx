import type { Metadata } from "next";
import { InviteAcceptance } from "@/components/invite-acceptance";

export const metadata: Metadata = { title: "Accept a family invitation" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <InviteAcceptance token={typeof token === "string" ? token : ""} />;
}
