#!/usr/bin/env node
'use strict';
// VENDORED COPY — OpenPi electron/vendor/relay-server.js
// Source: https://github.com/<owner>/Relay-pi-dashboard server.js (zero npm deps, read-only monitor).
// Local changes from upstream:
//  - VENDOR_DIR resolves this script's dir so it works both in dev (electron/vendor)
//    and packaged (resources/vendor via extraResources). Electron main passes
//    RELAY_VENDOR_DIR = resolveAppAssetPath('vendor') for prod.
// Keep this file dependency-free; do not import electron internals (spawned via `node`).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const PORT = Number(process.env.RELAY_PORT || 8080);
const HOST = process.env.RELAY_HOST || '127.0.0.1';
const BOARD_ROOT = process.env.AGENT_BOARD_ROOT
  || path.join(os.homedir(), '.pi', 'agent', 'agent-board');
const VIEWS_DIR = path.join(BOARD_ROOT, 'views');
const BOARD_SESSIONS_DIR = path.join(BOARD_ROOT, 'sessions'); // live view transcripts
const SESSION_ROOT = process.env.PI_CODING_AGENT_SESSION_DIR
  || path.join(os.homedir(), '.pi', 'agent', 'sessions');
// VENDOR_DIR: electron/vendor in dev; resources/vendor when packaged. The Electron
// main spawner passes RELAY_VENDOR_DIR = resolveAppAssetPath('vendor') so this
// standalone node process locates itself under process.resourcesPath in prod.
const VENDOR_DIR = process.env.RELAY_VENDOR_DIR || __dirname;
const PUBLIC_DIR = path.join(VENDOR_DIR, 'public');

// --- security gate (T-006) ---
const CONTROL_ENABLED = process.env.RELAY_ENABLE_CONTROL === '1';
const DISPATCH_ENABLED = process.env.RELAY_ENABLE_DISPATCH === '1';
const TUNNEL_ORIGIN = process.env.RELAY_TUNNEL_ORIGIN || '';
const AUTH_USER = process.env.RELAY_AUTH_USER || '';
const AUTH_PASS = process.env.RELAY_AUTH_PASS || '';
const AUTH_ENABLED = !!(AUTH_USER && AUTH_PASS);
const AUTH_BASIC = AUTH_ENABLED && ('Basic ' + Buffer.from(AUTH_USER + ':' + AUTH_PASS).toString('base64'));

// --- audit log for control mutations (who/when/what) ---
const AUDIT_LOG = path.join(VENDOR_DIR, 'relay-audit.log');
function auditUser(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return '-';
  try { const s = Buffer.from(h.slice(6), 'base64').toString('utf8'); const i = s.indexOf(':'); return i >= 0 ? s.slice(0, i) : s; } catch { return '-'; }
}
function audit(action, target, req, extra) {
  try {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      action, target,
      user: auditUser(req),
      ip: (req.socket && req.socket.remoteAddress) || '-',
      origin: req.headers.origin || '-',
      ...(extra || {}),
    }) + '\n';
    fs.appendFileSync(AUDIT_LOG, line);
  } catch { /* best-effort */ }
}

// --- dispatch (T-009): pi invocation for detached hosts ---
const BOARD_DIR = process.env.RELAY_BOARD_DIR
  || path.join(os.homedir(), '.pi', 'agent', 'npm', 'node_modules', 'pi-agent-board');
const RELAY_PI_COMMAND = process.env.RELAY_PI_COMMAND || 'pi';
const RELAY_PI_ARGS = (process.env.RELAY_PI_ARGS || '').trim() ? process.env.RELAY_PI_ARGS.trim().split(/\s+/) : [];

function isWhitelistedOrigin(o) {
  if (!o) return false;
  if (o === 'http://127.0.0.1:' + PORT || o === 'http://localhost:' + PORT) return true;
  return !!TUNNEL_ORIGIN && o === TUNNEL_ORIGIN;
}

const ANSI_RE = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const POLL_MS = 1000;
const TAIL_BYTES = 2 * 1024 * 1024; // first-read tail for view transcripts (screen-adjacent growth)
const THINK_PREVIEW = 8 * 1024;     // thinking truncated in history preview
const CUSTOM_CAP = 8 * 1024;        // cap on custom_message noise
const TOOL_ARGS_CAP = 16 * 1024;    // cap on toolCall arguments (questions/options) for future plugins
const LIVE_LIMIT = 200;             // last useful events in live chat window
const HIST_LIMIT = 500;             // last useful events in history transcript

function clean(s) {
  return typeof s === 'string' ? s.replace(ANSI_RE, '') : '';
}
function capToolArgs(a) {
  if (a == null || typeof a !== 'object' || Array.isArray(a)) return a;
  try {
    let copy = JSON.parse(JSON.stringify(a));
    const evalSize = () => JSON.stringify(copy).length;
    // preserve structure: strip biggest fields first, never mangle JSON
    if (evalSize() > TOOL_ARGS_CAP) {
      for (const q of copy.questions || []) for (const o of q.options || []) if (typeof o.preview === 'string' && o.preview.length > 300) o.preview = o.preview.slice(0, 300) + '…';
    }
    if (evalSize() > TOOL_ARGS_CAP) {
      const hard = JSON.parse(JSON.stringify(copy));
      for (const q of hard.questions || []) for (const o of q.options || []) if (o.preview) o.preview = undefined;
      copy = hard;
    }
    if (evalSize() > TOOL_ARGS_CAP) {
      const min = JSON.parse(JSON.stringify(copy));
      for (const q of min.questions || []) for (const o of q.options || []) { o.description = undefined; o.preview = undefined; }
      copy = min;
    }
    if (evalSize() > TOOL_ARGS_CAP) {
      // last resort: keep first 4 questions, labels only
      const slim = JSON.parse(JSON.stringify(copy));
      slim.questions = (slim.questions || []).slice(0, 4).map(q => ({ header: q.header, question: q.question, multiSelect: q.multiSelect, options: (q.options || []).map(o => ({ label: o.label })) }));
      copy = slim;
    }
    return copy;
  } catch { return { __truncated: true }; }
}
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}
function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// --- live board views ---
function scanSessions() {
  if (!fs.existsSync(VIEWS_DIR)) return [];
  let dirs;
  try { dirs = fs.readdirSync(VIEWS_DIR); } catch { return []; }
  const out = [];
  for (const id of dirs) {
    const dir = path.join(VIEWS_DIR, id);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const meta = readJson(path.join(dir, 'meta.json')) || {};
    if (meta.archived) continue;
    const stateP = path.join(dir, 'state.json');
    const hasState = fs.existsSync(stateP);
    const state = hasState ? (readJson(stateP) || {}) : {};
    const host = readJson(path.join(dir, 'host.json')) || {};
    out.push({
      id,
      name: meta.name || id,
      cwd: meta.cwd || '',
      kind: meta.kind || '',
      model: meta.defaultModel || '',
      pinned: !!meta.pinned,
      dimmed: !hasState, // missing state.json -> offline view
      semanticState: hasState ? (state.semanticState || 'unknown') : 'offline',
      processState: hasState ? (state.processState || 'unknown') : 'offline',
      needsInput: !!state.needsInput,
      question: state.question || '',
      hasError: !!state.hasError,
      summary: state.summary || '',
      latestAssistantPreview: state.latestAssistantPreview || '',
      latestTool: state.latestTool || null,
      lastActivityAt: state.lastActivityAt || 0,
      updatedAt: state.updatedAt || 0,
      attachedClients: host.attachedClients || 0,
    });
  }
  out.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  return out;
}

function groupSessions(list) {
  const byCwd = new Map();
  for (const v of list) {
    const key = v.cwd || '(no cwd)';
    if (!byCwd.has(key)) byCwd.set(key, { cwd: key, pinned: false, views: [] });
    const g = byCwd.get(key);
    if (v.pinned) g.pinned = true;
    g.views.push(v);
  }
  const groups = [...byCwd.values()];
  for (const g of groups) g.views.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  groups.sort((a, b) => (b.views[0]?.lastActivityAt || 0) - (a.views[0]?.lastActivityAt || 0));
  return groups;
}

// --- transcript parsing (jsonl) ---
function parseLine(ln, truncate) {
  let ev;
  try { ev = JSON.parse(ln); } catch { return null; }
  if (!ev || typeof ev !== 'object') return null;
  if (ev.type === 'message') {
    const msg = ev.message || {};
    const item = {
      type: 'message',
      role: msg.role || '',
      ts: ev.timestamp || '',
      text: '',
      thinking: null,
      tool: null,
    };
    for (const b of Array.isArray(msg.content) ? msg.content : []) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text') item.text += clean(b.text || '');
      else if (b.type === 'thinking' && !item.thinking) item.thinking = clean(b.thinking || b.text || '');
      else if (b.type === 'toolCall' && !item.tool) item.tool = { name: b.name || '', state: 'call', arguments: capToolArgs(b.arguments) };
      // unknown block types ignored
    }
    if (msg.role === 'toolResult') {
      item.tool = { name: msg.toolName || '', state: 'result', isError: !!msg.isError, toolCallId: msg.toolCallId || null };
    }
    if (truncate && item.thinking && item.thinking.length > THINK_PREVIEW) {
      item.thinking = item.thinking.slice(0, THINK_PREVIEW) + '…';
    }
    return item;
  }
  if (ev.type === 'custom_message' && ev.customType) {
    let text = clean(typeof ev.content === 'string' ? ev.content : '');
    if (!text) return null;
    if (text.length > CUSTOM_CAP) text = text.slice(0, CUSTOM_CAP) + '…';
    return { type: 'custom_message', role: 'system', ts: ev.timestamp || '', customType: ev.customType, text };
  }
  if (ev.type === 'tool' && (ev.name || ev.customType)) {
    return { type: 'tool', role: 'system', ts: ev.timestamp || '', tool: { name: ev.name || ev.customType, state: 'event' } };
  }
  return null;
}

function parseLines(lines, truncate) {
  const items = [];
  for (const ln of lines) {
    const it = parseLine(ln, truncate);
    if (it) items.push(it);
  }
  return items;
}

// --- live view transcript: cached, incremental read (only when mtime/size changed) ---
const winCache = new Map(); // id -> { size, mtimeMs, remainder, window }

function readTail(file, size) {
  const len = Math.min(size, TAIL_BYTES);
  const buf = Buffer.alloc(len);
  if (len > 0) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, buf, 0, len, size - len);
    } catch { return ''; } finally {
      if (fd) { try { fs.closeSync(fd); } catch {} }
    }
  }
  return buf.toString('utf8');
}

function viewWindow(id) {
  const file = path.join(BOARD_SESSIONS_DIR, id + '.jsonl');
  let st;
  try { st = fs.statSync(file); } catch { winCache.delete(id); return null; }
  let c = winCache.get(id);
  if (!c) {
    const parts = readTail(file, st.size).split('\n');
    c = {
      size: st.size,
      mtimeMs: st.mtimeMs,
      remainder: parts.pop() || '',
      window: parseLines(parts, false),
    };
    winCache.set(id, c);
    return c.window;
  }
  if (st.size === c.size && st.mtimeMs === c.mtimeMs) return c.window;
  if (st.size <= c.size) { // rotated/rewritten: full re-tail
    const parts = readTail(file, st.size).split('\n');
    c.size = st.size;
    c.mtimeMs = st.mtimeMs;
    c.remainder = parts.pop() || '';
    c.window = parseLines(parts, false);
    return c.window;
  }
  // append-only: read only the delta
  const len = st.size - c.size;
  const buf = Buffer.alloc(len);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, c.size);
  } catch { return c.window; } finally { if (fd) { try { fs.closeSync(fd); } catch {} } }
  const parts = (c.remainder + buf.toString('utf8')).split('\n');
  c.remainder = parts.pop() || '';
  c.window.push(...parseLines(parts, false));
  if (c.window.length > HIST_LIMIT) c.window = c.window.slice(-HIST_LIMIT);
  c.size = st.size;
  c.mtimeMs = st.mtimeMs;
  return c.window;
}

// --- history (pi session files) ---
let histSig = '';
let histGroups = null;

function scanHistory() {
  if (!fs.existsSync(SESSION_ROOT)) return [];
  const found = [];
  for (const dirName of fs.readdirSync(SESSION_ROOT)) {
    const dir = path.join(SESSION_ROOT, dirName);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.meta.json')) continue;
      const mp = path.join(dir, f);
      found.push({ dir: dirName, metaFile: mp, id: f.slice(0, -'.meta.json'.length), mtime: mtime(mp) });
    }
  }
  const sig = found.map(e => e.id + ':' + e.mtime).join('|');
  if (sig === histSig && histGroups) return histGroups;
  histSig = sig;
  const byCwd = new Map();
  for (const e of found) {
    const meta = readJson(e.metaFile);
    if (!meta || meta.hidden) continue;
    const key = meta.cwd || e.dir;
    if (!byCwd.has(key)) byCwd.set(key, []);
    byCwd.get(key).push({
      id: e.id,
      file: path.join(SESSION_ROOT, e.dir, e.id + '.jsonl'),
      startedAt: meta.startedAt || 0,
      status: meta.status || 'unknown',
      model: meta.model || '',
      tokensIn: meta.tokensIn || 0,
      tokensOut: meta.tokensOut || 0,
      cost: meta.cost || 0,
      firstMessage: meta.firstMessage || '',
      contextTokens: meta.contextTokens || 0,
      contextWindow: meta.contextWindow || 0,
    });
  }
  const groups = [];
  for (const [cwd, sessions] of byCwd) {
    sessions.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    groups.push({ cwd, sessions });
  }
  groups.sort((a, b) => (b.sessions[0]?.startedAt || 0) - (a.sessions[0]?.startedAt || 0));
  histGroups = groups;
  return groups;
}

function resolveHistoryFile(id) {
  if (!fs.existsSync(SESSION_ROOT)) return null;
  if (id.includes('/')) { // encoded path: <project-dir>/<basename>
    const rel = path.normalize(id);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const full = path.join(SESSION_ROOT, rel + '.jsonl');
    if (!full.startsWith(SESSION_ROOT + path.sep)) return null;
    return fs.existsSync(full) ? full : null;
  }
  if (!/^[\w.-]+$/.test(id)) return null;
  for (const dirName of fs.readdirSync(SESSION_ROOT)) {
    const dir = path.join(SESSION_ROOT, dirName);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    const f = path.join(dir, id + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// T01: tail-window read (like viewWindow) instead of full-file parse.
// History transcripts can be multi-MB; we only ever show the last HIST_LIMIT events.
function historyTranscript(id, truncate) {
  const file = resolveHistoryFile(id);
  if (!file) return null;
  const meta = readJson(file.replace(/\.jsonl$/, '.meta.json'));
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const len = Math.min(st.size, TAIL_BYTES);
  const buf = Buffer.alloc(len);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, st.size - len);
  } catch { return null; } finally { if (fd) { try { fs.closeSync(fd); } catch {} } }
  let text = buf.toString('utf8');
  if (len < st.size) text = text.slice(text.indexOf('\n') + 1); // drop partial first line from the tail
  const window = parseLines(text.split('\n'), truncate).slice(-HIST_LIMIT);
  return { id, file, meta, window };
}

// --- SSE ---
const clients = new Set();
const SSE_MAX_BUFFER = 1024 * 1024; // drop clients that cannot keep up (T04)

function viewsSig() {
  if (!fs.existsSync(VIEWS_DIR)) return '';
  let dirs; try { dirs = fs.readdirSync(VIEWS_DIR); } catch { return ''; }
  const parts = [];
  for (const id of dirs) {
    const dir = path.join(VIEWS_DIR, id);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    parts.push(id + ':' + mtime(path.join(dir, 'meta.json')) + ':' + mtime(path.join(dir, 'state.json')));
  }
  return JSON.stringify(parts);
}

function sendEvent(res, event, data) {
  // T04 backpressure: a slow client accumulating >1MB gets dropped
  if (res.writableLength > SSE_MAX_BUFFER) {
    clients.delete(res);
    try { res.destroy(); } catch {}
    return;
  }
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); }
}

function broadcast(event, data) {
  for (const res of [...clients]) sendEvent(res, event, data);
}

// T04: per-client signature — no shared lastSig, no broadcast-to-all on connect
setInterval(() => {
  if (clients.size === 0) return;
  const sig = viewsSig();
  const stale = [];
  for (const res of clients) if (res._sig !== sig) stale.push(res);
  if (!stale.length) return;
  const sessions = groupSessions(scanSessions());
  for (const res of stale) {
    res._sig = sig;
    sendEvent(res, 'sessions', sessions);
  }
}, POLL_MS);
setInterval(() => { if (clients.size) broadcast('tick', Date.now()); }, 5000);

function contentType(fp) {
  switch (path.extname(fp)) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.ico': return 'image/x-icon';
    case '.map': return 'application/json';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function dec(s) { try { return decodeURIComponent(s); } catch { return '\u0000'; } } // safe decode → fails id regex

// --- security gate + control helpers (T-006/T-007/T-008) ---
function gateMutant(req, res) {
  if (!CONTROL_ENABLED) { sendJson(res, 403, { error: 'control disabled' }); return false; }
  const origin = req.headers.origin;
  const relayOrigin = req.headers['x-relay-origin'];
  if (origin && !isWhitelistedOrigin(origin)) { sendJson(res, 403, { error: 'origin not allowed' }); return false; }
  if (!relayOrigin) { sendJson(res, 403, { error: 'missing x-relay-origin' }); return false; }
  if (!isWhitelistedOrigin(relayOrigin)) { sendJson(res, 403, { error: 'x-relay-origin not allowed' }); return false; }
  if (origin && relayOrigin !== origin) { sendJson(res, 403, { error: 'origin mismatch' }); return false; }
  return true;
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// one-shot write of a single JSON line to a unix control socket (3s connect timeout)
function sendSocketLine(socketPath, line) {
  return new Promise((resolve) => {
    const socket = net.connect({ path: socketPath });
    socket.setTimeout(3000);
    let sent = false;
    socket.on('error', (e) => { if (!sent) resolve({ ok: false, code: 502, error: e.code || String(e) }); });
    socket.on('timeout', () => { socket.destroy(); if (!sent) resolve({ ok: false, code: 504, error: 'socket connect timeout' }); });
    socket.on('connect', () => { sent = true; socket.write(line, () => socket.end()); resolve({ ok: true }); });
  });
}

function viewSocketPath(id) {
  const dir = path.join(VIEWS_DIR, id);
  const host = readJson(path.join(dir, 'host.json')) || {};
  return host.socketPath || path.join(dir, 'control.sock');
}

// relaunch an exited view's host with `text` — continues the SAME conversation
// (pty-runner always passes --session <meta.sessionFile>). Mirrors board's send() on dead host.
async function relaunchWithPrompt(req, res, id, op, text) {
  const meta = readJson(path.join(VIEWS_DIR, id, 'meta.json')) || {};
  if (!meta.sessionFile || !fs.existsSync(meta.sessionFile)) return sendJson(res, 409, { error: 'session not alive and no transcript to resume' });
  const mods = await boardModules();
  if (!mods) return sendJson(res, 500, { error: 'board unavailable: ' + BOARD_DIR + ' not found' });
  try {
    const config = {
      root: BOARD_ROOT,
      viewId: id,
      sessionFile: meta.sessionFile,
      cwd: meta.cwd || '',
      initialPrompt: text,
      piCommand: RELAY_PI_COMMAND,
      piArgsPrefix: RELAY_PI_ARGS,
      model: null,
      thinkingLevel: null,
      tools: null,
      env: {},
      cols: Number(process.env.COLUMNS || 120),
      rows: Number(process.env.LINES || 36),
    };
    mods.launch.launchHost(BOARD_ROOT, config, { runnerScript: path.join(BOARD_DIR, 'runner', 'pty-runner.mjs') });
    audit(op, id, req, { textPreview: text.slice(0, 200), relaunched: true });
    return sendJson(res, 200, { ok: true, relaunched: true });
  } catch (e) {
    return sendJson(res, 500, { error: 'relaunch failed: ' + (e && e.message ? e.message : String(e)) });
  }
}

async function handleReply(req, res, id) {
  const state = readJson(path.join(VIEWS_DIR, id, 'state.json')) || {};
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const text = typeof body.text === 'string' ? body.text : '';
  if (state.needsInput !== true) {
    // alive but busy -> reject; exited -> resume the conversation with this text
    if (state.processState === 'alive') return sendJson(res, 409, { error: 'session busy' });
    if (!text.trim()) return sendJson(res, 400, { error: 'empty text' });
    return relaunchWithPrompt(req, res, id, 'reply', text);
  }
  const socketPath = viewSocketPath(id);
  if (!fs.existsSync(socketPath)) return sendJson(res, 502, { error: 'socket not found' });
  const r = await sendSocketLine(socketPath, JSON.stringify({ type: 'input', data: text + '\r' }) + '\n');
  if (!r.ok) return sendJson(res, r.code || 502, { error: r.error });
  audit('reply', id, req, { textPreview: text.slice(0, 200) });
  return sendJson(res, 200, { ok: true });
}

// steer: inject a message while the session is running (pi treats typed input
// during a turn as steering). Same wire format as reply, different gate+audit.
async function handleSteer(req, res, id) {
  const state = readJson(path.join(VIEWS_DIR, id, 'state.json')) || {};
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (state.processState !== 'alive') {
    // exited -> resume the conversation with this text
    if (!text) return sendJson(res, 400, { error: 'empty text' });
    return relaunchWithPrompt(req, res, id, 'steer', text);
  }
  if (!text) return sendJson(res, 400, { error: 'empty text' });
  const socketPath = viewSocketPath(id);
  if (!fs.existsSync(socketPath)) return sendJson(res, 502, { error: 'socket not found' });
  const r = await sendSocketLine(socketPath, JSON.stringify({ type: 'input', data: text + '\r' }) + '\n');
  if (!r.ok) return sendJson(res, r.code || 502, { error: r.error });
  audit('steer', id, req, { textPreview: text.slice(0, 200) });
  return sendJson(res, 200, { ok: true });
}

// read-only model catalog from pi's models-store.json (provider -> {models:[{id,name}]})
function modelsCatalog() {
  const storePath = path.join(os.homedir(), '.pi', 'agent', 'models-store.json');
  const raw = readJson(storePath);
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const [pid, entry] of Object.entries(raw)) {
    const models = Array.isArray(entry && entry.models) ? entry.models : [];
    out.push({ id: pid, models: models.map((m) => ({ id: m && m.id, name: (m && m.name) || (m && m.id) || m })) });
  }
  return out;
}

// archive: remove a view from the dashboard (meta.archived=true), terminating it first when alive.
// Works on exited/stale views too — that's the point: dead sessions need a removable action.
async function handleArchive(req, res, id) {
  const dir = path.join(VIEWS_DIR, id);
  const state = readJson(path.join(dir, 'state.json')) || {};
  if (state.processState === 'alive') {
    const socketPath = viewSocketPath(id);
    if (fs.existsSync(socketPath)) await sendSocketLine(socketPath, JSON.stringify({ type: 'terminate' }) + '\n');
  }
  const metaP = path.join(dir, 'meta.json');
  const meta = readJson(metaP) || {};
  meta.archived = true;
  try { fs.writeFileSync(metaP, JSON.stringify(meta)); } catch (e) {
    return sendJson(res, 500, { error: 'archive failed: ' + (e && e.message ? e.message : String(e)) });
  }
  winCache.delete(id);
  audit('archive', id, req, { wasAlive: state.processState === 'alive' });
  return sendJson(res, 200, { ok: true });
}

async function handleSignal(req, res, id, type) {
  const state = readJson(path.join(VIEWS_DIR, id, 'state.json')) || {};
  if (state.processState !== 'alive') return sendJson(res, 409, { error: 'session not alive' });
  const socketPath = viewSocketPath(id);
  if (!fs.existsSync(socketPath)) return sendJson(res, 502, { error: 'socket not found' });
  const r = await sendSocketLine(socketPath, JSON.stringify({ type }) + '\n');
  if (!r.ok) return sendJson(res, r.code || 502, { error: r.error });
  audit(type, id, req, {});
  return sendJson(res, 200, { ok: true });
}

// T-009: dispatch a new session — calls the real model code of pi-agent-board.
// lazily load pi-agent-board's real modules (store/launch/ids) — cached
let boardModsPromise = null;
function boardModules() {
  if (!boardModsPromise) {
    boardModsPromise = (async () => {
      const base = path.join(BOARD_DIR, 'src', 'core');
      const [store, launch, ids] = await Promise.all([
        import(pathToFileURL(path.join(base, 'store.mjs')).href),
        import(pathToFileURL(path.join(base, 'launch.mjs')).href),
        import(pathToFileURL(path.join(base, 'ids.mjs')).href),
      ]);
      return { store, launch, ids };
    })().catch((e) => {
      // T06: don't cache failure forever — allow retry on next call
      console.error('[relay] board modules import failed (' + BOARD_DIR + '):', e && e.message ? e.message : e);
      boardModsPromise = null;
      return null;
    });
  }
  return boardModsPromise;
}

async function handleDispatch(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad json' }); }
  const cwd = typeof body.cwd === 'string' ? body.cwd : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!prompt) return sendJson(res, 400, { error: 'empty prompt' });
  if (!cwd) return sendJson(res, 400, { error: 'empty cwd' });
  if (model && !/^[\w.@/-]+$/.test(model)) return sendJson(res, 400, { error: 'bad model' });
  let st;
  try { st = fs.statSync(cwd); } catch { return sendJson(res, 400, { error: 'cwd not found' }); }
  if (!st.isDirectory()) return sendJson(res, 400, { error: 'cwd not a directory' });

  let store, launch, ids;
  const mods = await boardModules();
  if (!mods) return sendJson(res, 500, { error: 'board unavailable: ' + BOARD_DIR + ' not found' });
  ({ store, launch, ids } = mods);
  try {
    const id = ids.newViewId();
    const meta = store.createView(BOARD_ROOT, {
      id,
      name: ids.slugifyTask(prompt),
      cwd,
      repoCwd: cwd,
      repoRoot: null,
      worktreeMode: 'off',
      worktreePath: null,
      defaultModel: model || null,
      defaultThinking: null,
      writeCapable: true,
    });
    const config = {
      root: BOARD_ROOT,
      viewId: id,
      sessionFile: meta.sessionFile,
      cwd,
      initialPrompt: prompt,
      piCommand: RELAY_PI_COMMAND,
      piArgsPrefix: RELAY_PI_ARGS,
      model: model || null,
      thinkingLevel: null,
      tools: null,
      env: {},
      cols: Number(process.env.COLUMNS || 120),
      rows: Number(process.env.LINES || 36),
    };
    const { pid } = launch.launchHost(BOARD_ROOT, config, { runnerScript: path.join(BOARD_DIR, 'runner', 'pty-runner.mjs') });
    audit('dispatch', id, req, { cwd, model: model || '-', promptPreview: prompt.slice(0, 200) });
    return sendJson(res, 200, { ok: true, viewId: id, pid, socketPath: path.join(VIEWS_DIR, id, 'control.sock') });
  } catch (e) {
    return sendJson(res, 500, { error: 'dispatch failed: ' + (e && e.message ? e.message : String(e)) });
  }
}

async function handlePost(req, res, p) {
  const replyM = p.match(/^\/api\/sessions\/([^/]+)\/reply$/);
  const steerM = p.match(/^\/api\/sessions\/([^/]+)\/steer$/);
  const interruptM = p.match(/^\/api\/sessions\/([^/]+)\/interrupt$/);
  const terminateM = p.match(/^\/api\/sessions\/([^/]+)\/terminate$/);
  const archiveM = p.match(/^\/api\/sessions\/([^/]+)\/archive$/);

  if (p === '/api/dispatch') {
    if (!CONTROL_ENABLED) return sendJson(res, 403, { error: 'control disabled' });
    if (!DISPATCH_ENABLED) return sendJson(res, 403, { error: 'dispatch disabled' });
    if (!gateMutant(req, res)) return;
    return handleDispatch(req, res);
  }

  let id = null, op = null;
  if (replyM) { id = replyM[1]; op = 'reply'; }
  else if (steerM) { id = steerM[1]; op = 'steer'; }
  else if (interruptM) { id = interruptM[1]; op = 'interrupt'; }
  else if (terminateM) { id = terminateM[1]; op = 'terminate'; }
  else if (archiveM) { id = archiveM[1]; op = 'archive'; }
  else return sendJson(res, 404, { error: 'not found' });

  id = dec(id);
  if (!/^[\w.-]+$/.test(id)) return sendJson(res, 400, { error: 'bad view id' });
  if (!gateMutant(req, res)) return;
  const dir = path.join(VIEWS_DIR, id);
  let st;
  try { st = fs.statSync(dir); } catch { return sendJson(res, 404, { error: 'view not found' }); }
  if (!st.isDirectory()) return sendJson(res, 404, { error: 'view not found' });

  if (op === 'reply') return handleReply(req, res, id);
  if (op === 'steer') return handleSteer(req, res, id);
  if (op === 'archive') return handleArchive(req, res, id);
  return handleSignal(req, res, id, op);
}

// --- router ---
const server = http.createServer((req, res) => {
  securityHeaders(res); // T05: applied to every response (API + static + SSE)
  let u;
  try { u = new URL(req.url, 'http://localhost'); } catch { return sendJson(res, 400, { error: 'bad request' }); }
  const p = u.pathname;

  // Basic auth on every /api/* when configured (static pages stay public).
  if (p.startsWith('/api/') && AUTH_ENABLED) {
    const auth = req.headers.authorization || '';
    if (auth !== AUTH_BASIC) {
      res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Basic realm="relay"', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
  }

  if (req.method === 'HEAD') req.method = 'GET';
  if (req.method === 'POST') return handlePost(req, res, p);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed', allowed: 'GET, POST' });

  if (p === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      boardRoot: BOARD_ROOT,
      sessionRoot: SESSION_ROOT,
      views: scanSessions().length,
      sessionsDirExists: fs.existsSync(SESSION_ROOT),
    });
  }

  if (p === '/api/meta') {
    return sendJson(res, 200, {
      control: CONTROL_ENABLED,
      dispatch: DISPATCH_ENABLED,
      auth: AUTH_ENABLED,
      tunnelOrigin: !!TUNNEL_ORIGIN,
    });
  }

  if (p === '/api/sessions') {
    return sendJson(res, 200, groupSessions(scanSessions()));
  }

  if (p === '/api/models') {
    return sendJson(res, 200, { providers: modelsCatalog() });
  }

  if (p === '/api/history') {
    return sendJson(res, 200, scanHistory());
  }

  const hm = p.match(/^\/api\/history\/sessions\/(.+)$/);
  if (hm) {
    const id = dec(hm[1]);
    const truncate = u.searchParams.get('truncate') !== '0'; // history preview: truncate thinking >8KB by default
    const t = historyTranscript(id, truncate);
    if (!t) return sendJson(res, 404, { error: 'session not found' });
    return sendJson(res, 200, t);
  }

  const m = p.match(/^\/api\/sessions\/([^/]+)$/);
  if (m) {
    const id = dec(m[1]);
    if (!/^[\w.-]+$/.test(id)) return sendJson(res, 400, { error: 'bad view id' });
    const dir = path.join(VIEWS_DIR, id);
    let st;
    try { st = fs.statSync(dir); } catch { return sendJson(res, 404, { error: 'view not found' }); }
    if (!st.isDirectory()) return sendJson(res, 404, { error: 'view not found' });
    const meta = readJson(path.join(dir, 'meta.json')) || {};
    const state = readJson(path.join(dir, 'state.json')) || {};
    const host = readJson(path.join(dir, 'host.json')) || {};
    const window = (viewWindow(id) || []).slice(-LIVE_LIMIT); // live chat: never truncated
    // T03: ETag over the whole payload — unchanged windows answer 304 instead of re-sending ~200 events
    const body = JSON.stringify({ id, meta, state, host, window });
    const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ETag: etag });
    return res.end(body);
  }

  if (p === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
    });
    res.write('retry: 3000\n\n');
    // T04: initial snapshot goes to this client only; per-client sig starts clean
    clients.add(res);
    res._sig = viewsSig();
    sendEvent(res, 'sessions', groupSessions(scanSessions()));
    req.on('close', () => clients.delete(res));
    res.on('error', () => clients.delete(res));
    return;
  }

  // static: serve from PUBLIC_DIR; unknown path -> index.html (SPA)
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/g, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('not found');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(b2);
      });
    }
    // niente cache heuristica: il browser riverifica ad ogni refresh
    const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag });
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Cache-Control': 'no-cache',
      'ETag': etag,
    });
    res.end(buf);
  });
});

// T06: clear failure when the port is taken instead of an unhandled crash
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`relay-pi-dashboard: port ${PORT} already in use — is another relay instance running? (try --stop)`);
    process.exit(0);
  }
  console.error('relay-pi-dashboard server error:', e && e.message ? e.message : e);
  process.exit(1);
});

// T02: cap winCache entries (FIFO eviction via Map insertion order)
const WIN_CACHE_MAX = 50;
winCache.set = ((orig) => function (id, c) {
  orig.call(this, id, c);
  while (this.size > WIN_CACHE_MAX) this.delete(this.keys().next().value);
})(winCache.set.bind(winCache));

// T06: graceful shutdown — close SSE streams, flush and exit
function shutdown() {
  for (const res of [...clients]) { try { res.end(); } catch {} }
  clients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  // PORT may be 0 (ephemeral); report the OS-assigned port so the Electron
  // main process can learn it without a separate TOCTOU-prone probe.
  const BOUND_PORT = server.address() && typeof server.address() === 'object' ? server.address().port : PORT;
  console.log(`Relay-pi-dashboard on http://${HOST}:${BOUND_PORT} · board: ${BOARD_ROOT} · sessions: ${SESSION_ROOT}`);
  // T05: loud warning when a tunnel exposes unauthenticated PII
  if (TUNNEL_ORIGIN && !AUTH_ENABLED) {
    console.warn('WARNING: RELAY_TUNNEL_ORIGIN is set without RELAY_AUTH_USER/RELAY_AUTH_PASS — full pi session content (PII) is exposed to anyone who can reach the tunnel.');
  }
});