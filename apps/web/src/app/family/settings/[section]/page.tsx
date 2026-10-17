import { notFound } from "next/navigation";
import { SettingsDetailView } from "@/components/settings-detail";
import { isSettingsTopic } from "@/components/settings-topics";

export default async function SettingsTopicPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isSettingsTopic(section)) notFound();
  return <SettingsDetailView section={section} />;
}
