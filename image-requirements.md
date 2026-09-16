# Image requirements: `launchdarkly/workshop-autofactory-cursor`

Handoff document for whoever bakes the VM image. Not something Claude Code acts
on.

This track runs AutoFactory Phase 1 through the **Cursor cloud Automation** front
end. A Cursor Automation with a *Pull request opened* trigger fires a cloud
sandbox, which reads `.cursor/rules/autofactory.mdc`, fetches each phase's agent
instructions from LaunchDarkly at runtime via the LaunchDarkly MCP server, opens
its own PR, and comments on the triggering PR.

The consequence that shapes this image: **the agents do not execute on the
workstation.** The VM opens a pull request, watches what comes back, and renders
it. No agent runtime, no Anthropic key, no Cursor key, no `@cursor/sdk`.

## Base

Derive from `launchdarkly/image-pov-python-v2`, the image behind the
`ld-workshop-gh-copilot-cleanup` track. Three things in it are load-bearing here:

- `/opt/ld/util/` — `pool.py`, `gh_auth.py`, `pat.py`, `totp.py`, the GitHub
  account pool client
- `/opt/ld/terraform-ld-student/` — provisions one LaunchDarkly project per
  sandbox keyed on `_SANDBOX_ID`
- `python3` with `boto3` available, and `jq`

Only one LaunchDarkly project is needed. AutoFactory normally separates a factory
project from an app project for blast-radius isolation; this track deliberately
collapses them into the single project that Terraform already creates. **The
Terraform needs no changes.**

The demo app is AutoFactory's own `examples/demo-app` (Node `frontend/`, Python
`backend/`), not ToggleWear. Its shipped `environment.json` already matches that
layout, which is why it was chosen.

## Required

**Node 20 or newer.** AutoFactory declares `engines.node >= 20` and pins `.nvmrc`
to 20. The game server also runs on Node. Node 24 is **not** needed; that
requirement belongs to the GitHub Action's `cursor` provider path, which this
track does not use.

**The AutoFactory tooling checkout, with dependencies installed.**

```
/opt/ld/auto-factory        # checkout of launchdarkly-auto-factory
```

Run `npm ci` at bake time. Track setup calls `npm run bridge -- provision` from
here to seed the learner's project with the nine agent and judge configs, the
`gha-auto-factory` graph, and the operational flags from
`config/agentcontrol/flags/`. A cold `npm ci` mid-lab costs minutes of dead time.

**The `gh` CLI.** Track setup and every check script use it: resetting the repo,
closing stale PRs, listing PRs and diffs. Authentication comes from the pool
user's GitHub App installation token, never a user login.

**Git, configured for non-interactive HTTPS.** Setup clones with an
`x-access-token` URL, so no credential helper is strictly required, but a
committer identity should be present as a fallback.

**The game server.**

```
/opt/ld/factory-floor/      # contents of game/ from the track repo
```

Zero npm dependencies by design, so nothing to install. Needs a service unit
named `factory-floor` that reads `/opt/ld/factory-floor/.env` and listens on
7777. Track setup writes that `.env` then does `stop` followed by `start` —
**not** `restart`, which sends SIGHUP and will not reload the environment. This
is the same trap the ac-mcp track's setup documents for `togglewear`.

**A writable scratch path at `/opt/ld/autofactory-app`.** Setup clones the
assigned org repo here. It must not exist in the baked image; setup removes and
re-clones it.

## Strongly recommended

**The LaunchDarkly MCP server, pre-warmed.**

```
npm install -g @launchdarkly/mcp-server
```

Cloud agents get MCP from Cursor's web configuration, not from the repo, so the
chain itself does not use this. Bake it anyway: it is cheap, and it keeps the
option of a challenge that queries LaunchDarkly from the workstation without a
visible cold `npx` stall.

**Pre-seed the `pristine` tag check.** Nothing to install, but worth a bake-time
smoke test: confirm every one of the twelve org repos has a `pristine` tag, since
setup's `git checkout -B main refs/tags/pristine` fails hard without it.

## Secrets

Three, all inherited. No new Instruqt secrets.

| Secret | Purpose |
|---|---|
| `LAUNCHDARKLY_ACCESS_TOKEN` | Terraform, `bridge provision`, all check scripts |
| `AWS_ACCESS_KEY_ID` | DynamoDB pool checkout, Secrets Manager reads |
| `AWS_SECRET_ACCESS_KEY` | as above |

`CURSOR_API_KEY` is **not** required and should not be added. The Automation runs
on Cursor's side and is triggered by GitHub, so nothing in the sandbox calls
Cursor's API. `ANTHROPIC_API_KEY` is likewise not required — no agent executes
locally.

No Bedrock access is needed either, since ToggleWear is not part of this track.

## Outbound network

- `app.launchdarkly.com` — Terraform, `bridge provision`, check scripts, and the
  LaunchDarkly UI in the virtual browser
- `api.github.com` and `github.com` — repo reset, push, PR operations, and the
  game server's polling
- `dynamodb.<region>.amazonaws.com` and
  `secretsmanager.<region>.amazonaws.com` — pool checkout and release

No egress to Cursor, npm, or Bedrock at lab time.

## Verify before the first dry run

**Whether a Cursor Automation survives a force-push that rewrites `main`.** Setup
resets each repo with `git checkout -B main refs/tags/pristine` followed by a
force push. If that invalidates Cursor's saved cloud environment, every session
pays the environment setup cost again, and the first phase of challenge 03 gets
much slower. If it does invalidate, switch the reset strategy from history
rewrite to branch deletion and re-creation, and re-measure.

**Cloud sandbox environment setup time on a freshly reset repo.**
`environment.json` installs the app's dependencies before the tests phase can
run. Measure it. This number goes straight into challenge 03's assignment text as
an honest expectation.

**Concurrency headroom on the shared Cursor account.** The pool caps the lab at
twelve simultaneous sessions, so the ceiling only needs to clear twelve
concurrent cloud agents. Confirm it does, and find out what a queued agent looks
like — from inside the sandbox, queued and broken are indistinguishable, so if
queueing is possible the assignment text needs to say so.

**Whether the agents reliably post per-phase status comments.** The game's gate
timing depends on them. The fallback rules in `game-spec.md` cover their absence,
but the experience is much better when they arrive. AutoFactory's own README
names fetch-and-obey reliability as the thing this prototype is testing, so treat
it as unproven until measured over several runs.

**Tool definitions after `bridge provision`.** Provision stores only tool
*references*, not definitions, so tools may need re-attaching in LaunchDarkly.
The cloud path resolves tools through the bootstrap rule's translation table and
the MCP server rather than through LaunchDarkly tool definitions, so this is
probably harmless here. Confirm rather than assume.

**Pool table sharing.** This track should check out from the **same**
`gh-copilot-workshop-users` table as the copilot-cleanup track, not a copy. One
table gives global mutual exclusion across both tracks; two tables would let two
sandboxes hold the same GitHub account at once.
