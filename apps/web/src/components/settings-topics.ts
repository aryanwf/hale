export const settingsTopics = ["family-access", "patient-phone", "shared-data"] as const;
export type SettingsTopic = (typeof settingsTopics)[number];

export function isSettingsTopic(section: string): section is SettingsTopic {
  return settingsTopics.includes(section as SettingsTopic);
}
