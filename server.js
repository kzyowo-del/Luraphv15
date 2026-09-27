'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const detectModule = require('./src/detect');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.post('/api/detect', (req, res) => {
  const { source } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'No source provided' });
  }
  try {
    const { plugin, confidence } = detectModule.detect(source);
    res.json({ plugin: plugin.name, label: plugin.label, confidence });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── V14 engine via luauvmp ──────────────────────────────────────────────────
function runV14(inputPath, outputDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [
      '-m', 'luauvmp',
      'luraph',
      inputPath,
      '--output', path.join(outputDir, 'v14out'),
    ], {
      cwd: path.join(__dirname, 'luauvmp-engine', 'luau-vmp-deobf-main'),
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    const killer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('V14_TIMEOUT'));
    }, 30000);

    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', code => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error('V14_FAIL: ' + stderr.trim()));
      resolve({ stdout, stderr });
    });

    proc.on('error', err => {
      clearTimeout(killer);
      reject(err);
    });
  });
}

// Detect V14 bằng python — gọi luraph.detect()
function detectV14(inputPath) {
  return new Promise((resolve) => {
    const script = `
import sys
sys.path.insert(0, '.')
from luauvmp.luraph import detect
with open(sys.argv[1], encoding='utf-8', errors='surrogateescape') as f:
    src = f.read()
print('v14' if detect(src) else 'v15')
`;
    const tmpScript = path.join(os.tmpdir(), '_detect_v14.py');
    fs.writeFileSync(tmpScript, script);

    const proc = spawn('python3', [tmpScript, inputPath], {
      cwd: path.join(__dirname, 'luauvmp-engine', 'luau-vmp-deobf-main'),
    });

    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim() === 'v14'));
    proc.on('error', () => resolve(false)); // fallback V15
  });
}
// ───────────────────────────────────────────────────────────────────────────

app.post('/api/deobfuscate', async (req, res) => {
  const { source, mode = 'full' } = req.body;
  if (!source || typeof source !== 'string') {
    return res.status(400).json({ error: 'No source provided' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deobf_web_'));
  const inputPath = path.join(tmpDir, 'input.lua');
  const outputPath = path.join(tmpDir, 'output.lua');

  try {
    fs.writeFileSync(inputPath, source, 'latin1');

    // ── Detect version ──────────────────────────────────────────────────────
    const isV14 = await detectV14(inputPath);

    if (isV14) {
      // ── V14 path ──────────────────────────────────────────────────────────
      const v14Result = await runV14(inputPath, tmpDir);

      // luraph command viết ra: <output>.vm.lua và <output>.bytecode.bin
      const vmFile = path.join(tmpDir, 'v14out.vm.lua');
      const bytecodeFile = path.join(tmpDir, 'v14out.bytecode.bin');

      if (!fs.existsSync(vmFile)) {
        return res.status(500).json({
          error: 'V14 engine produced no output',
          log: v14Result.stderr,
        });
      }

      const vmSource = fs.readFileSync(vmFile, 'utf8');
      return res.json({
        output: vmSource,
        log: v14Result.stdout + v14Result.stderr,
        mode: 'v14',
        bytecode: fs.existsSync(bytecodeFile)
          ? fs.readFileSync(bytecodeFile).toString('base64')
          : null,
      });
    }

    // ── V15 path (original) ────────────────────────────────────────────────
    const args = [
      path.join(__dirname, 'deob.js'),
      inputPath,
      '-o', outputPath,
    ];
    if (mode === 'trace') args.push('--no-devirt');

    const timeout = mode === 'trace' ? 60000 : 600000;

    const result = await new Promise((resolve, reject) => {
      execFile(process.execPath, args, {
        timeout,
        maxBuffer: 20 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err && !fs.existsSync(outputPath)) {
          reject(new Error(stderr || err.message));
        } else {
          resolve({ stdout, stderr });
        }
      });
    });

    if (!fs.existsSync(outputPath)) {
      return res.status(500).json({ error: 'No output generated', log: result.stderr });
    }

    const output = fs.readFileSync(outputPath, 'utf8');
    res.json({ output, log: result.stderr, mode });

  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`Luraph Deobfuscator Web running on http://localhost:${PORT}`);
});
