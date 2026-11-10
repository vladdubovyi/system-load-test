# BreakIT Collaborative Rooms — MVP Product Spec

Status: **v4, approved for implementation** (2026-11-06). Q1, Q8 and Q9
decided; the remaining items in §11 follow the recommendations unless
revisited.
Owner: Vlad
Last updated: 2026-11-06
Supersedes v3 (2026-11-06), v2 (2026-11-03) and v1 (2026-11-02). v1
positioned BreakIT as a paid, multi-tenant interview platform with accounts,
email invites and a durable candidate log; that direction is parked in §10.

**Changes in v4** (owner review, 2026-11-06):
- **No database.** The MVP runs without PostgreSQL. The challenge catalog
  is served from memory (§2.3), and Identity, EF Core and the
  scenario-config PUT leave the build.
- **Rooms are private and joinable by link or by a typed code** (§3.2).
- **Terms-of-use line** next to the privacy note (§2.4).
- **Delivered in full**, so the phasing table is replaced by a build order
  (§9).
- **Hosting is TBD.** The spec states requirements only (§5.1).
- **Sync and runs redesigned.** Sync uses per-entity merges (§5.2), which
  also makes undo safe with two editors. Run controls are tick-stamped room
  events (§4.4).
- **Unedited seeded scenarios get a host-side warning** in interview mode
  (§6.1).
- Removed: the production-data purge (there is no production data) and the
  dependency on `pass-through-telemetry.md`, which does not exist (§11 Q8).

## 1. Positioning

**MVP:** a free, anonymous collaboration tool. Anyone opens a scenario,
clicks **Share**, and gets a link and a short room code. Whoever opens the
link or types the code is on the same canvas, live. No sign-up, no email,
no name. The room disappears when everyone leaves.

**Interview features ship in the MVP as room settings, not as a product
tier.** The person who created the room (the *host*) can switch it into
interview mode, which hides the scenario's flows, objectives and thresholds
from everyone else. The host can also hold or hand over the pen, fix the
traffic seed, toggle the design-time lint, control the run, and decide when
the other side sees the report. Every one of these is set on the spot and
lasts only as long as the room. There are no saved presets, no per-host
defaults, and no database to put them in.

Two rules govern the whole document:

> **The zero-personal-data rule.** The MVP stores no personal data,
> anywhere, for any duration. No email, no name, no account, no password,
> no notes about a person. §2 defines this precisely.

> **The integrity rule.** In interview mode, the scenario's flows,
> objectives and thresholds are withheld from non-host clients by the
> server, not hidden by the UI (§6). §6.1 and §6.2 state where this is
> weaker than it sounds.

The integrity rule concerns **rooms in interview mode only**. The solo
sandbox and the public scenario library stay fully readable. `#btn-scenario`
(`src/ui/floating-toolbar.ts:56`) showing the whole scenario document is
correct for solo use.

### What already exists

- A validated simulation engine with flows, objectives, a capability model,
  design-time lint and per-request tracing (120 unit and 85 e2e tests as of
  `95f7c1c`). It
  advances in fixed `1/60` s ticks (`sandbox-app.ts:147`, `:1381-1385`) and
  calls no transcendental `Math` functions, which makes cross-client
  determinism (§8) practical.
- A scenario editor with two paths. **Apply** is a session-only, client-side
  override. **Save** is a PUT to the backend that requires sign-in. Apply is
  exactly the "configure on the spot" behaviour the MVP needs. Save goes
  away (`src/ui/scenario-editor.ts:44`).
- Undo/redo built on full board snapshots (`HistoryEntry`,
  `src/sandbox/sandbox-app.ts:141`). Board annotations (free text and
  strokes) are separate state (`sandbox-app.ts:97`) and are not in
  `HistoryEntry`. Undo is already blocked while a run is in progress
  (`sandbox-app.ts:1538`).
- A backend whose only real job is serving the challenge catalog out of
  PostgreSQL. The catalog is seeded from C#
  (`Data/Seed/ChallengeSeeder.cs`, `Data/Seed/FlowDefinitions.cs`) on every
  startup. The database adds nothing the seed source doesn't already have.
- ASP.NET Identity with email, Google OAuth and JWT. The frontend stores the
  JWT and a serialized user object, including the email, in `localStorage`
  (`src/auth/auth-store.ts:3`). **All of this is personal data and is out of
  the MVP** (§2.3).

### What does not exist

Real-time transport. The MVP backend is the six read-only catalog GETs
(challenges ×3, components ×2, health), served from memory, plus one
SignalR hub.

## 2. The zero-personal-data rule

"Anonymous" is easy to claim and easy to break by accident. This section is
the checklist.

**Definition.** For this spec, *personal data* is anything that identifies a
person or that a person writes about themselves or someone else: emails,
names, passwords and hashes, OAuth identities, avatars, and free-text notes.
Network metadata (IP address, user agent) is out of scope. It gets standard
handling and is not a design constraint.

### 2.1 What we never collect

| Category | Today | MVP stance |
|---|---|---|
| Accounts, email, OAuth identity | `AuthController`, Identity, Google Sign-In script (`src/views/login-page.ts:37`). | None. Removed from the frontend and from the backend build (§2.3). |
| Display names | Account `DisplayName`. | Auto-generated per connection ("Blue Heron") and not editable. Free-text names invite real names. |
| Free text about a person | — | Host notes stay **in the host's tab only**: never sent to the server, never written to storage, lost on refresh unless exported (§4.5). |
| User-generated board content | — | Annotations, component labels and scenario text are content, not data about a person. They are held in server memory for the life of the room (§3.4) and **never logged** (§7). |
| Network metadata (IP, user agent) | Standard framework handling. | Out of scope of the rule. Used as-is for rate limiting (§7) and may appear in standard platform logs. |
| Cookies and browser storage | `sds_auth_token` (a JWT) and `sds_auth_user` (includes email) in `localStorage`. | **The MVP writes nothing** to cookies, `localStorage` or `sessionStorage`. Nothing needs it: the host secret lives in the URL (§3.2), and preferences are not persisted. Legacy keys: §11 Q7. |
| Application logs | `ChallengesController.cs:211` logs `"updated by {Email}"` on scenario save. | Gone with the endpoint (§2.3). Logs may never contain emails, host secrets or message payloads (board content, notes, scenario text). |
| Deployment config | `CHALLENGE_AUTHORS`, an email allowlist. | Gone with the endpoint. |
| Server-side storage | PostgreSQL: challenges, plus Identity tables for users. | **None.** No database, no file writes. Rooms, boards and runs live in process memory (§3.3). |
| Analytics | None. | None (§11 Q5). |

### 2.2 What makes a room identifiable, and why it isn't personal

A room has a random internal ID, a short join code and a host secret (§3.2).
None of these identifies a person. A room's participant list is a set of
connection IDs and generated names. People sharing a room know each other
out of band, which is the whole point, but the server does not know who any
of them are.

### 2.3 Removing the account surface and the database

**Backend: what leaves the build**
- `AuthController`, `JwtTokenService`, `ApplicationUser`, the Identity and
  JWT-bearer registrations, `AuthDtos`.
- `ApplicationDbContext`, the migrations, the `DATABASE_URL` parsing in
  `Program.cs`, and the EF Core / Npgsql / Identity package references.
- `PUT /api/challenges/slug/{slug}/scenario-config`, `IsAuthor()`,
  `CurrentEmail()`, `CHALLENGE_AUTHORS`.
- `UnmappedControllers.cs`, which existed to keep a compiled
  `AuthController` unreachable. Deleted with it (§11 Q1).

**Backend: what replaces the database**
- An `IChallengeCatalog` singleton is built once at startup from the
  existing seed source (`ChallengeSeeder` content and `FlowDefinitions`).
  It exposes the same records the controllers read today. The seed is
  refactored from "write to a `DbContext`" to "return records". The data
  itself does not change.
- `ChallengesController` and `ComponentsController` read from the catalog.
  **The HTTP response shapes do not change**, so the frontend's
  `src/api/client.ts` needs no changes for catalog reads.
- Authoring a seeded scenario means editing the seed source and
  redeploying. Hosts edit scenarios on the spot in rooms (§4.1), which
  needs no write endpoint.

**Frontend**
- Remove the `/login` route (`src/router.ts:18`), `login-page.ts`, the
  sign-in chrome in `app-shell.ts`, `src/auth/`, `restoreAuthSession`
  (`src/main.ts:85`), the `Authorization` header (`src/api/client.ts:62`),
  and the `register` / `login` / `googleLogin` / `getCurrentUser` /
  `saveScenarioConfig` client methods.
- Remove `canSave` and the Save button from the scenario editor
  (`sandbox-app.ts:744`, `scenario-editor.ts:20-57`).
- `e2e/flow-authoring.spec.ts:158` (*"Save is disabled when signed out"*)
  becomes *"Save does not exist"*. `e2e/auth.spec.ts` is deleted.

### 2.4 Privacy note and terms of use

A short block (`#privacy-note`) on the landing page, written from the table
above so the claim can be checked against behaviour:

> **Privacy.** No account, nothing saved in your browser, and nothing you
> type is stored. Rooms live in memory and disappear shortly after everyone
> leaves. Our hosting provider keeps standard access logs.
>
> **Terms.** BreakIT is free and provided as-is. Rooms are private and
> temporary, and we cannot recover them. Don't use rooms for unlawful or
> abusive content.

In interview mode, the integrity note from §6.2 appears in the host's room
menu.

### 2.5 Guard tests

The rule is only as good as the tests that fail when it breaks. These are
in place and green as of build step 1 (§9):

- `backend/SystemDesignSimulator.Api.Tests/AnonymousMvpTests.cs`: every
  `/api/auth/*` route is 404; the scenario-config PUT is 404/405; a bearer
  token changes nothing; no authentication scheme is registered and no EF
  Core, Identity, JWT or Npgsql assembly is loaded; the public GETs stay
  anonymous.
- `backend/SystemDesignSimulator.Api.Tests/CatalogTests.cs`: the in-memory
  catalog serves the same four challenges, flows, objectives and
  capabilities the database did, with IDs that are identical on every
  start.
- `e2e/anonymous.spec.ts`: no `/login`, no identity in the header, privacy
  and terms present, no `/api/auth/*` call on any route, no
  `Authorization` header, nothing in storage after a full session, and the
  two keys an older build wrote are deleted on boot (§11 Q7).
- `e2e/flow-authoring.spec.ts`: *Save does not exist*; Apply works and
  sends nothing.
- `e2e/real-api.spec.ts`: against the real API, the account routes and
  the PUT are gone.
- Still to add, with rooms: the hub log-redaction test (§7).

## 3. Rooms

### 3.1 Lifecycle

1. A user opens any scenario in the sandbox, as today.
2. They click **Share**. The tab opens a hub connection. The server creates
   a room and returns a join code and a host secret, and the tab becomes
   host. The Share dialog shows the participant link, the code, and the
   host link with a copy button and the warning "Keep this to get back in
   as host."
3. The user sends the link or the code out of band. We send nothing.
4. Participants open the link, or type the code into **Join a room**, and
   land in the room with the current board.
5. The room lives while anyone is connected, plus a grace period (§3.4).
   Then it is gone, including its board and runs.

### 3.2 Private rooms, links and codes

**Every room is private.** There is no public option, no listing, no search
and no directory. The only ways in are the participant link, the join code
and the host link.

| Credential | Form | Grants |
|---|---|---|
| **Join code** | 8 characters of Crockford base-32, displayed `K7QM-2XRD` (40 bits) | Participant |
| **Participant link** | `{site}/#join=K7QM-2XRD` | Participant. Same as the code. |
| **Host link** | `{site}/#host={hostSecret}`, where the secret is 128-bit random, base64url | Host |

- **The code and the link are the same credential.** The link is a
  convenience wrapper around the code.
- **Join a room** is a field on the landing page, the challenges page and
  the sandbox header. It accepts a code or a pasted link and extracts the
  code from either. Input is case-insensitive, and spaces and dashes are
  ignored. Crockford decoding maps `O→0` and `I`/`L→1`, so codes read
  aloud over a call still work.
- **Unknown, expired and rotated codes** all get the same message:
  "No room with that code." That does not reveal whether a room ever
  existed.
- **Why the fragment.** It works on any static host without SPA-fallback
  configuration (cold-loading a deep path such as `/room/x` 404s on GitHub
  Pages today). It also keeps the host secret, which is a credential, out
  of every server log.
- **How credentials reach the server.** The client sends the code or the
  secret in a hub invocation (`JoinByCode(code)` or `JoinAsHost(secret)`)
  after the connection is up. Do **not** use SignalR's
  `accessTokenFactory`: over WebSockets it puts the value in the
  `access_token` query string.
- **Enumeration.** There is no room listing. With 1,000 live rooms, a
  random code guess hits a room about once in 10⁹ attempts. Failed join
  attempts are rate-limited per IP (§7). That keeps brute force
  impractical while codes stay short enough to type.
- **Host lookup.** The server finds a room by `SHA-256(hostSecret)` and
  stores only that hash.
- **Rotation.** These are separate host actions in the room menu:
  - *New join code* invalidates the old code and link. Connected
    participants stay.
  - *New host link* disconnects every host connection except the one that
    asked, and invalidates the old host link.
- There is at most one host role, but it may have several connections (two
  tabs). There may be any number of participants. The UI is designed for
  one or two.

### 3.3 Room state

Everything below lives in the API process's memory:

```
Room
  id                           — internal GUID; SignalR group name; never shown or accepted from clients
  joinCode                     — current code; index joinCode → room
  hostSecretHash               — index hostSecretHash → room
  createdAt, lastActivityAt
  scenarioSlug                 — which catalog scenario the room started from
  scenarioOverride?            — the applied ScenarioDefinition, if the host used the editor
  settings                     — §4; all defaulted, all mutable live
  board                        — entities keyed by ID (§5.2):
                                   components, belts, componentConfigs,
                                   annotations.texts, annotations.strokes
  boardVersion                 — monotonically increasing integer
  penHolder                    — connectionId | null
  participants[]               — connectionId, generatedName, role, connectedAt
  run?                         — the current or last run (§4.4): seed, boardVersion,
                                 controllerConnectionId, events[], lastTick
```

No field identifies a person. A process restart drops every room (§3.4).

### 3.4 Expiry

- A room with zero connections is kept for **30 minutes**, then deleted.
  This covers a dropped connection or an accidental tab close.
- A room with connections but no activity for **12 hours** is deleted, and
  the clients are told why.
- A restart drops all rooms. The client shows "This room has ended" and
  offers to start a new room from the same scenario with the board it still
  holds in memory. New codes and links are issued.

## 4. Interview features as room settings

All of these are host-controlled, take effect immediately, broadcast to the
room, and end with the room. There are no saved presets. Each setting's
only default is the hard-coded one below.

| Setting | Default | Effect |
|---|---|---|
| **Mode** | `open` | `open`: everyone sees everything, as today. `interview`: the integrity rule applies (§6). |
| **Pen** | `shared` | `shared`: anyone can edit, and concurrent edits merge per entity (§5.2). `single`: exactly one connection holds the pen. The host assigns it and participants can request it. |
| **Lint visible to participants** | on in `open`, **off in `interview`** | The design-time lint names required flow steps, which is a hint. In interview mode, turning it on sends the flows to participants, and the UI says so when the host toggles it (§6.3). |
| **Seed** | random per run | The host can pin a seed so every run in the room faces identical traffic, or so two rooms on the same scenario are comparable. |
| **Report visibility** | `everyone` in `open`, **`host only` in `interview`** | Participants see "Run complete" and nothing else until the host releases the report. §6.2 explains what this does and does not withhold. |
| **Who can run** | `anyone` | Governs start, pause, resume, speed, failure injection and traffic changes during a run (§4.4). `host only` gives the host all of them. |

### 4.1 Scenario configuration on the spot

The existing **Apply** path becomes the room's scenario override. The host
opens the scenario editor, edits flows, objectives, thresholds and traffic,
and applies. The server stores the override on the room and sends each
connection its projection (§6.1). There is no **Save**. A host who wants to
keep a scenario copies the JSON from the editor, or exports the PDF (§4.5),
which includes it.

In a room, only the host sees the editor button. In `open` mode,
participants can read the scenario document in a read-only panel. In
`interview` mode they cannot open it at all. The solo sandbox is unchanged,
except that Save is gone.

**As built (2026-11-09).** Open-mode participants get a 📄 *Scenario*
button that opens the same panel with the JSON read-only and no Apply,
Validate or Reset; it closes whenever a new projection arrives (a host
Apply, a mode switch), and in interview mode the button is hidden and the
panel cannot be opened. Tested in `e2e/rooms.spec.ts` ("read-only panel")
and `e2e/rooms-interview.spec.ts` ("cannot open the scenario document").
There is no in-sandbox challenge selector to lock: switching challenges
means navigating to `/challenges`, which is a full page load that leaves
the room.

### 4.2 Switching modes mid-room

Switching `open → interview` re-projects immediately. Participant clients
receive the stripped scenario document and must discard what they had.
**Clients cannot be trusted to forget**, so if any participant has joined,
the host sees: "Participants who joined in open mode have already seen this
scenario's internals." The warning offers a **Start a fresh interview room**
button, which creates a new room with the current board and new
credentials.

Switching `interview → open` is safe. It simply reveals.

### 4.3 Pen control

In `single` pen mode the server decides. It accepts board updates only from
the pen holder's connection and rejects the rest with a reason, which the
client shows as a toast. Handing over the pen is a host action. A
participant's "raise hand" request appears as a badge on the host's side. If
the pen holder disconnects, the pen returns to the host.

### 4.4 Runs

A run is executed **locally by every client** from the same seed, the same
board version and the same sequence of control events. Streaming frames
from one client instead would be bandwidth-heavy and lossy. This requires
seeded determinism (§8) and one clock.

- **Start.** An allowed connection (§4, *Who can run*) asks to start. The
  server fixes `{seed, boardVersion}`, makes that connection the run's
  **controller**, and broadcasts. The board is read-only for everyone
  during the run. The sandbox already blocks undo while running.
- **One clock.** The controller's client broadcasts its simulation tick
  about four times a second. Other clients never advance past the last
  tick they have heard. A client that falls behind (a background tab, a
  slow machine) catches up by ticking without rendering. A participant who
  joins mid-run fast-forwards from tick 0 the same way.
- **Control events.** Pause, resume, speed change, failure injection
  (`failure-injection-panel.ts:83`, which stamps its start time at the
  moment of the click today) and traffic changes become room events. Each
  is stamped `applyAtTick = controllerTick + 15` (a quarter-second of
  simulation time). Every client, the controller included, applies the
  event at that tick. Speed is therefore room-wide during a run.
- **Controller loss.** If the controller disconnects, the host's
  connection takes over. If no host is connected, the run is abandoned and
  clients show "Run interrupted".
- **End.** Each client computes its own report from the same deterministic
  run. Report visibility (§4) decides which clients show it.

**As built (step 5, 2026-11-07).** The design above holds, with these
specifics:

- `StartRun(seed?)` fixes `{seed, boardVersion}` and names the caller the
  controller; the server rejects a second start and locks the board (and
  the traffic profile) with "The board is locked while a run is in
  progress." until `EndRun`. Every client, the requester included, starts
  its engine on the `RunStarted` broadcast.
- **Stamping is the controller's job, not the server's.** The server only
  relays control events, unstamped, to everyone (`RunEvent`). The
  controller stamps each one `applyAtTick = tick + 15`, or `= tick` while
  paused (nobody is advancing, so the event applies where everyone
  stands), and reports the stamps with its next `ReportTick`. Other
  clients hold unstamped events and never advance past the last tick they
  heard, so a stamp always arrives before the tick it names. Stamping on
  the server would have needed a margin that depends on the simulation
  speed, since at 100× the controller passes 1,500 ticks between reports.
- Events apply at tick boundaries in `seq` order: `pause`, `resume`,
  `speed`, `failure` (component, type, duration) and `stop`. Reset,
  Starter and Reference during a run send `stop` instead of touching the
  locked board.
- A client more than 90 ticks behind catches up at up to 1,200 ticks per
  frame without rendering. A mid-run joiner receives the run (seed, last
  tick, stamped events) in `RoomJoined` and replays from tick 0.
- The controller's engine ending calls `EndRun(finished|stopped)`;
  `RunEnded(finished)` lifts the tick clamp so a lagging client finishes
  and computes its own report. Controller loss hands the clock to a
  connected host (`RunControllerChanged`, carrying the last reported tick
  so the new controller stamps pending events after it); with no host the
  run is `interrupted` and clients stop with a toast.
- The Traffic panel's profile is now room state (`SetTrafficOverride`,
  `TrafficChanged`), since two clients with different traffic cannot
  produce the same run.
- After any run, scale instances the engine spawned are dropped from the
  board before the next gesture is committed, so they never become real
  components in the undo stack or in the room.
- Tests: `RoomRunTests` (server), `e2e/rooms-run.spec.ts` (two browsers:
  identical reports with pause, speed and failure events; mid-run join;
  Reset-as-stop; host takeover), and a run through the real hub in
  `e2e/real-api.spec.ts`.

### 4.5 Host notes and the "record"

The host has a private notes pane. It is in-memory state in the host's tab
and nothing else, not even `sessionStorage`. The PDF export
(`src/game/report-pdf.ts`) is extended to include the notes, the scenario as
applied, the seed and the board. That PDF, downloaded by the host, **is** the
interview record. It lives on the host's machine, which is exactly where the
zero-personal-data rule wants it.

### 4.6 As built (step 6, 2026-11-08)

- `RoomSettings` (`Rooms/RoomModels.cs`, `src/rooms/room-client.ts`):
  `mode`, `pen`, `lintVisible`, `seed`, `reportVisibility`, `whoCanRun`.
  `lintVisible` and `reportVisibility` are nullable: null means "the
  default for the mode", so switching modes flips them as the table above
  says, while an explicit choice survives a switch. Host-only
  `UpdateSettings` replaces the whole record and broadcasts
  `SettingsChanged` with the pen holder; invalid values are refused.
- **Pen** (§4.3): switching to `single` gives the pen to the host.
  `ApplyBoardDiff` from anyone else is refused with "*Name* holds the
  pen." The client refuses the same edits up front with a toast (place,
  connect, drag, delete, chips, tags, text, strokes, paste, undo, redo,
  Reset/Starter/Reference). `RequestPen` sends `PenRequested` to the hosts,
  who see a ✋ badge and a *Give pen* button per participant; `AssignPen`
  hands it over. The holder disconnecting returns the pen to a connected
  host (`PenChanged`).
- **Who can run**: `hostOnly` makes `StartRun`, `SendRunEvent` and
  `SetTrafficOverride` host-only on the server; the client dims and refuses
  Play, speed, Failures and Traffic for participants with a toast.
- **Seed**: a pinned seed in the settings overrides whatever a `StartRun`
  asks for, so *Replay same traffic* and pinned rooms agree.
- **Report visibility**: `hostOnly` participants see a "Run complete"
  notice instead of the report; their client keeps the report it computed
  and shows it on `ReportReleased`. The host's report modal has a *Release
  to participants* button; `ReportReleased` resets when the next run
  starts. §6.2 still applies: participants' HUD numbers are theirs.
- **Lint**: with `lintVisible` off, participant clients do not show the
  lint panel at run start. Withholding the flows themselves is step 7.
- **Mode switch**: `open → interview` with participants present shows the
  "already seen this scenario's internals" warning in the dialog. The
  *Start a fresh interview room* button is step 7, with projection.
- **Host notes** (§4.5): `src/rooms/host-notes.ts` keeps the text in a
  module variable; the pane is a host-only *Notes* button. Nothing is
  sent or stored; the e2e test asserts no hub invocation and no storage
  contains the text.
- **PDF**: `downloadReportPdf(report, extras)` appends *Board as run*
  (components, counts, seed, room code), *Scenario as applied* (the JSON
  document) and *Host notes*. Solo use passes the same extras minus the
  room code.
- Tests: `RoomSettingsTests` (server), `e2e/rooms-settings.spec.ts` (pen
  flow across two browsers, host-only runs with a pinned seed, held report
  and release, notes and PDF download, mode-switch warning).

## 5. Real-time collaboration

### 5.1 Transport and hosting

SignalR, native to ASP.NET Core. One hub, one group per room, keyed by the
internal room ID.

**Hosting is TBD.** Whatever host is chosen must provide:
- WebSockets.
- A single, always-on instance. Rooms live in process memory, so scaling to
  zero ends every room, and a second instance would need a backplane (§9).
- Separate hosting for the static frontend is fine. The frontend needs
  `VITE_API_URL` at build time (`deploy.yml` builds without it today).

### 5.2 Sync model: per-entity merge

Solo half implemented 2026-11-07 (build step 3); see *As built* at the end
of this section. The room half (transport, server merge, cursors) is step 4.

Every board entity already has an ID: components, belts, component
configs (keyed by component ID), annotation texts and strokes. Sync works at
that granularity. It is not OT or a CRDT; it is last-writer-wins **per
entity**.

- A gesture (a drag, a connect, a config change, a text edit) produces a
  **diff** against the board it started from: entities added, entities
  removed, and entities changed (new value in full). The client sends
  `{baseVersion, diff}`.
- The **server applies diffs**, treating each entity as opaque JSON keyed
  by ID:
  - Add or change: the latest write wins.
  - Remove: wins over a concurrent change.
  - A belt whose endpoint component no longer exists is dropped.
- The server then increments `boardVersion` and broadcasts
  `{version, diff}`. No retry loop is needed. A client that sees a gap in
  versions asks for the full board, and a joiner receives the full board.
- **Undo is per person.** Each client's undo stack holds its own gestures
  as diffs, recording before and after values. Undo sends the inverse diff,
  skipping any entity someone else has changed since. That keeps one
  person's undo from erasing another person's work. The solo sandbox uses
  the same mechanism. Diffs are computed from the before and after
  snapshots `pushHistory` already takes, so the history code changes what
  it stores, not when.
- Drags coalesce to about 10 Hz and send the final position on release.
  Live cursors are a separate, unreliable, high-frequency message that
  never touches `boardVersion`.
- Object IDs are now created on several clients at once, so the ID sites
  in §8 move to `crypto.randomUUID()`.

**As built (solo, 2026-11-07).**
- `src/game/board-diff.ts` is the pure core. A `BoardState` is the five
  entity collections (components, belts, configs keyed by component ID,
  texts, strokes). A diff is a list of `{ kind, id, before, after }`; `null`
  on one side means added or removed. `diffBoards` compares entities
  structurally, `invertDiff` swaps the sides, and `applyDiff` returns a new
  board plus the belts it dropped because an endpoint component had gone.
  With `skipConflicts`, a change is applied only if the entity still equals
  `before`, and skipped ones are reported. That is the per-person undo rule;
  the server's merge is the same call without the option, where the latest
  write wins and a remove beats a change. The sync message of §5.2 is
  `{ kind, id, after }`, a projection of the same record.
- The sandbox's `HistoryEntry` is now `{ diff }`. `pushHistory` diffs the
  live board against the last committed board and records nothing when a
  gesture changed nothing. Undo and redo apply the inverse or forward diff on
  top of the committed board, so a finished run's scale instances (which the
  engine writes into the live arrays) never enter the undo stack, and they
  invalidate the pre-run snapshot, which the old undo forgot to do.
- Gestures now include everything the spec lists: component drags, pen
  strokes and text notes commit on release, and creating a note and typing
  into it is one gesture. Previously only place, connect, delete, chip and
  tag drops were undoable, and annotations were outside history.
- Two bugs found by the new e2e tests, both fixed: the top-right action bar
  swallowed clicks on the Draw and Text tools at wide viewports, and every
  re-render stacked another copy of the window keyboard listeners, so one
  Ctrl+Z after a prior undo reverted several gestures.
- Tests: `src/game/__tests__/board-diff.test.ts` (classification, inverse
  round-trip, belt cascade, conflict skipping, last-writer-wins) and three
  cases in `e2e/sandbox-editing.spec.ts` (drag undo, delete restores belts,
  strokes and notes in undo/redo).
- Not yet done, deliberately: drag coalescing and live cursors, which only
  matter with a transport (step 4).

### 5.3 Presence

Shows who is in the room, their generated name and role, whether they hold
the pen, and a live cursor. Connection drops show within a few seconds.

### 5.4 As built (step 4, 2026-11-07)

**Backend** (`backend/SystemDesignSimulator.Api/Rooms/`):
- `RoomHub` at `/hubs/room`: `CreateRoom`, `JoinByCode`, `JoinAsHost`,
  `LeaveRoom`, `ApplyBoardDiff`, `RequestBoard`, `MoveCursor`,
  `SetScenarioOverride`, `RotateJoinCode`, `RotateHostLink`. Server
  messages: `BoardChanged`, `PresenceChanged`, `CursorMoved`,
  `ScenarioChanged`, `RoomEnded`.
- `RoomRegistry` holds rooms under one lock, indexed by join code and by
  the SHA-256 of the host secret. `RoomBoard` keeps entities in insertion
  order so every client that applies the same version stream ends with the
  same board order (§8 depends on it). Merge is last-writer-wins per entity;
  a removal beats a change; belts without an endpoint are dropped and the
  drop is broadcast as a change so clients converge. Size caps are checked
  before anything is written.
- `BoardChanged` goes to the whole group, author included, carrying
  `origin`. The author skips its own change; everyone sees one ordered
  stream of versions, and a gap means "ask for the full board". This avoids
  a race between an invocation's completion and the next broadcast.
- `RoomGuards` implements §7 on `System.Threading.RateLimiting`: sliding
  windows per IP for creations and failed joins, a process-wide failed-join
  window, token buckets per connection for diffs and cursors. Hub
  invocations are not HTTP requests, so the hub asks the guards directly.
  `KNOWN_PROXIES` (IPs or CIDRs) enables `ForwardedHeaders`.
- `RoomExpiryService` sweeps every 30 s: empty rooms after 30 minutes,
  occupied-but-idle rooms after 12 hours, the latter with a `RoomEnded`
  message before the connections are aborted. `RoomRegistry.Sweep` is
  driven directly by the tests with a fake `TimeProvider`.
- Logging: `Microsoft.AspNetCore.SignalR` and `Http.Connections` at
  `Warning`, detailed errors off. `RoomHubTests` captures every log line
  while driving a session with marker strings in an annotation, a scenario
  override and a failed join, and asserts none of them, the join code or
  the host secret appears.
- Tests: `JoinCodeTests`, `RoomRegistryTests`, `RoomHubTests` (real
  SignalR clients against the in-process server, long polling).

**Frontend** (`src/rooms/`):
- `join-codes.ts`: normalisation (case, spaces, dashes, `O→0`, `I`/`L→1`,
  a pasted link), the `#join=` / `#host=` fragment, and link builders.
- `room-client.ts`: the `@microsoft/signalr` connection (WebSockets,
  negotiation skipped, automatic reconnect followed by a rejoin) and the
  board ↔ wire conversions. Entities on the wire are `{ kind, id, value }`;
  changes are `{ kind, id, after }`.
- `room-ui.ts`: Share / Join dialog, presence panel, remote cursors, the
  "This room has ended" banner.
- The sandbox mirrors every committed gesture (`pushHistory`, undo, redo,
  Reset, Starter, Reference) to the room and applies remote changes to both
  the live board and the undo baseline, so undo stays per person. An entity
  under the local pointer keeps its local value until release. Remote
  changes that arrive during a local run are deferred and the board is
  refetched when the run ends (step 5 replaces this with the room-wide
  run). The host's scenario **Apply** becomes the room's override;
  participants receive it and do not see the editor or Reference buttons.
- The participant link on `/` redirects to the sandbox; the host's own URL
  carries `#host=` so a refresh returns as host; leaving or an ended room
  clears the fragment. "Join a room" is in the site header and in the
  sandbox's Share dialog.
- Tests: `join-codes.test.ts`, `room-wire.test.ts`; `e2e/rooms.spec.ts`
  drives two browser contexts through `e2e/fixtures/fake-hub.ts`, an
  in-process implementation of the hub protocol over Playwright's
  WebSocket routing; `e2e/real-api.spec.ts` repeats the two-person flow
  against the real hub.

**Known gaps, by design for this step.** Concurrent adds from two clients
within one round trip can land in different array positions on the two
clients; step 5 fetches the board from the server when a run starts, which
is where order matters. Drags are committed on release but not coalesced
to 10 Hz mid-drag (only the cursor streams). Reconnection rejoins with a
new connection ID and the full board.

## 6. Trust and integrity (interview mode)

### 6.1 Server-side projection

The server holds the full scenario (catalog or overridden) and sends each
connection a projection by role:

- **Host:** the full document.
- **Participant, open mode:** the full document.
- **Participant, interview mode:** `title`, `description`, `requirements`,
  `duration`, `allowedComponents`, `traffic` and `tags`. Withheld: `flows`,
  `objectives`, `scoringPriorities`, `referenceArchitecture`, the triggers
  in `failureScenarios`, and the scenario slug.

**Unedited catalog scenarios are public.** Their flows and objectives are
returned by `GET /api/challenges/slug/{slug}`, and they also ship in the
frontend bundle (`FLOWS_BY_SLUG` / `OBJECTIVES_BY_SLUG` in
`src/game/flow-presets.ts`). For those scenarios, projection only stops a
participant who doesn't recognise the scenario. In interview mode, while the
room runs an unedited catalog scenario, the host therefore sees a banner:
"This is a public scenario — participants may know it. Edit it to make it
yours." The banner disappears after the first Apply. Variety and on-the-spot
edits are what give interview mode its value, and this is the stated
posture.

### 6.2 What the participant's simulation can compute

The engine needs flows to route requests and detect violations, so a
participant client cannot simulate without them. In interview mode, the
participant receives an **opaque flow bundle**. It is delivered only when a
run starts, is never rendered by any UI, and is discarded when the run
ends. Consequences:

- **Violation UX is host-only in interview mode.** Violation toasts, the
  lint panel and the step-level detail in the request inspector would
  render flow internals, so they are suppressed on participant clients.
  The participant sees requests succeed or fail, which is what a real
  system shows them.
- **Report visibility is partly structural.** Objectives are never sent,
  so a participant client cannot compute the verdict. Raw throughput,
  latency and drop numbers come from the participant's own engine and are
  visible in the HUD during the run, like a dashboard. "Host only"
  withholds the verdict structurally, and withholds the raw end-of-run
  metrics in the UI only.
- **The bundle is capturable.** A DevTools reader can capture it during a
  run. The integrity note says so plainly: interview mode hides the
  scenario internals from the UI and from idle inspection, but not from a
  determined participant during a run. Moving the simulation server-side
  is the fix if §10 ever needs the claim to be strong. That is a different
  project.

### 6.3 Lint

The lint is computed client-side from the flows. In interview mode with lint
off (the default), participants have no flows outside a run and no lint. If
the host turns lint on, the room sends flows to participants, and the host
sees: "Participants will now see required flow steps as design hints."

### 6.4 Anti-cheat posture

Stated, not implied: scenario variety, per-room seeds, on-the-spot scenario
edits, and the host's judgement. No surveillance, no proctoring, no
telemetry about the participant.

### 6.5 As built (step 7, 2026-11-09)

- **Projection is server-side and whitelisted** (`Rooms/ScenarioProjector.cs`).
  `Project(room, role)` returns `{scenarioSlug, challenge, scenarioOverride}`:
  hosts and open-mode rooms get the slug and the full override; interview
  participants get `scenarioSlug: null`, a stripped catalog entry built from
  a whitelist (name, description, requirements, duration, traffic,
  characteristics, allowedComponents, tags — id and slug are empty strings,
  overview/video/scoring never enter the payload) in the `GET /api/challenges`
  wire shape so the frontend reuses `mapChallengeFromApi`, and the override
  reduced to `requestTypes` and `tags`. Flows are included only while
  `EffectiveLintVisible` is true (§6.3). The same projection rides
  `RoomJoined` and `ScenarioChanged`; `UpdateSettings` re-sends it to
  participants when the mode or the effective lint visibility changes (§4.2),
  and `SetScenarioOverride` sends each role its own version.
- **The opaque flow bundle** is `RunStartedMessage.Flows` /
  `RunStateMessage.Flows` (mid-run join), set only for interview-mode
  participants: the override's flows, else the catalog's for the room's slug.
  The client layers it over the active scenario for the run
  (`setRunFlowBundle`, `src/game/scenario-runtime.ts`) and discards it when
  the run ends; `getActiveScenarioDocument()` (editor, PDF) deliberately
  never sees it.
- **Participant UI suppression**: the request inspector takes
  `hideFlowDetails` (participant + interview + lint off) — a violated request
  reads "✕ Failed" with no reason, and step-level event detail is dropped.
  The lint panel was already gated by `effectiveLintVisible` (step 6); with
  projection, participants without lint now also hold no flows to lint.
- **Engine parity**: the participant's engine must reproduce the host's run
  from the stripped scenario plus the bundle. That surfaced a real bug: the
  frontend derived `cacheHitRatio` from a slug-keyed fallback, and the
  projection withholds the slug. `hotDataRatio` is now explicit in the
  url-shortener catalog entry (seeder and e2e fixture); the stripped and the
  slug'd scenario now build identical traffic numbers.
- **Mode-switch warning** (§4.2): the warning now carries a *Start a fresh
  interview room* button (`#room-fresh-interview`), which leaves the room and
  opens a new one — new code, new host link — around the same board, already
  in interview mode.
- **Public-scenario banner** (§6.1): `#room-public-scenario` on the host's
  canvas while the room is in interview mode with no override; it disappears
  on the first Apply. The §6.2 integrity note (`#room-integrity-note`) sits
  in the host's settings section while interview mode is on (§2.4).
- The report keeps the generic survival row for participants ("No component
  failures" — computed from their own engine); the authored objectives
  (completion floors, violation ceiling) are structurally absent, as §6.2
  intends.
- Tests: `RoomInterviewTests` (server guard tests: whitelist, both mode
  switches, lint-on flows without objectives, bundle to participants only and
  preferring the override, mid-run join), `e2e/rooms-interview.spec.ts`
  (objectives withheld while two browsers' runs agree stat for stat, lint off
  then on, inspector suppression, fresh room, banner + integrity note), an
  interview run through the real hub in `e2e/real-api.spec.ts`, and
  `scenario-runtime.test.ts` for the bundle layering.

## 7. Abuse and operational limits

No accounts means no per-user limits. Instead:

- **Room creation** is rate-limited per client IP (sliding window, e.g. 20
  rooms/hour) with ASP.NET Core's built-in rate limiter.
- **Failed join attempts** (unknown code or wrong host secret) are limited
  per IP (e.g. 20 per 10 minutes). A process-wide cap on failed joins per
  minute stops a distributed guesser.
- Behind a reverse proxy, configure `ForwardedHeaders` with the host's
  proxy ranges. Otherwise every user shares one bucket.
- A room-count cap per process. Creation returns 503 above it.
- Caps on diff and board size (annotations included) and on message rate
  per connection.
- Production logging: `Microsoft.AspNetCore.SignalR` and
  `Microsoft.AspNetCore.Http.Connections` at `Warning`, and SignalR
  detailed errors off. The hub never logs message payloads, join codes or
  host secrets. A log-redaction test drives a hub session with marker
  strings in an annotation, the join code and the host secret, and asserts
  that none of them appears in the captured log output.

## 8. Determinism and scoring

Implemented 2026-11-06 (build step 2). What follows is the design as built.

**Seeded PRNG.** `src/game/rng.ts` is a mulberry32 generator owned by the
engine. Every draw the engine makes comes from it: celebrity roll and
request colours, spike trigger, duration and jitter, read/write and
request-kind choice, target and belt choice, branch outcomes. The engine
takes a seed in its constructor, re-creates the generator on every
`start()`, and exposes it through `getSeed()`, the snapshot and the report.
Two engines built from the same board and seed produce the same run tick
for tick (`determinism.test.ts`).

**Seeds in the sandbox.**
- Each run draws a fresh 32-bit seed unless one is pinned.
- `?seed=N` on the sandbox URL pins the seed for every run in that tab.
  This is the reproducible-bug-report path, and the hook the room's pinned
  seed (§4) will use.
- The report shows the seed and offers **Replay same traffic** next to
  **Run again**. Run again draws a fresh seed (or keeps the pinned one);
  Replay reuses the run's seed. The PDF carries the seed too.

**IDs.** ID generation is outside the seeded stream and uses
`crypto.randomUUID()`: components, belts, scale instances, instance belts,
annotation texts and strokes. Random IDs exposed two places where a run
depended on ID text, both fixed: scale-in picked the instance to remove by
ID order, and the scale-group layout sorted instances by ID, which set belt
lengths and so travel times. Both now use board order.

**Two engine bugs found by seeded measurement, both fixed.**
- Scale-instance IDs embedded `Date.now()` and the instance index. A
  scale-in followed by a scale-out in the same millisecond reused an ID,
  and the unregister path then removed the wrong component and crashed.
- New instances were always wired from the load balancer, whatever fed the
  primary. Behind a gateway or a rate limiter the flow's next step was the
  gateway, so the instances never received a request. Instances now mirror
  the primary's inbound belts.

**Scoring recalibration.** Floors were measured with seeded runs of each
starter and of a reference solution per scenario (`challenge-presets.ts`,
`CHALLENGE_REFERENCES`), using the catalog's real capacities:

| Scenario | Starter completes | Reference completes | Floor |
|---|---|---|---|
| URL shortener | 78–98% | 100% | 99% (create, read) |
| Instagram feed | like/post 60–79%, feedLoad ≈100% | ≥ 99% | 95% (all three) |
| Dropbox | 51–69% | 100% | 95% (all three) |
| Rate limiter | 20–40% | 100% | 95% (check) |

Each reference keeps the starter's topology and adds what the exercise is
about: auto-scaling on every compute tier and replication plus sharding on
the SQL database. The rate-limiter reference also adds a second Redis for
counters, because scaling the API alone sends 5× spikes into one cache,
which fails. Bounded scaling without the second cache tops out near 85%.

Consequences:
- Every starter is a *correct* design (no violations, no failures) that
  misses at least one floor. The run is judged lost, and the report says
  **Survived, objectives missed**. "Architecture failed" is reserved for a
  design that broke a component or violated its flows: incorrect, not
  merely under capacity.
- A **Reference** button next to **Starter** loads the reference solution
  in the solo sandbox. In rooms it is host-only in interview mode (§6).
- The floors live in `flow-presets.ts` and `FlowDefinitions.cs`; both must
  change together. `calibration.test.ts` fails if a starter passes or a
  reference misses on any of four seeds, and a C# test pins the C# floors
  to the same numbers.

## 9. Build order

The feature ships in full. This order lists dependencies, not release
gates.

1. **Anonymous and database-free** (§2): catalog in memory, account surface
   and PUT removed, privacy and terms, guard tests green. Nothing else
   depends on the rest of this, but it simplifies everything after it.
   Done 2026-11-06.
2. **Determinism and scoring** (§8). Runs in rooms (§4.4) and seed pinning
   depend on it. Done 2026-11-06.
3. **Per-entity diffs and per-person undo** (§5.2), solo first. Room sync
   depends on it. Done 2026-11-07.
4. **Rooms** (§3, §5, §7): hub, codes and links, Join UI, sync, presence,
   expiry, limits, log redaction. Done 2026-11-07; see §5.4.
5. **Runs in rooms** (§4.4): controller clock and control events. Done
   2026-11-07; see §4.4 *As built*.
6. **Room settings** (§4): pen, who-can-run, seed, report visibility, host
   notes, PDF. Done 2026-11-08; see §4.6.
7. **Interview mode** (§6): projection, opaque flow bundle, participant UI
   suppression, lint semantics, mode-switch warning, public-scenario
   banner. Done 2026-11-09; see §6.5.

**Later, if usage demands it:** a backplane or room persistence across
restarts, which would bring back external state.

## 10. Parked: the paid platform

Draft v1's company tenancy, email invites with magic links, durable
candidate log, retention policy and shared scenario library are **parked.**
Every one of them introduces personal data and a database, and with them
obligations around retention, erasure, export and jurisdiction. The MVP
exists partly to find out whether anyone wants the collaboration tool
before taking on that load.

What the MVP preserves so that path stays open:

- The room model already distinguishes host from participant. A company
  becomes "who may create rooms", not a rewrite.
- Server-side projection (§6) is exactly what the candidate view needs.
- Seeded runs and the PDF record are the denormalized assessment the
  candidate log would store.
- `IChallengeCatalog` is the seam where a database-backed catalog would
  plug back in.
- The account code and migrations remain in git history (§11 Q1).

The trigger to un-park is a host asking "can I keep this" more than a few
times.

## 11. Open questions for review

1. **Account code: delete or keep uncompiled?** Decision (2026-11-06):
   **delete** it, along with the migrations and `UnmappedControllers.cs`.
   Git history is the parking place; §10 would rebuild against whatever
   the platform needs then.
2. **Opaque flow bundle (§6.2).** Recommendation: accept, with the
   participant-side UI suppression and the integrity note.
3. ~~Scenario authoring via the running app.~~ Resolved by "no database":
   authoring means editing the seed source and redeploying (§2.3).
4. **Expiry windows** (§3.4): 30 minutes empty and 12 hours idle.
5. **Aggregate analytics.** Recommendation: none.
6. **Local participant labels.** May the host label participants
   ("Candidate A") in their own tab only? Labels never leave the browser.
7. **Legacy auth keys in returning browsers.** Option (a): ignore them.
   This is what `e2e/anonymous.spec.ts` currently asserts. Option (b):
   delete `sds_auth_token` and `sds_auth_user` on boot. Recommendation:
   **(b).** We put an email there and nothing uses it any more. If
   accepted, the last test in `anonymous.spec.ts` flips.
8. ~~"Pass-through telemetry fix".~~ Decision (2026-11-06): **dropped.**
   v2 referenced a `pass-through-telemetry.md` that never existed.
9. ~~Locking a room.~~ Decision (2026-11-06): **out of scope.** Possession
   of the code is enough to join for the life of the room.

## 12. Explicitly out of scope

Accounts of any kind; a database or any server-side persistence; email or
any outbound messaging; public rooms, room listings or search; saving
boards or scenarios server-side; saved room presets; operational transform
or CRDT sync beyond per-entity last-writer-wins; a visual flow editor;
video/audio (assume a separate call); recording or replaying sessions;
leaderboards; billing; analytics; and everything in §10.
