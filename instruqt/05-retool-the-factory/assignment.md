---
slug: retool-the-factory
type: challenge
title: Retool the Factory
teaser: Change how the factory works without shipping anything.
notes:
- type: text
  contents: The agents fetched their instructions from LaunchDarkly at run time last
    shift, and they will again this shift. So edit the instructions. Add one house
    rule to the flag implementer, open a second pull request, and watch the same
    line produce different output. No deploy, no repo change, no restart.
tabs:
- title: LaunchDarkly
  type: browser
  hostname: launchdarkly
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
difficulty: ""
timelimit: 1500
enhanced_loading: null
---

# The idea

Every agent on this line fetched its instructions from LaunchDarkly at the moment its phase began. Not at build time. Not when the automation was created. At run time, from the `get-ai-config` call the bootstrap rule tells it to make.

Which means the instructions are configuration, and configuration you can change. Edit the flag implementer's instructions in LaunchDarkly right now and the **next** run picks up the new text. Nothing is deployed. The repo does not change. Nothing restarts. That is what you are about to prove.

# Add a house rule

The change is a flag-naming convention. Second shift, so every flag key gets a `shift2-` prefix.

Open the [LaunchDarkly](#tab-0) tab.

1. From the left-hand navigation, click **Agents**, then **Configs**.
2. Click **AutoFactory Flag Implementer Agent**.
3. Click **Variations** in the top navigation.
4. Expand the **Default Configuration** variation.
5. Scroll to the very end of the instructions text and append this sentence on its own line, exactly as written:

```text
Naming convention for this factory: every flag key you create must start with the prefix shift2- (for example shift2-enable-refresh-greeting). Apply the prefix to the flag key only, not to the flag name.
```

6. Click **Review and save**, then **Save changes**.

That is the whole retool. One sentence, saved in LaunchDarkly. The rule in the repo still says `enable-<descriptive-name>`, and the implementer's fetched instructions now say otherwise. You are about to find out which one wins. The fetched instructions are the ones the agent reads for how to do its job, so they should.

# Run the line again

Raw material for the second shift: a **Refresh greeting** button on the demo page, so visitors can re-fetch the greeting without reloading. Visible, user-facing, and different from last time.

Open the [Terminal](#tab-2) tab and paste the whole block. It branches from `main`, so your first change is not in it:

```text
cd /opt/ld/autofactory-app
git checkout main
git checkout -b shift-2-refresh-greeting
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
  <button id="refresh" type="button">Refresh greeting</button>
  <script>
    function loadGreeting() {
      document.getElementById("greeting").textContent = "Loading greeting from backend…";
      fetch("${BACKEND_URL}/api/greeting")
        .then(r => r.json())
        .then(d => { document.getElementById("greeting").textContent =
          d.greeting + "  (new-greeting flag: " + d.flag_new_greeting + ")"; })
        .catch(() => { document.getElementById("greeting").textContent = "backend unavailable"; });
    }
    loadGreeting();
    document.getElementById("refresh").addEventListener("click", loadGreeting);
  </script>
</body></html>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`demo-frontend on :${port}`));
EOF
git add frontend/server.mjs
git commit -m "Add a refresh button for the greeting"
git push -u origin shift-2-refresh-greeting
gh pr create --repo "$AF_REPO" --base main --head shift-2-refresh-greeting \
  --title "Add a refresh button for the greeting" \
  --body "Adds a Refresh greeting button so visitors can re-fetch the greeting from the backend without reloading the page."
```

Switch to the [Factory Floor](#tab-1) tab. The floor resets to the new pull request and the flaglings walk in again. Same five gates, same watch-and-wait. It should be quicker this time: the cloud environment is warm, so the dependency install that made the first gate slow last shift is already done.

# Read the difference

When the Flag Press gate lifts, look at the flag key on the gate's placard, or open the [LaunchDarkly](#tab-0) tab and go to **Flags**.

Last shift the key started with `enable-`. This shift it should start with `shift2-`.

Same repo. Same rule file. Same trigger. Same agents. The only thing that changed between the two runs was one sentence of instructions in LaunchDarkly, and the factory's output changed with it. That is what it means for the instructions to be the source of truth.

# Be honest about it

The agent is following instructions written in natural language. That is not the same as a code change, and compliance is not guaranteed the way a code change would be. Most of the time the prefix appears. Sometimes an agent reads the rule file's `enable-` convention, weighs it against your sentence, and picks wrong.

If the prefix did not appear, that is a real property of this approach and worth understanding, not a lab malfunction. Open your second pull request on the [GitHub](#tab-3) tab and read the flag implementer's comment. It usually says what it thought the naming rule was and why. That comment is the debugging surface for a factory run on instructions, and reading it is the same skill as reading a failing build log.

The check for this challenge treats a missing prefix as a warning, not a failure, for exactly this reason. Your work was the instruction edit and the second run. Both are checked hard. The agent's obedience is reported.

Once the second shift's verdict comment has landed, click **Check**.
