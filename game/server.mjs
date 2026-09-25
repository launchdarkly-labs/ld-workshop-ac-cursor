/**
 * Factory Floor — server.
 *
 * Polls the GitHub API for the assigned repo's pull requests, derives the
 * state of the AutoFactory chain from PR comments and PR contents, and serves
 * that state to the page at /api/state. Node stdlib only.
 *
 * Configuration comes from /opt/ld/factory-floor/.env (written by track
 * setup), then ./.env next to this file, then the process environment. The
 * process environment wins.
 *
 *   AF_REPO          owner/name of this session's assigned repo
 *   GITHUB_TOKEN     pool user's GitHub App installation token
 *   LD_PROJECT_KEY   for LaunchDarkly deep links in the UI
 *   PORT             7777
 *
 * Optional, for testing without GitHub:
 *   FACTORY_FIXTURE  path to a JSON file shaped { "pulls": [ ... ] } where each
 *                    pull carries `files` and `comments` arrays inline. When
 *                    set, no network calls are made.
 *
 * The only network egress is api.github.com.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "public");

// Game version, from package.json. Bump it with every change to game/ so an
// image can be checked with `curl localhost:7777/api/health`.
let VERSION = "unknown";
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).version || VERSION;
} catch {
  /* leave unknown */
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv("/opt/ld/factory-floor/.env");
loadDotEnv(path.join(HERE, ".env"));

const CONFIG = {
  repo: (process.env.AF_REPO || "").trim(),
  token: (process.env.GITHUB_TOKEN || "").trim(),
  ldProjectKey: (process.env.LD_PROJECT_KEY || "").trim(),
  port: Number(process.env.PORT || 7777),
  fixture: (process.env.FACTORY_FIXTURE || "").trim(),
};

const ACTIVE_POLL_MS = 5000;
const IDLE_POLL_MS = 15000;

/** The five gates, in conveyor order. */
const PHASES = [
  { key: "research", label: "Intake", openedBy: "research planner" },
  { key: "flag", label: "Flag Press", openedBy: "manifest steward + flag implementer" },
  { key: "metrics", label: "Instrumentation", openedBy: "metrics author" },
  { key: "tests", label: "Test Bench", openedBy: "flag testing" },
  { key: "review", label: "Quality Inspection", openedBy: "code reviewer" },
];
const PHASE_KEYS = new Set(PHASES.map((p) => p.key));

// ---------------------------------------------------------------------------
// Data sources: GitHub (live) or a fixture file (replay / tests)
// ---------------------------------------------------------------------------

const etagCache = new Map(); // url -> { etag, data }
const filesCache = new Map(); // pr number -> { sha, files }

async function githubGet(pathname) {
  const url = `https://api.github.com${pathname}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "factory-floor",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (CONFIG.token) headers.Authorization = `Bearer ${CONFIG.token}`;
  const cached = etagCache.get(url);
  if (cached) headers["If-None-Match"] = cached.etag;

  const res = await fetch(url, { headers });
  if (res.status === 304 && cached) return cached.data;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text ? `: ${text.replace(/\s+/g, " ").slice(0, 140)}` : "";
    throw new Error(`GitHub ${res.status} on ${pathname}${detail}`);
  }
  const data = await res.json();
  const etag = res.headers.get("etag");
  if (etag) etagCache.set(url, { etag, data });
  return data;
}

const githubSource = {
  name: "github",
  async listPulls() {
    if (!CONFIG.repo) throw new Error("AF_REPO is not set; the floor has no repo to watch");
    return githubGet(`/repos/${CONFIG.repo}/pulls?state=all&sort=created&direction=desc&per_page=30`);
  },
  async files(pr) {
    const sha = pr.head && pr.head.sha;
    const hit = filesCache.get(pr.number);
    if (hit && sha && hit.sha === sha) return hit.files;
    const data = await githubGet(`/repos/${CONFIG.repo}/pulls/${pr.number}/files?per_page=100`);
    const files = data.map((f) => f.filename);
    filesCache.set(pr.number, { sha, files });
    return files;
  },
  /**
   * Everything written on the PR, normalised to { body, created_at }.
   * Cursor's "Comment on PR" tool posts pull request REVIEWS, which the
   * issues/{n}/comments endpoint does not return, so read all three lists:
   * conversation comments, review bodies, and inline review comments.
   */
  async comments(pr) {
    const n = pr.number;
    const [issue, reviews, reviewComments] = await Promise.all([
      githubGet(`/repos/${CONFIG.repo}/issues/${n}/comments?per_page=100`),
      githubGet(`/repos/${CONFIG.repo}/pulls/${n}/reviews?per_page=100`),
      githubGet(`/repos/${CONFIG.repo}/pulls/${n}/comments?per_page=100`),
    ]);
    return [
      ...issue.map((c) => ({ body: c.body, created_at: c.created_at })),
      ...reviews.map((r) => ({ body: r.body, created_at: r.submitted_at })),
      ...reviewComments.map((c) => ({ body: c.body, created_at: c.created_at })),
    ].filter((c) => c.body);
  },
};

function fixtureSource(file) {
  const abs = path.resolve(file);
  return {
    name: "fixture",
    async listPulls() {
      const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
      return doc.pulls || [];
    },
    async files(pr) {
      return (pr.files || []).map((f) => (typeof f === "string" ? f : f.filename));
    },
    async comments(pr) {
      // Fixtures may list `reviews` (with submitted_at) alongside `comments`.
      return [
        ...(pr.comments || []),
        ...(pr.reviews || []).map((r) => ({ body: r.body, created_at: r.submitted_at || r.created_at })),
      ];
    },
  };
}

const source = CONFIG.fixture ? fixtureSource(CONFIG.fixture) : githubSource;

// ---------------------------------------------------------------------------
// State derivation
// ---------------------------------------------------------------------------

function isManifestPath(p) {
  return typeof p === "string" && (p.startsWith(".release-flags/") || p.includes("/.release-flags/"));
}

function blankPhases() {
  return PHASES.map((p) => ({ key: p.key, label: p.label, openedBy: p.openedBy, status: "pending", artifacts: [], source: null }));
}

function normaliseStatus(s) {
  const v = String(s ?? "complete").toLowerCase();
  if (["complete", "completed", "done", "finished", "success"].includes(v)) return "complete";
  if (["skipped", "skip"].includes(v)) return "skipped";
  if (["started", "start", "in_progress", "in-progress", "running"].includes(v)) return "started";
  return null;
}

function truthyVerdict(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").toLowerCase();
  if (["true", "approve", "approved", "yes", "pass"].includes(s)) return true;
  if (["false", "reject", "rejected", "no", "fail"].includes(s)) return false;
  return null;
}

// Fenced block, with or without a language tag, with or without a newline after
// the opening fence (agents sometimes write ```json { ... } ``` on one line).
const FENCE_RE = /```[\w-]*[ \t]*\r?\n?([\s\S]*?)```/g;
// Bare object mentioning one of our keys, for comments that skip the fence.
const BARE_OBJ_RE = /\{[^{}]*(?:autofactory_phase|review_approved)[^{}]*\}/g;

/**
 * Parse an agent-written JSON-ish object. Agents drift from strict JSON:
 * single-quoted strings, unquoted keys, trailing commas, Python booleans.
 * Try strict first, then a normalised copy. Returns null when hopeless.
 */
function parseLoose(text) {
  const t = String(text).trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fixed = t
    .replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}
const SHORT_CIRCUIT_RE =
  /no (?:feature )?flag (?:is |was )?(?:needed|required)|does(?:n't| not) (?:need|require) a (?:feature )?flag|skip_flagging["']?\s*[:=]\s*["']?true|short[- ]?circuit/i;
const FLAG_LINK_RE = /app\.launchdarkly\.com\/[^/\s)]+\/~\/features\/([A-Za-z0-9._-]+)/g;
const METRIC_LINK_RE = /app\.launchdarkly\.com\/[^/\s)]+\/metrics\/([A-Za-z0-9._-]+)\/details/g;
const MANIFEST_PATH_RE = /\.release-flags\/[A-Za-z0-9._/-]+\.json/g;

function deriveState({ triggering, agent, comments }) {
  const phases = blankPhases();
  const byKey = Object.fromEntries(phases.map((p) => [p.key, p]));
  const verdict = { reviewApproved: null, riskLevel: null };
  let shortCircuit = false;
  let completedAt = null;
  let manifestPath = null;
  const linkedFlags = new Set();
  const linkedMetrics = new Set();

  const applyBlock = (obj, createdAt) => {
    if (!obj || typeof obj !== "object") return;
    if (typeof obj.autofactory_phase === "string" && PHASE_KEYS.has(obj.autofactory_phase)) {
      const status = normaliseStatus(obj.status);
      if (status) {
        const phase = byKey[obj.autofactory_phase];
        phase.status = status; // later blocks for the same phase win
        phase.source = "comment";
        if (Array.isArray(obj.artifacts)) phase.artifacts = obj.artifacts.map(String);
      }
    }
    if ("review_approved" in obj) {
      const approved = truthyVerdict(obj.review_approved);
      if (approved !== null) {
        verdict.reviewApproved = approved;
        verdict.riskLevel = obj.risk_level != null ? String(obj.risk_level) : verdict.riskLevel;
        byKey.review.status = "complete";
        byKey.review.source = "comment";
        completedAt = createdAt || completedAt;
      }
    }
  };

  const ordered = [...(comments || [])].sort((a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0));
  for (const c of ordered) {
    const body = String(c.body || "");
    let applied = 0;
    for (const m of body.matchAll(FENCE_RE)) {
      const obj = parseLoose(m[1]);
      if (obj) {
        applyBlock(obj, c.created_at);
        applied += 1;
      }
    }
    // Fallback: bare objects anywhere in the body (no fence, or a fence whose
    // content did not parse as a whole).
    if (applied === 0 && /autofactory_phase|review_approved/.test(body)) {
      for (const m of body.matchAll(BARE_OBJ_RE)) {
        const obj = parseLoose(m[0]);
        if (obj) applyBlock(obj, c.created_at);
      }
    }
    if (SHORT_CIRCUIT_RE.test(body)) shortCircuit = true;
    for (const m of body.matchAll(FLAG_LINK_RE)) linkedFlags.add(m[1]);
    for (const m of body.matchAll(METRIC_LINK_RE)) linkedMetrics.add(m[1]);
    const mp = body.match(MANIFEST_PATH_RE);
    if (mp) manifestPath = mp[0];
  }

  // Fallbacks. These only ever open a gate; they never close one a comment
  // opened, and they never override an explicit `skipped`.
  const openDerived = (key) => {
    const p = byKey[key];
    if (p.status !== "complete" && p.status !== "skipped") {
      p.status = "complete";
      p.source = p.source || "derived";
    }
  };

  if (triggering && ordered.length > 0) openDerived("research");

  if (agent) {
    openDerived("research");
    openDerived("flag");
    openDerived("metrics");
    if (agent.files.some((f) => /test/i.test(f))) openDerived("tests");
    const manifests = agent.files.filter(isManifestPath);
    if (manifests.length && !manifestPath) manifestPath = manifests[0];
  }

  if (verdict.reviewApproved !== null) openDerived("review");

  // Artifact fallbacks from the summary comment's links.
  if (byKey.flag.artifacts.length === 0 && linkedFlags.size) byKey.flag.artifacts = [...linkedFlags];
  if (byKey.metrics.artifacts.length === 0 && linkedMetrics.size) byKey.metrics.artifacts = [...linkedMetrics];

  // A chain that could not run at all (for example, the agent's LaunchDarkly
  // MCP connection was unauthenticated) reports every phase as skipped,
  // starting with research. That is a halt, not a short-circuit and not
  // progress: the gates stay shut and the placard points at the PR comment.
  const halted =
    !agent &&
    verdict.reviewApproved === null &&
    byKey.research.status === "skipped" &&
    byKey.research.source === "comment" &&
    !shortCircuit;

  let runState = "idle";
  if (triggering) {
    if (verdict.reviewApproved === false) runState = "rejected";
    else if (agent && verdict.reviewApproved === true) runState = "complete";
    else if (halted) runState = "halted";
    else if (shortCircuit && !agent) runState = "short_circuited";
    else runState = "running";
  }
  if (runState === "short_circuited") {
    openDerived("research");
  }

  const inFlight = phases.find((p) => p.status === "started") || phases.find((p) => p.status === "pending") || null;

  return {
    version: VERSION,
    repo: CONFIG.repo,
    ldProjectKey: CONFIG.ldProjectKey,
    runState,
    triggeringPr: triggering
      ? {
          number: triggering.pr.number,
          title: triggering.pr.title || "",
          url: triggering.pr.html_url || "",
          branch: (triggering.pr.head && triggering.pr.head.ref) || "",
          changedFiles: triggering.files.length,
          createdAt: triggering.pr.created_at || null,
        }
      : null,
    agentPr: agent
      ? {
          number: agent.pr.number,
          title: agent.pr.title || "",
          url: agent.pr.html_url || "",
          branch: (agent.pr.head && agent.pr.head.ref) || "",
          createdAt: agent.pr.created_at || null,
        }
      : null,
    phases,
    inFlight: runState === "running" && inFlight ? inFlight.key : null,
    verdict,
    manifestPath,
    completedAt,
    flaglingCount: triggering ? Math.max(8, Math.min(40, triggering.files.length)) : 0,
    lastPollAt: null,
    pollError: null,
  };
}

async function poll() {
  const pulls = (await source.listPulls()).filter((pr) => pr.state === "open" || pr.merged_at);
  const enriched = [];
  for (const pr of pulls) {
    const files = await source.files(pr);
    enriched.push({ pr, files, hasManifest: files.some(isManifestPath) });
  }
  enriched.sort((a, b) => Date.parse(b.pr.created_at || 0) - Date.parse(a.pr.created_at || 0));

  // The triggering PR is the newest one that carries no manifest. The agent PR
  // is one created after it that does. This mirrors the Automation's loop guard.
  const triggering = enriched.find((e) => !e.hasManifest) || null;
  let agent = null;
  if (triggering) {
    const t = Date.parse(triggering.pr.created_at || 0);
    agent = enriched.find((e) => e.hasManifest && Date.parse(e.pr.created_at || 0) > t) || null;
  }
  // The Automation is told to comment on the triggering PR, but the summary
  // (and the verdict) sometimes lands on the agent's own PR. Read both. Each
  // list already includes reviews and inline review comments.
  let comments = triggering ? await source.comments(triggering.pr) : [];
  if (agent) comments = comments.concat(await source.comments(agent.pr));
  return deriveState({ triggering, agent, comments });
}

// ---------------------------------------------------------------------------
// Poll loop: keep the last good state on any error
// ---------------------------------------------------------------------------

let state = { ...deriveState({ triggering: null, agent: null, comments: [] }), pollError: CONFIG.repo ? null : "AF_REPO is not set" };
let inFlight = false;

async function tick() {
  if (!inFlight) {
    inFlight = true;
    const now = new Date().toISOString();
    try {
      const next = await poll();
      state = { ...next, lastPollAt: now, pollError: null };
    } catch (err) {
      state = { ...state, lastPollAt: now, pollError: String((err && err.message) || err) };
      console.error(`[factory-floor] poll failed: ${state.pollError}`);
    } finally {
      inFlight = false;
    }
  }
  const delay = state.runState === "running" ? ACTIVE_POLL_MS : IDLE_POLL_MS;
  setTimeout(tick, delay).unref();
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(payload);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR + path.sep) && abs !== PUBLIC_DIR) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("not found");
    }
    const type = MIME[path.extname(abs)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/state") return sendJson(res, 200, state);
  if (pathname === "/api/health") return sendJson(res, 200, { ok: true, version: VERSION, source: source.name, repo: CONFIG.repo });
  return serveStatic(req, res);
});

server.listen(CONFIG.port, () => {
  console.log(`[factory-floor] v${VERSION} listening on :${CONFIG.port} watching ${CONFIG.repo || "(no repo)"} via ${source.name}`);
  tick();
});
