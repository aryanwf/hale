self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  if (!payload || typeof payload !== "object") payload = {};

  const urgent = payload.priority === "urgent";
  const title = urgent ? "Hale care alert" : "Hale appointment reminder";
  const options = {
    body: urgent
      ? "A possible urgent phrase needs review in Hale."
      : "A confirmed-in-Hale appointment reminder is ready.",
    tag: typeof payload.tag === "string" ? payload.tag : "hale-care-update",
    data: { path: "/family/care" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/family/care", self.location.origin).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(`${self.location.origin}/family/`)) {
        try {
          const navigated = await client.navigate(target);
          if (navigated) return navigated.focus();
        } catch {
          // If the existing dashboard cannot be navigated, open a new one below.
        }
      }
    }
    return self.clients.openWindow(target);
  })());
});
