import { initializeApp, type FirebaseOptions } from 'firebase/app'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

export interface Services {
  db: Firestore
  storage: FirebaseStorage
  projectId: string
  emulators: boolean
}

const env = import.meta.env
const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true'

function configFromEnv(): FirebaseOptions | null {
  if (!env.VITE_FIREBASE_PROJECT_ID) return null
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }
}

async function configFromHosting(): Promise<FirebaseOptions> {
  const res = await fetch('/__/firebase/init.json', { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      'Could not load Firebase config. Deploy with `firebase deploy` (Hosting serves it at /__/firebase/init.json) or set VITE_FIREBASE_* in .env.',
    )
  }
  return (await res.json()) as FirebaseOptions
}

let servicesPromise: Promise<Services> | null = null

export function getServices(): Promise<Services> {
  if (!servicesPromise) servicesPromise = init()
  return servicesPromise
}

async function init(): Promise<Services> {
  let config: FirebaseOptions
  if (USE_EMULATORS) {
    config = {
      apiKey: 'demo',
      projectId: 'demo-takeawalk',
      appId: 'demo',
      storageBucket: 'demo-takeawalk.appspot.com',
    }
  } else {
    config = configFromEnv() ?? (await configFromHosting())
  }

  const app = initializeApp(config)
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  const storage = getStorage(app)

  if (USE_EMULATORS) {
    const host = location.hostname
    connectFirestoreEmulator(db, host, 8080)
    connectStorageEmulator(storage, host, 9199)
  }

  return { db, storage, projectId: config.projectId ?? '', emulators: USE_EMULATORS }
}
