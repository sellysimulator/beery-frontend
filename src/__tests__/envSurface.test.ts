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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// The only three.js this suite loads. `24 §8.1` keeps `Board3D.test.tsx` off
// the renderer because jsdom has no WebGL; a GLB container needs neither a
// canvas nor a GL context to parse, and the asset contracts below are exactly
// the ones no `SceneModel` assertion can reach.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

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

// ---------------------------------------------------------------------------
// `24-frontend-3d-board.md` §6.1, §8.3, AC 20: the shipped GLB payload
// ---------------------------------------------------------------------------

/**
 * Section 24's four meshes are configuration in exactly this file's sense:
 * they are committed files that nothing imports, so no application test can
 * notice them going missing. A `.glb` that is gitignored, or excluded by
 * Firebase Hosting's `ignore` list, is a file that builds green locally and
 * 404s in the classroom -- the same shape as failure mode 1 above, where
 * `firebase.ts` was gitignored while `src/` imported it.
 *
 * The filesystem, not `git ls-files`: these five arrive as new files in the
 * same change as this test, so tracking is asserted the way it actually
 * matters -- by proving `.gitignore` does not match them -- rather than by
 * asking the index about files the index has not been told about yet.
 */
describe('24 §6.1 / AC 20: public/3dmodels ships four meshes, their credits, and no road', () => {
  /** §6.1's table, exactly. `road.glb` is deliberately not among them. */
  const SHIPPED = ['ATTRIBUTION.txt', 'box.glb', 'money.glb', 'person.glb', 'truck.glb']

  it('contains exactly the four .glb files and ATTRIBUTION.txt', () => {
    const dir = join(ROOT, 'public', '3dmodels')
    expect(existsSync(dir), 'public/3dmodels/ is missing entirely').toBe(true)
    expect(readdirSync(dir).sort()).toEqual(SHIPPED)
  })

  it('road.glb is not shipped: 8.1 MB for 30 triangles, 97.5% of it textures', () => {
    // §6.1 states the decision and the replacement: the floor is a procedural
    // plane and the roads are painted quads -- smaller, sharper and
    // role-tintable. A `road.glb` appearing here means somebody copied the
    // whole of Samby's asset folder.
    expect(existsSync(join(ROOT, 'public', '3dmodels', 'road.glb'))).toBe(false)
  })

  it('AC 20: ATTRIBUTION.txt carries the four CC-BY-4.0 credits, verbatim', () => {
    // CC-BY is an attribution licence; shipping the meshes without visible
    // credit is a licence breach, not a polish item. `ModelAttribution.tsx`
    // re-renders these same strings in the app, and `Board3D.test.tsx`
    // asserts that it does.
    const text = readRoot('public', '3dmodels', 'ATTRIBUTION.txt')
    for (const author of ['FLAREMEDIA', 'Arifido._', 'xtiborz095', 'Courvois']) {
      expect(text).toContain(author)
    }
    expect(text).toMatch(/CC-BY-4\.0|creativecommons\.org\/licenses\/by\/4\.0/)
    for (const file of ['box.glb', 'truck.glb', 'person.glb', 'money.glb']) {
      expect(text).toContain(file)
    }
  })

  it('.gitignore does not match public/3dmodels/, so a clean checkout has the meshes', () => {
    const gitignore = existsSync(join(ROOT, '.gitignore'))
      ? readFileSync(join(ROOT, '.gitignore'), 'utf8')
      : ''
    const patterns = gitignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))

    for (const pattern of patterns) {
      expect(pattern, `.gitignore rule "${pattern}" would drop the 3D assets`).not.toMatch(
        /3dmodels|^public\b|\*\.glb/,
      )
    }
  })

  it('firebase.json ignores nothing under 3dmodels, so /3dmodels/*.glb resolves to the file', () => {
    // Hosting serves static files before applying rewrites, so a `.glb` that
    // survives the ignore list resolves to the mesh and not to index.html.
    // `matchesRewriteSource` above speaks the same glob dialect the ignore
    // list does, so it is reused rather than copied.
    const ignore = readFirebaseJson().hosting.ignore ?? []
    for (const asset of ['3dmodels/box.glb', '3dmodels/ATTRIBUTION.txt', '3dmodels/truck.glb']) {
      for (const pattern of ignore) {
        expect(
          matchesRewriteSource(pattern, asset),
          `firebase.json ignore rule "${pattern}" excludes ${asset}`,
        ).toBe(false)
      }
    }

    // Not vacuous: the list really does still exclude what it is there for.
    expect(ignore.some((pattern) => matchesRewriteSource(pattern, 'firebase.json'))).toBe(true)
  })
})

/**
 * `24 §7.3` -- the claims `gltfModels.ts` is written against, asserted against
 * the shipped files.
 *
 * That module's header says its three decisions -- no decoder, no
 * `useAnimations`, plain `clone()` -- are *"verified against the files in
 * `public/3dmodels/`, not assumed"*, and its truck bake says the same of the
 * thirteen flat materials it folds into two meshes. Nothing was re-verifying
 * either: `24 §8.1` keeps `Board3D.test.tsx` on the `SceneModel` because jsdom
 * has no WebGL, so no test anywhere opened a `.glb`. A re-export that added a
 * texture, a Draco extension or a third emissive material would have been a
 * black truck, a blank scene or a silent decoder failure in a classroom.
 *
 * These read the container directly -- a GLB is a 12-byte header and a JSON
 * chunk -- so they need no loader and no WebGL. The one test that does need a
 * loader is the crate mesh's name, and it needs it precisely because the
 * loader is what changes the name.
 */
describe('24 §7.3: the shipped meshes still match what gltfModels.ts assumes', () => {
  /** The JSON chunk of a binary glTF 2.0 file. */
  function readGlb(name: string): {
    meshes: { name?: string; primitives: { attributes: Record<string, number>; material?: number; indices?: number }[] }[]
    materials?: {
      name?: string
      emissiveFactor?: number[]
      pbrMetallicRoughness?: { baseColorTexture?: unknown; metallicFactor?: number }
    }[]
    animations?: unknown[]
    skins?: unknown[]
    extensionsUsed?: string[]
    extensionsRequired?: string[]
    asset?: { extras?: Record<string, string> }
  } {
    const buffer = readFileSync(join(ROOT, 'public', '3dmodels', name))
    const jsonLength = buffer.readUInt32LE(12)
    return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
  }

  const ASSETS = ['box.glb', 'truck.glb', 'person.glb', 'money.glb']

  it.each(ASSETS)(
    '%s uses no extension, carries no animation and no skin (§7.3: no decoder is wired up)',
    (name) => {
      const gltf = readGlb(name)
      // `useGLTF(url)` is called with no second argument and `public/draco/` is
      // deliberately not shipped -- ~2 MB of decoder for compression that is
      // not there. A required extension here is that decision going stale.
      expect(gltf.extensionsRequired ?? [], `${name} requires an extension`).toEqual([])
      expect(gltf.extensionsUsed ?? [], `${name} uses an extension`).toEqual([])
      // Zero clips is why there is no `useAnimations`; zero skins is why
      // `Object3D.clone()` is enough and `SkeletonUtils.clone` is not needed.
      expect(gltf.animations ?? [], `${name} carries animation clips`).toEqual([])
      expect(gltf.skins ?? [], `${name} carries skins`).toEqual([])
    },
  )

  it.each(ASSETS)('%s keeps its asset.extras credit intact (AC 20)', (name) => {
    // CC-BY is an attribution licence, and `24 §6.1` forbids running these
    // files through any tool that strips `asset.extras`. `ATTRIBUTION.txt`
    // and `ModelAttribution.tsx` are the visible half of the same obligation;
    // this is the half inside the file, which is where a re-export loses it.
    const extras = readGlb(name).asset?.extras ?? {}
    expect(Object.values(extras).join(' ')).toMatch(/creativecommons\.org\/licenses\/by\/4\.0|CC-BY-4\.0/)
    expect(extras.author, `${name} lost its author credit`).toBeTruthy()
    expect(extras.source, `${name} lost its source URL`).toBeTruthy()
  })

  it('truck.glb is still 33 flat-coloured primitives that merge into two meshes (§7.3)', () => {
    const gltf = readGlb('truck.glb')
    const primitives = gltf.meshes.flatMap((mesh) => mesh.primitives)
    const materials = gltf.materials ?? []

    // The numbers the bake's arithmetic is quoted in, and the numbers
    // `MODEL_DRAW_COST.truck` is 2 + 1 because of.
    expect(primitives).toHaveLength(33)
    expect(materials).toHaveLength(13)

    // `mergeGeometries` refuses parts whose attribute sets or indexed-ness
    // differ, and `addMerged` falls back to one mesh per part when it does --
    // silently turning two draw calls per truck into thirty-three, which is
    // the whole budget of AC 19 spent on two vehicles.
    const shapes = new Set(
      primitives.map(
        (primitive) =>
          `${Object.keys(primitive.attributes).sort().join('+')}|${primitive.indices === undefined ? 'noidx' : 'idx'}`,
      ),
    )
    expect(shapes.size, 'truck primitives no longer share one attribute set').toBe(1)

    // Exactly two lamps. A third emissive material would quietly join the
    // unlit `MeshBasicMaterial` mesh and stop being lit by the hall; a lamp
    // that lost its `emissiveFactor` would have its light put out by the bake.
    const lamps = materials.filter((material) =>
      (material.emissiveFactor ?? [0, 0, 0]).some((channel) => channel > 0),
    )
    expect(lamps.map((material) => material.name).sort()).toEqual(['Material.003', 'Material.006'])

    // Every other material is a flat colour. A `baseColorTexture` cannot be
    // folded into a per-vertex `color` attribute, so one appearing here means
    // the bake is painting a textured surface a single colour.
    for (const material of materials) {
      expect(
        material.pbrMetallicRoughness?.baseColorTexture,
        `${material.name} gained a baseColorTexture; the vertex-colour bake cannot carry it`,
      ).toBeUndefined()
    }
  })

  it('`[HARD-WON]` box.glb\'s crate mesh is found under the name the LOADER gives it', async () => {
    // The trap this test exists for: `GLTFLoader` runs every node name through
    // `PropertyBinding.sanitizeNodeName`, which strips `. [ ] : /`, so the mesh
    // declared `Cube_10_Mat.3_0` reaches the scene graph as `Cube_10_Mat3_0`.
    // `extractCrateGeometry` matched the file's spelling and threw on every
    // pile in every seat -- straight into `Board3D`'s boundary and back to 2D.
    // Both halves are asserted, because the bug lives in the gap between them.
    const declared = 'Cube_10_Mat.3_0'
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(declared)
    expect(sanitized).not.toBe(declared)

    expect(readGlb('box.glb').meshes.map((mesh) => mesh.name)).toContain(declared)

    const buffer = readFileSync(join(ROOT, 'public', '3dmodels', 'box.glb'))
    // Copied into an `ArrayBuffer` of *this* realm: the loader tests
    // `instanceof ArrayBuffer`, and a Node `Buffer`'s own backing store comes
    // from the runner's realm rather than jsdom's, which fails that test and
    // is then read as JSON text.
    const bytes = new ArrayBuffer(buffer.byteLength)
    new Uint8Array(bytes).set(buffer)
    const loaded = await new Promise<{ scene: THREE.Object3D }>((resolve, reject) => {
      new GLTFLoader().parse(
        bytes,
        '',
        (gltf) => resolve(gltf as unknown as { scene: THREE.Object3D }),
        reject,
      )
    })

    const names: string[] = []
    let crate: THREE.Mesh | undefined
    loaded.scene.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        names.push(node.name)
        if (node.name === sanitized) crate = node as THREE.Mesh
      }
    })

    expect(names, 'the loader no longer sanitises the name; re-check gltfModels.ts').not.toContain(
      declared,
    )
    expect(crate, `box.glb has no mesh named ${sanitized}; found ${names.join(', ')}`).toBeDefined()
    // 24 §7.2: the 96-triangle box, not the 12-triangle one beside it.
    expect((crate?.geometry.index?.count ?? 0) / 3).toBe(96)

    // And the module looks the mesh up through the sanitiser rather than
    // through a second hardcoded spelling. Read, not imported: `gltfModels.ts`
    // starts all four fetches at module scope (§7.3), which is right in a
    // browser behind the lazy chunk and wrong in a test runner. This is the
    // wiring-read `Board3D.test.tsx` already uses for claims about a module
    // §8.1 forbids it to load.
    const source = readRoot('src', 'components', 'game', 'views', 'board3d', 'gltfModels.ts')
    expect(source, 'gltfModels.ts no longer sanitises the crate mesh name').toMatch(
      /sanitizeNodeName/,
    )
    expect(source).toMatch(/CRATE_MESH_NAME_AS_LOADED/)
  })
})
