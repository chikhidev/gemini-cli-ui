// Reads Gemini CLI's own session files so every chat (terminal or UI) shows up in the sidebar.
// Layout: ~/.gemini/tmp/<project>/.project_root  (folder path)
//         ~/.gemini/tmp/<project>/chats/session-<date>-<id8>.jsonl
// Each .jsonl line is: a header {sessionId,...}, a message record {id,type,...} (same id = update),
// a patch {$set:{...}}, or a rewind {$rewindTo: id} (that message and everything after it are dropped, the
// same way Gemini CLI reads it; we keep the dropped part as an earlier version of that turn).
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = path.join(os.homedir(), '.gemini', 'tmp');
const cache = new Map(); // file -> { mtimeMs, summary }

function readRecords(file) {
  const state = { meta: null, messages: new Map(), summary: null, lastUpdated: null, rewound: [] };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (r.$set) {
      // $set.messages is the model-API snapshot written on resume (id-less, includes thought text) — skip it;
      // the id'd records below are the real transcript.
      if (r.$set.summary) state.summary = r.$set.summary;
      if (r.$set.lastUpdated) state.lastUpdated = r.$set.lastUpdated;
    } else if (typeof r.$rewindTo === 'string') {
      let found = false, turn = 0;
      const removed = [];
      for (const [mid, m] of state.messages) {
        if (mid === r.$rewindTo) found = true;
        if (found) removed.push(m);
        else if (m.type === 'user') { const t = userText(m); if (t && !isContext(t)) turn++; }
      }
      if (!found) { removed.push(...state.messages.values()); turn = 0; }
      for (const m of removed) state.messages.delete(m.id);
      if (removed.length) state.rewound.push({ turn, msgs: removed });
    } else if (r.sessionId && !r.type) {
      if (!state.meta) state.meta = r; // a header is re-appended on every resume; keep the original
    } else if (r.id) {
      state.messages.set(r.id, r); // later record with the same id replaces the earlier one
    }
  }
  return state;
}

// Gemini CLI inlines @file references into the saved prompt between these markers; that is file content,
// not something the user typed, so it is removed from what the sidebar and chat show.
const stripReferenced = (t) => t.replace(/\s*--- Content from referenced files ---[\s\S]*?--- End of content ---\s*/g, '\n').trim();
const userText = (m) => stripReferenced((Array.isArray(m.content) ? m.content : [{ text: m.content }])
  .map((c) => (typeof c?.text === 'string' ? c.text : '')).join('').trim());
const isContext = (t) => t.startsWith('<session_context>');

function projectRoot(dir) {
  try {
    const p = fs.readFileSync(path.join(dir, '.project_root'), 'utf8').trim();
    try { return fs.realpathSync.native(p); } catch { return p; }
  } catch { return null; }
}

function sessionFiles() {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(TMP, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const p of projects) {
    const dir = path.join(TMP, p.name);
    const chats = path.join(dir, 'chats');
    let files = [];
    try { files = fs.readdirSync(chats).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    const cwd = projectRoot(dir);
    if (!cwd) continue;
    for (const f of files) out.push({ file: path.join(chats, f), cwd });
  }
  return out;
}

function summarize(file, cwd) {
  const { mtimeMs } = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.summary;
  const s = readRecords(file);
  if (!s.meta || (s.meta.kind && s.meta.kind !== 'main')) return null;
  const msgs = [...s.messages.values()];
  const userTurns = msgs.map((m) => (m.type === 'user' ? userText(m) : '')).filter((t) => t && !isContext(t));
  // A repaired/partial session may have no user text left; fall back to Gemini's first reply.
  const firstGemini = msgs.map((m) => (m.type === 'gemini' && typeof m.content === 'string' ? m.content.trim() : '')).find(Boolean);
  const firstUser = userTurns[0] || firstGemini;
  if (!firstUser) return null; // empty session, nothing to show
  // Drop leading @"path" attachment references so the title shows what was actually asked.
  const titleText = (s.summary || firstUser).replace(/^(?:@"[^"]+"|@\S+)(?:\s+(?:@"[^"]+"|@\S+))*\s*/, '').trim()
    || (s.summary || firstUser);
  const summary = {
    id: s.meta.sessionId,
    title: titleText.replace(/\s+/g, ' ').slice(0, 80),
    cwd,
    updated: Date.parse(s.lastUpdated || s.meta.lastUpdated) || mtimeMs,
    userTurns: userTurns.length,
  };
  cache.set(file, { mtimeMs, summary });
  return summary;
}

// Sessions started or continued from this UI. Other tools (e.g. Aurelia) also run `gemini -p` in the same
// folders; their one-shot runs are flagged `automated` so the sidebar can hide them.
const UI_SESSIONS_FILE = path.join(os.homedir(), '.gemini-ui', 'ui-sessions.json');
let uiSessions = null;
function loadUiSessions() {
  if (!uiSessions) {
    try { uiSessions = new Set(JSON.parse(fs.readFileSync(UI_SESSIONS_FILE, 'utf8'))); } catch { uiSessions = new Set(); }
  }
  return uiSessions;
}
function markUiSession(id) {
  const set = loadUiSessions();
  if (!id || set.has(id)) return;
  set.add(id);
  try {
    fs.mkdirSync(path.dirname(UI_SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(UI_SESSIONS_FILE, JSON.stringify([...set]));
  } catch {}
}

// Names the user gave to chats. Kept in our own file (not Gemini's session files) so renaming can never
// damage a conversation, and it survives Gemini rewriting its files.
const TITLES_FILE = path.join(os.homedir(), '.gemini-ui', 'titles.json');
let titles = null;
function loadTitles() {
  if (!titles) { try { titles = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')); } catch { titles = {}; } }
  return titles;
}
function saveTitles() {
  try { fs.mkdirSync(path.dirname(TITLES_FILE), { recursive: true }); fs.writeFileSync(TITLES_FILE, JSON.stringify(titles, null, 1)); } catch {}
}
// An empty title removes the custom name, so the automatic one comes back.
function setTitle(id, title) {
  const t = loadTitles();
  const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (clean) t[id] = clean; else delete t[id];
  saveTitles();
  return t[id] || null;
}

function list() {
  const out = [];
  const ui = loadUiSessions();
  for (const { file, cwd } of sessionFiles()) {
    try {
      const s = summarize(file, cwd);
      if (s) {
        const custom = loadTitles()[s.id];
        out.push({ ...s, title: custom || s.title, renamed: !!custom, automated: !ui.has(s.id) && s.userTurns <= 1 });
      }
    } catch {}
  }
  return out.sort((a, b) => b.updated - a.updated);
}

function findFile(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '')) return null;
  const short = id.slice(0, 8);
  for (const { file, cwd } of sessionFiles()) {
    if (!path.basename(file).endsWith(short + '.jsonl')) continue;
    const s = summarize(file, cwd);
    if (s && s.id === id) return { file, cwd };
  }
  return null;
}

// Convert session records into the UI's message shape: {role:'user',text,id} | {role:'assistant',parts:[...]}
function buildMessages(records) {
  const messages = [];
  let ai = null;
  let turnStart = null;   // timestamp of the user message that started the current answer
  const assistant = () => {
    if (!ai) { ai = { role: 'assistant', parts: [], _meta: { start: turnStart, end: null, tokens: 0, input: 0, cached: 0, tools: 0, models: new Set() } }; messages.push(ai); }
    return ai;
  };

  for (const m of records) {
    if (m.type === 'user') {
      const t = userText(m);
      if (!t || isContext(t)) continue; // tool responses / injected context aren't user turns
      ai = null;
      turnStart = Date.parse(m.timestamp) || null;
      messages.push({ role: 'user', text: t, id: m.id });
    } else if (m.type === 'gemini') {
      const a = assistant();
      // what the live view shows under a reply: time, tokens, tool calls, models (rebuilt from the saved records)
      const meta = a._meta, ts = Date.parse(m.timestamp);
      if (ts) meta.end = Math.max(meta.end || 0, ts);
      if (m.tokens) { meta.tokens += m.tokens.total || 0; meta.input += m.tokens.input || 0; meta.cached += m.tokens.cached || 0; }
      if (m.model) meta.models.add(m.model);
      meta.tools += (m.toolCalls || []).length;
      // Gemini's reasoning for this step, shown on the timeline just before its actions
      for (const t of m.thoughts || []) {
        if (t.subject || t.description) a.parts.push({ kind: 'thought', subject: t.subject || '', description: t.description || '' });
      }
      const text = typeof m.content === 'string' ? m.content : userText(m);
      if (text) {
        const last = a.parts[a.parts.length - 1];
        if (last && last.kind === 'text') last.text += '\n\n' + text; else a.parts.push({ kind: 'text', text });
      }
      for (const tc of m.toolCalls || []) {
        const resp = tc.result?.[0]?.functionResponse?.response || {};
        a.parts.push({
          kind: 'tool', id: tc.id, name: tc.name, params: tc.args,
          status: tc.status === 'success' ? 'success' : (tc.status || 'error'),
          output: typeof resp.output === 'string' ? resp.output : (resp.error ? '' : JSON.stringify(resp)),
          error: resp.error ? { message: String(resp.error) } : undefined,
        });
      }
    } else if (m.type === 'error') {
      assistant().parts.push({ kind: 'err', text: userText(m) || String(m.content) });
    }
  }
  for (const msg of messages) {
    if (!msg._meta) continue;
    const t = msg._meta;
    delete msg._meta;
    if (!t.tokens && !t.tools) continue;
    msg.stats = {
      secs: t.start && t.end && t.end >= t.start ? (t.end - t.start) / 1000 : null,
      tokens: t.tokens,
      cachedPct: t.input ? Math.round(100 * t.cached / t.input) : 0,
      tools: t.tools,
      models: [...t.models],
    };
  }
  return messages;
}

// A rewound segment cut down to its first turn: the user message and everything up to the next real user message.
function firstTurn(records) {
  const out = [];
  let seenUser = false;
  for (const m of records) {
    const real = m.type === 'user' && (() => { const t = userText(m); return t && !isContext(t); })();
    if (real && seenUser) break;
    if (real) seenUser = true;
    if (seenUser) out.push(m);
  }
  return out;
}

// Every version of a turn: the rewound ones (in the order they were first written) plus the current one.
// A version is identified by the id of its user message, so a version that was brought back is not counted twice.
function turnVersions(state, turn, currentId) {
  const seen = new Map();
  for (const seg of state.rewound) {
    if (seg.turn !== turn) continue;
    const recs = firstTurn(seg.msgs);
    if (recs.length && !seen.has(recs[0].id)) seen.set(recs[0].id, recs);
  }
  if (seen.size === 0) return null;
  const keys = [...seen.keys()];
  if (!seen.has(currentId)) keys.push(currentId);
  return { keys, seen };
}

function load(id) {
  const found = findFile(id);
  if (!found) return null;
  const s = readRecords(found.file);
  const messages = buildMessages(s.messages.values());
  // Replies that were regenerated keep their earlier versions: attach them to the user message of that turn.
  let turn = 0;
  messages.forEach((msg, i) => {
    if (msg.role !== 'user') return;
    const v = turnVersions(s, turn++, msg.id);
    if (!v) return;
    msg.versions = v.keys.map((key) => {
      if (key === msg.id) return { key, current: true };
      const reply = buildMessages(v.seen.get(key)).find((m) => m.role === 'assistant') || { role: 'assistant', parts: [] };
      return { key, reply };
    });
    msg.active = v.keys.indexOf(msg.id);
    msg.latest = !messages.slice(i + 1).some((m) => m.role === 'user');
  });
  return { id, cwd: found.cwd, messages };
}

// The id of the user message that started the last turn (what a retry rewinds to).
function lastTurn(state) {
  let last = null;
  for (const m of state.messages.values()) {
    if (m.type !== 'user') continue;
    const t = userText(m);
    if (t && !isContext(t)) last = m;
  }
  return last;
}

// Retry: rewind the last turn using Gemini CLI's own "$rewindTo" record. Nothing is deleted; the old reply
// stays in the file (above the marker) and shows up as an earlier version.
function rewindLast(id) {
  const found = findFile(id);
  if (!found) return { error: 'Chat not found' };
  const last = lastTurn(readRecords(found.file));
  if (!last) return { error: 'Nothing to retry' };
  fs.appendFileSync(found.file, JSON.stringify({ $rewindTo: last.id }) + '\n');
  cache.delete(found.file);
  return { ok: true, rewound: last.id };
}

// Make another version of the last turn the current one, so the conversation continues from it:
// rewind the current version, then write the chosen version's records back.
function useVersion(id, key) {
  const found = findFile(id);
  if (!found) return { error: 'Chat not found' };
  const s = readRecords(found.file);
  const last = lastTurn(s);
  if (!last) return { error: 'Nothing to switch' };
  if (last.id === key) return { ok: true };
  const turn = [...s.messages.values()].filter((m) => m.type === 'user' && userText(m) && !isContext(userText(m))).length - 1;
  const v = turnVersions(s, turn, last.id);
  const recs = v?.seen.get(key);
  if (!recs) return { error: 'That version is not available' };
  const lines = [JSON.stringify({ $rewindTo: last.id }), ...recs.map((r) => JSON.stringify(r))];
  fs.appendFileSync(found.file, lines.join('\n') + '\n');
  cache.delete(found.file);
  return { ok: true };
}

function remove(id) {
  if (!findFile(id)) return false;
  // Resuming can leave extra stub files for the same session id — remove them all.
  for (const { file } of sessionFiles()) {
    if (!path.basename(file).endsWith(id.slice(0, 8) + '.jsonl')) continue;
    const firstLine = fs.readFileSync(file, 'utf8').split('\n', 1)[0];
    if (firstLine.includes(`"sessionId":"${id}"`)) { fs.unlinkSync(file); cache.delete(file); }
  }
  if (loadTitles()[id]) { delete titles[id]; saveTitles(); }
  return true;
}

// Gemini CLI 0.60 bug: resuming a session (`-r <id>`) leaves an extra "stub" file with the same short id but
// no messages. Gemini's own session cleanup treats the stub as invalid and deletes EVERY file with that short
// id — including the real conversation. We move such stubs out of chats/ (into ~/.gemini/stub-backup) so the
// cleanup never sees them. Called before and after every gemini run.
const STUB_BACKUP = path.join(os.homedir(), '.gemini', 'stub-backup');
function hasMessages(file) {
  const { messages } = readRecords(file);
  for (const m of messages.values()) if (m.type === 'user' || m.type === 'gemini') return true;
  return false;
}
// `onlyShortId` limits the scan to one session (cheap enough to run every second during a run).
function quarantineStubs(onlyShortId) {
  const byShortId = new Map();
  for (const entry of sessionFiles()) {
    const shortId = path.basename(entry.file).match(/-([0-9a-f]{8})\.jsonl$/)?.[1];
    if (!shortId || (onlyShortId && shortId !== onlyShortId)) continue;
    const key = path.dirname(entry.file) + '|' + shortId;
    if (!byShortId.has(key)) byShortId.set(key, []);
    byShortId.get(key).push(entry.file);
  }
  let moved = 0;
  for (const files of byShortId.values()) {
    if (files.length < 2) continue;
    const withContent = files.filter((f) => { try { return hasMessages(f); } catch { return true; } });
    if (!withContent.length) continue; // nothing real to protect
    for (const f of files) {
      if (withContent.includes(f)) continue;
      try {
        fs.mkdirSync(STUB_BACKUP, { recursive: true });
        const project = path.basename(path.dirname(path.dirname(f)));
        fs.renameSync(f, path.join(STUB_BACKUP, project + '__' + path.basename(f)));
        cache.delete(f);
        moved++;
      } catch {}
    }
  }
  return moved;
}

// How big the conversation has grown: the input token count of the last model call in the session.
// Gemini re-sends the whole conversation every call, so this is the live context size.
function contextSize(id) {
  const found = findFile(id);
  if (!found) return null;
  const { messages } = readRecords(found.file);
  let last = null;
  for (const m of messages.values()) if (m.type === 'gemini' && m.tokens?.input) last = m;
  if (!last) return null;
  return { input: last.tokens.input, model: last.model || null };
}

// Full-text search across every saved conversation (your messages and Gemini's replies).
function search(query, limit = 40) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const hits = [];
  for (const { file, cwd } of sessionFiles()) {
    let sum;
    try { sum = summarize(file, cwd); } catch { continue; }
    if (!sum) continue;
    let state;
    try { state = readRecords(file); } catch { continue; }
    for (const m of state.messages.values()) {
      if (m.type !== 'user' && m.type !== 'gemini') continue;
      const text = typeof m.content === 'string' ? m.content : userText(m);
      if (!text || isContext(text)) continue;
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) continue;
      const from = Math.max(0, i - 40);
      const snippet = (from ? '…' : '') + text.slice(from, i + q.length + 60).replace(/\s+/g, ' ')
        + (i + q.length + 60 < text.length ? '…' : '');
      hits.push({ id: sum.id, snippet, role: m.type === 'user' ? 'you' : 'gemini', updated: sum.updated });
      break; // one hit per chat is enough
    }
    if (hits.length >= limit) break;
  }
  return hits.sort((a, b) => b.updated - a.updated);
}

// Gemini's "thoughts" (subject + description) are not part of stream-json, but they are written to the
// session file as soon as the model decides on its next step. Read them while a run is in progress.
const liveFile = new Map(); // session id -> file path
function liveThoughts(id) {
  let file = liveFile.get(id);
  if (!file || !fs.existsSync(file)) {
    const found = findFile(id);
    if (!found) return [];
    file = found.file;
    liveFile.set(id, file);
  }
  let state;
  try { state = readRecords(file); } catch { return []; }
  const out = [];
  for (const m of state.messages.values()) {
    if (m.type !== 'gemini') continue;
    for (const t of m.thoughts || []) {
      if (!t.subject && !t.description) continue;
      out.push({ key: `${t.timestamp || m.id}|${t.subject || ''}`, subject: t.subject || '', description: t.description || '' });
    }
  }
  return out;
}

module.exports = { list, load, rewindLast, useVersion, remove, quarantineStubs, markUiSession, contextSize, search, liveThoughts, setTitle };
