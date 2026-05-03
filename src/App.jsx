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
    background: '#0F0F11',
  },
  loginRoot: {
    minHeight: '100vh',
    background: '#0F0F11',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: '#18181B',
    border: '1px solid #27272A',
    borderRadius: '16px',
    padding: '40px 36px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '32px',
  },
  logoMark: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    fontSize: '16px',
    color: '#fff',
    flexShrink: 0,
  },
  logoText: {
    fontWeight: '700',
    fontSize: '16px',
    letterSpacing: '-0.02em',
    color: '#F1F5F9',
  },
  title: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#F1F5F9',
    margin: '0 0 6px',
    letterSpacing: '-0.03em',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: '0 0 28px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '500',
    color: '#94A3B8',
    letterSpacing: '0.01em',
  },
  input: {
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #3F3F46',
    background: '#09090B',
    color: '#F1F5F9',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: '#2D0A0A',
    border: '1px solid #7F1D1D',
    borderRadius: '8px',
    padding: '10px 14px',
    color: '#FCA5A5',
    fontSize: '13px',
  },
  errorIcon: {
    flexShrink: 0,
  },
  submitBtn: {
    marginTop: '4px',
    padding: '11px',
    borderRadius: '8px',
    border: 'none',
    background: 'linear-gradient(135deg, #8B5CF6, #06B6D4)',
    color: '#fff',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    letterSpacing: '0.01em',
    transition: 'opacity 0.15s',
  },
}
