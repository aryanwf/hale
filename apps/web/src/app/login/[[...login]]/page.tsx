import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ redirect_url?: string | string[] }> }) {
  const { redirect_url } = await searchParams;
  return <AuthPage redirectUrl={typeof redirect_url === "string" ? redirect_url : undefined} />;
}
