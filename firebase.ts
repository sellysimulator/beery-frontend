/**
 * Firebase web configuration.
 *
 * These are public identifiers — they ship in the JavaScript bundle to every
 * visitor, and anyone can read them out of `dist/` or DevTools. Firebase
 * security comes from Auth rules and API-key restrictions, not from hiding
 * this. So the values live here as literals and this file is COMMITTED.
 *
 * It must never be added to `.gitignore`. Gitignoring it while `src/` imports
 * it means CI cannot build the frontend, and the frontend then silently stops
 * deploying while the backend keeps auto-deploying — the sibling Tequila
 * project does exactly that and has been in that state (section 16, 4.11).
 *
 * The project is `beery-30d23`. If you point this at a different project,
 * change it here and nowhere else; there is no environment override, so there
 * is exactly one place to look.
 */
import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  GoogleAuthProvider,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyD1dNjUNASHSyq_T7b-QCc17w7ksAU8o2U',
  authDomain: 'beery-30d23.firebaseapp.com',
  projectId: 'beery-30d23',
  storageBucket: 'beery-30d23.firebasestorage.app',
  messagingSenderId: '643310215282',
  appId: '1:643310215282:web:69fc7c5f3c4f86817f62eb',
}

export const app = initializeApp(firebaseConfig)

/**
 * `initializeAuth`, NOT `getAuth`.
 *
 * `getAuth()` is a shorthand that calls `initializeAuth` with
 * `popupRedirectResolver: browserPopupRedirectResolver` already set. Auth then
 * awaits that resolver during start-up — `initializeCurrentUser` runs
 * `tryRedirectSignIn`, which loads a cross-origin gapi iframe from
 * `authDomain` (`beery-30d23.firebaseapp.com/__/auth/iframe.js`, ~288 KB, plus
 * `apis.google.com/js/api.js`) to check for a pending redirect result. That
 * await sits directly in front of the auth-state resolution, so it delays
 * `onAuthStateChanged`, which delays every guarded route and the socket
 * handshake with it (`src/api/socket.ts` never auto-connects).
 *
 * This app is served from `beersim.web.app`, so it is always cross-origin from
 * `authDomain` and always paid that cost — for machinery only needed when
 * somebody clicks "Sign in with Google". Omitting the resolver here makes it
 * load on demand instead; `AuthContext.tsx` passes
 * `browserPopupRedirectResolver` to `signInWithPopup` explicitly, which is
 * what keeps sign-in working. A call site that forgets it gets a loud
 * `auth/operation-not-supported-in-this-environment`, not a quiet failure.
 *
 * The `AUTH_INIT_TIMEOUT_MS` watchdog in `AuthContext.tsx` stays: this removes
 * the iframe leg of the start-up chain, but the `securetoken` refresh and
 * `accounts:lookup` calls it documents still have no deadline of their own.
 *
 * The persistence list is the browser default minus `browserSessionPersistence`,
 * which was never reachable — the first entry that works wins, and localStorage
 * is always available before session storage is consulted.
 */
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
})

export const googleProvider = new GoogleAuthProvider()
