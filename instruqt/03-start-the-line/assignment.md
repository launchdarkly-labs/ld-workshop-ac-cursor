---
slug: start-the-line
type: challenge
title: Start the Line
teaser: One pull request, five agents, no code written by you.
notes:
- type: text
  contents: This is the main event. You make one small, visible change to the demo
    app, open a pull request, and the line starts. Five cloud agents work it in turn,
    and each one lifts a gate on the Factory Floor when it finishes. It takes minutes,
    not seconds. That is honest, and the floor is the thing to watch while you wait.
tabs:
- title: Factory Floor
  type: service
  hostname: workstation
  port: 7777
- title: Terminal
  type: terminal
  hostname: workstation
- title: GitHub
  type: browser
  hostname: github
- title: LaunchDarkly
  type: browser
  hostname: launchdarkly
difficulty: ""
timelimit: 1800
enhanced_loading: null
---

# Raw material

The line needs a pull request with a real, user-facing change in it. Not a comment tweak, not a dependency bump. The research planner classifies every change before anything else happens, and if it decides nobody would notice the difference, it correctly sends the run out the side door with no flag.

So the change below is deliberately visible: the demo page gets a live **backend status** line that tells visitors whether the API is reachable and which version is deployed. Use it exactly as written. The floor, the checks, and the next challenge all assume this change.

# Make the change

Open the [Terminal](#tab-1) tab. Paste the whole block. It creates a branch, rewrites the frontend server, commits, pushes, and opens the pull request:

```text
cd /opt/ld/autofactory-app
git checkout main
git checkout -b shift-1-backend-status
cat > frontend/server.mjs <<'EOF'
/**
 * Demo frontend (Node / Express). Serves a tiny page and the status contract.
 *   GET /api/status -> { service, version }   (version = deployed SHA)
 *   GET /          -> a page that fetches the backend greeting
 *
 * The page variant could be gated by a frontend flag; kept minimal here.
 */

import express from "express";

const SHA = process.env.RAILWAY_GIT_COMMIT_SHA || "dev";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";
const app = express();

app.get("/api/status", (_req, res) => {
  res.json({ service: "demo-frontend", version: SHA });
});

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Auto-Factory Demo</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:4rem auto">
  <h1>LaunchDarkly Auto-Factory — Demo</h1>
  <p>Frontend deployed SHA: <code>${SHA}</code></p>
  <p id="greeting">Loading greeting from backend…</p>
  <p id="backend-status">Checking backend status…</p>
  <script>
    fetch("${BACKEND_URL}/api/greeting")
      .then(r => r.json())
      .then(d => { document.getElementById("greeting").textContent =
        d.greeting + "  (new-greeting flag: " + d.flag_new_greeting + ")"; })
      .catch(() => { document.getElementById("greeting").textContent = "backend unavailable"; });
    fetch("${BACKEND_URL}/api/status")
      .then(r => r.json())
      .then(d => { document.getElementById("backend-status").textContent =
        "Backend online: " + d.service + " version " + d.version; })
      .catch(() => { document.getElementById("backend-status").textContent = "Backend offline"; });
  </script>
</body></html>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`demo-frontend on :${port}`));
EOF
git add frontend/server.mjs
git commit -m "Show backend status on the demo page"
git push -u origin shift-1-backend-status
gh pr create --repo "$AF_REPO" --base main --head shift-1-backend-status \
  --title "Show backend status on the demo page" \
  --body "Adds a live backend status line under the greeting so visitors can see whether the API is reachable and which version is deployed."
```

The last line prints the pull request's URL. That pull request is the trigger. The moment it opened, a Cursor Automation fired and a cloud sandbox started spinning up with your branch in it.

# Watch the floor

Switch to the [Factory Floor](#tab-0) tab and stay there.

Flaglings walk in from the left, one for each file your pull request touched, and pile up against the **Intake** gate. They wait there until the research planner posts its brief to your pull request. Then the gate lifts and the crowd surges to the next one.

Be patient with the first gate. It is the slowest, and not because the planner is slow. The cloud sandbox has to install the app's dependencies before any agent can run, and that happens once, up front. After that, each phase fetches its instructions from LaunchDarkly, does its work, and reports back. The whole chain takes several minutes end to end.

<!-- Track owner: after the first timed dry run (manual-setup.md, section 8, item 2), replace "several minutes" above with the measured per-phase numbers. -->

If the floor sits at the first gate far longer than that with no comment on your pull request, look at the [GitHub](#tab-2) tab: open your repo at `https://github.com/[[ Instruqt-Var key="af_repo" hostname="workstation" ]]/pulls` and check whether the automation has said anything. From inside this sandbox a queued cloud agent and a stalled one look the same, and the pull request is where the difference shows first.

# What each gate means

One line each. The details are the next challenge.

- **Intake** lifts when the research planner has classified the change and written its brief.
- **Flag Press** lifts when a flag exists in your LaunchDarkly project, targeting off, and the new code path is wired behind it.
- **Instrumentation** lifts when the metrics author has placed the tracking events and created the metrics.
- **Test Bench** lifts when flag-on and flag-off tests are written and passing.
- **Quality Inspection** lifts when the code reviewer has posted its verdict.

The status strip along the top names the phase in flight. Each open gate shows what its phase produced, and the flag and metric keys link into LaunchDarkly.

# The second pull request

When the last gate lifts, two things land on GitHub.

First, the automation opens **its own pull request** against `main`, carrying the flag wiring, the tracking events, the tests, and a release manifest under `.release-flags/`. That is the finished goods leaving the floor, and the exit door on the Factory Floor opens when it exists.

Second, the automation **comments on your pull request** with a summary: the flag key with its LaunchDarkly link, the metric keys, the manifest path, and a verdict block that looks like this:

```json
{ "review_approved": true, "risk_level": "low" }
```

Find both. On the [GitHub](#tab-2) tab, open the repo's pull requests list. Yours is the one you titled; theirs is the one you didn't. Open yours and read the comments from the top down. Each phase left a note.

# If the line takes the side door

Sometimes the research planner decides a change does not need a flag. When that happens the corridor on the floor diverts to a door marked **No Flag Needed**, the flaglings file through it, the automation posts one comment saying so, and **no second pull request is opened**.

That is the factory working correctly, not a failure. It means the change did not read as user-facing. If it happens to you, your edit probably drifted from the block above. Reset and try again with the verbatim change:

```text
cd /opt/ld/autofactory-app
git checkout main
git branch -D shift-1-backend-status
git push origin --delete shift-1-backend-status
```

Then repeat **Make the change** from the top. Closing the earlier pull request on GitHub first keeps the floor pointed at the new one.

Once your pull request has the verdict comment and the second pull request exists, click **Check**.
