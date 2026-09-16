---
slug: end-of-shift
type: challenge
title: End of Shift
teaser: Two shifts, two flags, no code written by you. Clock out.
notes:
- type: text
  contents: The line ran twice. The second time it ran differently because you changed
    one sentence in LaunchDarkly. A short wrap-up on what ran, the three ideas worth
    keeping, and where the manifest goes next. Then you're done.
tabs:
- title: LaunchDarkly
  type: browser
  hostname: launchdarkly
- title: Factory Floor
  type: service
  hostname: workstation
  port: 7777
difficulty: ""
timelimit: 300
enhanced_loading: null
---

# What ran

- **Challenge 01** — you walked the floor. Six agents on the pull-request path, a graph that hands work between them, and instructions that live in LaunchDarkly rather than in the repo.
- **Challenge 02** — you read the one file the repo does carry: a bootstrap rule that owns sequencing and conventions, and tells the agent to fetch everything else at run time.
- **Challenge 03** — you opened a pull request and five gates lifted. A flag was created dark, metrics were created, tests were written, a verdict was posted, and the agents opened their own pull request. You wrote none of it.
- **Challenge 04** — you inspected the goods. The flag was off everywhere. The manifest recorded what got flagged and how to judge it. The verdict was reported, not enforced.
- **Challenge 05** — you retooled the factory with one sentence in LaunchDarkly and ran the line again. Same repo, same trigger, different flag key.

# Three ideas worth keeping

**Agent instructions are configuration, not code.** The agents fetched their orders from LaunchDarkly at the start of every phase. That is why challenge 05 needed no deploy. It is also why the same instructions can drive a GitHub Action, an editor extension, and a cloud automation without any of them carrying a copy.

**Capability grants on graph edges are the unit of governance.** The flag implementer could create a flag because the edge into it said `create_flag`. The metrics author could not, because its edge did not. Who is allowed to write what is decided in the graph, in one place, and an instruction that says otherwise does not override it.

**Flags are created off, so an agent can prepare a change without releasing it.** Every flag this factory made was targeting off in every environment when the line finished. The code shipped behind `v1`, nobody was served `v1`, and the decision to change that stayed with a person. That separation is what makes it safe to let an agent do the wiring.

# What comes next

The manifest under `.release-flags/` is the handoff. In a fuller setup, a release system reads it after the code deploys, finds the flag key and the metric keys, and starts a guarded rollout that watches those metrics and rolls back on its own if they regress. This track stopped at the handoff on purpose. Two things to read if you want the rest:

- The AutoFactory repository, which holds the agent configs, the graph, the bootstrap rule you read in challenge 02, and the Phase 2 pieces this track left out.
- The LaunchDarkly AgentControl docs at [launchdarkly.com/docs/home/agentcontrol](https://launchdarkly.com/docs/home/agentcontrol), for AI configs, agent graphs, and the MCP server the agents used to fetch their orders.

# Sign-off

Two shifts. Two pull requests in, two pull requests out, two flags on the rack, both switched off and waiting for someone to decide. The flaglings have gone home.

Lights off on the floor. Click **Check** to clock out.
