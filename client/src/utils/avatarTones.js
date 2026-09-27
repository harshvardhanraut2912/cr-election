// Single source of truth for candidate avatar colors, so the same elector
// gets the same color everywhere: the admin/tv leaderboard, the student
// ballot, and the vote review screen. The actual gradient/text colors for
// each tone live in index.css as .tv-avatar-<tone>.
export const AVATAR_TONES = ["blue", "violet", "cyan", "rose", "amber", "emerald", "indigo", "pink"];

export function toneForCandidate(candidate, index = 0) {
  const key = candidate?.order ?? index;
  return AVATAR_TONES[((key % AVATAR_TONES.length) + AVATAR_TONES.length) % AVATAR_TONES.length];
}
