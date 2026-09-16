# ld-workshop-autofactory-cursor

You are building an Instruqt track in this repository. It teaches AutoFactory
Phase 1 driven by **Cursor cloud agents**, with a game-style visualization of the
agent chain running alongside.

Read `track-spec.md` for the per-challenge design and `game-spec.md` for the
visualization app before writing anything. This file covers the rules; those
cover the content.

`manual-setup.md` describes work the track owner does by hand (org repos, Cursor
Automations, pool table). You do not perform any of it and must not write scripts
that attempt to. Assume it is already done.

## What you are building

A six-challenge track, target completion ~70 minutes, in which a learner opens a
pull request against a demo app and watches a chain of Cursor cloud agents wire
that change behind a LaunchDarkly feature flag, instrument it with metrics, write
flag-on/flag-off tests, and review itself. A visualization app renders the chain's
progress as a side-scrolling factory the learner watches gates open in.

Deliverables:

```
instruqt/                    # push this with the Instruqt CLI
game/                        # the visualization app (Node, served on :7777)
lib/                         # nothing new — pool libs live in the image
```

## The architecture you must not drift from

This is the single most important section. There are two different Cursor
integrations in the AutoFactory repo and they are **not** interchangeable.

**We are using the cloud Automation path** (`bootstrap/cursor-automation/`). A
Cursor Automation with a *Pull request opened* trigger fires a cloud sandbox. The
sandbox reads `.cursor/rules/autofactory.mdc` from the repo, fetches each phase's
agent instructions from LaunchDarkly at runtime via the LaunchDarkly MCP
`get-ai-config` tool, carries them out with Cursor's native tools plus the MCP
flag/metric tools, then opens its own PR and comments on the triggering PR.

**We are not using** `CursorAgentRunner` / the `cursor` variation on the
`auto-factory-ai-provider` flag. That runner executes **local** agents on the CI
runner because its LD write tools are Cursor `customTools`, which are local-only
(ADR 0006). It has nothing to do with cloud agents.

Consequences you must respect:

1. **No GitHub Action.** Do not add `auto-factory.yml` or any AutoFactory
   workflow to the app repos. The trigger is the Cursor Automation, configured
   outside the repo.
2. **No agent runtime on the workstation.** No `ANTHROPIC_API_KEY`, no
   `CURSOR_API_KEY`, no `@cursor/sdk`. The workstation opens a PR and watches.
3. **No per-agent LaunchDarkly generation metrics.** Cursor's runtime does not
   emit them. Do not write any challenge, check, or visualization feature that
   depends on AI Config token/duration monitoring.
4. **Phase 1 only.** No Beacon, no guarded releases, no deployment. The flag is
   created targeting off and stays that way.

## Hard constraints

These are not suggestions. Violating any of them breaks the lab.

1. **Never delete or modify an existing line in
   `instruqt/track_scripts/setup-workstation` or `cleanup-workstation`.** You may
   only **append**. Both are derived from the `ld-workshop-gh-copilot-cleanup`
   track and are finely tuned. In particular, leave the pool checkout, the
   `terraform apply`, the `gh repo list | xargs gh repo delete` sweep, and the
   pool release exactly as they are. If a change seems necessary, stop and say
   so in your final report rather than making it.

2. **The twelve app repos live in the `launchdarkly-training` org, not under the
   pool user.** This is why constraint 1 is survivable: the cleanup script's repo
   sweep runs `gh repo list` with no argument, which lists only the authenticated
   user's own repos, so org-owned repos are untouched. Never write code that
   creates the app repo under the pool user.

3. **Strip every Instruqt-assigned identifier.** Instruqt allocates these on
   push. Remove or blank:
   - `id` and `checksum` in `track.yml`
   - `id` in every `assignment.md` front matter
   - `id` in every tab entry in every `assignment.md`

4. **Do not invent LaunchDarkly API shapes.** The reference tracks'
   `check-workstation` scripts are the authority for endpoints, query params, and
   JSON structure. Where the spec calls for a new call, model it on an existing
   one. Keep the `sed 's/\\/\\\\/g'` escaping before `jq` — it exists because
   prompt text contains backslashes that break `jq`.

5. **Do not invent Cursor API shapes either.** Nothing in this track calls
   Cursor's API. If you find yourself wanting to, you have drifted from the
   architecture section above.

6. **Repo state comes from a git tag, not from `gh repo create`.** Setup resets
   the assigned repo by force-pushing `refs/tags/pristine` to `main`. Never
   create, delete, or re-initialise an app repo.

7. **The learner never authenticates to anything.** No GitHub login, no Cursor
   login, no OAuth screens. Credentials arrive via pool checkout and
   `agent variable set`.

8. **Tab links are `[Label](#tab-N)`, zero-based, per that challenge's own tab
   list.** The copilot-cleanup track contains both `#tab-1` and `tab#1`; the
   latter is a broken link. Use `#tab-N` only, and keep indices in sync when tabs
   change.

9. **Instruqt variables use the documented long form**:
   `[[ Instruqt-Var key="projectkey" hostname="workstation" ]]`.

10. **No `type: quiz` challenges.**

11. **No original Lemmings assets, sprite art, character names, music, or the
    word "Lemmings" anywhere in the game or the assignments.** The creatures are
    **flaglings** and all art is original. This is a hard IP line.

## Reference material

Both reference repos should be provided locally as unzipped directories. Confirm
you can see them before starting; if you cannot, stop and say so rather than
building from memory.

| Repo | What to take from it |
|---|---|
| `ld-workshop-gh-copilot-cleanup` | `instruqt/track_scripts/*` (append-only base), `config.yml` secrets + virtual browsers, the `Instruqt-Var` pattern, pool checkout usage |
| `ld-workshop-ac-mcp` | assignment voice, `lab_config` block, check-script style, verbatim-string conventions |
| `launchdarkly-auto-factory` | `bootstrap/cursor-automation/` artifacts, `config/agentcontrol/graphs/auto-factory.json`, `examples/demo-app`, `packages/config-bridge` |

Do not vendor, commit, or submodule any of them.

## Build order

1. Read both reference tracks' `instruqt/` trees in full, plus
   `bootstrap/cursor-automation/` and `config/agentcontrol/graphs/auto-factory.json`.
2. Create `instruqt/`, copy `track_scripts/` and `config.yml` from the
   copilot-cleanup track, then **append** the new setup and cleanup blocks the
   spec defines. Record the appended line counts in your final report.
3. Write `track.yml` per the spec, identifiers stripped.
4. Write the six challenge directories.
5. Write `game/` per `game-spec.md`.
6. Run the verification checklist.

Do not start writing assignment prose before the structure is in place.

## Verification checklist

Report the result of every item. Do not declare the build done until each passes.

- `git diff` against the copilot-cleanup track's `track_scripts/` shows **only
  added lines**, no deletions or modifications, in both files.
- `grep -rn '^id:' instruqt/` returns nothing.
- `grep -rn 'checksum' instruqt/track.yml` returns nothing.
- `grep -rn '  id: ' instruqt/*/assignment.md` returns nothing.
- `grep -rn 'type: quiz' instruqt/` returns nothing.
- `grep -rn 'tab#' instruqt/` returns nothing.
- `grep -rni 'lemming' .` returns nothing.
- `grep -rn 'ANTHROPIC_API_KEY\|CURSOR_API_KEY\|@cursor/sdk\|auto-factory-ai-provider' instruqt/ game/` returns nothing.
- `grep -rn 'gh repo create\|gh repo delete' instruqt/*/` returns nothing (only
  the inherited cleanup sweep may delete, and it lives in `track_scripts/`).
- Every `assignment.md` front-matter `slug` matches the spec.
- Every `#tab-N` reference resolves to a tab that challenge declares, at the
  right zero-based index.
- Every script is executable and starts with a shebang.
- `game/` starts with `npm start` and serves on 7777 with no network egress
  other than `api.github.com`.
- Sum of front-matter `timelimit` values recorded in your final report.

## Writing style for assignments

Second person, plainly written, moves fast. Match the reference tracks' voice.

- Values the learner types verbatim go in fenced ```text blocks on their own.
- Section headings are `#`, used as narrative beats, not a document outline.
- Numbered steps for UI clicks; prose for explanation.
- **Have some fun.** The factory conceit is the spine of the writing: the learner
  is a floor supervisor watching a production line. Gate, conveyor, shift, and
  quality-inspection language is encouraged. Do not let it crowd out the
  instruction — every challenge still has to teach cleanly.
- **Content stays on Cursor and LaunchDarkly AgentControl.** No customer names,
  company comparisons, competitive framing, pricing, or partnership talk. If a
  sentence isn't teaching how the thing works, cut it.
- Be honest about latency. The chain takes minutes. Say so, and point at the
  game tab as the thing to watch.
- Do not add screenshots. No assets exist for this track.

## When you are unsure

Three failure modes, in order of how much damage they do:

1. **Drifting to the provider-seam architecture.** If you are writing a workflow
   file or reading `auto-factory-ai-provider`, stop.
2. **Editing the lifecycle scripts.** Append only. If appending cannot do it,
   stop and report.
3. **Guessing at an API shape.** Say so instead.
