import { useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { motion, AnimatePresence } from 'framer-motion'
import { auth } from './firebase'
import Dashboard from './components/Dashboard'

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = not yet resolved
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ?? null)
    })
    return unsubscribe
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    signOut(auth)
  }

  // Still resolving auth state — render nothing to avoid flicker
  if (user === undefined) return null

  if (user) {
    return (
      <div style={styles.appShell}>
        <Dashboard onLogout={handleLogout} user={user} />
      </div>
    )
  }

  return (
    <div style={styles.loginRoot}>
      <AnimatePresence>
        <motion.div
          key="login"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.4 }}
          style={styles.card}
        >
          <div style={styles.logoRow}>
            <span style={styles.logoMark}>S</span>
            <span style={styles.logoText}>StashPro</span>
          </div>

          <h1 style={styles.title}>Sign in</h1>
          <p style={styles.subtitle}>Use your StashPro account</p>

          <form onSubmit={handleLogin} style={styles.form} noValidate>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                placeholder="you@example.com"
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label} htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div style={styles.errorBanner}>
                <span style={styles.errorIcon}>⚠</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ ...styles.submitBtn, opacity: loading ? 0.65 : 1 }}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function friendlyError(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Try again later.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.'
    default:
      return 'Sign-in failed. Please try again.'
  }
}

const styles = {
  appShell: {
    minHeight: '100vh',
    background: 'transparent',
  },
  loginRoot: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: 'rgba(255,255,255,0.04)',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: '22px',
    padding: '44px 40px',
    boxShadow: '0 0 0 1px rgba(99,102,241,0.12), 0 40px 80px rgba(0,0,0,0.55), 0 0 80px rgba(99,102,241,0.07)',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '36px',
  },
  logoMark: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #6366F1, #06D6F7)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '800',
    fontSize: '18px',
    color: '#fff',
    flexShrink: 0,
    boxShadow: '0 0 24px rgba(99,102,241,0.55)',
  },
  logoText: {
    fontWeight: '800',
    fontSize: '18px',
    letterSpacing: '-0.03em',
    color: '#F8FAFC',
  },
  title: {
    fontSize: '26px',
    fontWeight: '800',
    color: '#F8FAFC',
    margin: '0 0 6px',
    letterSpacing: '-0.04em',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: '0 0 32px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#94A3B8',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  input: {
    padding: '12px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.05)',
    color: '#F8FAFC',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'rgba(255,62,108,0.12)',
    border: '1px solid rgba(255,62,108,0.28)',
    borderRadius: '10px',
    padding: '11px 16px',
    color: '#FCA5A5',
    fontSize: '13px',
  },
  errorIcon: {
    flexShrink: 0,
  },
  submitBtn: {
    marginTop: '6px',
    padding: '13px',
    borderRadius: '10px',
    border: 'none',
    background: 'linear-gradient(135deg, #6366F1, #06D6F7)',
    color: '#fff',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    letterSpacing: '0.02em',
    transition: 'opacity 0.15s',
    boxShadow: '0 4px 24px rgba(99,102,241,0.45)',
  },
}
