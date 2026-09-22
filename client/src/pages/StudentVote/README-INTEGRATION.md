# Student scanner flow

`CameraScanner.jsx` now does:

1. Fast QR / Code-128 scan.
2. Shows a macOS-style student confirmation card.
3. On **Confirm & Continue**, checks Firebase for the student and whether a vote already exists.
4. If already voted, blocks the ballot and shows **This student has already voted.**
5. If not voted, calls the existing `onResult(scannedValue, student)` callback so the parent can open the voting screen.

If the existing app already initializes Firebase, the scanner can auto-use that Firebase app. For an exact custom database schema, pass an async `verifyStudent(value)` prop returning:

```js
{ found: true, student: {...}, hasVoted: false }
```

Optional Vite variables:

- `VITE_STUDENT_COLLECTIONS=students,student`
- `VITE_VOTE_COLLECTIONS=votes,voting`
