const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const INDEX_HTML = path.join(__dirname, 'index.html');

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Serve Index HTML
  if (pathname === '/' || pathname === '/index.html') {
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end();
      return;
    }
    fs.readFile(INDEX_HTML, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading index.html');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Models Endpoints (OpenAI, LM Studio & Ollama formats for Android Studio AI)
  const modelsList = [
    "claude-opus-5.5", "gpt-6-astra", "claude-sonnet-5",
    "sol", "terra", "claude-fable-5.1", "glm-5.2", "kimi-k3", "dgx-image-flux"
  ];

  if ((pathname === '/v1/models' || pathname === '/models') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      object: 'list',
      data: modelsList.map(m => ({ id: m, object: 'model', owned_by: 'dgx-boss' }))
    }));
    return;
  }

  // Ollama format tags (Used by Android Studio native AI)
  if (pathname === '/api/tags' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      models: modelsList.map(m => ({
        name: m,
        model: m,
        modified_at: new Date().toISOString(),
        size: 4000000000,
        digest: "sha256:" + m.replace(/[^a-z0-9]/g, ''),
        details: { format: "gguf", family: "dgx", parameter_size: "70B", quantization_level: "Q4_K_M" }
      }))
    }));
    return;
  }

  if (pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ version: "0.4.1" }));
    return;
  }

  // Image Generation Endpoint (/v1/images/generations)
  if (pathname === '/v1/images/generations' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const prompt = parsed.prompt || 'a futuristic cyberpunk car';
        const seed = Math.floor(Math.random() * 900000 + 100000);
        const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=turbo&width=1024&height=1024&nologo=true&seed=${seed}`;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [{ url: imgUrl }]
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
      }
    });
    return;
  }

  // OpenAI Chat Completions Endpoint (/v1/chat/completions)
  if (pathname === '/v1/chat/completions' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        let model = parsed.model;
        if (!model) {
          const auth = req.headers['authorization'] || '';
          const match = auth.match(/Bearer\s+(?:dgx|sk-rusher)-([a-zA-Z0-9\.\-_]+)-/);
          model = match ? match[1] : 'gpt-6-astra';
        }

        const workerPayload = {
          messages: parsed.messages || [],
          modelId: model,
          thinking: !!parsed.thinking,
          deepSearch: !!parsed.deepSearch,
          stream: false
        };

        const response = await fetch('https://allaitools-generate.freemodels.workers.dev/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://rusherai.com',
            'Referer': 'https://rusherai.com/'
          },
          body: JSON.stringify(workerPayload)
        });

        const workerData = await response.json().catch(() => ({}));
        const content = workerData.content || (workerData.choices && workerData.choices[0] && workerData.choices[0].message ? workerData.choices[0].message.content : '');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          id: 'chatcmpl-dgx-' + Math.random().toString(36).substring(2),
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: content },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
    return;
  }

  // Direct API endpoint (/api/chat - handles both webapp and Android Studio Ollama format)
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch {}

        const model = parsed.modelId || parsed.model || 'claude-opus-5.5';
        const isOllama = !!parsed.model && !parsed.modelId;

        const workerPayload = {
          messages: parsed.messages || [{ role: 'user', content: parsed.prompt || '' }],
          modelId: model,
          thinking: !!parsed.thinking,
          deepSearch: !!parsed.deepSearch,
          stream: false
        };

        const response = await fetch('https://allaitools-generate.freemodels.workers.dev/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://rusherai.com',
            'Referer': 'https://rusherai.com/'
          },
          body: JSON.stringify(workerPayload)
        });

        const workerData = await response.json().catch(() => ({}));
        const content = workerData.content || (workerData.choices && workerData.choices[0] && workerData.choices[0].message ? workerData.choices[0].message.content : (typeof workerData === 'string' ? workerData : ''));

        if (isOllama) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            model: model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: content },
            done: true
          }));
          return;
        }

        res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(workerData));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Ollama /api/generate endpoint for Android Studio
  if (pathname === '/api/generate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const model = parsed.model || 'claude-opus-5.5';
        const prompt = parsed.prompt || '';

        const workerPayload = {
          messages: [{ role: 'user', content: prompt }],
          modelId: model,
          thinking: false,
          deepSearch: false,
          stream: false
        };

        const response = await fetch('https://allaitools-generate.freemodels.workers.dev/api/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://rusherai.com',
            'Referer': 'https://rusherai.com/'
          },
          body: JSON.stringify(workerPayload)
        });

        const workerData = await response.json().catch(() => ({}));
        const content = workerData.content || (workerData.choices && workerData.choices[0] && workerData.choices[0].message ? workerData.choices[0].message.content : '');

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          model: model,
          created_at: new Date().toISOString(),
          response: content,
          done: true
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`DGx Boss Server running on port ${PORT}`);
});
