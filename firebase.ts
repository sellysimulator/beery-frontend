/**
 * Firebase web configuration.
 *
 * These are public identifiers and are safe to ship in the bundle, so this
 * file is COMMITTED and must never be added to `.gitignore`: gitignoring it
 * while `src/` imports it breaks CI, and the frontend then silently stops
 * deploying while the backend keeps auto-deploying (section 16, 4.11).
 *
 * Every value comes from a `VITE_FIREBASE_*` variable and there is NO fallback
 * to any real project's identifiers. A hardcoded project id behind
 * `import.meta.env.VITE_FIREBASE_*` makes a missing or misspelled variable
 * invisible: the app would silently authenticate against whichever project the
 * literal names, which in this monorepo of sibling games is a different game's
 * Firebase project.
 *
 * Loud, but not fatal. A missing variable is reported at `console.error` here,
 * at module load, and makes `signInWithGoogle()` reject with the same message.
 * It does not throw: `socket.ts` and `http.ts` import this module, so throwing
 * would black-screen the welcome page and the manuals, which section 4.7
 * requires to render with no backend at all. Guest play needs no Firebase and
 * keeps working; the degradation is that Google sign-in is unavailable and
 * says so.
 *
 * `.env.example` documents all six keys.
 */
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

// Read statically, one key at a time, so Vite substitutes each at build time.
const declared: Record<string, string | undefined> = {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
}

const missing = Object.keys(declared).filter((key) => !declared[key]?.trim())

/** The message to show and to reject a Google sign-in with, or null when configured. */
export const firebaseConfigError: string | null = missing.length
  ? `Firebase is not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} ` +
    'missing. Google sign-in is unavailable; guest play is unaffected. ' +
    "Copy .env.example to .env and fill in the Beery project's web config."
  : null

if (firebaseConfigError) {
  console.error(firebaseConfigError)
}

/**
 * `getAuth()` refuses to construct an Auth instance without an `apiKey` and
 * throws `auth/invalid-api-key`, which would be exactly the module-load crash
 * this file must not have. An unconfigured build therefore gets an inert
 * placeholder: it names no real project, so it cannot authenticate against one,
 * and `firebaseConfigError` above is what stops sign-in being attempted.
 */
const PLACEHOLDER = 'missing-firebase-configuration'

export const app = initializeApp(
  firebaseConfigError
    ? {
        apiKey: PLACEHOLDER,
        authDomain: PLACEHOLDER,
        projectId: PLACEHOLDER,
        storageBucket: PLACEHOLDER,
        messagingSenderId: PLACEHOLDER,
        appId: PLACEHOLDER,
      }
    : {
        apiKey: declared.VITE_FIREBASE_API_KEY,
        authDomain: declared.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: declared.VITE_FIREBASE_PROJECT_ID,
        storageBucket: declared.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: declared.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: declared.VITE_FIREBASE_APP_ID,
      },
)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
