# Deploying Beery_Frontend

Static hosting on Firebase (`00-decisions.md` D17). See
`docs/plan/23-deployment-and-ci.md` for the full specification this file
implements.

## Topology

```
Browser --HTTPS--> Firebase Hosting (site: beersim, project: beery-30d23)  -- static, dist/
Browser --HTTPS--> Render: Beery_Backend  (/api/v1/*)
Browser --WSS----> Render: Beery_Backend  (/socket.io)  -- direct, NOT via Hosting
```

Production is `https://beersim.web.app`. Firebase Hosting does **not** proxy
WebSocket upgrades, so `VITE_SOCKET_URL` must point directly at the Render
backend host in production, e.g. `https://beery-backend.onrender.com` --
**never** `https://beersim.web.app`.

## Build and deploy

`npm run build` -> `dist/`, then `firebase deploy --only hosting`. In CI, both
`.github/workflows/firebase-hosting-merge.yml` (push to `main`) and
`firebase-hosting-pull-request.yml` (PRs, preview channel) run, in order:
`actions/setup-node` (reading `.nvmrc`), `npm ci`, `tsc -b`, `eslint .`,
`vitest run`, `npm run build`, then the owner-created
`FirebaseExtended/action-hosting-deploy` step.

`firebase.json` declares `public: "dist"` and a catch-all SPA rewrite to
`/index.html`, so a deep link -- `/results/:roomCode`, `/host/:roomCode`,
`/join/:roomCode`, `/profile` -- resolves on a hard load or a shared URL
instead of 404ing (Hosting otherwise looks for a literal file at that path).

## Environment (build-time, `VITE_*`)

```
VITE_API_BASE_URL=https://beery-backend.onrender.com
VITE_SOCKET_URL=https://beery-backend.onrender.com
VITE_BOARD_VIEW=2D          # optional; '2D' or '3D', read by GameRoomPlaying
```

These are read at **build time** by Vite. A change needs a rebuild and a
redeploy, not a restart. In CI they are supplied as repository variables
(`vars.VITE_API_BASE_URL`, `vars.VITE_SOCKET_URL`) on the `npm run build`
step of both workflows.

**There are no `VITE_FIREBASE_*` variables and there must not be.** The
Firebase web config is literals in `firebase.ts`, at the repository root
(not under `src/`), imported as `'../../firebase'` by `AuthContext.tsx`,
`api/socket.ts` and `api/http.ts`. It is deliberately committed: those values
are public identifiers that ship in the bundle to every visitor regardless,
and gitignoring the file while `src/` imports it is exactly the failure that
stops CI from building the frontend at all (see failure mode 1 below).

## The shared wire protocol -- ship together

Every Socket.IO event name and payload in `src/api/socketHandlers.ts` is a
contract with a specific, separately deployed version of `Beery_Backend`. An
old frontend against a new backend means nobody can play.

**When a change touches `src/api/socketHandlers.ts` or the backend's
`app/sockets/handlers/`, deploy `Beery_Backend` and `Beery_Frontend` in the
same window, backend first.**

## Deploy checklist (frontend-relevant subset)

- [ ] Frontend and backend deployed from the same commit window (see above).
- [ ] CI built the frontend -- confirm the Hosting release timestamp moved.
- [ ] `VITE_SOCKET_URL` points directly at the backend host, **not** at
      `beersim.web.app` or any other Hosting origin.
- [ ] A deep link, e.g. `https://beersim.web.app/results/ABC123`, loads
      instead of 404ing.
- [ ] Smoke test: sign in, create a room, join from a second browser, play a
      full week, finish a game -- both as a signed-in user and as a guest.
- [ ] `git ls-files firebase.ts` still reports the file tracked at the
      repository root -- gitignoring it silently breaks CI's ability to
      build (failure mode 1).
- [ ] Secrets: `.env` not committed.

## Failure modes this guards against

- **The frontend never deploys** (failure mode 1): CI checks out the
  repository clean and runs `npm ci && npm run build`; any file imported
  from `src/` that is not committed -- most importantly `firebase.ts` -- fails
  the build. This is the exact failure the sibling Tequila project shipped:
  `firebase.ts` gitignored while three modules imported it, so the backend
  kept auto-deploying on push while the frontend silently never did again.
- **WebSocket through Hosting**: pointing `VITE_SOCKET_URL` at
  `beersim.web.app` instead of the Render host breaks every real-time
  feature, because Firebase Hosting does not proxy WebSocket upgrades.
