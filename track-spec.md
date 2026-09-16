# Track specification: ld-workshop-autofactory-cursor

Design detail for the track described in `CLAUDE.md`. Read that file first, and
`game-spec.md` for the visualization.

## Premise

The learner is the supervisor of a factory floor. Raw pull requests come in one
end. A chain of Cursor cloud agents works them: deciding whether the change needs
a flag, creating it, instrumenting metrics, writing tests, and inspecting the
result. Flagged, tested, monitored code comes out the other end.

The agents' instructions live in LaunchDarkly, not in the repo, and they are
fetched at the start of every phase. That is the lesson: you retool the factory by
editing configuration, not by shipping code.

## Challenge map

| Dir | Slug | Est. | `timelimit` |
|---|---|---|---|
| `01-the-factory-floor` | `the-factory-floor` | 8 min | 900 |
| `02-how-agents-get-their-orders` | `how-agents-get-their-orders` | 10 min | 900 |
| `03-start-the-line` | `start-the-line` | 20 min | 1800 |
| `04-inspect-the-goods` | `inspect-the-goods` | 10 min | 900 |
| `05-retool-the-factory` | `retool-the-factory` | 17 min | 1500 |
| `06-end-of-shift` | `end-of-shift` | 3 min | 300 |

Expected total 68 minutes. `timelimit` values sit roughly 50% above expected so a
slow learner is not cut off. Track `timelimit` is `7200`, matching
`POOL_LOCK_TTL_SECS`.

If a dry run comes in long, take it out of 02. Do not shorten 03 or 05; they are
the reason the track exists.

## track.yml

Copy the `lab_config` block, `icon`, `owner`, `developers`, `show_timer`, and
`idle_timeout` from the copilot-cleanup track. Change:

- `slug`: `ld-autofactory-cursor`
- `title`: `Run an Agent Factory with Cursor and AgentControl`
- `timelimit`: `7200`
- `tags`: `cursor`, `ai`, `agentcontrol`, `mcp`, `feature-flags`
- `id`, `checksum`: remove
- `teaser` and `description`: written fresh. The description must convey that
  cloud agents do the work, that their instructions live in LaunchDarkly, and
  that the learner watches the chain run. It must not mention the GitHub Action,
  guarded releases, or the provider flag.
- Add `theme: name: modern-dark` under `lab_config` to match the ac-mcp track.

## config.yml

Start from the copilot-cleanup track's file. Changes:

```yaml
version: "3"
virtualbrowsers:
- name: launchdarkly
  url: https://i3vcudz5ncoet6xkoaqxnos7mu0sdcpz.lambda-url.us-east-2.on.aws/?sandboxId=${_SANDBOX_ID}
- name: github
  url: https://github.com/launchdarkly-training
virtualmachines:
- name: workstation
  image: launchdarkly/workshop-autofactory-cursor
  shell: /bin/bash
  machine_type: n1-standard-2
secrets:
- name: LAUNCHDARKLY_ACCESS_TOKEN
- name: AWS_SECRET_ACCESS_KEY
- name: AWS_ACCESS_KEY_ID
```

Note: `n1-standard-2`, not `-1`. The game service and the demo app run
alongside each other. No new secrets — the pool already delivers GitHub
credentials through AWS, and nothing here talks to Cursor's API.

## track_scripts

**Append-only.** Copy both files from the copilot-cleanup track verbatim, then add
the blocks below at the end.

### setup-workstation (appended)

Runs after the inherited pool checkout and `terraform apply`, so `GH_USER`,
`GH_TOKEN`, `LD_PROJECT_KEY`, and `LAUNCHDARKLY_ACCESS_TOKEN` are all in scope.

```sh
###################
# AutoFactory: assign an org repo, seed the LD project, start the game
###################

# Pool usernames end in a two-digit index (launchdarkly-user-07). The app repos
# are named to match, one per pool user, so assignment needs no extra state.
POOL_IDX="$(echo "$GH_USER" | grep -oE '[0-9]+$')"
AF_REPO="launchdarkly-training/autofactory-$(printf '%02d' "$POOL_IDX")"
echo "export AF_REPO=\"$AF_REPO\"" >> ~/.bashrc
echo "export AF_REPO=\"$AF_REPO\"" >> ~/.profile
agent variable set af_repo "$AF_REPO"

# Reset the repo to its pristine tag. Force-push is deliberate: the previous
# session's agent branches and commits go away. The `pristine` tag is created
# once, by hand, at repo provisioning time (see manual-setup.md).
WORK=/opt/ld/autofactory-app
rm -rf "$WORK"
git clone "https://x-access-token:${GH_TOKEN}@github.com/${AF_REPO}.git" "$WORK"
cd "$WORK"
git checkout -B main refs/tags/pristine
git push --force origin main

# Close anything the last session left open, in case its cleanup did not run.
gh pr list --repo "$AF_REPO" --state open --json number -q '.[].number' \
  | xargs -r -I {} gh pr close {} --repo "$AF_REPO" --delete-branch || true

# Point the agents at this sandbox's LaunchDarkly project. The cloud agent reads
# project keys from this rule file, not from its MCP token, which is shared.
RULE="$WORK/.cursor/rules/autofactory.mdc"
sed -i "s/^\(.*factory project.*\)auto-factory-prototype/\1${LD_PROJECT_KEY}/" "$RULE"
sed -i "s/autofactory-demo/${LD_PROJECT_KEY}/g" "$RULE"
sed -i "s/auto-factory-prototype/${LD_PROJECT_KEY}/g" "$RULE"
git -C "$WORK" add .cursor/rules/autofactory.mdc
git -C "$WORK" -c user.email="workshops@launchdarkly.com" -c user.name="AutoFactory Setup" \
  commit -m "Point AutoFactory at this session's LaunchDarkly project"
git -C "$WORK" push origin main

# Seed the project with the agent configs, judge configs, graph, and operational
# flags. `bridge provision` is idempotent and REST-only.
cd /opt/ld/auto-factory
LD_API_KEY="${LAUNCHDARKLY_ACCESS_TOKEN}" \
LD_PROJECT_KEY="${LD_PROJECT_KEY}" \
LD_BASE_URL="https://app.launchdarkly.com" \
  npm run bridge -- provision

# Start the game with this session's context.
GAME_ENV=/opt/ld/factory-floor/.env
{
  echo "AF_REPO=${AF_REPO}"
  echo "GITHUB_TOKEN=${GH_TOKEN}"
  echo "LD_PROJECT_KEY=${LD_PROJECT_KEY}"
  echo "PORT=7777"
} > "$GAME_ENV"
service factory-floor stop || true
service factory-floor start
```

Two notes for the builder. The `sed` calls are written defensively because the
exact wording around project keys in `autofactory.mdc` is not guaranteed stable —
read the actual file in the AutoFactory checkout and adjust the expressions to
match what is really there, then verify by grepping the result for
`auto-factory-prototype` and `autofactory-demo` and asserting both are gone.
Second, `service ... restart` sends SIGHUP, which will not reload the env; stop
then start, as the ac-mcp track's setup does for `togglewear`.

### cleanup-workstation (appended)

Goes at the very end, after the inherited pool release. Everything is
best-effort; setup resets the repo anyway, so this is politeness, not
correctness.

```sh
###################
# AutoFactory: tidy the org repo (best-effort; setup resets it regardless)
###################
if [ -n "${AF_REPO:-}" ]; then
  gh pr list --repo "$AF_REPO" --state open --json number -q '.[].number' \
    | xargs -r -I {} gh pr close {} --repo "$AF_REPO" --delete-branch || true
fi
```

Deliberately minimal. The correctness guarantee is that **setup** resets, which
survives a sandbox that dies without running cleanup.

---

## 01 — The Factory Floor

Orientation. The learner sees the agent configs and the graph in LaunchDarkly,
and the game tab with every gate shut.

### Front matter

- `slug`: `the-factory-floor`
- `type`: `challenge`
- `title`: `The Factory Floor`
- `teaser`: the crew that will do the work, and where their instructions live
- `timelimit`: `900`
- Tabs:

  | Index | Title | Type | Host / port |
  |---|---|---|---|
  | 0 | LaunchDarkly | `browser` | `launchdarkly` |
  | 1 | Factory Floor | `service` | `workstation`, `7777` |
  | 2 | Terminal | `terminal` | `workstation` |

### setup-workstation

`#!/bin/sh` then `exit 0`. Track setup did the work.

### Assignment body

Four beats.

**1. The crew.** Open the LaunchDarkly tab. Nine AI configs were provisioned into
this project. Name the five that run on a pull request and say in one line what
each does: research planner, manifest steward, flag implementer, metrics author,
flag testing, code reviewer. Note that the judges are separate configs that grade
the work. Have the learner open `autofactory-flag-implementer` and read its
instructions. Point out this is plain text in LaunchDarkly, not code in a repo.

**2. The running order.** Show them the agent graph. Explain edges carry the
handoff: `capabilities` lists what the next agent is allowed to do, and
`require_tags` / `skip_if_tags` decide whether an edge is taken at all. Give the
flag-implementer edge as the concrete example — it grants `create_flag`,
`flag_state`, `edit_files`, `write_manifest`, `read_docs`, `query_repos`, and the
metrics edge only fires when the previous agent tagged `flag_ready: true`.

**3. The floor.** Open the Factory Floor tab. Five gates, all shut, no flaglings
on the conveyor yet. One sentence per gate mapping it to the agent that opens it.

**4. What happens next.** They will open a pull request and the line will start.
Nothing is running yet.

### check-workstation

Assert the project was seeded: GET the AI configs for `LD_PROJECT_KEY` and
confirm `autofactory-flag-implementer` and `autofactory-metrics-author` both
exist. Failure message should say the project did not finish provisioning and to
restart the lab. This checks setup, not learner work, which is intentional for an
orientation challenge.

### solve-workstation

`#!/bin/sh` then `exit 0`.

---

## 02 — How Agents Get Their Orders

The learner reads the bootstrap rule and understands the runtime fetch. No agents
run.

### Front matter

- `slug`: `how-agents-get-their-orders`
- `title`: `How Agents Get Their Orders`
- `timelimit`: `900`
- Tabs: Terminal `#tab-0`, LaunchDarkly `#tab-1`, GitHub `#tab-2`, Factory Floor `#tab-3`

Terminal first so it opens by default.

### setup-workstation

`#!/bin/sh`, `exit 0`. The repo is already cloned at `/opt/ld/autofactory-app`.

### Assignment body

**1. Your repo.** Give the assigned repo via
`[[ Instruqt-Var key="af_repo" hostname="workstation" ]]`, and the local clone
path. Have them `cd /opt/ld/autofactory-app && ls .cursor`.

**2. The bootstrap rule.** Have them open `.cursor/rules/autofactory.mdc`. Three
things to point out:
- It owns sequencing and LaunchDarkly conventions.
- It does **not** contain the agents' instructions. It tells the agent to fetch
  each phase's instructions from LaunchDarkly with the `get-ai-config` MCP tool
  at the moment that phase begins.
- It carries a tool-translation table, because the LaunchDarkly instructions name
  tools from AutoFactory's other runtimes. `create_flag` becomes the MCP
  `create-feature-flag` tool, `create_metric` becomes the MCP metric tool, file
  edits and tests become Cursor's native tools.

**3. Why the translation matters.** One short paragraph: the same instructions in
LaunchDarkly drive several different runtimes. The rule is the adapter. This is
what lets the instructions be the source of truth rather than a copy.

**4. The trigger.** Explain that a Cursor Automation on this repo watches for
*Pull request opened*, and that it runs in Cursor's cloud, not on this machine.
Be explicit that nothing on the workstation runs the agents — the workstation
opens the PR and watches. Mention the loop guard: the automation opens its own
PR, so the prompt tells it to stop if the change set already carries a
`.release-flags/` manifest.

**5. Confirm the project key.** Have them run a grep that shows the rule now
names their sandbox's project key. Give it verbatim:

```text
grep -n "$LD_PROJECT_KEY" .cursor/rules/autofactory.mdc
```

### check-workstation

Assert `/opt/ld/autofactory-app/.cursor/rules/autofactory.mdc` exists and
contains `$LD_PROJECT_KEY`, and that it contains neither
`auto-factory-prototype` nor `autofactory-demo`. This catches a failed `sed` in
setup, which would otherwise fail silently at challenge 03 by sending the agent
to the wrong project.

### solve-workstation

`#!/bin/sh` then `exit 0`. Nothing to solve; it is a reading challenge.

---

## 03 — Start the Line

The main event. Learner makes a change, opens a PR, watches five gates open.

### Front matter

- `slug`: `start-the-line`
- `title`: `Start the Line`
- `teaser`: one pull request, five agents, no code written by you
- `timelimit`: `1800`
- Tabs: Factory Floor `#tab-0`, Terminal `#tab-1`, GitHub `#tab-2`, LaunchDarkly `#tab-3`

Factory Floor first — the learner should be looking at the game while it runs.

### setup-workstation

`#!/bin/sh`, `exit 0`.

### The change the learner makes

It has to be a real user-facing behaviour change, or the research planner will
correctly short-circuit and no flag gets created. Pick one small, visible change
in `examples/demo-app`'s frontend and give it verbatim as a fenced block — a
copy-paste edit, not a described one, so the run is reproducible and the check
script can rely on it. Read `examples/demo-app/frontend/server.mjs` and
`examples/demo-app/GUIDE.md` and choose something that is unambiguously
user-facing. State the chosen change in your final report.

### Assignment body

**1. Make the change.** The verbatim edit, applied on a new branch. Give the
whole sequence as one fenced block: branch, edit, commit, push, open PR with
`gh pr create`.

**2. Watch the floor.** Switch to the Factory Floor tab. Explain what they are
seeing as it happens: flaglings enter, they pile at the first gate, each gate
opens when its agent finishes and posts its status to the pull request. Be honest
that the whole chain takes several minutes and that the first phase is the
slowest because the cloud sandbox is installing dependencies.

**3. What each gate means.** A short list, one line per gate, naming what the
agent behind it produced. Keep it tight; the detail belongs in 04.

**4. The second PR.** When the line finishes, the automation opens its own pull
request carrying the flag wiring, and comments on theirs with the flag key,
metric keys, manifest path, and a verdict JSON block. Have them find both.

Add an honest note: if the research planner decides no flag is needed, the line
diverts to the side door and no PR is opened. That is correct behaviour, not a
failure. If it happens, their change was not user-facing enough — revert and use
the verbatim edit.

### check-workstation

1. Assert the learner's PR exists on `AF_REPO` (open or merged).
2. Assert a **second** PR exists whose head branch is not the learner's, and
   whose changed files include a path under `.release-flags/`. Use
   `gh pr list --json number,headRefName` then `gh pr diff --name-only`.
3. Assert the learner's PR has at least one comment containing the string
   `review_approved`.

Do not assert on the flag existing here — that is 04's job, and splitting the
assertions gives a clearer failure message about which half broke.

Each failure message should name the specific thing missing and point at the
assignment section. If the second PR is absent, the message should mention the
short-circuit case explicitly, since that is the most likely benign cause.

### solve-workstation

Cannot drive the agents. Instead: create the flag, the two metrics, and a
`.release-flags/pr-N.json` manifest via `curl` against the LaunchDarkly API and
`gh`, then open a PR from a branch carrying the manifest, and post a comment with
a `review_approved` JSON block. Model the flag and metric request shapes on the
reference tracks' calls plus the LaunchDarkly API docs. **If you cannot determine
a request shape with confidence, stop and say so rather than shipping a solve
script that fails silently.**

---

## 04 — Inspect the Goods

What the agents actually produced. No agent runs.

### Front matter

- `slug`: `inspect-the-goods`
- `title`: `Inspect the Goods`
- `timelimit`: `900`
- Tabs: LaunchDarkly `#tab-0`, GitHub `#tab-1`, Terminal `#tab-2`

### Assignment body

**1. The flag.** In LaunchDarkly, find the flag the agent created. Point out it
is targeting **off** in every environment. Nothing changed for any user. That is
the intended end state of Phase 1.

**2. The metrics.** The metrics the agent created, and why an agent creating
metrics matters: the change arrives already measurable rather than needing
instrumentation added later.

**3. The manifest.** `.release-flags/pr-N.json` on the agent's branch. This is
the handoff artifact — a machine-readable record of what was flagged. Say plainly
that acting on it is out of scope for this track.

**4. The tests.** The flag-on and flag-off tests. Have them run the test suite
locally from the agent's branch.

**5. The verdict.** The JSON block in the PR comment, and the risk level. Note
the verdict is reported, not enforced.

### check-workstation

1. GET flags for `LD_PROJECT_KEY`; assert at least one flag exists that is not
   one of the five `auto-factory-*` operational flags provisioned by `bridge`.
   Filter those out by key prefix explicitly.
2. Assert every environment's targeting on that flag is off.
3. GET metrics for the project; assert at least one exists that is not
   `sentry-errors-binary` or `sentry-errors-count`.

Be tolerant on naming. The flag key is chosen by an agent and will vary.

### solve-workstation

`#!/bin/sh` then `exit 0`. 03's solve created these artifacts; there is nothing
for the learner to do here but read.

---

## 05 — Retool the Factory

The payoff. Change an agent's instructions in LaunchDarkly, run the line again,
see different output with no code deployed.

### Front matter

- `slug`: `retool-the-factory`
- `title`: `Retool the Factory`
- `teaser`: change how the factory works without shipping anything
- `timelimit`: `1500`
- Tabs: LaunchDarkly `#tab-0`, Factory Floor `#tab-1`, Terminal `#tab-2`, GitHub `#tab-3`

### Assignment body

**1. The idea.** One paragraph. The agents fetched their instructions at runtime
last time and will again this time. Editing the instructions in LaunchDarkly
changes the next run. No deploy, no repo change, no restart.

**2. Make the change.** Have them edit `autofactory-flag-implementer`'s
instructions to add a flag-naming convention, and give the sentence to append
verbatim so the check script can assert on the result. Use a prefix distinctive
enough to be unambiguous, for example requiring every flag key to start with
`shift2-`. Save the variation.

**3. Run the line again.** A second verbatim change to the demo app on a new
branch, pushed, PR opened. Same watch-the-floor loop. Note it will be faster
this time because the cloud environment is warm.

**4. Read the difference.** The new flag carries the prefix. Same repo, same
agents, same trigger — only the instructions changed.

**5. Be honest about it.** Add a short, plain paragraph: the agent is following
instructions in natural language, so compliance is not guaranteed the way a code
change would be. If the prefix did not appear, that is a real property of the
approach and worth understanding, not a lab malfunction. Say what to do — read
the agent's comment on the PR to see what it thought it was doing.

### check-workstation

1. GET `autofactory-flag-implementer` and assert its instructions contain
   `shift2-` (or whatever prefix the spec settles on). This is the learner's
   actual work and must pass.
2. Assert a second learner PR exists and a second agent PR exists.
3. Assert a flag whose key starts with the prefix exists in the project. **This
   assertion must be a warning, not a hard failure** — print a clear message that
   the instruction edit was made correctly but the agent did not follow it, and
   still exit 0. Instruction-following is what this prototype is testing, and a
   learner should not be blocked by the agent's non-compliance.

Put a comment in the script explaining why item 3 is soft. A future maintainer
will otherwise "fix" it into a hard failure.

### solve-workstation

PATCH the agent config's variation instructions to include the prefix via `curl`,
then create a prefixed flag and open a PR carrying a manifest, as in 03. Same
instruction about not guessing API shapes.

---

## 06 — End of Shift

### Front matter

- `slug`: `end-of-shift`
- `title`: `End of Shift`
- `timelimit`: `300`
- Tabs: LaunchDarkly `#tab-0`, Factory Floor `#tab-1`

### Assignment body

- **What ran.** The arc across five challenges, one line each.
- **The three ideas worth keeping.** Agent instructions as configuration rather
  than code. Capability grants on graph edges as the unit of governance. Flags
  created off by default, so an agent can prepare a change without releasing it.
- **What comes next.** Two or three sentences on where the manifest goes in a
  fuller setup, without teaching it. Point at the AutoFactory repo and the
  LaunchDarkly AgentControl docs.
- **Sign-off.** End on the factory conceit. Keep it short.

### Scripts

All three are `#!/bin/sh` then `exit 0`.
