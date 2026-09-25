/*
 * Factory Floor — render loop.
 *
 * A side-scrolling factory corridor. Flaglings (small original pixel
 * creatures) walk in from the left and pile up at the first shut gate. The
 * server tells us which gates are open; we animate them lifting and let the
 * crowd through. No player input, no sound, no fake progress: a gate stays
 * shut until the server reports its phase done.
 *
 * The simulation is time-based (dt in seconds, clamped) so it survives a
 * backgrounded tab.
 */

(() => {
  "use strict";

  // ---- logical stage --------------------------------------------------------
  const W = 960;
  const H = 420;
  const CEIL_Y = 70; // bottom of the ceiling beam
  const FLOOR_Y = 330; // walking baseline
  const WALL_TOP = 96;
  const GATE_XS = [220, 360, 500, 640, 780];
  const SHUTTER_H = FLOOR_Y - WALL_TOP - 6;
  const EXIT_X = 905;
  const SIDE_DOOR_X = 292;
  const SPAWN_X = -24;

  const PALETTE = {
    bg0: "#0b0e14",
    bg1: "#121722",
    wall: "#1b2230",
    wallLine: "#222b3b",
    beam: "#2a3345",
    floor: "#232c3c",
    floorEdge: "#2f3a4e",
    belt: "#1a2130",
    beltStripe: "#2b3549",
    post: "#5b6a82",
    shutter: "#7d8ca6",
    shutterDark: "#5f6d86",
    shutterSlat: "#94a3bd",
    lampOff: "#3a4456",
    lampOn: "#f5a623",
    lampOk: "#58c99a",
    lampSkip: "#9aa5b8",
    text: "#c7cfdc",
    muted: "#7f899b",
    doorway: "#0a0d12",
    doorLight: "#f7e7b0",
    stop: "#e2574c",
  };

  const BODIES = ["#7fd1ae", "#8fb8ff", "#f4b860", "#e08fb1", "#b9a4ff"];
  const PENNANTS = ["#ffd166", "#ff8fa3", "#7ee0ff", "#c3f584"];

  // ---- DOM --------------------------------------------------------------------
  const canvas = document.getElementById("floor");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const strip = {
    repo: document.getElementById("repo"),
    pr: document.getElementById("pr"),
    elapsed: document.getElementById("elapsed"),
    phase: document.getElementById("phase"),
    runstate: document.getElementById("runstate"),
  };
  const banner = document.getElementById("banner");
  const placard = document.getElementById("placard");
  const hint = document.getElementById("hint");

  // ---- state ------------------------------------------------------------------
  let server = null; // last state from /api/state
  let fetchFailed = false;
  let watchedPr = null; // triggering PR number the floor is currently showing
  let flaglings = [];
  let spawned = 0;
  let spawnTimer = 0;
  let beltOffset = 0;
  let clock = 0;
  const gates = GATE_XS.map((x, i) => ({ x, index: i, key: null, status: "pending", openness: 0, lamp: 0 }));
  let exitOpen = 0; // 0..1
  let sideDoorOpen = 0; // 0..1

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const approach = (v, target, rate, dt) => (v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt));

  function resetFloor() {
    flaglings = [];
    spawned = 0;
    spawnTimer = 0;
    for (const g of gates) {
      g.status = "pending";
      g.openness = 0;
    }
    exitOpen = 0;
    sideDoorOpen = 0;
  }

  function makeFlagling() {
    return {
      x: SPAWN_X - rand(0, 20),
      depth: rand(-16, 8), // small vertical scatter for a crowd feel
      speed: rand(26, 46),
      pile: rand(0, 78), // how far back from a shut gate this one stops
      body: BODIES[Math.floor(rand(0, BODIES.length))],
      pennant: PENNANTS[Math.floor(rand(0, PENNANTS.length))],
      frameT: rand(0, 0.3),
      frame: 0,
      moving: false,
      alpha: 1,
      wander: null,
      wanderPause: 0,
      leaving: false,
      gone: false,
    };
  }

  // ---- server sync ------------------------------------------------------------
  // Relative URL so the page also works when a proxy mounts it under a prefix.
  const STATE_URL = new URL("api/state", window.location.href).toString();

  let pollTimer = null;

  async function pollServer() {
    clearTimeout(pollTimer);
    try {
      const res = await fetch(STATE_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      server = await res.json();
      fetchFailed = false;
    } catch (err) {
      fetchFailed = true;
      // Before the first successful fetch there is no state to render, but the
      // learner still needs to know the page cannot reach its server.
      if (!server) {
        banner.hidden = false;
        banner.textContent = `The floor cannot reach its server at ${STATE_URL} (${err && err.message ? err.message : err}). Retrying every 2 seconds.`;
      }
    }
    try {
      applyServer();
    } catch (err) {
      // A rendering bug must never stop the polling loop; the gates are driven
      // by gate state set before rendering, so keep going and log it.
      console.error("[factory-floor] render failed", err);
    } finally {
      pollTimer = setTimeout(pollServer, 2000);
    }
  }

  // Browsers throttle timers in hidden tabs; poll at once when the tab is back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pollServer();
  });

  function applyServer() {
    if (!server) return;
    const prNumber = server.triggeringPr ? server.triggeringPr.number : null;
    if (prNumber !== watchedPr) {
      watchedPr = prNumber;
      resetFloor();
    }
    server.phases.forEach((p, i) => {
      gates[i].key = p.key;
      gates[i].status = p.status;
    });
    renderChrome();
  }

  // ---- simulation -------------------------------------------------------------
  function passable(gate) {
    return gate.openness >= 0.85;
  }

  function step(dt) {
    clock += dt;
    if (!server) return;
    const run = server.runState;

    // Gates lift when their phase is complete or skipped.
    for (const g of gates) {
      // A halted run reports every phase skipped without doing anything; keep
      // those gates shut so the floor does not look like progress.
      const open = g.status === "complete" || (g.status === "skipped" && run !== "halted");
      g.openness = approach(g.openness, open ? 1 : 0, 1 / 0.9, dt);
      g.lamp += dt;
    }
    exitOpen = approach(exitOpen, run === "complete" ? 1 : 0, 1 / 0.9, dt);
    sideDoorOpen = approach(sideDoorOpen, run === "short_circuited" ? 1 : 0, 1 / 0.9, dt);

    if (run === "running") beltOffset = (beltOffset + dt * 40) % 32;

    // Spawn the crowd for the watched pull request.
    const want = server.flaglingCount || 0;
    if (spawned < want) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        flaglings.push(makeFlagling());
        spawned += 1;
        spawnTimer = 0.32;
      }
    }

    const firstShut = gates.find((g) => !passable(g)) || null;

    for (const f of flaglings) {
      if (f.gone) continue;
      let target = null;

      if (run === "short_circuited" && passable(gates[0])) {
        // File calmly through the side door and out.
        target = SIDE_DOOR_X - f.pile * 0.25;
        if (f.x >= target - 2) {
          f.alpha = Math.max(0, f.alpha - dt * 1.4);
          if (f.alpha <= 0) f.gone = true;
          f.moving = false;
          continue;
        }
      } else if (firstShut) {
        target = firstShut.x - 18 - f.pile;
      } else if (run === "complete") {
        target = EXIT_X + 40; // walk out through the open exit
        if (f.x > EXIT_X + 8) {
          f.alpha = Math.max(0, f.alpha - dt * 2.2);
          if (f.alpha <= 0) f.gone = true;
        }
      } else if (run === "rejected") {
        // Mill about between the last gate and the shut exit.
        if (f.wanderPause > 0) {
          f.wanderPause -= dt;
          f.moving = false;
          continue;
        }
        if (f.wander == null || Math.abs(f.x - f.wander) < 2) {
          if (f.wander != null) f.wanderPause = rand(0.4, 1.8);
          f.wander = rand(GATE_XS[4] + 20, EXIT_X - 30);
        }
        const dir = Math.sign(f.wander - f.x);
        f.x += dir * f.speed * 0.6 * dt;
        f.moving = true;
        f.facing = dir >= 0 ? 1 : -1;
        tickFrame(f, dt);
        continue;
      } else {
        // All gates open, exit still shut: wait for the agents' pull request.
        target = EXIT_X - 18 - f.pile;
      }

      if (target != null && f.x < target) {
        f.x = Math.min(target, f.x + f.speed * dt);
        f.moving = true;
        f.facing = 1;
        tickFrame(f, dt);
      } else {
        f.moving = false;
      }
    }

    flaglings = flaglings.filter((f) => !f.gone);
  }

  function tickFrame(f, dt) {
    f.frameT += dt;
    if (f.frameT > 0.16) {
      f.frameT = 0;
      f.frame = f.frame ? 0 : 1;
    }
  }

  // ---- drawing ----------------------------------------------------------------
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.max(1, Math.round(rect.width * dpr));
    const targetH = Math.max(1, Math.round((rect.width * H) / W * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(targetW / W, 0, 0, targetH / H, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function draw() {
    fitCanvas();
    const run = server ? server.runState : "idle";

    // Background and back wall
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, PALETTE.bg0);
    grad.addColorStop(1, PALETTE.bg1);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = PALETTE.wall;
    ctx.fillRect(0, WALL_TOP, W, FLOOR_Y - WALL_TOP);
    ctx.fillStyle = PALETTE.wallLine;
    for (let x = 0; x < W; x += 48) ctx.fillRect(x, WALL_TOP, 1, FLOOR_Y - WALL_TOP);
    for (let y = WALL_TOP + 24; y < FLOOR_Y; y += 48) ctx.fillRect(0, y, W, 1);

    // Ceiling beam with rivets
    ctx.fillStyle = PALETTE.beam;
    ctx.fillRect(0, CEIL_Y - 14, W, 14);
    ctx.fillStyle = PALETTE.post;
    for (let x = 12; x < W; x += 40) ctx.fillRect(x, CEIL_Y - 9, 3, 3);

    // Side door (short-circuit exit) on the back wall
    drawSideDoor(run);

    // Floor + conveyor
    ctx.fillStyle = PALETTE.floor;
    ctx.fillRect(0, FLOOR_Y, W, H - FLOOR_Y);
    ctx.fillStyle = PALETTE.floorEdge;
    ctx.fillRect(0, FLOOR_Y, W, 3);
    ctx.fillStyle = PALETTE.belt;
    ctx.fillRect(0, FLOOR_Y + 10, W, 18);
    ctx.fillStyle = PALETTE.beltStripe;
    for (let x = -32 + beltOffset; x < W; x += 32) ctx.fillRect(x, FLOOR_Y + 13, 12, 12);

    // Exit door on the right
    drawExit(run);

    // Gates (drawn after the crowd behind them, so draw crowd in two passes)
    const behind = flaglings.filter((f) => f.depth < -4);
    const front = flaglings.filter((f) => f.depth >= -4);
    behind.forEach(drawFlagling);
    gates.forEach(drawGate);
    front.forEach(drawFlagling);

    // Labels under gates
    ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = PALETTE.text;
    gates.forEach((g, i) => {
      const label = server ? server.phases[i].label : "";
      ctx.fillText(label, g.x, FLOOR_Y + 48);
      ctx.fillStyle = PALETTE.muted;
      ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText(`gate ${i + 1}`, g.x, FLOOR_Y + 62);
      ctx.fillStyle = PALETTE.text;
      ctx.font = "bold 11px ui-monospace, Menlo, Consolas, monospace";
    });
    ctx.fillStyle = PALETTE.muted;
    ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
    ctx.fillText("intake", 60, FLOOR_Y + 48);
    ctx.fillText(run === "complete" ? "shipped" : "exit", EXIT_X, FLOOR_Y + 48);

    // Idle hint on the wall
    if (run === "idle") {
      ctx.fillStyle = PALETTE.muted;
      ctx.font = "12px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText("line idle — open a pull request to start the shift", W / 2, WALL_TOP + 40);
    }
  }

  function drawGate(g) {
    const x = g.x;
    const top = WALL_TOP - 6;
    // posts
    ctx.fillStyle = PALETTE.post;
    ctx.fillRect(x - 30, top, 6, FLOOR_Y - top);
    ctx.fillRect(x + 24, top, 6, FLOOR_Y - top);
    // header box
    ctx.fillRect(x - 32, top - 12, 64, 14);
    // shutter
    const visible = (1 - g.openness) * SHUTTER_H;
    if (visible > 0.5) {
      ctx.fillStyle = PALETTE.shutter;
      ctx.fillRect(x - 24, top + 2, 48, visible);
      ctx.fillStyle = PALETTE.shutterSlat;
      for (let y = top + 6; y < top + 2 + visible - 3; y += 8) ctx.fillRect(x - 22, y, 44, 2);
      ctx.fillStyle = PALETTE.shutterDark;
      ctx.fillRect(x - 24, top + 2 + visible - 3, 48, 3);
    }
    // lamp
    let lamp = PALETTE.lampOff;
    if (g.status === "complete") lamp = PALETTE.lampOk;
    else if (g.status === "skipped") lamp = PALETTE.lampSkip;
    else if (g.status === "started") lamp = Math.floor(g.lamp * 2) % 2 ? PALETTE.lampOn : PALETTE.lampOff;
    ctx.fillStyle = lamp;
    ctx.fillRect(x - 3, top - 9, 6, 6);
  }

  function drawExit(run) {
    const x = EXIT_X;
    const top = WALL_TOP + 10;
    ctx.fillStyle = PALETTE.post;
    ctx.fillRect(x - 28, top - 8, 56, FLOOR_Y - top + 8);
    // opening
    const doorH = FLOOR_Y - top;
    ctx.fillStyle = PALETTE.doorway;
    ctx.fillRect(x - 22, top, 44, doorH);
    if (exitOpen > 0.01) {
      const g = ctx.createLinearGradient(x - 22, 0, x + 22, 0);
      g.addColorStop(0, "rgba(247,231,176,0)");
      g.addColorStop(1, `rgba(247,231,176,${0.55 * exitOpen})`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 22, top, 44, doorH);
    }
    // door panel slides up as it opens
    const panelH = doorH * (1 - exitOpen);
    if (panelH > 0.5) {
      ctx.fillStyle = run === "rejected" ? "#5a3b3b" : PALETTE.shutterDark;
      ctx.fillRect(x - 22, top, 44, panelH);
      ctx.fillStyle = run === "rejected" ? PALETTE.stop : PALETTE.shutterSlat;
      for (let y = top + 6; y < top + panelH - 3; y += 10) ctx.fillRect(x - 18, y, 36, 2);
    }
    // sign
    ctx.fillStyle = PALETTE.beam;
    ctx.fillRect(x - 26, top - 24, 52, 14);
    ctx.fillStyle = run === "rejected" ? PALETTE.stop : run === "complete" ? PALETTE.lampOk : PALETTE.muted;
    ctx.font = "bold 9px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(run === "rejected" ? "STOP" : "EXIT", x, top - 13);
  }

  function drawSideDoor(run) {
    if (sideDoorOpen <= 0.01 && run !== "short_circuited") return;
    const x = SIDE_DOOR_X;
    const top = WALL_TOP + 60;
    const h = FLOOR_Y - top;
    ctx.fillStyle = PALETTE.post;
    ctx.fillRect(x - 22, top - 6, 44, h + 6);
    ctx.fillStyle = PALETTE.doorway;
    ctx.fillRect(x - 17, top, 34, h);
    if (sideDoorOpen > 0.01) {
      ctx.fillStyle = `rgba(154,165,184,${0.25 * sideDoorOpen})`;
      ctx.fillRect(x - 17, top, 34, h);
    }
    ctx.fillStyle = PALETTE.beam;
    ctx.fillRect(x - 40, top - 22, 80, 14);
    ctx.fillStyle = PALETTE.lampSkip;
    ctx.font = "bold 9px ui-monospace, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("NO FLAG NEEDED", x, top - 11);
  }

  function drawFlagling(f) {
    const x = Math.round(f.x);
    const y = Math.round(FLOOR_Y + f.depth);
    ctx.globalAlpha = f.alpha;
    const facing = f.facing || 1;
    // legs (two-frame walk)
    ctx.fillStyle = "#2b3140";
    if (f.moving) {
      const a = f.frame ? 0 : 3;
      ctx.fillRect(x - 3, y - 3 + (f.frame ? 0 : 0), 2, 3);
      ctx.fillRect(x + 1 + (a ? 1 : -1), y - 3, 2, 3);
    } else {
      ctx.fillRect(x - 3, y - 3, 2, 3);
      ctx.fillRect(x + 1, y - 3, 2, 3);
    }
    // body
    ctx.fillStyle = f.body;
    ctx.fillRect(x - 4, y - 10, 8, 7);
    // head
    ctx.fillStyle = "#f2e9dc";
    ctx.fillRect(x - 3, y - 15, 6, 5);
    // eye
    ctx.fillStyle = "#1a1d24";
    ctx.fillRect(x + (facing > 0 ? 1 : -2), y - 14, 1, 1);
    // pennant on a pin: the "flag" in flagling
    ctx.fillStyle = "#c7cfdc";
    ctx.fillRect(x, y - 21, 1, 6);
    ctx.fillStyle = f.pennant;
    ctx.fillRect(x + (facing > 0 ? 1 : -4), y - 21, 4, 3);
    ctx.globalAlpha = 1;
  }

  // ---- chrome (HTML) ----------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  function ldFlagUrl(key) {
    return `https://app.launchdarkly.com/${encodeURIComponent(server.ldProjectKey)}/~/features/${encodeURIComponent(key)}`;
  }
  function ldMetricUrl(key) {
    return `https://app.launchdarkly.com/${encodeURIComponent(server.ldProjectKey)}/metrics/${encodeURIComponent(key)}/details`;
  }

  function artifactHtml(phaseKey, a) {
    const s = String(a);
    const looksLikePath = /\.release-flags\//.test(s) || /\.json$/.test(s) || s.includes("/");
    if (!looksLikePath && server.ldProjectKey) {
      if (phaseKey === "flag") return `<a href="${ldFlagUrl(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
      if (phaseKey === "metrics") return `<a href="${ldMetricUrl(s)}" target="_blank" rel="noopener">${esc(s)}</a>`;
    }
    return `<code>${esc(s)}</code>`;
  }

  function renderChrome() {
    const s = server;
    strip.repo.textContent = s.repo || "no repo configured";
    strip.repo.title = `assigned repository · Factory Floor v${s.version || "?"}`;
    strip.runstate.textContent = s.runState.replace("_", " ");
    strip.runstate.dataset.state = s.runState;

    if (s.triggeringPr) {
      strip.pr.textContent = `PR #${s.triggeringPr.number} · ${s.triggeringPr.changedFiles} file${s.triggeringPr.changedFiles === 1 ? "" : "s"}`;
      strip.pr.title = s.triggeringPr.title || "";
    } else {
      strip.pr.textContent = "no pull request yet";
      strip.pr.title = "";
    }

    const phaseText = {
      idle: "line idle",
      running: s.inFlight ? `${labelFor(s.inFlight)} in progress` : "waiting for the agents' pull request",
      complete: "shift complete",
      rejected: `inspection failed${s.verdict.riskLevel ? ` · risk ${s.verdict.riskLevel}` : ""}`,
      short_circuited: "no flag needed · line diverted",
      halted: "line halted · the agents could not run",
    }[s.runState];
    strip.phase.textContent = phaseText || "";

    // Banner: poll trouble, but never blank the floor.
    const problems = [];
    if (fetchFailed) problems.push("The floor lost contact with its own server; showing the last known state.");
    if (s.pollError) problems.push(`GitHub poll failed: ${s.pollError}. Showing the last good state.`);
    banner.hidden = problems.length === 0;
    banner.textContent = problems.join(" ");

    // Gate cards
    overlay.innerHTML = "";
    s.phases.forEach((p, i) => {
      const card = document.createElement("div");
      card.className = "gate-card";
      card.dataset.status = p.status;
      card.style.left = `${(GATE_XS[i] / W) * 100}%`;
      card.style.top = "6%";
      card.title = `Opened by the ${p.openedBy}`;
      const status =
        p.status === "complete" ? "open"
        : p.status === "started" ? "working"
        : p.status === "skipped" ? (s.runState === "halted" ? "halted" : "skipped")
        : "shut";
      let html = `<div class="title">${esc(p.label)}</div><div class="status">${status}</div>`;
      if (p.status !== "pending") html += `<small>${esc(p.openedBy)}</small>`;
      if (p.artifacts && p.artifacts.length) {
        html += `<ul>${p.artifacts.slice(0, 4).map((a) => `<li>${artifactHtml(p.key, a)}</li>`).join("")}</ul>`;
      }
      card.innerHTML = html;
      overlay.appendChild(card);
    });

    // Placard + hint
    renderPlacard();
  }

  function labelFor(key) {
    const p = server.phases.find((x) => x.key === key);
    return p ? p.label : key;
  }

  function renderPlacard() {
    const s = server;
    const flagKeys = (s.phases.find((p) => p.key === "flag") || {}).artifacts || [];
    const metricKeys = (s.phases.find((p) => p.key === "metrics") || {}).artifacts || [];
    const flagsOnly = flagKeys.filter((k) => !/\.release-flags\//.test(k) && !/\.json$/.test(k));

    if (s.runState === "complete") {
      placard.hidden = false;
      placard.dataset.state = "complete";
      placard.innerHTML =
        `<h2>Shift complete — goods shipped</h2>` +
        `<dl>` +
        `<dt>Flag</dt><dd>${flagsOnly.length ? flagsOnly.map((k) => artifactHtml("flag", k)).join(", ") : "<em>see the agents' comment</em>"}</dd>` +
        `<dt>Metrics</dt><dd>${metricKeys.length ? metricKeys.map((k) => artifactHtml("metrics", k)).join(", ") : "<em>see the agents' comment</em>"}</dd>` +
        `<dt>Manifest</dt><dd>${s.manifestPath ? `<code>${esc(s.manifestPath)}</code>` : "<em>under .release-flags/ on the agents' branch</em>"}</dd>` +
        `<dt>Agents' PR</dt><dd>${s.agentPr ? `<a href="${esc(s.agentPr.url)}" target="_blank" rel="noopener">#${s.agentPr.number}</a>` : "—"}</dd>` +
        `<dt>Verdict</dt><dd>approved${s.verdict.riskLevel ? ` · risk ${esc(s.verdict.riskLevel)}` : ""}</dd>` +
        `</dl>`;
    } else if (s.runState === "rejected") {
      placard.hidden = false;
      placard.dataset.state = "rejected";
      placard.innerHTML =
        `<h2>Quality Inspection rejected the change</h2>` +
        `<p>The code reviewer did not approve. Risk level: <code>${esc(s.verdict.riskLevel || "not stated")}</code>. ` +
        `The exit stays shut. Read the reviewer's comment on the pull request for what it found.</p>`;
    } else if (s.runState === "halted") {
      placard.hidden = false;
      placard.dataset.state = "halted";
      placard.innerHTML =
        `<h2>Line halted before the first gate</h2>` +
        `<p>The automation started but could not do its work, so it reported every phase as skipped and created nothing: no flag, no metrics, no manifest, no second pull request. ` +
        `The reason is in its comment on ${s.triggeringPr && s.triggeringPr.url ? `<a href="${esc(s.triggeringPr.url)}" target="_blank" rel="noopener">pull request #${s.triggeringPr.number}</a>` : "your pull request"}. ` +
        `This is a lab-environment problem, not something your change caused.</p>`;
    } else if (s.runState === "short_circuited") {
      placard.hidden = false;
      placard.dataset.state = "short_circuited";
      placard.innerHTML =
        `<h2>No flag needed</h2>` +
        `<p>The research planner classified this change as not user-facing, so the rest of the line was skipped on purpose. ` +
        `No flag, no metrics, no second pull request. That is the factory working as designed.</p>`;
    } else {
      placard.hidden = true;
      placard.innerHTML = "";
    }

    if (s.runState === "idle") {
      hint.innerHTML = s.repo
        ? `Waiting for a pull request on <code>${esc(s.repo)}</code>. Open one and the flaglings clock in. <span class="ver">v${esc(s.version || "?")}</span>`
        : `No repository configured. <span class="ver">v${esc(s.version || "?")}</span>`;
    } else if (s.runState === "running") {
      hint.textContent = "Gates lift when the agents post their progress on the pull request. Slow gates are honest gates.";
    } else {
      hint.textContent = "";
    }
  }

  // ---- elapsed clock ----------------------------------------------------------
  function renderElapsed() {
    if (!server || !server.triggeringPr || !server.triggeringPr.createdAt) {
      strip.elapsed.textContent = "00:00";
      return;
    }
    const start = Date.parse(server.triggeringPr.createdAt);
    const end = server.completedAt && server.runState !== "running" ? Date.parse(server.completedAt) : Date.now();
    const secs = Math.max(0, Math.floor((end - start) / 1000));
    const m = Math.floor(secs / 60);
    const sN = secs % 60;
    const h = Math.floor(m / 60);
    strip.elapsed.textContent = h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(sN).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sN).padStart(2, "0")}`;
  }

  // ---- main loop --------------------------------------------------------------
  let last = performance.now();
  let elapsedTick = 0;
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    step(dt);
    draw();
    elapsedTick += dt;
    if (elapsedTick > 0.5) {
      elapsedTick = 0;
      renderElapsed();
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", fitCanvas);
  pollServer();
  requestAnimationFrame(frame);
})();
