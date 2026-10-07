// Serves the built app (dist/) and a small password-protected admin API.
//
// The app itself talks to Firestore/Storage directly from the browser; the
// admin API exists because hiding and deleting walks need privileges the
// public rules (rightly) don't give browsers. Those actions run here with the
// Cloud Run service account.
//
// Env:
//   PORT                 (Cloud Run sets it; default 8080)
//   ADMIN_USER           default "harshu"
//   ADMIN_PASSWORD       from Secret Manager (takeawalk-admin-password)
//   ADMIN_TOKEN_SECRET   from Secret Manager (takeawalk-admin-token-secret)
//   GCP_PROJECT, FS_DATABASE, BUCKET  default hvrc-web / takeawalk / hvrc-takeawalk
//   FIRESTORE_EMULATOR_HOST, STORAGE_EMULATOR_HOST for local testing
import { createServer } from 'node:http'
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Firestore } from '@google-cloud/firestore'
import { Storage } from '@google-cloud/storage'
import { accounts } from './accounts.mjs'

const PORT = Number(process.env.PORT || 8080)
const DIST = process.env.DIST || fileURLToPath(new URL('../dist', import.meta.url))
const ADMIN_USER = process.env.ADMIN_USER || 'harshu'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || ''
const PROJECT = process.env.GCP_PROJECT || 'hvrc-web'
const BUCKET = process.env.BUCKET || 'hvrc-takeawalk'
const db = new Firestore({ projectId: PROJECT, databaseId: process.env.FS_DATABASE || 'takeawalk' })
const bucket = new Storage({ projectId: PROJECT }).bucket(BUCKET)
const acct = accounts({ db, project: PROJECT, apiKey: process.env.FIREBASE_API_KEY })

// Google sign-in runs its handler on the app's own domain (authDomain =
// walk.hvrc.place) so it works in browsers that block third-party storage,
// like Safari. Those paths are passed through to Firebase.
const AUTH_ORIGIN = `https://${PROJECT}.firebaseapp.com`
async function proxyAuth(req, res) {
  const headers = { ...req.headers }
  delete headers.host
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await rawBody(req)
  const r = await fetch(AUTH_ORIGIN + req.url, { method: req.method, headers, body, redirect: 'manual' })
  const out = {}
  r.headers.forEach((v, k) => {
    if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) out[k] = v
  })
  res.writeHead(r.status, out)
  res.end(Buffer.from(await r.arrayBuffer()))
}
async function rawBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

// Same lock-out as admin sign-in, for username sign-in.
const loginFailures = new Map()
async function guardedResolve(req, res) {
  const ip = clientIp(req)
  const f = loginFailures.get(ip)
  if (f && f.count >= 10 && Date.now() - f.at < 15 * 60_000) return json(res, 429, { error: 'Too many tries. Wait 15 minutes.' })
  try {
    json(res, 200, await acct.resolve(await body(req)))
    loginFailures.delete(ip)
  } catch (e) {
    if (e.status === 401) loginFailures.set(ip, { count: (f && Date.now() - f.at < 15 * 60_000 ? f.count : 0) + 1, at: Date.now() })
    throw e
  }
}

// ---- static app ------------------------------------------------------------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x')
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, path)
  if (!file.startsWith(DIST)) return send(res, 400, 'bad path')
  let info = await stat(file).catch(() => null)
  if (!info || info.isDirectory()) {
    // Single-page app: unknown paths get index.html.
    file = join(DIST, 'index.html')
    path = '/index.html'
    info = await stat(file).catch(() => null)
    if (!info) return send(res, 404, 'not built')
  }
  const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }
  if (path === '/index.html' || path === '/sw.js') headers['Cache-Control'] = 'no-cache'
  else if (path.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  res.writeHead(200, headers)
  if (req.method === 'HEAD') return res.end()
  res.end(await readFile(file))
}

// ---- admin auth ------------------------------------------------------------

const TOKEN_TTL_MS = 12 * 60 * 60_000
const sha = (s) => createHash('sha256').update(String(s)).digest()
const sign = (exp) => createHmac('sha256', TOKEN_SECRET).update(`admin.${exp}`).digest('hex')

function makeToken() {
  const exp = Date.now() + TOKEN_TTL_MS
  return `${exp}.${sign(exp)}`
}

function checkToken(req) {
  const m = /^Bearer (\d+)\.([0-9a-f]{64})$/.exec(req.headers.authorization || '')
  if (!m || !TOKEN_SECRET) return false
  const [, exp, sig] = m
  if (Number(exp) < Date.now()) return false
  return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(sign(exp), 'hex'))
}

// Slow down guessing: 5 wrong tries per address locks it out for 15 minutes.
const failures = new Map()
const LOCK_AFTER = 5
const LOCK_MS = 15 * 60_000
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
}

async function login(req, res) {
  const ip = clientIp(req)
  const f = failures.get(ip)
  if (f && f.count >= LOCK_AFTER && Date.now() - f.at < LOCK_MS) return json(res, 429, { error: 'Too many tries. Wait 15 minutes.' })
  const { user = '', password = '' } = await body(req)
  const ok = ADMIN_PASSWORD && timingSafeEqual(sha(user), sha(ADMIN_USER)) & timingSafeEqual(sha(password), sha(ADMIN_PASSWORD))
  if (!ok) {
    const n = f && Date.now() - f.at < LOCK_MS ? f.count + 1 : 1
    failures.set(ip, { count: n, at: Date.now() })
    return json(res, 401, { error: 'Wrong name or password.' })
  }
  failures.delete(ip)
  json(res, 200, { token: makeToken() })
}

// ---- admin actions ---------------------------------------------------------

async function listWalks(res) {
  const snap = await db.collection('trips').orderBy('updatedAt', 'desc').get()
  const walks = snap.docs.map((d) => {
    const t = d.data()
    return {
      id: d.id,
      name: t.name ?? 'Untitled walk',
      status: t.status ?? 'active',
      hidden: !!t.hidden,
      deleted: !!t.deleted,
      deletedBy: t.deletedBy ? (t.members?.[t.deletedBy]?.name ?? 'admin') : null,
      deletedAt: t.deletedAt ?? null,
      createdAt: t.createdAt ?? 0,
      updatedAt: t.updatedAt ?? 0,
      polaroidCount: t.polaroidCount ?? 0,
      members: Object.values(t.members ?? {}).map((m) => ({ name: m.name, color: m.color })),
    }
  })
  json(res, 200, { walks })
}

async function setHidden(req, res, id) {
  const { hidden } = await body(req)
  const ref = db.collection('trips').doc(id)
  if (!(await ref.get()).exists) return json(res, 404, { error: 'No such walk.' })
  await ref.update({ hidden: !!hidden })
  json(res, 200, { id, hidden: !!hidden })
}

// "Deleting" a walk only marks it deleted: it disappears from the app but
// every route, photo and file stays, and it can be restored here.
async function setDeleted(res, id, deleted) {
  const ref = db.collection('trips').doc(id)
  if (!(await ref.get()).exists) return json(res, 404, { error: 'No such walk.' })
  await ref.update(deleted ? { deleted: true, deletedAt: Date.now(), deletedBy: 'admin' } : { deleted: false, deletedAt: null, deletedBy: null })
  console.log(JSON.stringify({ msg: deleted ? 'admin deleted walk (soft)' : 'admin restored walk', id }))
  json(res, 200, { id, deleted })
}

// ---- plumbing --------------------------------------------------------------

function send(res, code, text) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}
async function body(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 10_000) break
  }
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    if (url.pathname.startsWith('/__/auth/') || url.pathname === '/__/firebase/init.json') return await proxyAuth(req, res)
    if (!url.pathname.startsWith('/api/')) return await serveStatic(req, res)
    if (req.method === 'POST' && url.pathname === '/api/auth/signup') return json(res, 200, await acct.signup(await body(req)))
    if (req.method === 'POST' && url.pathname === '/api/auth/resolve') return await guardedResolve(req, res)
    if (req.method === 'POST' && url.pathname === '/api/auth/username') return json(res, 200, await acct.chooseUsername(req, await body(req)))
    const j = /^\/api\/walks\/([A-Za-z0-9_-]{1,64})\/join$/.exec(url.pathname)
    if (j && req.method === 'POST') return json(res, 200, await acct.join(req, j[1], await body(req)))
    if (!url.pathname.startsWith('/api/admin/')) return json(res, 404, { error: 'Not found.' })
    if (url.pathname === '/api/admin/login' && req.method === 'POST') return await login(req, res)
    if (!checkToken(req)) return json(res, 401, { error: 'Sign in again.' })
    if (url.pathname === '/api/admin/walks' && req.method === 'GET') return await listWalks(res)
    const m = /^\/api\/admin\/walks\/([A-Za-z0-9_-]{1,64})(\/hidden|\/restore)?$/.exec(url.pathname)
    if (m && m[2] === '/hidden' && req.method === 'POST') return await setHidden(req, res, m[1])
    if (m && m[2] === '/restore' && req.method === 'POST') return await setDeleted(res, m[1], false)
    if (m && !m[2] && req.method === 'DELETE') return await setDeleted(res, m[1], true)
    json(res, 404, { error: 'Not found.' })
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message })
    console.error(e)
    json(res, 500, { error: 'Something went wrong.' })
  }
}).listen(PORT, () => console.log(`takeawalk on :${PORT}`))
