/**
 * Section 23 -- deployment and CI, the frontend half
 * (`docs/plan/23-deployment-and-ci.md`).
 *
 * Covers `§8` acceptance criteria 9, 10, 11, 12 (the frontend half; the
 * backend half lives in `Beery_Backend/tests/test_deploy/test_config_surface.py`),
 * 16 and 17, and `§9` failure modes 1 and 7.
 *
 * This section is configuration, not code: every test here reads a committed
 * file -- `firebase.json`, the two `.github/workflows/firebase-hosting-*.yml`
 * files, `DEPLOY.md`, `.env.example`, `.gitignore`, `firebase.ts` -- rather
 * than importing an application module. Real toolchain execution (`tsc -b`,
 * `eslint .`, `npm run build`) is already exercised for real in
 * `routes.test.tsx`'s "toolchain gates" describe block (section 16); this
 * file does not repeat that, it asserts the CI *wiring* that makes those
 * checks run automatically on a clean checkout, which is this section's job.
 *
 * There are deliberately no `VITE_FIREBASE_*` assertions here beyond proving
 * they do not exist: the Firebase web config is literals in `firebase.ts` at
 * the repository root (00-decisions.md, 23-deployment-and-ci.md §4.2), and an
 * `envSurface` test asserting those six keys would assert the opposite of
 * the truth.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The `Beery_Frontend` directory, found without assuming the runner's cwd. */
function projectRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

const ROOT = projectRoot()

function readRoot(...segments: string[]): string {
  const path = join(ROOT, ...segments)
  if (!existsSync(path)) throw new Error(`required file is missing: ${path}`)
  return readFileSync(path, 'utf8')
}

const MERGE_WORKFLOW = () => readRoot('.github', 'workflows', 'firebase-hosting-merge.yml')
const PR_WORKFLOW = () => readRoot('.github', 'workflows', 'firebase-hosting-pull-request.yml')

/**
 * Ordered-appearance check: every marker in `markers` must be present in
 * `text`, each strictly after the previous one. Both owner-created workflows
 * here are a single job with a flat step list, so textual order of these
 * literal, distinctive substrings *is* step order -- no YAML parser needed
 * for a file this shape (the backend's `ci.yml` uses a small regex parser
 * instead, because it has multiple jobs; this one does not).
 */
function assertOrdered(text: string, markers: string[]): void {
  let cursor = -1
  for (const marker of markers) {
    const index = text.indexOf(marker)
    expect(index, `expected to find ${JSON.stringify(marker)}`).toBeGreaterThan(-1)
    expect(
      index,
      `expected ${JSON.stringify(marker)} to appear after the previous step (order is wrong)`,
    ).toBeGreaterThan(cursor)
    cursor = index
  }
}

// ---------------------------------------------------------------------------
// AC 9, AC 16, failure mode 1: the owner's workflows can actually build
// ---------------------------------------------------------------------------

describe('AC 9 / AC 16 / failure mode 1: CI can build the frontend', () => {
  it('the merge workflow installs deps with setup-node + npm ci, then lints/types/tests before building', () => {
    const text = MERGE_WORKFLOW()
    assertOrdered(text, [
      'actions/setup-node',
      'npm ci',
      'tsc -b',
      'eslint .',
      'vitest run',
      'npm run build',
    ])
  })

  it('the pull-request workflow has the identical gate', () => {
    const text = PR_WORKFLOW()
    assertOrdered(text, [
      'actions/setup-node',
      'npm ci',
      'tsc -b',
      'eslint .',
      'vitest run',
      'npm run build',
    ])
  })

  it('setup-node reads the pinned version from .nvmrc, not a hardcoded number', () => {
    for (const text of [MERGE_WORKFLOW(), PR_WORKFLOW()]) {
      expect(text).toMatch(/node-version-file:\s*['"]?\.nvmrc['"]?/)
    }
  })

  it('the owner-created deploy step and its secret/projectId survive the amendment', () => {
    for (const text of [MERGE_WORKFLOW(), PR_WORKFLOW()]) {
      expect(text).toContain('FirebaseExtended/action-hosting-deploy@v0')
      expect(text).toContain('FIREBASE_SERVICE_ACCOUNT_BEERY_30D23')
      expect(text).toContain('projectId: beery-30d23')
    }
  })

  it('failure mode 1: a clean checkout still finds firebase.ts (nothing imported from src/ is gitignored)', () => {
    // The exact Tequila failure this guards: firebase.ts gitignored while
    // src/ imports it means `npm ci && npm run build` in CI has no
    // node_modules problem at all -- it fails because the import target does
    // not exist on disk, and the backend keeps auto-deploying while the
    // frontend silently never does again.
    const gitignore = existsSync(join(ROOT, '.gitignore'))
      ? readFileSync(join(ROOT, '.gitignore'), 'utf8')
      : ''
    expect(gitignore).not.toMatch(/^firebase\.ts$/m)
    expect(existsSync(join(ROOT, 'firebase.ts'))).toBe(true)
  })

  // A genuine reproduction of this failure mode -- temporarily removing
  // firebase.ts and re-running tsc -b to watch it fail -- was tried here and
  // reverted: this suite's test FILES run in parallel worker processes, and
  // several other files (`routes.test.tsx`, `socketHandlers.test.ts`, ...)
  // import firebase.ts at collection or module-load time. Removing the file
  // from disk while those workers are live is a genuine race that broke
  // unrelated tests, not a simulation of the failure mode -- it *became* the
  // failure mode, for the whole suite, nondeterministically. The reproduction
  // was instead done once, by hand, outside the test run: renaming
  // firebase.ts aside and running `npx tsc -b --force` reliably fails with
  // "Cannot find module '../../firebase'" in api/http.ts, api/socket.ts and
  // AuthContext.tsx, confirming the mechanism this static check guards.
})

// ---------------------------------------------------------------------------
// AC 10: firebase.ts is tracked, at the repository root
// ---------------------------------------------------------------------------

describe('AC 10: firebase.ts is present in a clean checkout, at the repository root', () => {
  it('git ls-files includes exactly "firebase.ts" (not src/firebase.ts)', () => {
    const output = execFileSync('git', ['ls-files', 'firebase.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(output).toBe('firebase.ts')
  })

  it('src/ has no committed firebase.ts of its own to import instead', () => {
    const output = execFileSync('git', ['ls-files', 'src/firebase.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(output).toBe('')
  })

  it('the three importers reach it as "../../firebase", per §4.2', () => {
    for (const file of ['src/auth/AuthContext.tsx', 'src/api/socket.ts', 'src/api/http.ts']) {
      const source = readRoot(file)
      expect(source).toMatch(/from ['"]\.\.\/\.\.\/firebase['"]/)
    }
  })

  it('there are no VITE_FIREBASE_* variables anywhere -- the config is literals in firebase.ts', () => {
    const envExample = readRoot('.env.example')
    expect(envExample).not.toMatch(/VITE_FIREBASE_/)

    const firebaseTs = readRoot('firebase.ts')
    expect(firebaseTs).not.toMatch(/import\.meta\.env/)
    expect(firebaseTs).toMatch(/apiKey/)
  })

  it('the real, non-Firebase build-time variables are documented in .env.example', () => {
    const envExample = readRoot('.env.example')
    expect(envExample).toMatch(/VITE_API_BASE_URL/)
    expect(envExample).toMatch(/VITE_SOCKET_URL/)
  })
})

// ---------------------------------------------------------------------------
// AC 11, AC 17: the SPA rewrite
// ---------------------------------------------------------------------------

interface FirebaseHostingConfig {
  hosting: {
    site?: string
    public: string
    ignore?: string[]
    rewrites?: Array<{ source: string; destination: string }>
  }
}

function readFirebaseJson(): FirebaseHostingConfig {
  return JSON.parse(readRoot('firebase.json')) as FirebaseHostingConfig
}

/**
 * Firebase Hosting's rewrite-source glob, just enough of it: `**` is the
 * catch-all form used here and matches any path.
 */
function matchesRewriteSource(source: string, path: string): boolean {
  if (source === '**') return true
  const pattern = source
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*(?!\.)/g, '[^/]*')
  return new RegExp(`^${pattern}$`).test(path)
}

describe('AC 11 / AC 17: firebase.json declares the SPA rewrite', () => {
  const config = readFirebaseJson()

  it('AC 11: public is still "dist", and a rewrite to index.html exists', () => {
    expect(config.hosting.public).toBe('dist')
    expect(Array.isArray(config.hosting.rewrites)).toBe(true)
    const catchAll = config.hosting.rewrites?.find((r) => r.source === '**')
    expect(catchAll?.destination).toBe('/index.html')
  })

  it('the owner-created site and ignore list are untouched by the amendment', () => {
    expect(config.hosting.site).toBe('beersim')
    expect(config.hosting.ignore).toEqual(
      expect.arrayContaining(['firebase.json', '**/.*', '**/node_modules/**']),
    )
  })

  it('AC 17: a deep path such as /results/ABC123 resolves to index.html, not a 404', () => {
    const rewrites = config.hosting.rewrites ?? []
    const match = rewrites.find((r) => matchesRewriteSource(r.source, '/results/ABC123'))
    expect(match, 'no rewrite in firebase.json matches a deep link').toBeDefined()
    expect(match?.destination).toBe('/index.html')

    for (const deepPath of ['/host/ABC123', '/join/ABC123', '/profile']) {
      const matched = rewrites.some((r) => matchesRewriteSource(r.source, deepPath))
      expect(matched, `${deepPath} has no matching rewrite`).toBe(true)
    }
  })

  it('the matcher is not vacuous: an unmatched literal source only matches itself', () => {
    expect(matchesRewriteSource('/health', '/results/ABC123')).toBe(false)
    expect(matchesRewriteSource('/health', '/health')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// .firebaserc is untouched
// ---------------------------------------------------------------------------

describe('the owner-created .firebaserc is not touched', () => {
  it('still names the beery-30d23 project as default', () => {
    const rc = JSON.parse(readRoot('.firebaserc')) as { projects?: { default?: string } }
    expect(rc.projects?.default).toBe('beery-30d23')
  })
})

// ---------------------------------------------------------------------------
// AC 12 (frontend half), failure mode 7: DEPLOY.md
// ---------------------------------------------------------------------------

describe('AC 12: DEPLOY.md states the ship-together rule', () => {
  const deploy = readRoot('DEPLOY.md')

  it('names the socket handler module and the same-window, backend-first rule', () => {
    expect(deploy).toMatch(/socketHandlers\.ts|sockets\/handlers/)
    expect(deploy.toLowerCase()).toMatch(/same window/)
    expect(deploy.toLowerCase()).toMatch(/backend first/)
  })

  it('failure mode 7: documents that VITE_SOCKET_URL in production is the Render host, never the Hosting origin', () => {
    expect(deploy).toMatch(/VITE_SOCKET_URL/)
    const match = deploy.match(/VITE_SOCKET_URL\s*[=:]\s*(\S+)/)
    expect(match, 'DEPLOY.md does not give an example VITE_SOCKET_URL value').not.toBeNull()
    const exampleValue = match?.[1] ?? ''
    expect(exampleValue).not.toMatch(/web\.app/)
    expect(deploy).toMatch(/beersim\.web\.app/) // named as the thing NOT to point at
  })
})

// ---------------------------------------------------------------------------
// Failure mode 7, enforced: the deploy build refuses an unconfigured backend
// ---------------------------------------------------------------------------

describe('failure mode 7: a deploy build cannot ship without the backend URLs', () => {
  it('both workflows pass the repository variables AND arm the guard', () => {
    for (const text of [MERGE_WORKFLOW(), PR_WORKFLOW()]) {
      expect(text).toContain('vars.VITE_API_BASE_URL')
      expect(text).toContain('vars.VITE_SOCKET_URL')
      // Without this the variables being unset is silent: Vite substitutes
      // empty strings, the build is green, and the deployed bundle points at
      // the Hosting origin, which does not proxy WebSocket upgrades.
      expect(text).toMatch(/REQUIRE_BACKEND_ENV:\s*'1'/)
    }
  })

  it('vite.config.ts fails the build on an empty or Hosting-origin value', () => {
    const config = readRoot('vite.config.ts')
    expect(config).toContain('REQUIRE_BACKEND_ENV')
    expect(config).toMatch(/VITE_API_BASE_URL/)
    expect(config).toMatch(/VITE_SOCKET_URL/)
    expect(config).toMatch(/web\\\.app/)
  })

  it('the guard is opt-in, so a plain `npm run build` still works on the dev proxy', () => {
    // routes.test.tsx's toolchain gate runs `npm run build` with no
    // environment at all; that must stay green.
    const config = readRoot('vite.config.ts')
    expect(config).toMatch(/process\.env\.REQUIRE_BACKEND_ENV !== '1'/)
  })
})
