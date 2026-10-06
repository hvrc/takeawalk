import { useEffect, useState, type FormEvent } from 'react'
import type { Services } from '../firebase'
import { chooseUsername, connectGoogle, finishGoogleRedirect, signIn, signInWithGoogle, signUp } from '../lib/account'
import type { AuthCredential } from 'firebase/auth'
import { WalkerParade } from './Walker'
import PlaceMap from './PlaceMap'

type Mode = 'signin' | 'signup' | 'forgot' | 'link'

const ADMIN_EMAIL = 'harshrajmachikar@gmail.com'

function Password({ value, onChange, autoComplete }: { value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-field">
      <input
        className="field"
        type={show ? 'text' : 'password'}
        placeholder="password"
        aria-label="Password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
      />
      <button type="button" className="pw-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c6 0 10 7 10 7a17.6 17.6 0 01-3.2 4M6.6 6.6A17.4 17.4 0 002 12s4 7 10 7a9.6 9.6 0 005.4-1.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}

function GoogleButton({ services, label, onError }: { services: Services; label: string; onError: (m: string) => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost google-btn"
      onClick={() => signInWithGoogle(services).catch(() => onError("Google sign-in didn't start. Try again."))}
    >
      <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z" />
        <path fill="#FBBC05" d="M10.5 28.7A14.6 14.6 0 019.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 000 24c0 3.9.9 7.5 2.6 10.7l7.9-6z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6C6.6 42.6 14.6 48 24 48z" />
      </svg>
      {label}
    </button>
  )
}

/** Landing: sign in (username/email + password, or Google), sign up, or forgot password. */
export default function AuthScreen({ services }: { services: Services }) {
  const [mode, setMode] = useState<Mode>('signin')
  const [login, setLogin] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    email: string
    credential: AuthCredential
  } | null>(null)

  useEffect(() => {
    finishGoogleRedirect(services).then((r) => {
      if (!r) return
      if ('link' in r) {
        setPending(r.link)
        setMode('link')
      } else setMsg(r.message)
    })
  }, [services])

  const go = (m: Mode) => {
    setMode(m)
    setMsg(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'link' && pending) await connectGoogle(services, pending.email, password, pending.credential)
      else if (mode === 'signin') await signIn(services, login, password)
      else await signUp(services, username, email, password)
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <PlaceMap />
      <div className="splash auth">
        <WalkerParade size={40} />
        <h1 className="wordmark">
          take a walk <span className="nowrap">(with a friend)</span>
          <small>and pin some pictures along the way</small>
        </h1>

        {mode === 'link' && pending ? (
          <form className="card auth-card" onSubmit={submit}>
            <h2>You already have an account</h2>
            <p>
              <b>{pending.email}</b> already has a take a walk account. Enter its password once to connect Google to it; after that, Sign in with Google takes
              you straight in.
            </p>
            <Password value={password} onChange={setPassword} autoComplete="current-password" />
            {msg ? <p className="confirm-error">{msg}</p> : null}
            <button className={`btn btn-accent ${busy ? 'busy' : ''}`} type="submit" disabled={busy || !password}>
              {busy ? <span className="spinner sm" aria-label="Working" /> : 'Connect Google'}
            </button>
            <button type="button" className="link-btn" onClick={() => go('forgot')}>
              Forgot password?
            </button>
          </form>
        ) : mode === 'forgot' ? (
          <div className="card auth-card">
            <h2>Forgot your password?</h2>
            <p>
              Email <a href={`mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent('take a walk: I forgot my password')}`}>{ADMIN_EMAIL}</a> saying you forgot
              your password. He'll fix it for you.
            </p>
            <button className="btn btn-ghost" onClick={() => go('signin')}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form className="card auth-card" onSubmit={submit}>
            <h2>{mode === 'signin' ? 'Sign in' : 'Make an account'}</h2>
            <GoogleButton services={services} label={mode === 'signin' ? 'Sign in with Google' : 'Sign up with Google'} onError={setMsg} />
            <div className="or">or</div>
            {mode === 'signin' ? (
              <input
                className="field"
                placeholder="username or email"
                aria-label="Username or email"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
              />
            ) : (
              <>
                <input
                  className="field"
                  placeholder="username"
                  aria-label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  maxLength={24}
                />
                <input
                  className="field"
                  type="email"
                  placeholder="email"
                  aria-label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </>
            )}
            <Password value={password} onChange={setPassword} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            {msg ? <p className="confirm-error">{msg}</p> : null}
            <button
              className={`btn btn-accent ${busy ? 'busy' : ''}`}
              type="submit"
              disabled={busy || !password || (mode === 'signin' ? !login.trim() : !username.trim() || !email.trim())}
            >
              {busy ? <span className="spinner sm" aria-label="Working" /> : mode === 'signin' ? 'Sign in' : 'Make my account'}
            </button>
            {mode === 'signin' ? (
              <button type="button" className="link-btn" onClick={() => go('forgot')}>
                Forgot password?
              </button>
            ) : null}
          </form>
        )}

        {mode === 'signin' ? (
          <p className="auth-switch">
            New here?{' '}
            <button className="link-btn" onClick={() => go('signup')}>
              Sign up
            </button>
          </p>
        ) : mode === 'signup' ? (
          <p className="auth-switch">
            Already have an account?{' '}
            <button className="link-btn" onClick={() => go('signin')}>
              Sign in
            </button>
          </p>
        ) : null}
      </div>
    </div>
  )
}

/** After signing in with Google for the first time: pick a username. */
export function ChooseUsername({ services, suggestion, onSignOut }: { services: Services; suggestion: string; onSignOut: () => void }) {
  const [name, setName] = useState(suggestion)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      await chooseUsername(services, name.trim())
    } catch (err) {
      setMsg((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="splash auth">
      <WalkerParade size={40} />
      <form className="card auth-card" onSubmit={submit}>
        <h2>Pick a username</h2>
        <p className="muted">This is the name your friends see on walks.</p>
        <input
          className="field"
          aria-label="Username"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={24}
          autoCapitalize="none"
          autoCorrect="off"
        />
        {msg ? <p className="confirm-error">{msg}</p> : null}
        <button className={`btn btn-accent ${busy ? 'busy' : ''}`} type="submit" disabled={busy || !name.trim()}>
          {busy ? <span className="spinner sm" aria-label="Saving" /> : 'Continue'}
        </button>
        <button type="button" className="link-btn" onClick={onSignOut}>
          Use a different account
        </button>
      </form>
    </div>
  )
}
