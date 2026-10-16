const NOTIFICATION_PERMISSION_API_LEVEL = 33;

interface RecordingPermissionRequests {
  apiLevel: number;
  requestMicrophone: () => Promise<{ granted: boolean }>;
  requestNotifications: () => Promise<{ granted: boolean }>;
}

export async function requestAndroidRecordingPermissions(requests: RecordingPermissionRequests): Promise<void> {
  const microphone = await requests.requestMicrophone();
  if (!microphone.granted) {
    throw new Error("Microphone access is off. Enable it in Hale’s Android app settings, then try again.");
  }
  if (requests.apiLevel < NOTIFICATION_PERMISSION_API_LEVEL) return;

  const notifications = await requests.requestNotifications();
  if (!notifications.granted) {
    throw new Error("Notifications are off. Enable notifications in Hale’s Android app settings so background recording can show its recording controls, then try again.");
  }
}
