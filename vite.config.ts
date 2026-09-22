import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** The build-time variables a deployed bundle cannot work without. */
const REQUIRED_BACKEND_VARS = ['VITE_API_BASE_URL', 'VITE_SOCKET_URL'] as const

/** Hosting origins: correct for the app, never correct for the backend. */
const HOSTING_ORIGIN = /web\.app|firebaseapp\.com/

/**
 * Fails the build when the backend URLs are missing or point at the Hosting
 * origin — but only when `REQUIRE_BACKEND_ENV=1`, which the two deploy
 * workflows set on their build step.
 *
 * `.env` is gitignored, so CI has these values only if the repository
 * variables are set. When they are not, Vite substitutes empty strings and
 * the build still succeeds: the bundle then asks the Hosting origin for
 * everything. REST survives that by accident — the `**` rewrite answers 200
 * with `index.html` — while the socket cannot, because Firebase Hosting does
 * not proxy WebSocket upgrades (DEPLOY.md, failure mode 7). Every real-time
 * feature then fails with "Could not reach the game server" on a deploy whose
 * own CI run was green. This turns that into a red build.
 *
 * It is opt-in rather than always-on because `npm run build` also runs with
 * no environment at all — in `routes.test.tsx`'s toolchain gate, and for
 * anyone building locally against the dev proxy, where empty is correct.
 */
function requireBackendEnv(env: Record<string, string>): Plugin {
  return {
    name: 'beery:require-backend-env',
    apply: 'build',
    buildStart() {
      if (process.env.REQUIRE_BACKEND_ENV !== '1') return

      const problems = REQUIRED_BACKEND_VARS.flatMap((key) => {
        const value = (env[key] ?? '').trim()
        if (!value) return [`${key} is empty — set the repository variable vars.${key}.`]
        if (HOSTING_ORIGIN.test(value))
          return [`${key} is ${value}, a Hosting origin. It must be the backend host.`]
        return []
      })

      if (problems.length > 0) {
        this.error(
          'Refusing to build a deploy bundle with no backend configured:\n' +
            problems.map((p) => `  - ${p}`).join('\n') +
            '\nSee DEPLOY.md, "Environment".',
        )
      }
    },
  }
}

/**
 * Fails the build when the entry HTML's import graph reaches the `three` chunk
 * — 24 AC 4, enforced instead of trusted.
 *
 * AC 4 says `three` may appear in NO chunk the entry HTML loads. That holds
 * only while every package in drei's and fiber's transitive tree is caught by
 * `manualChunks` above. It is a list of names, and a `npm update` that adds one
 * more transitive dependency breaks it silently: the new package falls through
 * to `vendor`, `vendor` imports `three`, and Vite emits a `modulepreload` for
 * the whole WebGL bundle on the login screen. Nothing fails. The only symptom
 * is a megabyte in the network tab of a player who chose the 2D board.
 *
 * So the criterion is checked here, against the emitted bundle, the same way a
 * human would check it: walk the entry chunk's imports transitively and look
 * for `three`. Rollup's own "Circular chunk" message is a warning and warnings
 * scroll past.
 */
function forbidThreeInEntryGraph(): Plugin {
  return {
    name: 'beery:forbid-three-in-entry-graph',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle).filter(
        (c): c is Extract<typeof c, { type: 'chunk' }> => c.type === 'chunk' && c.isEntry,
      )

      for (const entry of entries) {
        // Static imports only: `modulepreload` and the entry's own `import`
        // statements are what "the entry HTML loads" means. A dynamic import is
        // exactly the lazy fetch this whole arrangement exists to produce.
        const seen = new Set<string>()
        const queue = [...entry.imports]
        const path = new Map<string, string>(entry.imports.map((f) => [f, entry.fileName]))

        while (queue.length > 0) {
          const fileName = queue.shift() as string
          if (seen.has(fileName)) continue
          seen.add(fileName)

          const chunk = bundle[fileName]
          if (!chunk || chunk.type !== 'chunk') continue

          if (chunk.name === 'three') {
            const chain: string[] = [fileName]
            let cursor = path.get(fileName)
            while (cursor) {
              chain.unshift(cursor)
              cursor = path.get(cursor)
            }
            this.error(
              `24 AC 4 violated: the entry HTML loads the \`three\` chunk.\n` +
                `  ${chain.join(' -> ')}\n` +
                'A package in drei\'s or fiber\'s tree fell through to `vendor`. Add it to the\n' +
                '`three` bucket in `manualChunks` — see the comment there for how to find it.',
            )
          }

          for (const next of chunk.imports) if (!path.has(next)) path.set(next, fileName)
          queue.push(...chunk.imports)
        }
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  // Reads the .env files AND the prefixed variables already in process.env,
  // which is how the workflows pass them in.
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    plugins: [react(), tailwindcss(), requireBackendEnv(env), forbidThreeInEntryGraph()],
    build: {
      // The `three` chunk is large and that is expected: it is lazy, it is
      // never in the entry graph, and it is fetched only when a player asks
      // for the 3D board (24 §6.4, AC 4). The default 500 kB warning would
      // fire on every build and train everyone to ignore it, which costs more
      // than it catches.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          /**
           * Splits the dependencies into chunks that change at different rates.
           *
           * One chunk meant the browser parsed every library before the first
           * paint and re-downloaded all of them whenever a single line of app
           * code changed. Split, they are fetched in parallel, parsed as
           * separate units, and a deploy that touches only `src/` leaves every
           * vendor chunk in the HTTP cache.
           *
           * The groupings follow what a screen needs together, not what npm
           * happens to name: `engine.io-client` is socket.io's transport and
           * `@firebase/*` is what `firebase` re-exports, so neither may fall
           * through to the generic bucket and be split away from its own entry
           * point.
           */
          manualChunks(id: string): string | undefined {
            // [HARD-WON] Vite's `__vitePreload` helper is a virtual module, so
            // it matches no `node_modules` rule below and Rollup is free to
            // place it. It chose the `three` chunk — the largest group that
            // uses it — and because `index.html`'s own lazy routes call the
            // helper too, the entry chunk then carried a bare
            // `import{_}from"./three-*.js"` and the whole WebGL bundle was
            // preloaded on the login screen. One tiny module, the entire 24
            // AC 4 guarantee. It belongs in `vendor`: already in the entry
            // graph, already imported by `three`, so nobody pays a request.
            if (id.includes('vite/preload-helper')) return 'vendor'
            if (!id.includes('node_modules')) return undefined
            if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase'
            if (/[\\/]node_modules[\\/](chart\.js|react-chartjs-2)[\\/]/.test(id)) return 'charts'
            if (/[\\/]node_modules[\\/](socket\.io-client|engine\.io-client|engine\.io-parser|socket\.io-parser)[\\/]/.test(id))
              return 'socket'
            // The 3D board's whole dependency tree, in one lazy chunk (24 §6.4).
            //
            // §6.4 prescribes the names it could see from the import statements
            // — `troika-three-text`, `troika-three-utils`, `troika-worker-utils`,
            // `bidi-js` and `webgl-sdf-generator` are drei `<Text>`'s SDF
            // pipeline, and `react-reconciler`, `its-fine` and `suspend-react`
            // are @react-three/fiber's. None of them is named `three` or
            // `@react-three`, so none would be caught by the obvious rule.
            //
            // [HARD-WON] That list is necessary and it is not sufficient. Drei
            // also pulls a second tier nothing in `src/` imports by name —
            // `three-stdlib`, `three-mesh-bvh`, `camera-controls`, `maath`,
            // `meshline`, `@monogrid/gainmap-js`, `@mediapipe/tasks-vision`,
            // `detect-gpu`, `stats-gl`, `stats.js`, `hls.js`, `tunnel-rat`,
            // `@use-gesture/*`, `@babel/runtime`, plus `react-use-measure` from
            // fiber and `potpack` from `three-stdlib`. Left to fall through,
            // they land in `vendor`; most of them import `three` themselves, so
            // `vendor` then imports the `three` chunk, Rollup reports
            // `Circular chunk: vendor -> three -> vendor`, and the entry HTML
            // emits a `modulepreload` for a megabyte of WebGL that a 2D player
            // never renders. The build stays green while AC 4 is broken, which
            // is why `forbidThreeInEntryGraph` below turns it red instead.
            //
            // Every name here was verified against the real module graph by its
            // importers, not guessed: each is reachable only through
            // `@react-three/*`. Anything genuinely shared must stay in `vendor`,
            // where both consumers reach it — `use-sync-external-store` is the
            // live example, wanted by `tunnel-rat` in this tree and by `zustand`
            // in the app's. `three` importing `vendor` is the harmless
            // direction; `vendor` importing `three` is the fatal one.
            //
            // `zustand` is deliberately NOT moved here. The app imports it
            // directly, so it belongs in `vendor`, where both consumers reach
            // it.
            if (
              /[\\/]node_modules[\\/](three|@react-three|troika-three-text|troika-three-utils|troika-worker-utils|bidi-js|webgl-sdf-generator|its-fine|suspend-react|react-reconciler)[\\/]/.test(id)
            )
              return 'three'
            if (
              /[\\/]node_modules[\\/](three-stdlib|three-mesh-bvh|camera-controls|maath|meshline|potpack|@monogrid[\\/]gainmap-js|@mediapipe[\\/]tasks-vision|detect-gpu|stats-gl|stats\.js|hls\.js|tunnel-rat|@use-gesture[\\/]core|@use-gesture[\\/]react|react-use-measure|@babel[\\/]runtime)[\\/]/.test(id)
            )
              return 'three'
            if (/[\\/]node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/.test(id)) return 'forms'
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
              return 'react'
            return 'vendor'
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': 'http://localhost:8080',
        '/socket.io': { target: 'http://localhost:8080', ws: true },
      },
    },
    test: { environment: 'jsdom', setupFiles: ['./src/__tests__/setup.ts'], globals: true },
  }
})
