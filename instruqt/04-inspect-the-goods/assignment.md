---
slug: inspect-the-goods
type: challenge
title: Inspect the Goods
teaser: The line ran. Walk the finished goods off the conveyor and check each one.
notes:
- type: text
  contents: Five agents just worked your pull request. This challenge is the quality
    walk. You look at what each one actually produced, in LaunchDarkly and in the
    agents' pull request, and you check that the flag is still off. No agents run.
tabs:
- title: LaunchDarkly
  type: browser
  hostname: launchdarkly
- title: GitHub
  type: browser
  hostname: github
- title: Terminal
  type: terminal
  hostname: workstation
difficulty: ""
timelimit: 900
enhanced_loading: null
---

# The flag

Open the [LaunchDarkly](#tab-0) tab.

1. From the left-hand navigation, click **Flags**.
2. Find the flag the agent created. Its key was chosen by the agent, so it will vary, but it starts with `enable-` and carries the tags `auto-factory` and `auto-generated`. Ignore the `auto-factory-*` flags; those are the factory's own operational settings, seeded at setup.
3. Click it and look at the **Targeting** tab.

Two things to confirm. The flag is a **string multivariate** with two variations, `control` and `v1`. And it is targeting **off** in every environment. Nothing changed for any user when this line ran. The new code path exists behind `v1`, and nobody is being served `v1`.

That is the intended end state of Phase 1. The factory prepares a change for release. It does not release it. Turning the flag on, or handing it to a guarded rollout, is a separate decision made by a person or by a later system, and it is out of scope here.

# The metrics

1. In the left-hand navigation, click **Metrics**.
2. Find the metrics keyed on the flag, typically `<flag-key>-error-rate` and `<flag-key>-latency`, sometimes a `-success-rate` too.

Open one. It is a custom metric on an event key that matches, letter for letter, a `track()` call the metrics author placed in the code. That greppable link between event name and metric is the contract.

Why an agent creating metrics matters: the change arrived already measurable. Whoever eventually releases this flag does not have to go back and instrument it first, because the instrumentation shipped with the code, and the release manifest already names which metrics to watch.

# The manifest

The handoff artifact is a small JSON file the agents committed on their branch. Open the [Terminal](#tab-2) tab and fetch their branch:

```text
cd /opt/ld/autofactory-app
git fetch origin
AGENT_BRANCH=$(gh pr list --repo "$AF_REPO" --state open --json headRefName -q '.[] | select(.headRefName != "shift-1-backend-status") | .headRefName' | head -1)
git checkout "$AGENT_BRANCH"
git diff --stat main...HEAD
```

You are looking at everything the agents changed. Now the manifest:

```text
cat $(git diff --name-only main...HEAD | grep '^\.release-flags/')
```

It records the flag key, the target variation, the metric keys, and an empty `releaseIntent` block reserved for a human. It is a machine-readable statement of what got flagged and how to judge it. In a fuller setup, a release system reads this file after deploy and runs the rollout. Acting on it is out of scope for this track. Reading it is the point: the line's output is not just code, it is a record.

# The tests

```text
git diff --name-only main...HEAD | grep -i test
```

Open one and read it. There will be a flag-on case that asserts the new behaviour under `v1` and a flag-off case that asserts the old behaviour under `control`. The flag-off case is the one that matters most. It is the proof that turning this flag on later, and off again in a hurry, is safe.

Run them from the agents' branch. The agent chose the runner, so match the command to what it added. For tests under `frontend/`:

```text
cd /opt/ld/autofactory-app/frontend && npm install && npm test
```

For tests under `backend/`:

```text
cd /opt/ld/autofactory-app/backend && pip install -r requirements.txt && python -m pytest
```

If the sandbox cannot reach a package registry, the install step will fail and reading the tests is the deliverable. The agents ran them green in their own sandbox before the Test Bench gate lifted.

# The verdict

Back on the [GitHub](#tab-1) tab, open your pull request and scroll to the last comment. The JSON block at the end:

```json
{ "review_approved": true, "risk_level": "low" }
```

The code reviewer read the whole change set, checked that `control` preserves existing behaviour, and graded the risk. Note what this verdict is and is not. It is **reported**, in a comment, for a person to read. It is not **enforced**. Nothing blocked the pull request from opening because of it. Turning the verdict into a gate is a policy decision, and the graph you saw in challenge 01 is where that policy would live.

Switch back to `main` before the next challenge:

```text
cd /opt/ld/autofactory-app && git checkout main
```

Click **Check** to continue.
