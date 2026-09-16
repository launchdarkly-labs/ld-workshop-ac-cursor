---
slug: the-factory-floor
type: challenge
title: The Factory Floor
teaser: Meet the crew that will work your pull request, and find out where their
  instructions live.
notes:
- type: text
  contents: You're the new floor supervisor. Before the line starts, walk the floor.
    Meet the agents that work a pull request, read one of their instruction sheets,
    and look at the graph that hands work from one station to the next. Nothing runs
    yet. That comes in challenge 03.
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
difficulty: ""
timelimit: 900
enhanced_loading: null
---

# Welcome to the floor

This factory takes in raw pull requests and puts out flagged, measured, tested code. The crew doing the work is a chain of Cursor cloud agents. You don't write any of that code. You open the pull request, and you watch.

What makes this factory different is where the crew keeps its instructions. They are not in the repo. They are in LaunchDarkly AgentControl, and every agent fetches its orders at the moment its shift begins. Change the instructions there and the next run behaves differently. No deploy. That is the whole lesson, and you will prove it to yourself in challenge 05.

First, meet the crew.

# The crew

Open the [LaunchDarkly](#tab-0) tab.

1. From the left-hand navigation, where you see the **Code | Agents** selector, click **Agents**.
2. Under Agents, click **Configs**.

Nine AI configs were provisioned into this project when your lab started. Six of them sit on the pull-request path in the agent graph:

- **AutoFactory Research & Planning Agent** reads the diff, decides whether the change needs a flag at all, and writes the brief for everyone downstream.
- **AutoFactory Manifest Steward** tidies the release manifest so the human-owned intent block stays well formed.
- **AutoFactory Flag Implementer Agent** creates the flag in LaunchDarkly and wires the new code path behind it.
- **AutoFactory Metrics Author Agent** instruments the flagged path with events and creates the metrics that will judge it.
- **AutoFactory Flag Testing Agent** writes flag-on and flag-off tests and runs them to green.
- **AutoFactory Code Review Agent** inspects the whole change and issues a verdict with a risk level.

The cloud automation runs those six as five phases, because the steward's small step is folded into the flag phase. The remaining three configs never touch your pull request. The two **Judge** configs grade the flag implementer's and metrics author's work after the fact. The **Issue Coder** is a separate entry point for turning a GitHub issue into a branch, and it does not run on this line.

# Read an instruction sheet

Pick up the flag implementer's orders.

1. Click **AutoFactory Flag Implementer Agent**.
2. Click **Variations** in the top navigation.
3. Expand the **Default Configuration** variation.

Read the instructions. Skim is fine. Notice what they are: plain text, in LaunchDarkly, describing how to name a flag, how to create it dark, how to wire the code so flag-off preserves existing behaviour, and which tools to use for each step. Notice what they are not: code in a repository. Nobody deploys anything to change them.

# The running order

Instructions tell one agent what to do. The graph decides who works next and what each is allowed to do.

1. Under **Agents**, open **Graphs**.
2. Click **GHA AutoFactory**.

Each edge is a handoff, and the handoff carries the rules:

- `capabilities` lists what the **next** agent is allowed to do. It is a grant, not a suggestion. An agent with no `create_flag` grant cannot create a flag no matter what its instructions say.
- `require_tags` and `skip_if_tags` decide whether an edge is taken at all. Agents emit tags as they finish, and the graph routes on them.

Look at the edge from the manifest steward into the flag implementer. It grants `create_flag`, `flag_state`, `edit_files`, `write_manifest`, `read_docs`, and `query_repos`. That is the full set of powers the implementer has, and the widest grant on the graph, because it is the agent that touches LaunchDarkly and the code.

Now the edge from the flag implementer into the metrics author. It carries `require_tags` with `flag_ready: true`. The metrics author only starts when the implementer's tools have confirmed a real flag exists. If the flag was never created, the line stops there instead of instrumenting nothing.

One more. The edge out of the research planner carries `skip_if_tags` with `skip_flagging: true`. That is the side door. When the planner decides a change is config-only, docs, or a dependency bump, it tags the run and the rest of the line is skipped on purpose.

# The floor

Open the [Factory Floor](#tab-1) tab.

You are looking at the production line. Five gates, all shut. No flaglings on the conveyor yet, because there is no pull request to work. Each gate is opened by one phase of the chain:

- **Intake** opens when the research planner finishes its brief.
- **Flag Press** opens when the flag exists and the code is wired behind it. Two agents work this station: the manifest steward and the flag implementer.
- **Instrumentation** opens when the metrics author has created the metrics and placed the events.
- **Test Bench** opens when the flag-on and flag-off tests are written and green.
- **Quality Inspection** opens when the code reviewer posts its verdict.

The exit door at the far right opens when the agents' own pull request lands. The floor takes no input from you. The agents clear the obstacles. The flaglings just walk.

# What happens next

Nothing is running yet. In the next challenge you'll read the one file in the repo that ties this together, the bootstrap rule that tells the cloud agent to go fetch its orders. Then you'll open a pull request and start the line.

Click **Check** to continue.
