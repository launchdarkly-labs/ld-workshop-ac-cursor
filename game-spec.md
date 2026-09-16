# Game specification: Factory Floor

The visualization the learner watches while a chain of Cursor cloud agents works
their pull request. Lives in `game/`, ships in the VM image at
`/opt/ld/factory-floor`, runs as a service on port 7777, and is exposed as an
Instruqt `type: service` tab.

## The idea

Side-scrolling factory corridor. Small creatures — **flaglings** — walk in from
the left and pile up against the first closed gate. When an agent finishes its
phase, that gate lifts and the crowd surges to the next one. The exit at the far
right opens when the agent's pull request lands.

The learner has no controls. That is the point: the agents clear the obstacles,
the flaglings just walk. The learner is watching a production line, not playing.

**IP line.** No Lemmings sprites, sounds, character names, level designs, or the
word itself anywhere in code, comments, or UI. Original pixel art only. This is
non-negotiable.

## Architecture

Node HTTP server, no framework, no build step, no bundler. Two endpoints and a
static page.

```
game/
  package.json          # start: node server.mjs ; no dependencies beyond node stdlib
  server.mjs            # polls GitHub, holds state, serves /api/state and /
  public/
    index.html
    floor.js            # canvas render loop
    floor.css
```

Zero npm dependencies is a hard requirement. The image bakes this in and the
sandbox has no reason to reach npm at lab time.

### Why polling

Inbound network to an Instruqt sandbox is the hard direction, so webhooks are out.
The server polls the GitHub API outward. This is the only egress the game needs.

- Poll interval: 5 seconds while a run is active, 15 seconds when idle.
- Conditional requests with `If-None-Match` on the comments endpoint; a 304 costs
  no rate limit against the 5000/hour installation-token budget.
- On any GitHub error, keep the last good state and surface a muted banner. Never
  blank the floor because one poll failed.

### Configuration

Read from `/opt/ld/factory-floor/.env`, written by track setup:

| Var | Purpose |
|---|---|
| `AF_REPO` | `owner/name` of this session's assigned repo |
| `GITHUB_TOKEN` | pool user's GitHub App installation token |
| `LD_PROJECT_KEY` | for building LaunchDarkly deep links in the UI |
| `PORT` | 7777 |

No Cursor credentials. The game never talks to Cursor.

## State model

### Discovering the run

1. List open and recently closed PRs on `AF_REPO`.
2. The **triggering PR** is the most recently created PR whose changed files
   include no path under `.release-flags/`.
3. The **agent PR**, once it exists, is a PR created after the triggering one
   whose changed files do include a `.release-flags/` path.

That mirrors the loop guard in the Automation prompt, so the game's notion of
which PR is which matches the agent's.

### Phases

Five gates, in order. The graph has six nodes on the pull-request path; the
manifest steward is folded into the flag gate because the cloud prompt presents
five phases and the learner should see what the prompt actually does.

| # | Key | Gate label | Opened by |
|---|---|---|---|
| 1 | `research` | Intake | research planner |
| 2 | `flag` | Flag Press | manifest steward + flag implementer |
| 3 | `metrics` | Instrumentation | metrics author |
| 4 | `tests` | Test Bench | flag testing |
| 5 | `review` | Quality Inspection | code reviewer |

Gate 2's tooltip should name both agents, so a learner who read the graph in
challenge 01 is not confused by the count.

### Progress signal

The server reads comments on the triggering PR and looks for a fenced JSON block
of this shape:

```json
{ "autofactory_phase": "metrics", "status": "complete", "artifacts": ["metric-key-a", "metric-key-b"] }
```

`autofactory_phase` is one of the five keys above. `status` is `started`,
`complete`, or `skipped`. `artifacts` is optional and free-form.

**This requires an addition to the Automation prompt** — a per-phase status
comment. It is additive to the prompt only, not to AutoFactory's architecture.
The exact wording to add is in `manual-setup.md`.

Parsing rules:

- Scan every comment, newest last; later blocks for the same phase win.
- Accept a fenced block with or without a `json` language tag.
- Ignore any block that does not parse or lacks `autofactory_phase`.
- The terminal comment — the one carrying `review_approved` — always sets
  `review` complete regardless of whether a per-phase block arrived, and carries
  `review_approved` and `risk_level` into state.

**Fallbacks, because per-phase comments are unproven.** The server must derive as
much as it can without them, so a learner never stares at a dead floor:

- Any comment at all on the triggering PR opens gate 1. The research planner
  posting anything means intake happened.
- The agent PR existing opens gates 2 and 3, because a manifest implies a flag
  and the metrics phase precedes the manifest write.
- A file matching `*test*` in the agent PR's changed files opens gate 4.
- The `review_approved` block opens gate 5.

Derived state never closes a gate that a per-phase comment already opened.

### Terminal states

| State | Trigger | Floor behaviour |
|---|---|---|
| `running` | triggering PR exists, chain incomplete | flaglings walking, gates opening |
| `short_circuited` | a comment says no flag was needed, and no agent PR appears | corridor diverts to a side door labelled **No Flag Needed**; flaglings file through it calmly |
| `complete` | agent PR exists and `review_approved` is true | exit door opens, flaglings walk out, artifact placard shows flag key, metric keys, manifest path |
| `rejected` | `review_approved` is false | exit stays shut, a placard shows the risk level, flaglings mill about |
| `idle` | no triggering PR yet | empty conveyor, all gates shut, a hint to open a PR |

`short_circuited` is correct behaviour, not failure. Style it neutrally — no red,
no error iconography. The assignment text says the same thing.

`rejected` should look like a real stop, because it is one.

## Rendering

Canvas, fixed logical resolution, scaled to fit. Target 60fps but the simulation
must be frame-rate independent — a learner switching tabs for two minutes should
not come back to a broken floor.

- Flagling count equals the triggering PR's changed-file count, clamped to 8–40.
  Reading that from the GitHub API is free and makes each run feel like it is
  about the learner's own change.
- Flaglings are 8–12px, two-frame walk cycle, small palette. Simple crowd
  behaviour: walk right, stop at a closed gate, resume when it lifts. No
  pathfinding.
- Gates are industrial shutters. Closed, lifting (short animation), open.
- Each open gate shows the artifacts its phase produced, pulled from
  `artifacts`. Flag keys and metric keys link into LaunchDarkly using
  `LD_PROJECT_KEY`.
- A status strip along the top: repo name, triggering PR number, elapsed time,
  and which phase is in flight.
- Dark palette to match the track's `modern-dark` theme.

### What not to build

- No sound.
- No player input. Not even a restart button; the state is derived from GitHub.
- No fake progress. A gate that has not been reported open stays shut. If a
  phase is genuinely slow, the floor should look like it is waiting, because it
  is. Inventing motion to fill time would teach the learner the wrong thing
  about what the agents are doing.
- No WebSockets. Poll `/api/state` from the page every 2 seconds; the server
  holds the GitHub poll cadence separately.

## Endpoints

`GET /` — the static page.

`GET /api/state` — JSON:

```json
{
  "repo": "launchdarkly-training/autofactory-07",
  "ldProjectKey": "instruqt-abc123",
  "runState": "running",
  "triggeringPr": { "number": 4, "changedFiles": 3, "createdAt": "..." },
  "agentPr": { "number": 5, "url": "..." },
  "phases": [
    { "key": "research", "status": "complete", "artifacts": [], "source": "comment" },
    { "key": "flag", "status": "complete", "artifacts": ["shift2-new-banner"], "source": "derived" },
    { "key": "metrics", "status": "started", "artifacts": [], "source": "comment" },
    { "key": "tests", "status": "pending", "artifacts": [], "source": null },
    { "key": "review", "status": "pending", "artifacts": [], "source": null }
  ],
  "verdict": { "reviewApproved": null, "riskLevel": null },
  "lastPollAt": "...",
  "pollError": null
}
```

`source` distinguishes a phase opened by an explicit per-phase comment from one
inferred by the fallback rules. The UI does not need to show it, but it makes the
first dry run diagnosable, which is worth the field.

## Acceptance

The game is done when all of these hold:

- Starts with `npm start`, no dependency install, serves on 7777.
- With `AF_REPO` pointing at a repo with no PRs, shows `idle` and does not crash.
- With a completed historical run, replays to `complete` from the PR history
  alone, with no live agent running. **Build against this case first** — it makes
  the whole app testable without waiting on a cloud agent.
- Revoking the GitHub token mid-run shows the banner and keeps the last state.
- No reference to Cursor's API, no npm dependencies, no `grep -i lemming` hits.
