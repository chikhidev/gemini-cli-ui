#!/usr/bin/env node
// Gemini UI — local web frontend for the Gemini CLI (the CLI is the backend).
// Zero dependencies. Run: gemini-ui [port] [--no-open]  (or: node server.js)  →  http://localhost:4545
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execSync, execFileSync } = require('child_process');
const history = require('./history');

const ARGS = process.argv.slice(2);
const PORT = Number(ARGS.find((a) => /^\d+$/.test(a)) || process.env.PORT || 4545);
const APP_URL = `http://localhost:${PORT}`;

function openBrowser() {
  if (ARGS.includes('--no-open')) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', APP_URL]]
    : process.platform === 'darwin' ? ['open', [APP_URL]] : ['xdg-open', [APP_URL]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}
const PUBLIC = path.join(__dirname, 'public');
const running = new Map(); // runId -> child process
const runs = new Map();    // runId -> { sessionId, prompt, events, subs, done, … } — survives page reloads

// Resolve the CLI's JS entry so we can spawn node directly (no shell quoting issues on Windows).
function resolveGemini() {
  if (process.env.GEMINI_JS) return [process.execPath, [process.env.GEMINI_JS]];
  try {
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    const js = path.join(root, '@google', 'gemini-cli', 'bundle', 'gemini.js');
    if (fs.existsSync(js)) return [process.execPath, [js]];
  } catch {}
  return ['gemini', []]; // fallback: rely on PATH
}
const [GEMINI_BIN, GEMINI_PRE] = resolveGemini();

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}

// List sub-directories for the folder picker.
function listDirs(dir) {
  if (!dir) {
    if (process.platform === 'win32') {
      const drives = [];
      for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') if (fs.existsSync(l + ':\\')) drives.push({ name: l + ':\\', path: l + ':\\' });
      return { path: '', parent: null, dirs: drives };
    }
    dir = '/';
  }
  const abs = path.resolve(dir);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const dirs = entries
    .filter((e) => { try { return e.isDirectory() && !e.name.startsWith('$'); } catch { return false; } })
    .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => { try { return e.isFile(); } catch { return false; } })
    .map((e) => {
      let size = 0;
      try { size = fs.statSync(path.join(abs, e.name)).size; } catch {}
      return { name: e.name, path: path.join(abs, e.name), size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const parent = path.dirname(abs);
  return { path: abs, parent: parent === abs ? '' : parent, isGit: fs.existsSync(path.join(abs, '.git')), dirs, files };
}

// ---------- files view ----------
// The Files panel browses the chat's working folder and shows files in place. Reading is limited to that
// folder (and our uploads), so a page can never read arbitrary files through it.
const insideDir = (root, f) => {
  if (!root) return false;
  const rel = path.relative(path.resolve(root), path.resolve(f));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
const readable = (cwd, f) => insideDir(UPLOAD_DIR, f) || insideDir(cwd, f);
const resolveIn = (cwd, p) => path.resolve(cwd || '', String(p || ''));

function treeDir(cwd, dir) {
  const abs = resolveIn(cwd, dir || '.');
  if (!readable(cwd, abs)) return { error: 'Outside the working folder' };
  const out = listDirs(abs);
  out.dirs = out.dirs.filter((d) => d.name !== '.git');
  out.rel = path.relative(path.resolve(cwd), abs);
  return out;
}

const MAX_VIEW = 2 * 1024 * 1024;

// Save text from the file viewer (the CSV table editor). Only inside the working folder. Keeps the file's
// encoding (UTF-8 with or without BOM, UTF-16LE with BOM), and refuses when the file changed on disk since it
// was read (mtime = the mtimeMs the viewer got), so edits Gemini made meanwhile are never overwritten silently.
function writeFileView(cwd, p, text, mtime) {
  const abs = resolveIn(cwd, p);
  if (!cwd || !insideDir(cwd, abs)) return { error: 'Outside the working folder' };
  if (typeof text !== 'string') return { error: 'Nothing to save' };
  let st = null;
  try { st = fs.statSync(abs); } catch {}
  if (st && !st.isFile()) return { error: 'Not a file' };
  if (st && mtime && Math.abs(st.mtimeMs - Number(mtime)) > 1) return { conflict: true, error: 'The file changed on disk since you opened it' };
  let bom = null, enc = 'utf8';
  if (st && st.size >= 2) {
    const head = Buffer.alloc(3), fd = fs.openSync(abs, 'r');
    try { fs.readSync(fd, head, 0, 3, 0); } finally { fs.closeSync(fd); }
    if (head[0] === 0xFF && head[1] === 0xFE) { bom = Buffer.from([0xFF, 0xFE]); enc = 'utf16le'; }
    else if (head[0] === 0xEF && head[1] === 0xBB && head[2] === 0xBF) bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  }
  const body = Buffer.from(text, enc);
  fs.writeFileSync(abs, bom ? Buffer.concat([bom, body]) : body);
  const after = fs.statSync(abs);
  return { ok: true, mtime: after.mtimeMs, size: after.size };
}

function readFileView(cwd, p) {
  const abs = resolveIn(cwd, p);
  if (!readable(cwd, abs)) return { error: 'Outside the working folder' };
  let st;
  try { st = fs.statSync(abs); } catch { return { error: 'File not found' }; }
  if (!st.isFile()) return { error: 'Not a file' };
  const base = { path: abs, rel: path.relative(path.resolve(cwd || ''), abs), size: st.size, mtime: st.mtimeMs };
  if (st.size > MAX_VIEW) return { ...base, tooBig: true };
  const buf = fs.readFileSync(abs);
  const text = decodeText(buf);
  if (text == null) return { ...base, binary: true };
  return { ...base, text };
}

// Text files are not always UTF-8: PowerShell's `>` and Windows tools often write UTF-16, which is full of
// zero bytes and used to be mistaken for binary. Returns null for real binary files.
function decodeText(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xFE && buf[1] === 0xFF) return swap16(buf.subarray(2)).toString('utf16le');
  const head = buf.subarray(0, 8000);
  if (!head.includes(0)) return buf.toString('utf8');
  // No BOM: UTF-16 text has zeros in (almost) every other byte, on one side only.
  const pairs = Math.floor(head.length / 2);
  let evenZeros = 0, oddZeros = 0;
  for (let i = 0; i < pairs * 2; i += 2) { if (head[i] === 0) evenZeros++; if (head[i + 1] === 0) oddZeros++; }
  if (pairs >= 2 && oddZeros > pairs * 0.6 && evenZeros < pairs * 0.05) return buf.toString('utf16le');
  if (pairs >= 2 && evenZeros > pairs * 0.6 && oddZeros < pairs * 0.05) return swap16(buf).toString('utf16le');
  return null;
}
function swap16(b) {
  const out = Buffer.from(b.subarray(0, b.length - (b.length % 2)));
  return out.swap16();
}

// Filter box: files and folders whose path contains the text, across the whole folder (skips .git and
// dependency folders, and stops early on huge trees).
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'target', '.gradle']);
function findFiles(cwd, q) {
  const root = path.resolve(cwd || '');
  if (!cwd || !fs.existsSync(root)) return { error: 'Folder not found' };
  const needle = String(q || '').toLowerCase().replace(/\\/g, '/').trim();
  if (!needle) return { files: [] };
  const out = [], queue = [''];
  let seen = 0, truncated = false;
  while (queue.length) {
    const rel = queue.shift();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (++seen > 40000) { truncated = true; queue.length = 0; break; }
      const r = rel ? rel + '/' + e.name : e.name;
      let dir = false;
      try { dir = e.isDirectory(); } catch {}
      if (dir && SKIP_DIRS.has(e.name)) continue;
      if (dir) queue.push(r);
      if (r.toLowerCase().includes(needle) && (dir ? e.name.toLowerCase().includes(needle) : true)) {
        if (out.length >= 300) { truncated = true; continue; }
        let size;
        if (!dir) { try { size = fs.statSync(path.join(root, r)).size; } catch {} }
        out.push({ rel: r, path: path.join(root, r), dir, size, nameHit: e.name.toLowerCase().includes(needle) });
      }
    }
  }
  // names that match come first, then shorter paths
  out.sort((a, b) => (b.nameHit - a.nameHit) || a.rel.split('/').length - b.rel.split('/').length || a.rel.localeCompare(b.rel));
  return { files: out, truncated };
}

// Which of these paths (absolute or relative to cwd) are real files or folders inside the working folder.
function statPaths(cwd, paths) {
  const out = {};
  for (const p of (paths || []).slice(0, 300)) {
    const abs = resolveIn(cwd, p);
    if (!readable(cwd, abs)) continue;
    try { const st = fs.statSync(abs); out[p] = { path: abs, dir: st.isDirectory() }; } catch {}
  }
  return out;
}

// VS Code's executable, found once (spawned directly, never through a shell).
let vscodeExe;
// Who is signed in: the Google account the Gemini CLI uses (~/.gemini/google_accounts.json), else the OS user.
function currentUser() {
  let email = '';
  try { email = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.gemini', 'google_accounts.json'), 'utf8')).active || ''; } catch {}
  let login = '';
  try { login = os.userInfo().username; } catch {}
  const base = email ? email.split('@')[0] : login;
  const name = base.split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || login;
  return { name, email, login };
}

function findVSCode() {
  if (vscodeExe !== undefined) return vscodeExe;
  vscodeExe = null;
  const tries = process.platform === 'win32'
    ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
       path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '/usr/local/bin/code', '/opt/homebrew/bin/code']
      : ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'];
  if (process.platform === 'win32') {
    try {   // "code" on PATH is ...\Microsoft VS Code\bin\code.cmd; the exe sits one folder up
      const cmd = execFileSync('where', ['code'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim();
      if (cmd) tries.unshift(path.join(path.dirname(path.dirname(cmd)), 'Code.exe'));
    } catch {}
  }
  vscodeExe = tries.find((t) => { try { return fs.statSync(t).isFile(); } catch { return false; } }) || null;
  return vscodeExe;
}

// Open a file with its default app, in VS Code, or show it in Explorer/Finder.
function openPath(cwd, p, how) {
  const abs = resolveIn(cwd, p);
  if (!readable(cwd, abs) || !fs.existsSync(abs)) return { error: 'File not found in the working folder' };
  const run = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  const win = process.platform === 'win32', mac = process.platform === 'darwin';
  if (how === 'reveal') {
    if (win) run('explorer.exe', [`/select,${abs}`]);
    else if (mac) run('open', ['-R', abs]);
    else run('xdg-open', [path.dirname(abs)]);
  } else if (how === 'vscode') {
    const exe = findVSCode();
    if (!exe) return { error: 'VS Code was not found on this computer' };
    run(exe, [abs]);
  } else {
    // never launch programs from here: the default app for these would run them
    if (/\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|msi|msc|scr|lnk|hta|cpl|reg|jar|sh|app|command)$/i.test(abs))
      return { error: 'This file would be run, not opened. Use VS Code or Show in Explorer instead.' };
    if (win) run('explorer.exe', [abs]);
    else run(mac ? 'open' : 'xdg-open', [abs]);
  }
  return { ok: true };
}

// ---------- file changes (git) ----------
// Shows what Gemini actually changed on disk, including files it deleted or changed via shell commands.
function git(cwd, args, maxBuffer = 8 * 1024 * 1024) {
  // stderr is ignored: git's line-ending warnings are not errors here.
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
}
function isRepo(cwd) {
  try { return git(cwd, ['rev-parse', '--is-inside-work-tree']).trim() === 'true'; } catch { return false; }
}
const STATUS_LABEL = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflicted', '?': 'new' };

function changes(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return { error: 'Folder not found' };
  if (!isRepo(cwd)) return { repo: false, files: [] };
  const counts = new Map(); // path -> {added, removed}
  for (const args of [['diff', '--numstat'], ['diff', '--numstat', '--cached']]) {
    for (const line of git(cwd, args).split('\n')) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const prev = counts.get(m[3]) || { added: 0, removed: 0 };
      if (m[1] === '-') { // git sees "binary" (often UTF-16 text): count from our decoded diff instead
        const d = decodedDiff(cwd, m[3], args.includes('--cached'));
        if (d) {
          const body = d.split('\n').slice(d.split('\n').findIndex((l) => l.startsWith('@@')));
          counts.set(m[3], {
            added: prev.added + body.filter((l) => l.startsWith('+')).length,
            removed: prev.removed + body.filter((l) => l.startsWith('-')).length,
          });
        } else counts.set(m[3], prev);
        continue;
      }
      counts.set(m[3], { added: prev.added + (+m[1] || 0), removed: prev.removed + (+m[2] || 0) });
    }
  }
  const files = [];
  for (const line of git(cwd, ['status', '--porcelain=v1', '-uall']).split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2).trim()[0] || 'M';
    const p = line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
    let stat = counts.get(p);
    if (!stat && code === '?') { // untracked: every line is new
      try {
        const abs = path.join(cwd, p);
        stat = fs.statSync(abs).isFile() && fs.statSync(abs).size < 512 * 1024
          ? { added: (decodeText(fs.readFileSync(abs)) ?? '').split(/\r?\n/).length, removed: 0 } : null;
      } catch {}
    }
    files.push({ path: p, status: STATUS_LABEL[code] || code, ...(stat || { added: 0, removed: 0 }) });
  }
  return { repo: true, files };
}

function fileDiff(cwd, file) {
  if (!isRepo(cwd)) return { error: 'Not a git repository' };
  const tracked = (() => { try { git(cwd, ['ls-files', '--error-unmatch', '--', file]); return true; } catch { return false; } })();
  if (!tracked) {
    // Untracked file: show its current content as an addition.
    const abs = path.join(cwd, file);
    if (!fs.existsSync(abs)) return { diff: '' };
    if (fs.statSync(abs).size > 512 * 1024) return { diff: '(file too large to preview)' };
    const text = decodeText(fs.readFileSync(abs));
    if (text == null) return { diff: '(binary file)' };
    const body = text.split('\n').map((l) => '+' + l).join('\n');
    return { diff: `--- /dev/null\n+++ b/${file}\n${body}` };
  }
  let cached = false;
  let out = git(cwd, ['diff', '--', file]);
  if (!out.trim()) { out = git(cwd, ['diff', '--cached', '--', file]); cached = true; }
  // git calls UTF-16 text "binary"; decode both sides ourselves and diff them as text.
  if (/^Binary files .* differ$/m.test(out)) out = decodedDiff(cwd, file, cached) ?? out;
  return { diff: out };
}

// Diff of a file git considers binary, after decoding both versions with decodeText. Returns null when
// either side really is binary. Working-tree diffs compare against the index, staged ones index vs HEAD.
function decodedDiff(cwd, file, cached) {
  const show = (rev) => {
    try { return execFileSync('git', ['show', `${rev}:${file.replace(/\\/g, '/')}`], { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return Buffer.alloc(0); }
  };
  const oldBuf = cached ? show('HEAD') : show('');
  let newBuf;
  if (cached) newBuf = show('');
  else { try { newBuf = fs.readFileSync(path.join(cwd, file)); } catch { newBuf = Buffer.alloc(0); } }
  const a = oldBuf.length ? decodeText(oldBuf) : '', b = newBuf.length ? decodeText(newBuf) : '';
  if (a == null || b == null) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-ui-diff-'));
  try {
    const fa = path.join(dir, 'a'), fb = path.join(dir, 'b');
    fs.writeFileSync(fa, a); fs.writeFileSync(fb, b);
    let out = '';
    try { out = execFileSync('git', ['diff', '--no-index', '--no-color', '--', fa, fb], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (e) { out = e.stdout ? e.stdout.toString() : ''; }   // exit code 1 just means "there are differences"
    // put the real file name back in the header (it names the temp files); stop at the first hunk
    const p = file.replace(/\\/g, '/');
    const lines = out.split('\n');
    const firstHunk = lines.findIndex((l) => l.startsWith('@@'));
    for (let i = 0; i < (firstHunk < 0 ? lines.length : firstHunk); i++) {
      if (lines[i].startsWith('diff --git ')) lines[i] = `diff --git a/${p} b/${p}`;
      else if (lines[i].startsWith('--- ')) lines[i] = `--- a/${p}`;
      else if (lines[i].startsWith('+++ ')) lines[i] = `+++ b/${p}`;
    }
    return lines.join('\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---------- attachments ----------
// Files dropped on the page are written to ~/.gemini-ui/uploads so Gemini can read them with @path.
const UPLOAD_DIR = path.join(os.homedir(), '.gemini-ui', 'uploads');
const MAX_UPLOAD = 20 * 1024 * 1024;

// ---------- plan mode ----------
// In a headless run the CLI's policy auto-allows exit_plan_mode, which switches to YOLO and starts
// implementing right away. This user-tier policy (beats the default tier) denies it instead, so the run
// ends with the plan and the UI shows an Approve / Request changes card.
const PLAN_POLICY = path.join(os.homedir(), '.gemini-ui', 'plan-review.toml');
const PLAN_POLICY_TEXT = `# Written by Gemini Studio: the plan is approved in the UI, not inside the run.
[[rule]]
toolName = "exit_plan_mode"
decision = "deny"
priority = 900
modes = ["plan"]
denyMessage = "The plan is complete. The user reviews and approves it in Gemini Studio, not through this tool. Do not call exit_plan_mode again and do not start implementing. End your turn now with a short summary of the plan."
`;
function planReviewPolicy() {
  try {
    if (!fs.existsSync(PLAN_POLICY) || fs.readFileSync(PLAN_POLICY, 'utf8') !== PLAN_POLICY_TEXT) {
      fs.mkdirSync(path.dirname(PLAN_POLICY), { recursive: true });
      fs.writeFileSync(PLAN_POLICY, PLAN_POLICY_TEXT);
    }
    return PLAN_POLICY;
  } catch { return null; }
}
// Plans live in ~/.gemini/tmp/<project>/<sessionId>/plans/<name>.md (older CLIs: .../<project>/plans).
function readPlan(sessionId, name) {
  const file = path.basename(String(name || ''));
  if (!/\.md$/i.test(file) || (sessionId && !/^[\w-]+$/.test(sessionId))) return { error: 'Bad plan name' };
  const tmp = path.join(os.homedir(), '.gemini', 'tmp');
  let projects = [];
  try { projects = fs.readdirSync(tmp, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  const candidates = [];
  for (const p of projects) {
    if (sessionId) candidates.push(path.join(tmp, p, sessionId, 'plans', file));
    candidates.push(path.join(tmp, p, 'plans', file));
  }
  const found = candidates.filter((c) => fs.existsSync(c)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!found) return { error: 'Plan file not found (Windows may have cleaned the temp folder)' };
  return { path: found, text: fs.readFileSync(found, 'utf8') };
}

function saveUpload({ name, data }) {
  if (!name || typeof data !== 'string') return { error: 'A name and file data are required' };
  const buf = Buffer.from(data, 'base64');
  const isSession = /\.jsonl?$/i.test(name);
  if (buf.length > (isSession ? 100 * 1024 * 1024 : MAX_UPLOAD)) return { error: `File is larger than ${isSession ? 100 : 20} MB` };
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(UPLOAD_DIR, day);
  fs.mkdirSync(dir, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.\- ]+/g, '_');
  let file = path.join(dir, safe);
  if (fs.existsSync(file)) {           // keep both when the same name comes twice
    const ext = path.extname(safe), base = path.basename(safe, ext);
    file = path.join(dir, `${base}-${Date.now().toString(36)}${ext}`);
  }
  fs.writeFileSync(file, buf);
  return { path: file, name: path.basename(file), size: buf.length };
}

// ---------- quota ----------
// Same numbers as the CLI's "/model manage": Code Assist's retrieveUserQuota, using the CLI's own
// OAuth credentials (~/.gemini/oauth_creds.json) and the project from GOOGLE_CLOUD_PROJECT.
const OAUTH_CLIENT_ID = 'REMOVED';
const OAUTH_CLIENT_SECRET = 'REMOVED';
const CODE_ASSIST = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
let tokenCache = null;  // { token, expiry }
let quotaCache = null;  // { at, data }

async function accessToken() {
  if (tokenCache && tokenCache.expiry > Date.now() + 60000) return tokenCache.token;
  const file = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
  const creds = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (creds.expiry_date > Date.now() + 60000) {
    tokenCache = { token: creds.access_token, expiry: creds.expiry_date };
    return tokenCache.token;
  }
  if (!creds.refresh_token) throw new Error('Not signed in');
  const body = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID, client_secret: OAUTH_CLIENT_SECRET,
    refresh_token: creds.refresh_token, grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(j.error_description || j.error || 'Could not refresh the Google token');
  tokenCache = { token: j.access_token, expiry: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

// ---------- models ----------
// The model list is not hardcoded. It mirrors the CLI's "/model manage" picker: from the models Google reports
// quota for on this account, take the newest of each kind (pro preview, flash, pro, flash-lite), then add the
// Gemma models the installed CLI knows. The "auto-..." routing aliases are read from the CLI as well, so a CLI
// update brings new models and aliases along.
let cliModels = null;
function scanCli() {
  if (cliModels) return cliModels;
  const auto = new Set(), gemma = new Set();
  try {
    const bundle = path.dirname(GEMINI_PRE[0] || '');
    for (const f of fs.readdirSync(bundle).filter((n) => n.endsWith('.js'))) {
      const text = fs.readFileSync(path.join(bundle, f), 'utf8');
      for (const m of text.matchAll(/"(auto-gemini-\d+(?:\.\d+)?)"/g)) auto.add(m[1]);
      for (const m of text.matchAll(/var GEMMA_\w+_MODEL = "(gemma-[\w.-]+)"/g)) gemma.add(m[1]);
    }
  } catch {}
  cliModels = { auto: [...auto], gemma: [...gemma] };
  return cliModels;
}
const cliAutoAliases = () => scanCli().auto;
const modelVer = (id) => parseFloat((String(id).match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
function pickerModels(ids) {
  const newest = (re) => ids.filter((id) => re.test(id)).sort((a, b) => modelVer(b) - modelVer(a))[0];
  const picks = [
    newest(/^gemini-[\d.]+-pro-preview$/),
    newest(/^gemini-[\d.]+-flash$/),
    newest(/^gemini-[\d.]+-pro$/),
    newest(/^gemini-[\d.]+-flash-lite$/),
  ].filter(Boolean);
  return [...new Set([...picks, ...scanCli().gemma])];
}
let modelsCache = null;
async function models(force) {
  if (!force && modelsCache && Date.now() - modelsCache.at < 10 * 60 * 1000) return modelsCache.data;
  let ids = [];
  try { ids = ((await quota(force)).models || []).map((m) => m.model); } catch {}
  const data = { models: ids.length ? pickerModels([...new Set(ids)]) : [], auto: cliAutoAliases(), source: ids.length ? 'quota' : 'none' };
  if (ids.length) modelsCache = { at: Date.now(), data };   // only cache a good answer
  return data;
}

async function quota(force) {
  if (!force && quotaCache && Date.now() - quotaCache.at < 60000) return quotaCache.data;
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!project) return { error: 'GOOGLE_CLOUD_PROJECT is not set, so quota cannot be read.' };
  const token = await accessToken();
  const res = await fetch(CODE_ASSIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ project }),
  });
  if (!res.ok) return { error: `Quota request failed (${res.status})` };
  const j = await res.json();
  const models = (j.buckets || [])
    .filter((b) => b.modelId && b.remainingFraction != null)
    .map((b) => ({
      model: b.modelId,
      remaining: b.remainingFraction,
      used: 1 - b.remainingFraction,
      resetTime: b.resetTime || null,
      unit: b.tokenType || 'REQUESTS',
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
  const data = { project, models, at: Date.now() };
  quotaCache = { at: Date.now(), data };
  return data;
}

// POST /api/chat → streams Gemini's stream-json events back as Server-Sent Events.
async function chat(req, res) {
  const { prompt, cwd, sessionId, model, approvalMode, runId, sessionFile } = await readBody(req);
  if (!prompt || !cwd) return json(res, 400, { error: 'prompt and cwd are required' });
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return json(res, 400, { error: 'Working directory does not exist: ' + cwd });

  const mode = ['yolo', 'auto_edit', 'plan'].includes(approvalMode) ? approvalMode : 'yolo';
  const args = [...GEMINI_PRE, '-o', 'stream-json', '--skip-trust', '--approval-mode', mode];
  // Headless plan mode approves its own plan and starts editing in the same run; this policy stops it
  // after the plan so the user can approve it in the UI instead.
  if (mode === 'plan') { const p = planReviewPolicy(); if (p) args.push('--policy', p); }
  // Attachments dropped on the page live outside the project; Gemini only reads binary files (images,
  // PDFs) inside its workspace, so add the uploads folder to it.
  if (fs.existsSync(UPLOAD_DIR)) args.push('--include-directories', UPLOAD_DIR);
  if (model) args.push('-m', model);
  if (sessionId) { args.push('-r', sessionId); history.markUiSession(sessionId); }
  else if (sessionFile) {
    // Gemini loads the file into a NEW session in this folder; its id arrives in the init event as usual.
    if (!fs.existsSync(sessionFile) || !fs.statSync(sessionFile).isFile()) return json(res, 400, { error: 'Session file not found: ' + sessionFile });
    args.push('--session-file', sessionFile);
  }

  // The run lives on its own, not tied to this request: every event is kept, and any page can (re)attach to it
  // and replay what it missed (GET /api/attach). Closing or reloading the page no longer stops Gemini.
  let turnsBefore = 0;
  if (sessionId) { try { turnsBefore = (history.load(sessionId)?.messages || []).filter((m) => m.role === 'user').length; } catch {} }
  const run = { runId: runId || crypto.randomUUID(), sessionId: sessionId || null, cwd, prompt, turnsBefore, startedAt: Date.now(), events: [], subs: new Set(), done: false };
  runs.set(run.runId, run);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  run.subs.add(res);
  req.on('close', () => run.subs.delete(res));
  const send = (obj) => {
    run.events.push(obj);
    const line = 'data: ' + JSON.stringify(obj) + '\n\n';
    for (const r of run.subs) { try { r.write(line); } catch {} }
  };

  // Protect resumed chats from Gemini's own startup cleanup (see history.quarantineStubs). Resuming creates
  // the dangerous stub right away, and other tools' gemini runs can trigger cleanup at any moment, so keep
  // moving this session's stub out every second while the run is active.
  try { history.quarantineStubs(); } catch {}
  const guard = sessionId ? setInterval(() => { try { history.quarantineStubs(sessionId.slice(0, 8)); } catch {} }, 1000) : null;
  // Live thoughts: poll the session file and forward thoughts we have not sent yet. For a resumed chat the
  // existing ones are marked as seen first, so only this run's thoughts are shown.
  let liveId = sessionId || null;
  const seenThoughts = new Set();
  if (liveId) { try { history.liveThoughts(liveId).forEach((t) => seenThoughts.add(t.key)); } catch {} }
  const pollThoughts = () => {
    if (!liveId) return;
    let list = [];
    try { list = history.liveThoughts(liveId); } catch { return; }
    for (const t of list) {
      if (seenThoughts.has(t.key)) continue;
      seenThoughts.add(t.key);
      send({ type: 'thought', subject: t.subject, description: t.description });
    }
  };
  const thoughtTimer = setInterval(pollThoughts, 700);

  // Snapshot the working tree so we can report exactly what this run changed.
  const before = new Map((changes(cwd).files || []).map((f) => [f.path, `${f.status}:${f.added}:${f.removed}`]));
  const child = spawn(GEMINI_BIN, args, {
    cwd,
    // NODE_NO_WARNINGS silences Node deprecation warnings (e.g. DEP0190) that aren't Gemini output.
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    windowsHide: true,
  });
  if (runId) running.set(runId, child);
  // Prompt goes through stdin so long/multiline text and quotes are safe.
  child.stdin.end(prompt);

  // Expired Google login: headless gemini asks "[Y/n]" on stdin, eats the prompt and exits.
  // Detect it and tell the UI instead of dumping the stack trace.
  const AUTH_RE = /Opening authentication page|Error authenticating|FatalCancellationError|Authentication cancelled/;
  let authFailed = false;
  const checkAuth = (text) => {
    if (authFailed || !AUTH_RE.test(text)) return authFailed;
    authFailed = true;
    send({ type: 'auth_required' });
    return true;
  };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    if (checkAuth(chunk.toString('utf8'))) return;
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { send({ type: 'log', content: line }); continue; }
      if (ev.type === 'init' && ev.session_id) { history.markUiSession(ev.session_id); if (!liveId) liveId = ev.session_id; if (!run.sessionId) run.sessionId = ev.session_id; }
      send(ev);
    }
  });
  // Network trouble between this PC and Google (VPN/proxy dropping the connection) makes Gemini retry, and
  // each retry prints a huge error dump. Turn that into a short status, and swallow the rest of the dump.
  const NET_RE = /ECONNRESET|socket hang up|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|TLS connection|network socket disconnected/i;
  let inNetDump = false;
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (checkAuth(text)) return;
    const retry = text.match(/Attempt (\d+) failed\. Retrying with backoff/);
    if (retry) {
      const reason = (text.match(/reason: ([^\n]+)/) || [])[1] || (text.match(NET_RE) || [])[0] || 'connection problem';
      send({ type: 'net_retry', attempt: Number(retry[1]), reason: reason.trim(), network: NET_RE.test(text) });
      inNetDump = true;
      return;
    }
    // continuation lines of that dump (config/headers/stack) arrive in later chunks
    if (inNetDump && /^\s*(config|url|href|origin|protocol|username|password|host|hostname|port|pathname|search|searchParams|hash|method|params|headers|authorization|'content-type'|'User-Agent'|'x-goog-api-client'|responseType|body|signal|retry|validateStatus|errorRedactor|duplex|response|status|error|type|errno|erroredSysCall|Symbol|\[cause\]|\}|\]|at )/m.test(text)
        && !/Error when talking to Gemini API/.test(text)) return;
    inNetDump = false;
    if (NET_RE.test(text)) {
      send({ type: 'net_error', reason: (text.match(/reason: ([^\n]+)/) || text.match(NET_RE) || ['connection problem'])[0].replace(/^reason: /, '').trim() });
      return;
    }
    // Skip known startup noise; surface real errors.
    // Also drop Node warnings, and tool errors — those already show on the failed tool card.
    const NOISE = /256-color|Ripgrep is not available|\[STARTUP\]|reset\)\.?$|YOLO mode is enabled|DeprecationWarning|--trace-deprecation|--trace-warnings|^Error executing tool |^Tool with name ".*" is already registered\. Overwriting\.?$|Skill conflict detected|overriding the same skill from/;
    const withoutNodeWarnings = text.replace(/\(node:\d+\) [^\n]*Warning:[\s\S]*?warning was created\)/g, '');
    const useful = withoutNodeWarnings.split(/\r?\n/).filter((l) => l.trim() && !NOISE.test(l));
    if (useful.length) send({ type: 'stderr', content: useful.join('\n') });
  });
  child.on('error', (e) => { send({ type: 'error', content: 'Failed to start gemini: ' + e.message }); });
  child.on('close', (code) => {
    clearInterval(thoughtTimer);
    if (guard) clearInterval(guard);
    if (runId) running.delete(runId);
    try { history.quarantineStubs(); } catch {}
    if (buf.trim()) { try { send(JSON.parse(buf)); } catch { send({ type: 'log', content: buf }); } }
    try {
      const touched = (changes(cwd).files || []).filter((f) => before.get(f.path) !== `${f.status}:${f.added}:${f.removed}`);
      if (touched.length) send({ type: 'changed_files', files: touched });
    } catch {}
    send({ type: 'done', code });
    run.done = true;
    for (const r of run.subs) { try { r.end(); } catch {} }
    run.subs.clear();
    // keep the finished run a little while, for a page that reloads right at the end
    setTimeout(() => runs.delete(run.runId), 2 * 60 * 1000);
  });
}

// GET /api/attach?runId=…&from=N → the run's events from N on (all of them by default), then live ones.
function attach(req, res, url) {
  const run = runs.get(url.searchParams.get('runId') || '');
  if (!run) return json(res, 404, { error: 'This run is no longer available' });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
  for (const ev of run.events.slice(from)) res.write('data: ' + JSON.stringify(ev) + '\n\n');
  if (run.done) return res.end();
  run.subs.add(res);
  req.on('close', () => run.subs.delete(res));
}


const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.json': 'application/json',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Block other websites / DNS rebinding from driving the CLI through this server.
  const host = (req.headers.host || '').split(':')[0];
  const origin = req.headers.origin;
  if (!['localhost', '127.0.0.1'].includes(host) || (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) {
    res.writeHead(403); return res.end('Forbidden');
  }
  if (req.method === 'POST' && !(req.headers['content-type'] || '').includes('application/json')) {
    res.writeHead(415); return res.end('JSON required');
  }
  try {
    if (req.method === 'POST' && url.pathname === '/api/chat') return chat(req, res);
    if (url.pathname === '/api/attach') return attach(req, res, url);
    if (url.pathname === '/api/runs') {
      return json(res, 200, [...runs.values()].map((r) => ({ runId: r.runId, sessionId: r.sessionId, cwd: r.cwd, prompt: r.prompt, turnsBefore: r.turnsBefore, startedAt: r.startedAt, done: r.done })));
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      const { runId } = await readBody(req);
      const c = running.get(runId);
      if (c) c.kill();
      return json(res, 200, { stopped: !!c });
    }
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return json(res, 200, history.list());
      const s = history.load(id);
      return s ? json(res, 200, s) : json(res, 404, { error: 'Session not found' });
    }
    if (url.pathname === '/api/history' && req.method === 'DELETE') {
      return json(res, 200, { deleted: history.remove(url.searchParams.get('id')) });
    }
    if (url.pathname === '/api/file') {
      const f = url.searchParams.get('path') || '';
      const allowed = !!f && readable(url.searchParams.get('cwd'), f);
      if (!allowed || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end('Not found'); }
      const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      try { return json(res, 200, saveUpload(await readBody(req))); }
      catch (e) { return json(res, 200, { error: e.message }); }
    }
    if (url.pathname === '/api/models') {
      try { return json(res, 200, await models(url.searchParams.get('force') === '1')); }
      catch (e) { return json(res, 200, { models: [], auto: [], error: e.message }); }
    }
    if (url.pathname === '/api/quota') {
      try { return json(res, 200, await quota(url.searchParams.get('force') === '1')); }
      catch (e) { return json(res, 200, { error: e.message }); }
    }
    // Retry: rewind the chat's last turn (Gemini's own "$rewindTo" record), then the page sends the message again.
    if (req.method === 'POST' && url.pathname === '/api/rewind') {
      const { id } = await readBody(req);
      if (running.size) return json(res, 409, { error: 'Wait for Gemini to finish first' });
      return json(res, 200, history.rewindLast(id));
    }
    // Make another version of the last reply the current one, so the conversation continues from it.
    if (req.method === 'POST' && url.pathname === '/api/version') {
      const { id, key } = await readBody(req);
      if (running.size) return json(res, 409, { error: 'Wait for Gemini to finish first' });
      return json(res, 200, history.useVersion(id, key));
    }
    if (req.method === 'POST' && url.pathname === '/api/rename') {
      const { id, title } = await readBody(req);
      if (!/^[0-9a-f-]{36}$/i.test(id || '')) return json(res, 400, { error: 'Bad session id' });
      return json(res, 200, { title: history.setTitle(id, title) });
    }
    if (url.pathname === '/api/search') return json(res, 200, history.search(url.searchParams.get('q')));
    if (url.pathname === '/api/context') return json(res, 200, history.contextSize(url.searchParams.get('id')) || {});
    if (url.pathname === '/api/changes') return json(res, 200, changes(url.searchParams.get('cwd')));
    if (url.pathname === '/api/diff') return json(res, 200, fileDiff(url.searchParams.get('cwd'), url.searchParams.get('path')));
    if (url.pathname === '/api/dirs') return json(res, 200, listDirs(url.searchParams.get('path')));
    if (url.pathname === '/api/tree') return json(res, 200, treeDir(url.searchParams.get('cwd'), url.searchParams.get('path')));
    if (url.pathname === '/api/find') return json(res, 200, findFiles(url.searchParams.get('cwd'), url.searchParams.get('q')));
    if (url.pathname === '/api/plan') return json(res, 200, readPlan(url.searchParams.get('sessionId'), url.searchParams.get('name')));
    if (url.pathname === '/api/read') return json(res, 200, readFileView(url.searchParams.get('cwd'), url.searchParams.get('path')));
    if (req.method === 'POST' && url.pathname === '/api/stat') {
      const { cwd, paths } = await readBody(req);
      return json(res, 200, statPaths(cwd, paths));
    }
    if (req.method === 'POST' && url.pathname === '/api/write') {
      const { cwd, path: p, text, mtime } = await readBody(req);
      try { return json(res, 200, writeFileView(cwd, p, text, mtime)); }
      catch (e) { return json(res, 200, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const { cwd, path: p, how } = await readBody(req);
      return json(res, 200, openPath(cwd, p, how));
    }
    if (url.pathname === '/api/info') return json(res, 200, { home: os.homedir(), cwd: process.cwd(), gemini: GEMINI_PRE[0] || GEMINI_BIN, vscode: !!findVSCode(), platform: process.platform, user: currentUser() });

    const file = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  // Already running (e.g. in another terminal) — just open it.
  console.log(`\n  ✦ Gemini UI is already running at ${APP_URL} — opening it.\n`);
  openBrowser();
  setTimeout(() => process.exit(0), 500);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ✦ Gemini UI running at ${APP_URL}`);
  console.log(`    using: ${GEMINI_PRE[0] || GEMINI_BIN}`);
  console.log('    press Ctrl+C to stop\n');
  openBrowser();
});
