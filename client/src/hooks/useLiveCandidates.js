import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config.js";

// Live (real-time) elector + vote count listener, used by the TV leaderboard.
// Reads directly from Firestore (public read-only rules) — no polling needed.
export function useLiveCandidates() {
  const [boys, setBoys] = useState([]);
  const [girls, setGirls] = useState([]);

  useEffect(() => {
    const boysQuery = query(collection(db, "candidates_boys"), orderBy("order", "asc"));
    const girlsQuery = query(collection(db, "candidates_girls"), orderBy("order", "asc"));

    const unsubBoys = onSnapshot(boysQuery, (snap) => {
      setBoys(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubGirls = onSnapshot(girlsQuery, (snap) => {
      setGirls(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubBoys();
      unsubGirls();
    };
  }, []);

  return { boys, girls };
}
