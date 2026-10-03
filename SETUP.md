# Setting up and deploying

You need: a Google account with billing enabled on Google Cloud, Node 20+, and
this repo cloned on your laptop. Run everything below from the repo folder.

## 1. Create the Firebase project (one time, in the browser)

1. Go to https://console.firebase.google.com and click **Add project**.
   Name it anything (for example `takeawalk`). Google Analytics is not needed.
2. In the left sidebar under **Build**, open **Firestore Database** and click
   **Create database**. Choose **Production mode** and a region close to you
   (for example `northamerica-northeast2` for Toronto, or `us-central1`). Done.
3. Still under **Build**, open **Storage** and click **Get started**. Storage
   requires the **Blaze (pay as you go)** plan, so the console will ask you to
   upgrade and attach a billing account. The free tier still applies, so a few
   people walking and uploading photos costs nothing or cents. Pick the same
   region as Firestore. Choose **Production mode** for the rules; we deploy our
   own rules in step 3.
4. Click the gear next to **Project Overview**, then **Project settings**. Under
   **Your apps**, click the web icon (`</>`), give it a nickname like `web`,
   tick **Also set up Firebase Hosting**, and click **Register app**. You can
   skip the SDK snippet; the app fetches its config from Hosting automatically.

## 2. Log in and point the repo at your project (one time)

```bash
npm install
npx firebase login
npx firebase use --add
```

Pick your project from the list and give it the alias `default`. This rewrites
`.firebaserc` to your real project id.

## 3. Deploy

```bash
npm run deploy
```

That builds the app and deploys Hosting, Firestore rules and Storage rules.
At the end it prints a URL like `https://takeawalk-xxxxx.web.app`. Open it on
your phone.

## 4. Allow the browser to save polaroids (one time)

The "save image" button draws the photo onto a canvas, which needs the storage
bucket to allow cross-origin reads. Run once:

```bash
gcloud auth login
gcloud storage buckets update gs://YOUR_BUCKET --cors-file=cors.json
```

Your bucket name is on the Storage page in the Firebase console, usually
`YOUR_PROJECT_ID.firebasestorage.app` (older projects use `.appspot.com`).
Without this step everything else works; "save" falls back to opening the photo
in a new tab so you can long-press it.

## 5. Install it on the phones

Open the `web.app` URL in Safari (iPhone) or Chrome (Pixel), then:

- **iPhone:** Share button, then **Add to Home Screen**.
- **Pixel:** three-dot menu, then **Add to Home screen** or **Install app**.

Open it from the home screen. The first time you tap **Start** it asks for
location permission (choose **Allow While Using App** and **Precise**). The
first photo asks for camera permission.

## Before the walk: a checklist

- Both phones have the app installed from the home screen and a name entered.
- Tap **Start a walk**, read the 4-letter code from the top bar, friend types it
  under **or join a friend**. You should both see two colour chips at the top.
- Tap **Start** on each phone. Keep the app open and the screen on while walking
  (the app keeps the screen awake for you). Locking the phone pauses tracking
  and unlocking resumes it; a gap under 90 seconds stays one continuous line.
- Take photos with the shutter button in the middle. Caption on the front,
  optional description on the back, **Pin it to the map**.
- When done, **Finish**. The walk is published and shows on the home page for
  everyone. You can resume it later; what you already walked stays as it was.

## Updating later

```bash
git pull
npm run deploy
```

## Running against the local emulators instead

```bash
npm run emulators   # needs Java 11+
npm run dev:emu
```

Open http://localhost:5173. Data lives only in the emulator and is wiped on restart.
