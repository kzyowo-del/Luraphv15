'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const DEOB_SCRIPT = path.join(__dirname, 'deob.js');
const VMP_DIR = path.join(__dirname, 'luauvmp-engine', 'luau-vmp-deobf-main');

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Luau Deobfuscator</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d0d;color:#e0e0e0;font-family:'Courier New',monospace;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:28px 14px}
h1{font-size:1.35rem;color:#a78bfa;margin-bottom:4px;letter-spacing:1px}
p.sub{color:#555;font-size:.78rem;margin-bottom:18px}

/* ENGINE TABS */
.tabs{display:flex;gap:0;max-width:760px;width:100%;margin-bottom:12px;border-radius:7px;overflow:hidden;border:1px solid #333}
.tab{flex:1;padding:10px;background:#111;color:#888;font-family:'Courier New',monospace;font-size:.85rem;font-weight:700;cursor:pointer;border:none;letter-spacing:.4px;transition:.15s}
.tab.active{background:#a78bfa;color:#000}
.tab:hover:not(.active){background:#1a1a1a;color:#ccc}

textarea{width:100%;max-width:760px;height:220px;background:#111;border:1px solid #333;color:#ccc;padding:12px;font-size:.8rem;border-radius:6px;resize:vertical;outline:none}
textarea:focus{border-color:#a78bfa}

.row{display:flex;gap:8px;max-width:760px;width:100%;margin-top:9px;flex-wrap:wrap}
button{flex:1;padding:9px 6px;background:#a78bfa;color:#000;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:.82rem;font-family:'Courier New',monospace;letter-spacing:.3px;min-width:80px}
button:hover{background:#c4b5fd}
button.sec{background:#1a1a1a;color:#a78bfa;border:1px solid #333}
button.sec:hover{background:#252525}
button:disabled{opacity:.4;cursor:not-allowed}

#status{max-width:760px;width:100%;margin-top:12px;font-size:.76rem;color:#888;min-height:16px}
.badge{display:inline-block;padding:2px 7px;border-radius:4px;font-size:.7rem;margin-left:6px}
.ok{background:#134e2a;color:#4ade80}.err{background:#450a0a;color:#f87171}.info{background:#1e1b4b;color:#a78bfa}

#out{width:100%;max-width:760px;height:280px;background:#080808;border:1px solid #1e1e1e;color:#7dd3a8;padding:12px;font-size:.78rem;border-radius:6px;resize:vertical;margin-top:10px;display:none;outline:none}
#out.show{display:block}

.outrow{display:flex;gap:8px;max-width:760px;width:100%;margin-top:8px;flex-wrap:wrap}
</style>
</head>
<body>
<h1>⬡ Luau Deobfuscator</h1>
<p class="sub">Luraph V15 · luau-vmp (V14.7 và cũ hơn)</p>

<!-- ENGINE SWITCH -->
<div class="tabs">
  <button class="tab active" id="tab-v15" onclick="setEngine('v15')">Luraph V15 Master</button>
  <button class="tab" id="tab-vmp" onclick="setEngine('vmp')">luau-vmp</button>
</div>

<textarea id="src" placeholder="-- dán code obfuscated vào đây..."></textarea>

<!-- INPUT ACTIONS -->
<div class="row">
  <button class="sec" onclick="pasteClipboard()">📋 Dán clipboard</button>
  <button class="sec" onclick="pickFile()">📂 Dán từ file</button>
  <input type="file" id="fileInput" accept=".lua,.luau,.txt" style="display:none" onchange="loadFile(this)"/>
</div>

<!-- MAIN ACTIONS -->
<div class="row" style="margin-top:10px">
  <button id="btnDeob" onclick="run()">▶ Deobfuscate</button>
  <button class="sec" onclick="detect()">🔍 Detect only</button>
  <button class="sec" onclick="clearAll()">✕ Clear</button>
</div>

<div id="status"></div>
<textarea id="out" readonly placeholder="output sẽ hiện ở đây..."></textarea>

<!-- OUTPUT ACTIONS -->
<div class="outrow" id="outrow" style="display:none">
  <button class="sec" onclick="copyOut()">📋 Copy output</button>
  <button class="sec" onclick="downloadOut()">⬇ Download file</button>
</div>

<script>
const statusEl = document.getElementById('status');
const outEl    = document.getElementById('out');
const outrow   = document.getElementById('outrow');
let engine = 'v15';

function setEngine(e) {
  engine = e;
  document.getElementById('tab-v15').classList.toggle('active', e === 'v15');
  document.getElementById('tab-vmp').classList.toggle('active', e === 'vmp');
  statusEl.innerHTML = 'engine: <span class="badge info">' + (e === 'v15' ? 'Luraph V15 Master' : 'luau-vmp') + '</span>';
}

async function pasteClipboard() {
  try {
    const t = await navigator.clipboard.readText();
    document.getElementById('src').value = t;
    statusEl.textContent = 'đã dán từ clipboard (' + t.length + ' ký tự)';
  } catch(e) {
    statusEl.textContent = 'không đọc được clipboard: ' + e.message;
  }
}

function pickFile() { document.getElementById('fileInput').click(); }

function loadFile(input) {
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = e => {
    document.getElementById('src').value = e.target.result;
    statusEl.textContent = 'đã tải file: ' + f.name + ' (' + f.size + ' bytes)';
  };
  r.readAsText(f, 'utf-8');
  input.value = '';
}

async function run() {
  const src = document.getElementById('src').value.trim();
  if (!src) { statusEl.textContent = 'dán code trước đã'; return; }
  const btn = document.getElementById('btnDeob');
  btn.disabled = true;
  statusEl.innerHTML = 'đang chạy <span class="badge info">' + engine + '</span> ... ⏳';
  outEl.classList.remove('show');
  outrow.style.display = 'none';

  try {
    const r = await fetch('/deobfuscate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ source: src, engine })
    });
    const j = await r.json();
    if (j.error) {
      statusEl.innerHTML = 'lỗi <span class="badge err">FAIL</span>';
      outEl.value = j.error + (j.stderr ? '\\n\\n--- stderr ---\\n' + j.stderr : '');
    } else {
      statusEl.innerHTML = 'xong <span class="badge ok">OK</span>' + (j.obfuscator ? ' · ' + j.obfuscator : '');
      outEl.value = j.result;
      outrow.style.display = 'flex';
    }
    outEl.classList.add('show');
  } catch(e) {
    statusEl.textContent = 'lỗi mạng: ' + e.message;
  }
  btn.disabled = false;
}

async function detect() {
  const src = document.getElementById('src').value.trim();
  if (!src) { statusEl.textContent = 'dán code trước đã'; return; }
  statusEl.textContent = 'đang detect...';
  try {
    const r = await fetch('/detect', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ source: src })
    });
    const j = await r.json();
    statusEl.innerHTML = j.error
      ? 'lỗi: ' + j.error
      : 'detected: <strong style="color:#a78bfa">' + j.obfuscator + '</strong> (confidence: ' + j.confidence + ')';
  } catch(e) {
    statusEl.textContent = 'lỗi mạng: ' + e.message;
  }
}

function clearAll() {
  document.getElementById('src').value = '';
  outEl.value = '';
  outEl.classList.remove('show');
  outrow.style.display = 'none';
  statusEl.textContent = '';
}

function copyOut() {
  const v = outEl.value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => {
    statusEl.textContent = 'đã copy output';
  });
}

function downloadOut() {
  const v = outEl.value;
  if (!v) return;
  const blob = new Blob([v], {type: 'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'deobfuscated.lua';
  a.click();
  URL.revokeObjectURL(a.href);
}

document.getElementById('src').addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') run();
});
</script>
</body>
</html>`;

// ─── HELPERS ────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8 * 1024 * 1024) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function runDeobV15(source, flags = []) {
  return new Promise((resolve) => {
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'deob_v15_'));
    const inFile  = path.join(tmpDir, 'input.lua');
    const outFile = path.join(tmpDir, 'output.lua');
    fs.writeFileSync(inFile, source, 'latin1');
    const args = [DEOB_SCRIPT, inFile, '-o', outFile, ...flags];
    execFile('node', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      let result = null;
      try { if (fs.existsSync(outFile)) result = fs.readFileSync(outFile, 'utf8'); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      if (err && !result) resolve({ ok: false, error: err.message, stderr });
      else resolve({ ok: true, result: result || stdout, stderr });
    });
  });
}

function runDeobVMP(source) {
  return new Promise((resolve) => {
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'deob_vmp_'));
    const inFile  = path.join(tmpDir, 'input.lua');
    const outFile = path.join(tmpDir, 'output.lua');
    fs.writeFileSync(inFile, source, 'utf8');
    const args = ['-m', 'luauvmp', 'deobf', inFile, '-o', outFile];
    execFile('python3', args, {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      cwd: VMP_DIR,
      env: { ...process.env, PYTHONPATH: VMP_DIR }
    }, (err, stdout, stderr) => {
      let result = null;
      try { if (fs.existsSync(outFile)) result = fs.readFileSync(outFile, 'utf8'); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      if (err && !result) resolve({ ok: false, error: err.message, stderr: stderr || stdout });
      else resolve({ ok: true, result: result || stdout, stderr });
    });
  });
}

function runDetect(source) {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deob_det_'));
    const inFile = path.join(tmpDir, 'input.lua');
    fs.writeFileSync(inFile, source, 'latin1');
    execFile('node', [DEOB_SCRIPT, inFile, '--detect'], { timeout: 15_000 }, (err, stdout, stderr) => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      if (err && !stdout) return resolve({ ok: false, error: err.message });
      const parts = stdout.trim().split('\t');
      resolve({ ok: true, name: parts[0] || '', confidence: parts[1] || '0', label: parts[2] || '' });
    });
  });
}

// ─── SERVER ────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  if (method === 'GET' && url === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  if (method === 'POST' && url === '/deobfuscate') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    if (!body.source || typeof body.source !== 'string') return json(res, 400, { error: 'missing source' });

    let r;
    if (body.engine === 'vmp') {
      r = await runDeobVMP(body.source);
    } else {
      const flags = [];
      if (body.noDevirt)     flags.push('--no-devirt');
      if (body.noFold)       flags.push('--no-fold');
      if (body.strings)      flags.push('--strings');
      if (body.keepHarness)  flags.push('--keep-harness');
      if (body.keepPreamble) flags.push('--keep-preamble');
      r = await runDeobV15(body.source, flags);
    }

    if (!r.ok) return json(res, 500, { error: r.error, stderr: r.stderr });
    return json(res, 200, { result: r.result, stderr: r.stderr });
  }

  if (method === 'POST' && url === '/detect') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    if (!body.source) return json(res, 400, { error: 'missing source' });
    const r = await runDetect(body.source);
    if (!r.ok) return json(res, 500, { error: r.error });
    return json(res, 200, { obfuscator: r.label || r.name, confidence: r.confidence });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  process.stderr.write(`[*] server listening on 0.0.0.0:${PORT}\n`);
});
