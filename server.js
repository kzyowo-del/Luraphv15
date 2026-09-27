'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const DEOB_SCRIPT = path.join(__dirname, 'deob.js');

// ─── HTML UI ────────────────────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Luraph V15 Deobfuscator</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0d;color:#e0e0e0;font-family:'Courier New',monospace;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px}
  h1{font-size:1.4rem;color:#a78bfa;margin-bottom:6px;letter-spacing:1px}
  p.sub{color:#666;font-size:.8rem;margin-bottom:24px}
  textarea{width:100%;max-width:760px;height:240px;background:#111;border:1px solid #333;color:#ccc;padding:12px;font-size:.82rem;border-radius:6px;resize:vertical;outline:none}
  textarea:focus{border-color:#a78bfa}
  .row{display:flex;gap:12px;max-width:760px;width:100%;margin-top:10px;flex-wrap:wrap}
  button{flex:1;padding:10px;background:#a78bfa;color:#000;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:.9rem;letter-spacing:.5px}
  button:hover{background:#c4b5fd}
  button.sec{background:#222;color:#a78bfa;border:1px solid #a78bfa}
  button.sec:hover{background:#2a2a2a}
  #status{max-width:760px;width:100%;margin-top:14px;font-size:.78rem;color:#888;min-height:18px}
  #out{width:100%;max-width:760px;height:300px;background:#0a0a0a;border:1px solid #222;color:#7dd3a8;padding:12px;font-size:.8rem;border-radius:6px;resize:vertical;margin-top:10px;display:none}
  #out.show{display:block}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.72rem;margin-left:8px}
  .ok{background:#134e2a;color:#4ade80}.err{background:#450a0a;color:#f87171}
</style>
</head>
<body>
<h1>⬡ Luraph V15 Deobfuscator</h1>
<p class="sub">Paste obfuscated Lua/Luau source below</p>
<textarea id="src" placeholder="-- paste obfuscated code here..."></textarea>
<div class="row">
  <button onclick="run()">Deobfuscate</button>
  <button class="sec" onclick="detect()">Detect Only</button>
  <button class="sec" onclick="copy()">Copy Output</button>
</div>
<div id="status"></div>
<textarea id="out" readonly placeholder="output will appear here..."></textarea>

<script>
const status = document.getElementById('status');
const out    = document.getElementById('out');

async function run() {
  const src = document.getElementById('src').value.trim();
  if (!src) { status.textContent = 'paste some code first'; return; }
  status.innerHTML = 'running... <span style="color:#facc15">⏳</span>';
  out.classList.remove('show');
  try {
    const r = await fetch('/deobfuscate', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ source: src })
    });
    const j = await r.json();
    if (j.error) {
      status.innerHTML = 'error <span class="badge err">FAIL</span>';
      out.value = j.error + (j.stderr ? '\\n\\n--- stderr ---\\n' + j.stderr : '');
    } else {
      status.innerHTML = 'done <span class="badge ok">OK</span>' + (j.obfuscator ? ' · detected: ' + j.obfuscator : '');
      out.value = j.result;
    }
    out.classList.add('show');
  } catch(e) {
    status.textContent = 'network error: ' + e.message;
  }
}

async function detect() {
  const src = document.getElementById('src').value.trim();
  if (!src) { status.textContent = 'paste some code first'; return; }
  status.textContent = 'detecting...';
  try {
    const r = await fetch('/detect', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ source: src })
    });
    const j = await r.json();
    status.innerHTML = j.error
      ? 'error: ' + j.error
      : 'detected: <strong style="color:#a78bfa">' + j.obfuscator + '</strong> (confidence: ' + j.confidence + ')';
  } catch(e) {
    status.textContent = 'network error: ' + e.message;
  }
}

function copy() {
  const v = out.value;
  if (!v) return;
  navigator.clipboard.writeText(v).then(() => {
    status.textContent = 'copied to clipboard';
  });
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
    req.on('data', c => { data += c; if (data.length > 4 * 1024 * 1024) reject(new Error('body too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function runDeob(source, flags = []) {
  return new Promise((resolve) => {
    const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'deob_srv_'));
    const inFile  = path.join(tmpDir, 'input.lua');
    const outFile = path.join(tmpDir, 'output.lua');

    fs.writeFileSync(inFile, source, 'latin1');

    const args = [DEOB_SCRIPT, inFile, '-o', outFile, ...flags];
    const proc = execFile('node', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      let result = null;
      try { if (fs.existsSync(outFile)) result = fs.readFileSync(outFile, 'utf8'); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

      if (err && !result) {
        resolve({ ok: false, error: err.message, stderr });
      } else {
        resolve({ ok: true, result: result || stdout, stderr });
      }
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

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // UI
  if (method === 'GET' && (url === '/' || url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

  // Health check
  if (method === 'GET' && url === '/health') {
    return json(res, 200, { status: 'ok' });
  }

  // POST /deobfuscate
  if (method === 'POST' && url === '/deobfuscate') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    if (!body.source || typeof body.source !== 'string') return json(res, 400, { error: 'missing source' });

    const flags = [];
    if (body.noDevirt)     flags.push('--no-devirt');
    if (body.noFold)       flags.push('--no-fold');
    if (body.strings)      flags.push('--strings');
    if (body.keepHarness)  flags.push('--keep-harness');
    if (body.keepPreamble) flags.push('--keep-preamble');

    const r = await runDeob(body.source, flags);
    if (!r.ok) return json(res, 500, { error: r.error, stderr: r.stderr });
    return json(res, 200, { result: r.result, stderr: r.stderr });
  }

  // POST /detect
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
