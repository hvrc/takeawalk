# take a walk

A phone-first web app for walking together. Start a walk, your route draws on the
map as you go, friends join with a 4-letter code and get their own colour, and
photos you take along the way become polaroids pinned where you took them.

Everything is public. There are no accounts: you type a name once and it lives
on your phone.

- **Frontend:** Vite + React + TypeScript, installable PWA
- **Map:** MapLibre GL with free OpenFreeMap vector tiles (no API key)
- **Backend:** Firebase on Google Cloud. Firestore for trips, routes and polaroid
  metadata (live sync to everyone on the trip), Cloud Storage for the photos,
  Firebase Hosting for the app. No servers to run.

## Deploy it

See [SETUP.md](SETUP.md). It is about ten minutes the first time, then one command.

## Develop locally

```bash
npm install
npm run emulators      # terminal 1: Firestore + Storage emulators (needs Java 11+)
npm run dev:emu        # terminal 2: app on http://localhost:5173 wired to the emulators
```

To try it on your actual phone against the emulators, open `http://<your-laptop-ip>:5173`
on the phone. The emulators listen on the same hostname the page was loaded from.
GPS and the camera need a secure context, so on a phone that only works for
`localhost`; for real-device testing, deploy to Firebase Hosting instead (it is HTTPS).

```bash
npm run test:e2e       # Playwright: two simulated phones walk one trip (needs dev:emu running)
npm run build          # production build into dist/
npm run lint
```

## How it works

**Trips** are lobbies. A trip has a name, a join code, a status (`active` or
`published`) and a `members` map keyed by device id with each person's name and
colour. Anyone can join any trip with the code. A published trip can be resumed;
old route segments are never modified, resuming only adds new ones.

**Routes** are stored as segments: one document per stretch of continuous
tracking per person. Every Start or Resume opens a new segment, so pauses never
draw a fake straight line. Points are filtered (accuracy under 50 m, at least
5 m apart, no GPS teleports) and flushed to Firestore every 8 seconds. Firestore
offline persistence means points written without signal upload later.

**Location while the screen is off:** browsers do not give web pages GPS when
the tab is backgrounded or the phone is locked. The app keeps the screen awake
while tracking, pauses automatically when you leave, and resumes when you come
back (continuing the same segment if you were gone under 90 seconds). For
pocket tracking you would need a native wrapper, which is on the roadmap.

**Polaroids** are taken with the phone's own camera, compressed client-side to
1600 px, uploaded to Cloud Storage, and recorded in Firestore with the GPS fix
from the moment the shutter was tapped. If the upload fails (no signal) the photo
sits in IndexedDB and retries when you are back online or reopen the app.
Tap a pin to enlarge it, tap the photo to flip it over and read the back. The
bottom-left corner opens the spot in Google Maps, the bottom-right renders the
framed polaroid to an image and hands it to the share sheet (Save Image on iOS)
or downloads it.

## Layout

```
src/
  firebase.ts          Firebase init (config from Hosting, .env, or emulators)
  lib/tracker.ts       GPS tracking state machine: filtering, flushing, wake lock, auto-pause
  lib/tripApi.ts       All Firestore / Storage reads and writes
  lib/image.ts         Compression, polaroid canvas rendering, save/share
  lib/uploadQueue.ts   IndexedDB queue for photos taken offline
  pages/Home.tsx       Public list of walks, start / join
  pages/Trip.tsx       The walk screen: map, controls, camera, viewer
  components/MapView.tsx       MapLibre map, route lines, head markers, polaroid pins
  components/PolaroidViewer.tsx  Enlarged, flippable polaroid with actions
  components/CaptureSheet.tsx    Caption / description / retake after a photo
firestore.rules, storage.rules   Public read/write with shape and size limits
```
