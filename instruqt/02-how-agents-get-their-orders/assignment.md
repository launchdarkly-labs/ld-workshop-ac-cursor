---
slug: how-agents-get-their-orders
type: challenge
title: How Agents Get Their Orders
teaser: One small file in the repo tells a cloud agent to go fetch its instructions
  from LaunchDarkly. Read it before you start the line.
notes:
- type: text
  contents: The agents' instructions live in LaunchDarkly. So what is in the repo?
    One bootstrap rule that owns sequencing, conventions, and a tool-translation table,
    and tells the agent to fetch everything else at run time. This challenge is a
    reading challenge. No agents run.
tabs:
- title: Terminal
  type: terminal
  hostname: workstation
- title: LaunchDarkly
  type: browser
  hostname: launchdarkly
- title: GitHub
  type: browser
  hostname: github
- title: Factory Floor
  type: service
  hostname: workstation
  port: 7777
difficulty: ""
timelimit: 900
enhanced_loading: null
---

# Your repo

Every learner gets their own copy of the demo app, and yours is:

```text
[[ Instruqt-Var key="af_repo" hostname="workstation" ]]
```

# Sign in to GitHub

You will watch the line's work land on GitHub, so sign in once now and you stay signed in for the rest of the shift. Open the [GitHub](#tab-2) tab and sign in with the account assigned to your session:

**Username:**
```text
[[ Instruqt-Var key="gh_user" hostname="workstation" ]]
```
**Password:**
```text
[[ Instruqt-Var key="gh_pass" hostname="workstation" ]]
```
**2FA code:**
```text
[[ Instruqt-Var key="gh_totp" hostname="workstation" ]]
```

> The 2FA code rotates every 30 seconds. If the one above has expired by the time GitHub asks for it, open the [Terminal](#tab-0) tab and print a fresh one:

```text
gh-totp
```

Once you are in, open `https://github.com/[[ Instruqt-Var key="af_repo" hostname="workstation" ]]`. That is the repo the automation is bound to. Right now it has no pull requests; by the end of the next challenge it will have two.

# The clone on your workstation

Setup reset the repo to a clean state and cloned it onto this workstation. Open the [Terminal](#tab-0) tab and look at what Cursor sees:

```text
cd /opt/ld/autofactory-app && ls -R .cursor
```

Four files. `environment.json` tells the cloud sandbox how to install the app's dependencies. `mcp.json` is for running the chain locally in Cursor and is not used here. `commands/autofactory.md` is the local slash command, also not used here. The one that matters is the rule.

# The bootstrap rule

Open it:

```text
cat .cursor/rules/autofactory.mdc
```

Three things to notice as you read.

**It owns the sequencing and the conventions.** The five phases in order. How a flag is shaped: string multivariate, `control` plus `v1`, created dark, tagged `auto-factory`. How metrics are keyed. What the release manifest looks like. These are the factory's house rules, and they are the same for every agent.

**It does not contain the agents' instructions.** Look at the **Procedure** section. For each phase it names an AI config key, `autofactory-research-planner`, `autofactory-flag-implementer`, and so on, and tells the agent to call the LaunchDarkly MCP `get-ai-config` tool to fetch that config's instructions **at the moment the phase begins**. The text you read in challenge 01 is what comes back from that call. It is fetched, not copied.

**It carries a tool-translation table.** The instructions in LaunchDarkly were written for AutoFactory's other runtimes and name tools like `create_flag`, `create_metric`, and `write_manifest` that do not exist inside Cursor. The table maps each one to something that does: `create_flag` becomes the MCP `create-feature-flag` tool, `create_metric` becomes the MCP metric-creation tool, `edit_file` and `run_tests` become Cursor's own file and terminal tools, and `tag_conversation` becomes a note the agent keeps in its own reasoning.

# Why the translation matters

The same instructions in LaunchDarkly drive several different runtimes: a GitHub Action, an editor extension, and this cloud automation. None of them carry a copy of the instructions. Each carries an adapter. The rule you just read is Cursor's adapter. That is what lets the text in LaunchDarkly be the source of truth rather than one copy among several, and it is why editing it in challenge 05 will change the run without touching the repo.

# The trigger

Nothing on this workstation runs the agents. A Cursor Automation attached to your repo watches for one event, **Pull request opened**, and when it fires, Cursor starts a cloud sandbox, clones your branch, reads the rule, and runs the chain. The workstation's job is to open the pull request and watch what comes back.

There is one wrinkle you should know about before you see it happen. When the chain finishes, the automation commits its work and opens **its own** pull request. That pull request also fires the **Pull request opened** trigger. So the automation's prompt begins with a loop guard: if the change set already carries a `.release-flags/` manifest, stop and do nothing. The agents' pull request always carries one. Yours never does. That is how the line tells raw material from finished goods, and the Factory Floor uses the same rule to decide which pull request to watch.

# Confirm the project key

The shipped rule names AutoFactory's default projects. Setup rewrote it to point at your sandbox's project instead, because the MCP token the cloud agent uses is shared across every session and the rule is the only thing telling it which project is yours. Confirm the rewrite landed:

```text
grep -n "$LD_PROJECT_KEY" .cursor/rules/autofactory.mdc
```

You should see several lines: the factory and app project entries in the prerequisites, and the LaunchDarkly link templates in the output section. If that grep returns nothing, do not start the line. Click **Check** and it will tell you what went wrong.

Otherwise you are ready. Next challenge, you open a pull request.

Click **Check** to continue.
