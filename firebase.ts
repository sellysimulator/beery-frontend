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
import { getAuth, GoogleAuthProvider } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyD1dNjUNASHSyq_T7b-QCc17w7ksAU8o2U',
  authDomain: 'beery-30d23.firebaseapp.com',
  projectId: 'beery-30d23',
  storageBucket: 'beery-30d23.firebasestorage.app',
  messagingSenderId: '643310215282',
  appId: '1:643310215282:web:69fc7c5f3c4f86817f62eb',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
