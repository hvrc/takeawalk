import { useEffect, useState } from 'react'
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
} from 'firebase/auth'
import { doc, onSnapshot, type Firestore } from 'firebase/firestore'
import type { Services } from '../firebase'

export type Account =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'needs-username'; uid: string; suggestion: string }
  | { status: 'ready'; uid: string; username: string }

/** Who's signed in, and their username (from users/{uid}, written by the server). */
export function useAccount({ auth, db }: { auth: Auth; db: Firestore }): Account {
  const [state, setState] = useState<Account>({ status: 'loading' })
  useEffect(() => {
    let unProfile: (() => void) | null = null
    const unAuth = onAuthStateChanged(auth, (user) => {
      unProfile?.()
      unProfile = null
      if (!user) return setState({ status: 'signed-out' })
      unProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          const username = snap.exists() ? (snap.data().username as string) : ''
          if (username) setState({ status: 'ready', uid: user.uid, username })
          else setState({ status: 'needs-username', uid: user.uid, suggestion: suggest(user.displayName || user.email || '') })
        },
        () => setState({ status: 'needs-username', uid: user.uid, suggestion: suggest(user.displayName || user.email || '') }),
      )
    })
    return () => {
      unAuth()
      unProfile?.()
    }
  }, [auth, db])
  return state
}

function suggest(from: string): string {
  return from.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24)
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || "Couldn't reach the server. Check your connection.")
  return data as T
}

/** Sign in with an email or a username, and a password. */
export async function signIn({ auth }: Services, login: string, password: string) {
  let email = login.trim()
  if (!email.includes('@')) email = (await post<{ email: string }>('/api/auth/resolve', { login: email, password })).email
  try {
    await signInWithEmailAndPassword(auth, email, password)
  } catch {
    throw new Error('Wrong username or password.')
  }
}

export async function signUp(services: Services, username: string, email: string, password: string) {
  await post('/api/auth/signup', { username, email, password })
  await signInWithEmailAndPassword(services.auth, email.trim(), password)
}

export async function signInWithGoogle({ auth }: Services) {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  await signInWithRedirect(auth, provider)
}

/** After coming back from Google: surface any problem as a message. */
export async function finishGoogleRedirect({ auth }: Services): Promise<string | null> {
  try {
    await getRedirectResult(auth)
    return null
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'auth/account-exists-with-different-credential')
      return 'You already have an account with that email. Sign in with your username or email and password instead.'
    if (code === 'auth/operation-not-allowed') return "Google sign-in isn't switched on yet."
    return "Google sign-in didn't work. Try again, or use your username and password."
  }
}

export async function chooseUsername({ auth }: Services, username: string) {
  const token = await auth.currentUser?.getIdToken()
  await post('/api/auth/username', { username }, token)
}

/** Join a walk you have the link to. The server checks you're near it. */
export async function joinWalk({ auth }: Services, tripId: string) {
  const token = await auth.currentUser?.getIdToken()
  const here = await new Promise<GeolocationPosition | null>((resolve) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: false, timeout: 12_000, maximumAge: 120_000 })
      : resolve(null),
  )
  await post(`/api/walks/${tripId}/join`, here ? { lat: here.coords.latitude, lng: here.coords.longitude } : {}, token)
}

export const signOut = ({ auth }: Services) => fbSignOut(auth)
