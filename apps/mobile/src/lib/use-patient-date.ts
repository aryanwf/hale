import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { localDate } from "@hale/contracts/time";

export function usePatientDate(timezone: string): string {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const interval = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    return () => { clearInterval(interval); subscription.remove(); };
  }, []);
  return localDate(now, timezone);
}
