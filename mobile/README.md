# AsyncForge Mobile

An Expo (SDK 57) React Native client for the AsyncForge pipeline. It talks to
the **same** Next.js API the web frontend uses — `POST /api/analyze` and
`GET /api/status/:jobId`. Nothing in `dispatcher/`, `worker/`, RabbitMQ or
Prisma is aware this client exists.

## Running it

The app needs the Next.js API reachable from the device, so start that first:

```bash
# from the repo root
pnpm dev
```

You do not need to configure anything for local development. `EXPO_PUBLIC_API_URL`
is left unset in `.env`, and the app derives the API host from Metro's own
address (`Constants.expoConfig.hostUri`) — the bundler and the API run on the
same machine, so whatever host the device used to load the bundle also reaches
the API. A LAN address that changes between sessions fixes itself.

This replaced a hardcoded LAN IP, which broke within an hour of being written
when DHCP handed out a different address.

To point at a real deployment, set it explicitly:

```
EXPO_PUBLIC_API_URL=https://asyncforge.example.com
```

Expo inlines `EXPO_PUBLIC_*` values at bundle time, so after editing `.env` you
need to restart Metro and fully reload the app, not just Fast Refresh.

```bash
cd mobile
npm start          # then press i / a, or scan the QR code with Expo Go
```

## Layout

```
src/
  app/
    _layout.tsx        Stack navigator + React Query provider
    index.tsx          Prompt submission
    jobs/[jobId].tsx   Status polling and result rendering
  components/ui.tsx    Card / Button / Badge — the neobrutalist shell
  lib/
    config.ts          API base URL resolution, timeouts, poll interval
    types.ts           Zod schemas mirroring the backend contract
    api.ts             fetch wrapper with timeouts and typed errors
  theme.ts             Palette shared conceptually with the web frontend
```

## Notes on a few deliberate choices

**Polling is handled by React Query, not `setInterval`.** The web build's
`app/jobs/[jobId]/page.tsx` polls every 2s with a manual interval. On a phone
that is worse than untidy — it keeps firing while the app is backgrounded. The
`refetchInterval` here returns `false` once a job is terminal, and `_layout.tsx`
wires `AppState` into React Query's `focusManager` so polling pauses when the
app is not in the foreground.

**`job.output` is validated before it is rendered.** It is a free-form JSON
column filled from an LLM response, and `lib/gemini.ts` only constrains the shape
by prompt. A malformed payload degrades to an "unreadable result" card rather
than crashing the screen.

**`metro.config.js` disables hierarchical module resolution.** The repo root is
a Next.js app with its own `node_modules` (React 18, Next, Prisma). Without
this, any dependency missing from `mobile/node_modules` would silently resolve
against the web app's tree — including a second copy of React.

**Types are duplicated, not shared.** `src/lib/types.ts` mirrors
`prisma/schema.prisma`, `lib/gemini.ts` and the `select` in
`app/api/status/[jobId]/route.ts` by hand. Extracting a shared package would mean
restructuring the repo into a workspace and updating the Dockerfiles, k8s
manifests and CI that are keyed to the current paths — not worth it for ~30
lines. If they start drifting, that is the signal to do it properly.

## Not done yet

The API has no authentication. Shipping this app makes `/api/analyze` a public,
unmetered proxy to the Gemini key, and `/api/status/:jobId` will return any job to
anyone holding an id. Adding a `userId` to `Job`, scoping the status query, and
rate limiting `/api/analyze` should land before this goes anywhere real.
