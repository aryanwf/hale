import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-form";

export const metadata: Metadata = { title: "Join your circle" };
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string | string[] }> }) {
  const { redirect_url } = await searchParams;
  return <AuthPage signup redirectUrl={typeof redirect_url === "string" ? redirect_url : undefined} />;
}
