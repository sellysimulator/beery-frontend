# Deploying Beery_Frontend

Static hosting on Firebase (D17 in `docs/beer-game-spec.md` §15).

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
`npm test`, `npm run build`, then the owner-created
`FirebaseExtended/action-hosting-deploy` step.

`firebase.json` declares `public: "dist"` and a catch-all SPA rewrite to
`/index.html`, so a deep link -- `/results/:publicId`, `/host/:roomCode`,
`/join/:roomCode`, `/profile` -- resolves on a hard load or a shared URL
instead of 404ing (Hosting otherwise looks for a literal file at that path).

It also serves `/3dmodels/**` with `Cache-Control: public, max-age=31536000,
immutable`. Hosting serves static files before the SPA rewrite, so the `.glb`
files are never rewritten to `index.html`. Because the cache is immutable, a
changed model must ship under a new filename, never overwrite the old one.

The other headers, the same as the catalog site's: `/assets/**` (Vite's
hashed bundles) immutable for a year; `/index.html` and every extensionless
path (`{"regex": "^/[^.]*$"}`, the SPA routes) `Cache-Control: no-cache`, so a
deploy is picked up on the next load; and on everything
`X-Content-Type-Options: nosniff` and `Referrer-Policy:
strict-origin-when-cross-origin`. There is deliberately no `X-Frame-Options`
or CSP: Firebase Auth's iframe and handler on this site could break. A tab
left open across a deploy that asks for a chunk the deploy removed reloads
once (`vite:preloadError` in `src/main.tsx`).

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

Set them under **Settings -> Secrets and variables -> Actions -> Variables**
(repository *variables*, not secrets -- they ship in the bundle anyway), or:

```
gh variable set VITE_API_BASE_URL --body https://beery-backend.onrender.com
gh variable set VITE_SOCKET_URL   --body https://beery-backend.onrender.com
```

`.env` is gitignored, so **CI never sees local values**: if the variables are
unset the build is still green and the bundle points at the Hosting origin.
Both workflows therefore set `REQUIRE_BACKEND_ENV: '1'` on the build step,
which makes `vite.config.ts` refuse to build when either variable is empty or
names a `web.app` / `firebaseapp.com` origin. A plain local `npm run build`
does not set the flag and keeps working against the dev proxy.

To confirm a deploy actually carries them, grep the live bundle:

```
curl -s https://beersim.web.app/assets/index-*.js | grep -c onrender.com
```

**There are no `VITE_FIREBASE_*` variables and there must not be.** The
Firebase web config is literals in `firebase.ts`, at the repository root
(not under `src/`), imported as `'../../firebase'` by `AuthContext.tsx`,
`api/socket.ts` and `api/http.ts`. It is deliberately committed: those values
are public identifiers that ship in the bundle to every visitor regardless,
and gitignoring the file while `src/` imports it is exactly the failure that
stops CI from building the frontend at all (see *Failure modes* below).

## The shared wire protocol -- ship together

Every Socket.IO event name and payload in `src/api/socketHandlers.ts` is a
contract with a specific, separately deployed version of `Beery_Backend`. An
old frontend against a new backend means nobody can play.

**When a change touches `src/api/socketHandlers.ts` or the backend's
`app/sockets/handlers/`, deploy `Beery_Backend` and `Beery_Frontend` in the
same window, backend first.**

**The handoff-hardening release (branch `fix/handoff-hardening`) ships backend
first, then the frontend in the same window.** The new backend accepts the old
frontend's signed-in and guest handshakes, but refuses one with no identity at
all, which the old frontend still sends on a first visit (no sign-in, no guest
id yet) and then shows a "Sign-in could not be verified" alert until the new
frontend is live; the new frontend never connects without an identity.

**A REST route the live frontend still calls is removed frontend first**, for the
same reason: the new frontend must stop calling it before the backend drops it.
The public_id-only results change (spec D22) is one: the previous frontend fetched
`GET /games/{room_code}/results`, which the backend no longer serves, while the new
frontend calls only routes the previous backend already had for its results flow
(`GET /games/id/{public_id}/results`, `/export`, `game_persisted`). The new profile
needs the new backend (`/users/me/hosted-games`, `/users/me/games/{public_id}`,
`public_id` on history rows, `best_game_public_id`), so deploy the backend right
after the frontend, in the same window: in between, only the profile's links and
its hosted list are degraded.

## Deploy checklist (frontend-relevant subset)

- [ ] Frontend and backend deployed from the same commit window (see above).
- [ ] CI built the frontend -- confirm the Hosting release timestamp moved.
- [ ] `VITE_SOCKET_URL` points directly at the backend host, **not** at
      `beersim.web.app` or any other Hosting origin.
- [ ] A deep link, e.g. a finished game's `https://beersim.web.app/results/<public_id>`,
      loads instead of 404ing.
- [ ] Smoke test: sign in, create a room, join from a second browser, play a
      full week, finish a game -- both as a signed-in user and as a guest.
- [ ] `git ls-files firebase.ts` still reports the file tracked at the
      repository root -- gitignoring it silently breaks CI's ability to
      build (see *Failure modes* below).
- [ ] Secrets: `.env` not committed.

## Failure modes this guards against

- **The frontend never deploys**: CI checks out the
  repository clean and runs `npm ci && npm run build`; any file imported
  from `src/` that is not committed -- most importantly `firebase.ts` -- fails
  the build. This is the exact failure the sibling Tequila project once
  shipped (since fixed): `firebase.ts` gitignored while three modules imported
  it, so the backend kept auto-deploying on push while the frontend silently
  never did.
- **WebSocket through Hosting**: pointing `VITE_SOCKET_URL` at
  `beersim.web.app` instead of the Render host breaks every real-time
  feature, because Firebase Hosting does not proxy WebSocket upgrades.
