import { redirect } from "next/navigation";
import { appMode } from "@/lib/app-mode";

export default function Home() {
  redirect(appMode === "demo" ? "/family/overview" : "/login");
}
