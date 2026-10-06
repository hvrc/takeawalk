// Accounts and joining walks. The browser signs in with Firebase Auth; the
// pieces that need to be atomic or private run here:
//   - sign up with a username (username must be unique, created with the account)
//   - sign in with a username (look up the email without exposing it)
//   - choose a username after signing in with Google
//   - join a private walk from its link (non-members can't write to it)
import { FieldValue } from '@google-cloud/firestore'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const COLORS = ['#c0432e', '#2f6fa3', '#3a8a3f', '#d9961a', '#7b3f6e', '#e06a2c', '#1f7f80', '#8a2b2b']
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,23}$/i

export function accounts({ db, project, apiKey }) {
  initializeApp({ projectId: project })
  const auth = getAuth()
  const users = db.collection('users')
  const usernames = db.collection('usernames')

  const clean = (u) => String(u || '').trim()
  const key = (u) => clean(u).toLowerCase()

  async function requireUser(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '')
    if (!m) throw httpError(401, 'Sign in first.')
    try {
      return await auth.verifyIdToken(m[1])
    } catch {
      throw httpError(401, 'Sign in again.')
    }
  }

  // Reserve a username for a uid, atomically. Throws 409 if it's taken.
  async function reserve(uid, username) {
    if (!USERNAME.test(username)) throw httpError(400, 'Usernames are 2–24 letters, numbers, dots, dashes or underscores.')
    await db.runTransaction(async (tx) => {
      const ref = usernames.doc(key(username))
      const taken = await tx.get(ref)
      if (taken.exists && taken.data().uid !== uid) throw httpError(409, 'That username is taken.')
      tx.set(ref, { uid })
      tx.set(users.doc(uid), { username, createdAt: Date.now() }, { merge: true })
    })
  }

  return {
    async signup(body) {
      const username = clean(body.username)
      const email = clean(body.email)
      const password = String(body.password || '')
      if (!USERNAME.test(username)) throw httpError(400, 'Usernames are 2–24 letters, numbers, dots, dashes or underscores.')
      if ((await usernames.doc(key(username)).get()).exists) throw httpError(409, 'That username is taken.')
      if (password.length < 6) throw httpError(400, 'Passwords need at least 6 characters.')
      let user
      try {
        user = await auth.createUser({ email, password, displayName: username })
      } catch (e) {
        if (e.code === 'auth/email-already-exists') throw httpError(409, 'There is already an account with that email. Try signing in.')
        if (e.code === 'auth/invalid-email') throw httpError(400, "That email doesn't look right.")
        throw e
      }
      try {
        await reserve(user.uid, username)
      } catch (e) {
        await auth.deleteUser(user.uid).catch(() => undefined)
        throw e
      }
      return { email }
    },

    // Username sign-in: check the password here, then hand back the email so
    // the browser can sign in with it. Without the right password you learn nothing.
    async resolve(body) {
      const login = clean(body.login)
      const password = String(body.password || '')
      const wrong = httpError(401, 'Wrong username or password.')
      const u = await usernames.doc(key(login)).get()
      if (!u.exists) throw wrong
      const { email } = await auth.getUser(u.data().uid).catch(() => ({}))
      if (!email) throw wrong
      const base = process.env.FIREBASE_AUTH_EMULATOR_HOST
        ? `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com`
        : 'https://identitytoolkit.googleapis.com'
      const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${apiKey || 'emulator'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: false }),
      })
      if (!r.ok) throw wrong
      return { email }
    },

    async chooseUsername(req, body) {
      const me = await requireUser(req)
      await reserve(me.uid, clean(body.username))
      await auth.updateUser(me.uid, { displayName: clean(body.username) }).catch(() => undefined)
      return { username: clean(body.username) }
    },

    async join(req, tripId, body = {}) {
      const me = await requireUser(req)
      const profile = await users.doc(me.uid).get()
      if (!profile.exists) throw httpError(400, 'Pick a username first.')
      const ref = db.collection('trips').doc(tripId)
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) throw httpError(404, 'That walk is gone.')
        const t = snap.data()
        const members = t.members ?? {}
        const now = Date.now()
        if (members[me.uid]) {
          tx.update(ref, { [`members.${me.uid}.lastSeenAt`]: now, memberUids: FieldValue.arrayUnion(me.uid) })
          return
        }
        if (t.status === 'published') throw httpError(409, 'This walk is finished, so nobody new can join.')
        // You have to be near where the walk is happening.
        let where = null
        for (const m of Object.values(members)) if (m.lastPos && (!where || m.lastPos.t > where.t)) where = m.lastPos
        if (where) {
          if (typeof body.lat !== 'number' || typeof body.lng !== 'number')
            throw httpError(400, 'Turn on location so we can check you are near this walk, then try again.')
          const d = distanceM(where, body)
          if (d > MAX_JOIN_DISTANCE_M) throw httpError(403, `You're about ${Math.round(d / 1000)} km from this walk. You can only join when you're nearby.`)
        }
        const taken = Object.values(members).map((m) => m.color)
        const color = COLORS.find((c) => !taken.includes(c)) ?? COLORS[taken.length % COLORS.length]
        tx.update(ref, {
          [`members.${me.uid}`]: { name: profile.data().username, color, joinedAt: now, lastSeenAt: now, lastPos: null, tracking: false },
          memberUids: FieldValue.arrayUnion(me.uid),
          updatedAt: now,
        })
      })
      return { ok: true }
    },
  }
}

const MAX_JOIN_DISTANCE_M = 10_000
function distanceM(a, b) {
  const R = 6371e3
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status })
}
