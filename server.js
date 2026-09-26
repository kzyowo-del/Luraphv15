'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
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

    const args = [path.join(__dirname, 'deob.js'), inputPath, '-o', outputPath];
    if (mode === 'trace') args.push('--no-devirt');

    const timeout = mode === 'trace' ? 15000 : 180000;

    const result = await new Promise((resolve, reject) => {
      execFile(process.execPath, args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
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
