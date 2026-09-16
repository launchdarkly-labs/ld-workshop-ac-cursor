# Manual setup

Everything here is work only a human can do — web UIs, one-time provisioning, and
decisions with a credential attached. Claude Code does none of it and the specs
assume it is already done.

Rough order. Items 1 through 5 block the first dry run. Item 6 blocks the build.

---

## 1. Twelve app repos in `launchdarkly-training`

One per pool user, named to match the pool username's numeric suffix, because
setup derives the repo name from it with no extra state:

```
launchdarkly-training/autofactory-01
...
launchdarkly-training/autofactory-12
```

For each:

- Seed the default branch from AutoFactory's `examples/demo-app` directory as the
  repo root, so `frontend/` and `backend/` sit at the top level. This is what
  the shipped `.cursor/environment.json` expects.
- Copy `bootstrap/cursor-automation/dot-cursor/` in as `.cursor/`. All four
  files: `rules/autofactory.mdc`, `commands/autofactory.md`, `environment.json`,
  `mcp.json`.
- In `.cursor/mcp.json`, leave `REPLACE_WITH_LD_API_KEY` as-is. Cloud agents get
  MCP from Cursor's web config, not this file, and a real token must never be
  committed. The file stays for the local `/autofactory` path.
- Tag the seeded commit **`pristine`**. Setup resets every session with
  `git checkout -B main refs/tags/pristine`, so a missing tag is a hard failure.
- Grant the matching pool user write access.

**Org, not the pool user.** The copilot-cleanup track's `cleanup-workstation`
runs `gh repo list | xargs gh repo delete` to wipe the pool user's repos. That
command lists only repos the authenticated user owns, so org-owned repos survive
it. Putting these under a pool user would have them deleted after the first
session and would have forced a change to a script you asked not to change.

**Repos are long-lived.** Never delete and recreate them. The Cursor Automation
binding and the saved cloud environment both depend on the repo persisting.

---

## 2. Connect the LaunchDarkly MCP server in Cursor

At **cursor.com/agents**, MCP dropdown. Cloud agents configure MCP in the web,
not from the repo.

The token you paste here is shared across all twelve sessions, so it cannot be
one of the per-sandbox project-scoped tokens the lab mints. It needs write access
to **projects that do not exist yet**, since Terraform creates each session's
project at lab start. In practice that means an operator-level token.

Two consequences to accept consciously:

- An agent could in principle write into another session's project. The project
  key it targets comes from `.cursor/rules/autofactory.mdc` in the assigned repo,
  which setup rewrites per session, so it will target the right one — but nothing
  *enforces* that.
- The token is long-lived and sits in Cursor's configuration. Treat it like any
  other shared workshop credential and rotate on the same schedule.

If that trade is not acceptable, the alternative is twelve Cursor accounts with
twelve scoped tokens, which is a much larger operational lift. Worth deciding
before building rather than after.

---

## 3. Twelve Cursor Automations

At **cursor.com/automations** (or `/automate`), one per repo. For each:

- **Trigger:** *Pull request opened*, on `launchdarkly-training/autofactory-NN`.
- **Tools enabled:** LaunchDarkly MCP, Open PR, Comment on PR.
- **Prompt:** the body of
  `bootstrap/cursor-automation/cloud-automation-prompt.md`, everything below the
  horizontal rule, **plus the per-phase status addition in section 4 below.**

Before creating all twelve, create one and answer this: **does an Automation bind
to a repository by path or by internal id?** If by path, a repo that is ever
deleted and recreated keeps working. If by id, never delete a repo. Either way
the answer belongs in your runbook.

Also worth knowing before you do this twelve times: whether one Automation can be
scoped to several repositories. If it can, this section collapses to a single
item.

---

## 4. Add per-phase status reporting to the Automation prompt

The game opens its gates from comments on the triggering PR. Without this, it
falls back to inferring progress from the agent PR's contents, which works but
means gates 2 and 3 open together at the end instead of in sequence.

Append this to each Automation's prompt:

> **Progress reporting.** As each of the five phases completes, post a short
> comment on the triggering pull request containing a fenced JSON block of
> exactly this shape, and nothing else in the block:
>
> ```json
> { "autofactory_phase": "research", "status": "complete", "artifacts": [] }
> ```
>
> Use `research`, `flag`, `metrics`, `tests`, or `review` for
> `autofactory_phase`. Use `complete` or `skipped` for `status`. Put any keys or
> paths the phase created into `artifacts` — flag keys, metric keys, the
> manifest path. Post this in addition to, not instead of, the final summary
> comment.

This is additive to the prompt only. It changes nothing about AutoFactory's
architecture, which was the constraint.

---

## 5. Pool and sweeper

Reuse the **existing** `gh-copilot-workshop-users` DynamoDB table. Do not create
a second table — one table is what guarantees that this track and the
copilot-cleanup track can never hand the same GitHub account to two sandboxes.

Confirm:

- The sweeper Lambda from `infra/sweeper/` is deployed and on its 5-minute
  schedule. Invoke it once and check the output.
- `POOL_LOCK_TTL_SECS` matches this track's `timelimit` of `7200`.
- The workstation IAM principal's policy still covers `dynamodb:Query`,
  `dynamodb:UpdateItem`, and `secretsmanager:GetSecretValue` on the pool
  resources.

Nothing new to provision here.

---

## 6. Provide the reference repos to Claude Code

The build needs all three as local unzipped directories. `CLAUDE.md` tells it to
stop rather than build from memory if they are absent.

- `launchdarkly-auto-factory`
- `ld-workshop-gh-copilot-cleanup`
- `ld-workshop-ac-mcp`

---

## 7. Build and publish the VM image

Per `image-requirements.md`. The two items most likely to bite:

- The `factory-floor` service unit, because a missing one fails silently at setup
  and the learner just sees an empty tab.
- `npm ci` in `/opt/ld/auto-factory` at bake time, because doing it at lab time
  costs minutes.

---

## 8. Dry run, in this order

1. **Game against history.** Point the game at a repo with a completed run and
   confirm it replays to `complete`. This is testable without any agent running
   and catches most of the parsing work.
2. **One full session.** Single sandbox, watch a real chain end to end. Time each
   phase and write the numbers into challenge 03's assignment text.
3. **Retooling.** Verify challenge 05 — does the agent actually honour a naming
   convention added to its instructions in LaunchDarkly? Run it several times.
   The check script treats non-compliance as a warning rather than a failure for
   exactly this reason, but you want to know the real hit rate.
4. **Two sandboxes at once.** Confirm the pool hands out different users and
   different repos, and that both chains run without interfering.
5. **Ungraceful shutdown.** Kill a sandbox without letting cleanup run. Confirm
   the sweeper releases the pool row and that the next session's setup resets the
   repo cleanly. This is the failure mode that strands a live workshop.

---

## Open questions worth answering before the build

Not blockers, but each one changes something:

- **Automation scope.** One Automation per repo, or one covering many? Collapses
  section 3 if the latter.
- **Force-push and the environment snapshot.** If rewriting `main` invalidates
  Cursor's saved cloud environment, the reset strategy should change from history
  rewrite to branch delete-and-recreate.
- **Queued agents.** If twelve concurrent cloud agents can queue, challenge 03's
  text needs a sentence about it, because a queued agent and a broken lab look
  identical from inside the sandbox.
- **The demo change.** `track-spec.md` leaves the exact verbatim edit in challenge
  03 to the builder, with instructions to pick something unambiguously
  user-facing and report what it chose. Worth reviewing that choice, since a
  change that reads as config-only will make the research planner correctly
  short-circuit and no flag will be created.
