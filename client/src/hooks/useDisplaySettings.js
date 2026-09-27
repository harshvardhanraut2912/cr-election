import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config.js";

// Public, real-time display controls used by the TV screen and the student
// ballot (flexibleVoting: whether boys-only/girls-only votes are allowed).
export function useDisplaySettings() {
  const [showQr, setShowQr] = useState(false);
  const [flexibleVoting, setFlexibleVoting] = useState(false);

  useEffect(() => {
    const ref = doc(db, "settings", "display");
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setShowQr(Boolean(snap.exists() && snap.data()?.showQr));
        setFlexibleVoting(Boolean(snap.exists() && snap.data()?.flexibleVoting));
      },
      () => {
        setShowQr(false);
        setFlexibleVoting(false);
      }
    );
    return unsubscribe;
  }, []);

  return { showQr, flexibleVoting };
}
