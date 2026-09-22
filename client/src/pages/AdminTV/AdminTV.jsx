import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveCandidates } from "../../hooks/useLiveCandidates.js";
import { useDisplaySettings } from "../../hooks/useDisplaySettings.js";

const AVATAR_TONES = ["blue", "violet", "cyan", "rose", "amber", "emerald", "indigo", "pink"];

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CR";
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(value || 0);
  const previous = useRef(value || 0);

  useLayoutEffect(() => {
    const from = previous.current;
    const to = value || 0;
    previous.current = to;
    if (from === to) return;

    const duration = 520;
    const start = performance.now();
    let frame;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{display}</>;
}

function Leaderboard({ title, eyebrow, rows, accent }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (b.votes || 0) - (a.votes || 0) || (a.order ?? 0) - (b.order ?? 0)),
    [rows]
  );
  const refs = useRef(new Map());
  const previousRects = useRef(new Map());
  const previousVotes = useRef(new Map());

  useLayoutEffect(() => {
    const nextRects = new Map();
    sorted.forEach((candidate) => {
      const node = refs.current.get(candidate.id);
      if (!node) return;
      const rect = node.getBoundingClientRect();
      nextRects.set(candidate.id, rect);
      const old = previousRects.current.get(candidate.id);
      if (old && Math.abs(old.top - rect.top) > 1) {
        const delta = old.top - rect.top;
        node.style.transition = "none";
        node.style.transform = `translateY(${delta}px)`;
        node.style.zIndex = "3";
        requestAnimationFrame(() => {
          node.style.transition = "transform 720ms cubic-bezier(.2,.82,.2,1), box-shadow 420ms ease, border-color 420ms ease";
          node.style.transform = "translateY(0)";
        });
        window.setTimeout(() => {
          if (refs.current.get(candidate.id) === node) node.style.zIndex = "";
        }, 760);
      }
    });
    previousRects.current = nextRects;
  }, [sorted]);

  const maxVotes = Math.max(1, ...sorted.map((candidate) => candidate.votes || 0));
  const totalVotes = sorted.reduce((sum, candidate) => sum + (candidate.votes || 0), 0);

  return (
    <section className={`tv-board tv-board-${accent}`}>
      <div className="tv-board-header">
        <div>
          <span className="tv-board-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <div className="tv-board-total">
          <strong><AnimatedNumber value={totalVotes} /></strong>
          <span>votes</span>
        </div>
      </div>

      <div className="tv-list">
        {sorted.map((candidate, index) => {
          const votes = candidate.votes || 0;
          const previousVote = previousVotes.current.get(candidate.id) ?? votes;
          const changed = votes !== previousVote;
          previousVotes.current.set(candidate.id, votes);
          const isLeader = index === 0 && votes > 0;
          const tone = AVATAR_TONES[(candidate.order ?? index) % AVATAR_TONES.length];

          return (
            <div
              className={`tv-row ${isLeader ? "is-leader" : ""} ${changed ? "vote-changed" : ""}`}
              key={candidate.id}
              ref={(node) => {
                if (node) refs.current.set(candidate.id, node);
                else refs.current.delete(candidate.id);
              }}
            >
              <div className="tv-rank">{index + 1}</div>
              <div className={`tv-avatar tv-avatar-${tone}`}>{initials(candidate.name)}</div>
              <div className="tv-candidate-main">
                <div className="tv-candidate-name-line">
                  <strong>{candidate.name}</strong>
                  {isLeader && <span className="leader-chip">LEADING</span>}
                </div>
                <div className="tv-progress-track">
                  <span style={{ width: `${votes ? Math.max(4, (votes / maxVotes) * 100) : 0}%` }} />
                </div>
              </div>
              <div className="tv-vote-count">
                <strong><AnimatedNumber value={votes} /></strong>
                <span>{votes === 1 ? "vote" : "votes"}</span>
              </div>
            </div>
          );
        })}
        {!sorted.length && <div className="tv-empty">No candidates added yet.</div>}
      </div>
    </section>
  );
}

export default function AdminTV() {
  const { boys, girls } = useLiveCandidates();
  const { showQr } = useDisplaySettings();
  const totalVotes = boys.reduce((sum, c) => sum + (c.votes || 0), 0) + girls.reduce((sum, c) => sum + (c.votes || 0), 0);

  return (
    <main className="tv-page">
      <div className="tv-orb tv-orb-one" />
      <div className="tv-orb tv-orb-two" />
      <div className="tv-grid-glow" />

      <header className="tv-header">
        <div className="tv-header-topline">
          <div className="tv-brand">
            <div className="tv-brand-mark">CR</div>
            <div>
              <strong>PICT College</strong>
              <span>Class Representative Elections</span>
            </div>
          </div>
          <div className="tv-live-pill"><i /> LIVE · REAL-TIME</div>
        </div>

        <div className="tv-title-wrap">
          <span className="tv-kicker">FIRST YEAR · FY-08</span>
          <h1>CR Election <span>Live Leaderboard</span></h1>
          <p>Every vote is reflected instantly. Watch the rankings move in real time.</p>
        </div>

        <div className="tv-stat-strip">
          <div><span>BOYS' CR</span><strong>{boys.length}</strong><small>candidates</small></div>
          <div><span>GIRLS' CR</span><strong>{girls.length}</strong><small>candidates</small></div>
          <div><span>TOTAL VOTES</span><strong><AnimatedNumber value={totalVotes} /></strong><small>submitted</small></div>
          <div className="tv-status"><i /> Firebase live sync</div>
        </div>
      </header>

      <div className="tv-boards">
        <Leaderboard title="Boys' CR" eyebrow="BOYS · REPRESENTATIVE" rows={boys} accent="blue" />
        <Leaderboard title="Girls' CR" eyebrow="GIRLS · REPRESENTATIVE" rows={girls} accent="violet" />
      </div>

      <footer className="tv-footer">
        <span>PICT · FY-08 · CR ELECTIONS</span>
        <span>Live results update automatically</span>
      </footer>

      {showQr && <QrOverlay />}
    </main>
  );
}

function QrOverlay() {
  return (
    <div className="tv-qr-overlay" role="dialog" aria-label="Student voting QR code">
      <div className="tv-qr-backdrop" />
      <div className="tv-qr-card">
        <div className="tv-qr-live"><i /> LIVE VOTING</div>
        <div className="tv-qr-icon">SCAN</div>
        <h2>Scan to vote</h2>
        <p>Use your phone camera to open the student voting page.</p>
        <div className="tv-qr-image-wrap">
          <img src="/student-vote-qr.png" alt="QR code for student voting" />
        </div>
        <div className="tv-qr-url">cr-election-7kjkr9lat-cetwalle.vercel.app/student/vote</div>
        <div className="tv-qr-hint">PICT · FIRST YEAR · FY-08</div>
      </div>
    </div>
  );
}
