# CR Election — Class Representative Election App

Single, fixed election. React (Vite, light theme) frontend + Node.js/Express backend + Firebase
(Firestore) for data storage and the real-time leaderboard.

## Routes

- `/student/vote` — student enters name + roll number, gets checked against previous votes
  (by roll number, device, and name), then votes for one Boys elector and one Girls elector.
  After the check it moves to `/student/vote?election=<rollNumber>` to show the ballot.
- `/admin/tv` — live leaderboard, Boys CR / Girls CR side by side, updates instantly as votes
  come in (no refresh). Put this on the classroom projector.
- `/admin/settings` — add/remove electors (the candidates students vote for), per category.

## How the anti-duplicate check works

Every write goes through the backend using the Firebase **Admin SDK**; Firestore rules deny all
client writes, so nothing can be forced through dev tools. Before showing the ballot, and again
right before recording the vote, the backend checks three things:

- has this **roll number** already voted (`voters/roll_<rollNumber>`)
- has this **device** already voted (`devices/<deviceToken>`, a token generated once per browser
  and stored in localStorage — not the human-readable name)
- has this **name** already voted (a Firestore query on `voters` for a matching name)

Any one of those being true blocks the vote.

## Firestore data model

```
candidates_boys/{id}   → { name, votes, order }
candidates_girls/{id}  → { name, votes, order }
voters/{roll_<roll>}   → { name, deviceId, voted, boysChoice, girlsChoice, votedAt }
devices/{deviceId}     → { rollNumber, name, voted, votedAt }
```

`voters` and `devices` are never readable by the client (Firestore rules deny client reads).

## 1. Firebase setup

1. Firestore Database already created (production mode).
2. Paste `firebase/firestore.rules` into the Rules tab and publish.
3. Web app config → `client/.env` (see `client/.env.example`).
4. Service account key → save as `server/serviceAccountKey.json`, reference it from
   `server/.env` (see `server/.env.example`).

## 2. Install & run

```
npm run install:all
```
Terminal 1: `npm run dev:server` (http://localhost:5000)
Terminal 2: `npm run dev:client` (http://localhost:3000)

## 3. Set it up

1. Open `http://localhost:3000/admin/settings`, enter your admin token.
2. Add a few Boys CR and Girls CR electors.
3. Open `http://localhost:3000/admin/tv` on the projector — leaderboard updates live.
4. Students go to `http://localhost:3000/student/vote` (QR code to be added once ready).

## What's deliberately simple for now

- One fixed election — no election creation/start/end/reset UI.
- No QR code yet (per current scope — link only, QR to be added later).
- Admin auth is a single shared Bearer token.
- No styling/animation pass beyond a clean light theme — polish comes next.
