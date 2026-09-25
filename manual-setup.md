# Manual setup

Everything here is work only a human can do — web UIs, one-time provisioning, and
decisions with a credential attached. The specs assume it is already done. In
practice, items 1, 5 (the IAM role), 6, and 7 were scripted with the track
owner's own credentials and run from this machine; the status table below says
what remains.

Rough order. Items 1 through 5 block the first dry run. Item 6 blocks the build.

## Status as of 2026-09-16

| Item | State |
|---|---|
| 1. App repos | **Done.** All twelve created, seeded, tagged `pristine`, pool users granted write. |
| 2. LaunchDarkly MCP in Cursor | Pending. Web UI. |
| 3. Cursor Automations | Pending. Web UI. |
| 4. Per-phase status in the prompt | Pending. Goes in with item 3. |
| 5. Pool and sweeper | Table and sweeper reused as-is. **New:** the workstation's federated IAM role is applied (see 5). Sweeper invocation not yet re-confirmed. |
| 6. Reference repos | **Done.** |
| 7. VM image | **Done.** `launchdarkly/workshop-autofactory-cursor` saved from `scripts/build_script.sh`. |
| Track on Instruqt | **Pushed** at `https://play.instruqt.com/manage/launchdarkly/tracks/ld-autofactory-cursor`, pointing at the real image. |
| 8. Dry run | Not started. Blocked on items 2 and 3. |

---

## 1. Twelve app repos in `launchdarkly-training`

**Done 2026-09-16.** Created with a throwaway script run by the track owner (the
owner's `gh` login is an org admin), not by hand and not from the track repo.
Each repo is public, seeded from one identical tree, and tagged `pristine` on
the seed commit. One addition beyond the list below: a four-line `.gitignore`
(`node_modules/`, `__pycache__/`, `.venv/`, `*.pyc`) so an agent's pull request
never carries installed dependencies. Pool users `launchdarkly-user-01` through
`-12` have **write** on the matching `autofactory-NN`, added directly with no
pending invitations. Verified: `pristine` tag and all 14 seed files present.

The original plan follows, for the record and for any future re-seed. Remember
that re-seeding means moving the `pristine` tag, never deleting the repo.

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

**Seen in the first dry run (2026-09-24): the connection expires.** The agent
ran and every LaunchDarkly MCP call failed with `401 token_expired`,
`"action":"reauthenticate"`, including the caller-identity probe
`get-member-self`. It retried for two and a half minutes and then halted,
reporting all five phases as `skipped` and creating nothing. A connection made
through the MCP dropdown's sign-in flow is an OAuth session, and OAuth sessions
expire; a workshop cannot depend on someone re-authenticating between
sessions. Use a long-lived **API access token** (`api-...`) instead: create it
in LaunchDarkly with the operator-level role described above, store it as a
Cloud Agent secret (Cursor Dashboard → Cloud Agents → Secrets), and configure
the LaunchDarkly MCP server to read it from that secret. The agent's own halt
comment pointed at exactly this fix.

---

## 3. Twelve Cursor Automations

At **cursor.com/automations** (or `/automate`), one per repo. For each:

- **Trigger:** *Pull request opened*, on `launchdarkly-training/autofactory-NN`.
- **Tools enabled:** LaunchDarkly MCP, Open PR, Comment on PR.
- **Prompt:** the body of
  `bootstrap/cursor-automation/cloud-automation-prompt.md`, everything below the
  horizontal rule, **plus the per-phase status addition in section 4 below,
  minus the two fallback project-key lines.** The shipped prompt says to fetch
  agent configs from `auto-factory-prototype` and create flags in
  `autofactory-demo` "if the rule failed to load". Setup rewrites the rule
  file per session; it cannot touch the prompt. In the first dry run the
  agent's halt comment named both of those default projects, so it does read
  them. Delete those lines. With them gone, the only project key the agent
  can find is the one in `.cursor/rules/autofactory.mdc`, which is the right
  one for that session.

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

Append this to each Automation's prompt. A correction to an earlier version of
this note: during the first full run the agent **did** post a per-phase status
block, promptly and well formed, under the original gentler wording. The floor
still opened nothing, because Cursor's "Comment on PR" tool posts **pull
request reviews**, and the game (and the challenge 03 check) read only
conversation comments, which the `issues/{n}/comments` endpoint returns. Both
now read reviews too (game 1.2.0). The stronger wording below is kept because
it costs nothing and makes the timing explicit, not because the agent failed
to comply.

> ## Progress reporting (required, per phase, not deferred)
>
> The pull request is your progress log. A dashboard reads your comments on
> the **triggering** pull request and opens one gate per phase as you report
> it, so a comment posted late is a gate that stays shut.
>
> **Rule: a phase is not finished until its status comment is posted.**
> Immediately after you complete a phase, and **before you begin the next
> one**, post a comment on the triggering pull request. Do this five times, once
> for each of `research`, `flag`, `metrics`, `tests`, `review`. Never batch these
> comments, never combine two phases into one comment, and never wait for the
> chain to finish. Posting the comment is the last step of every phase.
>
> Each status comment must contain exactly one fenced JSON block of this shape,
> using strict JSON with double quotes and lowercase `true`/`false`, and
> nothing else inside the fence:
>
> ```json
> { "autofactory_phase": "flag", "status": "complete", "artifacts": ["enable-backend-status"] }
> ```
>
> - `autofactory_phase`: one of `research`, `flag`, `metrics`, `tests`, `review`.
> - `status`: `complete` when the phase did its work; `skipped` when the phase
>   did not run (for example, the research phase decided no flag is needed, or
>   the chain cannot run at all). If you halt early, post a `skipped` block for
>   every remaining phase before you stop.
> - `artifacts`: the keys or paths the phase created. Flag keys for `flag`,
>   metric keys for `metrics`, the manifest path for whichever phase wrote it,
>   test file paths for `tests`. An empty array is fine.
>
> You may also post `{ "autofactory_phase": "<phase>", "status": "started" }`
> when you begin a phase; it lights the gate's working lamp. It is optional.
> The `complete` or `skipped` comment is not.
>
> These status comments are **in addition to** the final summary comment,
> which must still end with the verdict as a fenced JSON block, again in strict
> JSON:
>
> ```json
> { "review_approved": true, "risk_level": "low" }
> ```
>
> Post the summary and the verdict on the triggering pull request, not only
> on the pull request you open.

The dashboard is tolerant of sloppy JSON (single quotes, unquoted keys) and
of comments landing on the agent's own pull request, but the *timing* is the
thing only the prompt can fix: a comment that arrives at the end cannot open a
gate in the middle.

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

**Done 2026-09-16: a dedicated IAM role for the workstation.** This turned out
not to be "nothing new". The `RoleForAccessFromInstruqt` role the hand-copied
credential helper pointed at is the ai-configs-intro track's Bedrock-only role,
and its trust policy is pinned to that track's audience, so it could neither be
assumed with this track's token nor read the pool table.
`terraform/aws-role/` creates `InstruqtAutoFactoryCursorRole` in account
`955116512041`, trusted by the Instruqt node-pool service account for audience
`instruqt-agentcontrol-cursor`, with exactly the pool client's needs: Query and
UpdateItem on `gh-copilot-workshop-users` and its GSIs, GetSecretValue on
`gh-copilot-workshop/*`, PutSecretValue on the refresh-token secrets. Applied
with the solutions-engineering admin SSO profile; state is local and gitignored.

How the two credential paths split: the `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` Instruqt secrets are elevated and exist **only while the
track-level setup and cleanup scripts run**, so those use static keys. During
the interactive session they are gone, and anything touching AWS falls through
to the `BasicProfile` profile, whose `credential_process` is
`/opt/bin/credentials.sh` (`scripts/credentials.sh` in this repo). Both paths
must keep working. Do not remove the two secrets from `config.yml`.

Still to confirm: invoke the sweeper once and check its output.

---

## 6. Provide the reference repos to Claude Code

**Done.** The build needs all three as local unzipped directories. `CLAUDE.md`
tells it to stop rather than build from memory if they are absent.

- `launchdarkly-auto-factory`: was only present as a zip in `~/Downloads`;
  unzipped to `../_ref/launchdarkly-auto-factory-main/`, outside this repo. The
  canonical source is `github.com/launchdarkly-labs/launchdarkly-auto-factory`.
- `ld-workshop-gh-copilot-cleanup`: sibling directory, `instruqt/` tree.
- `ld-workshop-ac-mcp`: sibling directory. Note its track lives in
  `instruqt-build/`, not `instruqt/`.

---

## 7. Build and publish the VM image

**Done 2026-09-16.** Saved as `launchdarkly/workshop-autofactory-cursor` from a
VM built with `scripts/build_script.sh`, pasted into the console as root on top
of `launchdarkly/image-pov-python-v2`. The script is idempotent; to rebuild,
start from the same base and paste it again. Pin `AUTOFACTORY_REF` to a commit
before a workshop so a push to that repo cannot change the provisioned configs.

Per `image-requirements.md`. The two items most likely to bite:

- The `factory-floor` service unit, because a missing one fails silently at setup
  and the learner just sees an empty tab.
- `npm ci` in `/opt/ld/auto-factory` at bake time, because doing it at lab time
  costs minutes.

Four things that bit during the first bake, all now handled in the script:

- **The AWS CLI was missing.** `credentials.sh` shells out to `aws sts`; without
  the binary it printed an error and boto3 failed with a `JSONDecodeError`.
- **The AWS CLI pager.** `aws sts get-caller-identity` on a TTY opens `less`,
  which looks like a hang when the script is pasted. `AWS_PAGER=""` is exported.
- **`credential_process` recursion.** Calling `aws` with `AWS_PROFILE=BasicProfile`
  ran the helper, which inherited the profile and ran itself again forever.
  The helper now unsets `AWS_PROFILE` before it calls `aws`, and the smoke test
  uses `--profile` under `timeout`.
- **macOS `bash -n` is Bash 3.2** and does not parse inside `$( )`, so it passed
  a quoting error that Linux Bash 5 rejected. Check the script on Linux.

---

## 8. Dry run, in this order

**Precondition met:** the track is pushed to Instruqt and points at the real
image. **Precondition not met:** items 2 and 3. Until an Automation exists,
challenge 03 opens a pull request and nothing answers it.

When pushing the track again, `instruqt track push` writes `id` and `checksum`
values back into `track.yml` and every `assignment.md`. Revert them with
`git checkout -- instruqt/` before committing; the repo convention is stripped
identifiers. The remote already exists, so a push after local edits may need
`--force`.

1. **Game against history.** Point the game at a repo with a completed run and
   confirm it replays to `complete`. This is testable without any agent running
   and catches most of the parsing work. The server also takes a
   `FACTORY_FIXTURE=<file.json>` env var that replays a hand-written PR history
   with no GitHub access at all; it was exercised against idle, complete,
   fallback-only, short-circuit, and rejected histories during the build.
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
- **The demo change.** Chosen: challenge 03 adds a live **backend status** line
  to the frontend page (fetches the backend's `/api/status` and shows service
  and version, or "Backend offline"); challenge 05 adds a **Refresh greeting**
  button. Both are full-file heredoc rewrites of `frontend/server.mjs` so the
  run is reproducible. Still worth watching in the dry run: if the planner
  short-circuits on either, the change needs to be more obviously user-facing.
- **The Automation prompt's fallback project keys.** The shipped prompt ends
  with two lines naming `auto-factory-prototype` and `autofactory-demo` "if the
  rule failed to load". Setup rewrites the rule per session but cannot touch
  the prompt, so consider dropping those lines when creating the Automations.
- **Manifest filename.** The rule names the manifest after the branch
  (`.release-flags/<change-id>.json`), not `pr-N.json` as `track-spec.md`
  says. Assignments and solve scripts follow the rule.
