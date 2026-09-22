import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config.js";

// Public, real-time display controls used by the TV screen.
export function useDisplaySettings() {
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    const ref = doc(db, "settings", "display");
    const unsubscribe = onSnapshot(
      ref,
      (snap) => setShowQr(Boolean(snap.exists() && snap.data()?.showQr)),
      () => setShowQr(false)
    );
    return unsubscribe;
  }, []);

  return { showQr };
}
