const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8085;
const INDEX_HTML = path.join(__dirname, 'index.html');

const modelsList = [
  "claude-opus-5.5", "gpt-6-astra", "claude-sonnet-5",
  "sol", "terra", "claude-fable-5.1", "glm-5.2", "kimi-k3", "dgx-image-flux"
];

async function callUpstreamWorker(messages, modelId, thinking = false, deepSearch = false) {
  // Normalize model ID (strip tags like :latest)
  const cleanModel = String(modelId || 'gpt-6-astra').replace(/:latest$/, '').trim();

  // Normalize messages (convert OpenAI array contents [{type:"text", text:"..."}] into plain string)
  const normalizedMessages = (messages || []).map(m => {
    let text = '';
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content.map(part => {
        if (typeof part === 'string') return part;
        return part.text || part.content || '';
      }).join('\n');
    } else if (m.content) {
      text = String(m.content);
    }
    return {
      role: m.role === 'developer' ? 'system' : (m.role || 'user'),
      content: text
    };
  }).filter(m => m.content.length > 0);

  // If no messages remained, provide fallback
  if (normalizedMessages.length === 0) {
    normalizedMessages.push({ role: 'user', content: 'Hello' });
  }

  const payload = {
    messages: normalizedMessages,
    modelId: cleanModel,
    thinking: !!thinking,
    deepSearch: !!deepSearch,
    stream: false
  };

  try {
    const response = await fetch('https://allaitools-generate.freemodels.workers.dev/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://rusherai.com',
        'Referer': 'https://rusherai.com/'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    let content = '';
    if (typeof data.content === 'string') {
      content = data.content;
    } else if (data.choices && data.choices[0] && data.choices[0].message) {
      content = data.choices[0].message.content || '';
    } else if (typeof data === 'string') {
      content = data;
    }
    console.log(`[Worker Success] Model: ${cleanModel}, Length: ${content.length}`);
    return content;
  } catch (err) {
    console.error(`[Worker Error] ${err.message}`);
    return `Error: ${err.message}`;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${pathname}`);

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

  // --- OLLAMA ENDPOINTS (Android Studio Native AI) ---

  // GET /api/tags - Models list
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

  // GET /api/version
  if (pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ version: "0.4.1" }));
    return;
  }

  // POST /api/show - Model inspection
  if (pathname === '/api/show' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch {}
      const modelName = parsed.name || parsed.model || 'claude-opus-5.5';
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        modelfile: `# Modelfile\nFROM ${modelName}\nPARAMETER stop "<|im_start|>"\nPARAMETER stop "<|im_end|>"`,
        parameters: `stop "<|im_start|>"\nstop "<|im_end|>"`,
        template: `{{ if .System }}<|im_start|>system\n{{ .System }}<|im_end|>\n{{ end }}{{ if .Prompt }}<|im_start|>user\n{{ .Prompt }}<|im_end|>\n{{ end }}<|im_start|>assistant\n{{ .Response }}<|im_end|>`,
        details: {
          parent_model: "",
          format: "gguf",
          family: "dgx",
          families: ["dgx"],
          parameter_size: "70B",
          quantization_level: "Q4_K_M"
        },
        model_info: {
          "general.architecture": "dgx",
          "general.parameter_count": 70000000000
        }
      }));
    });
    return;
  }

  // GET /api/ps
  if (pathname === '/api/ps' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ models: [] }));
    return;
  }

  // POST /api/chat (Handles both web app & Android Studio Ollama streaming/non-streaming)
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch {}

        const model = parsed.modelId || parsed.model || 'claude-opus-5.5';
        const isOllama = !!parsed.model && !parsed.modelId;

        let messages = parsed.messages || [];
        if (messages.length === 0 && parsed.prompt) {
          messages = [{ role: 'user', content: parsed.prompt }];
        }

        const content = await callUpstreamWorker(messages, model, parsed.thinking, parsed.deepSearch);

        if (isOllama) {
          // If non-streaming requested explicitly
          if (parsed.stream === false) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({
              model: model,
              created_at: new Date().toISOString(),
              message: { role: 'assistant', content: content },
              done: true
            }));
            return;
          }

          // Streaming ndjson response for Android Studio
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Transfer-Encoding': 'chunked',
            'Connection': 'keep-alive'
          });

          const chunks = content.match(/.{1,16}/gs) || [content];
          for (const piece of chunks) {
            res.write(JSON.stringify({
              model: model,
              created_at: new Date().toISOString(),
              message: { role: 'assistant', content: piece },
              done: false
            }) + '\n');
          }

          res.write(JSON.stringify({
            model: model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: '' },
            done: true,
            total_duration: 1500000000,
            load_duration: 500000,
            prompt_eval_count: 20,
            eval_count: chunks.length
          }) + '\n');
          res.end();
          return;
        }

        // Web app internal response
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ content: content, choices: [{ message: { content: content } }] }));
      } catch (err) {
        console.error("Error in /api/chat:", err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /api/generate (Ollama single-prompt completion)
  if (pathname === '/api/generate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch {}
        const model = parsed.model || 'claude-opus-5.5';
        const prompt = parsed.prompt || '';

        const content = await callUpstreamWorker([{ role: 'user', content: prompt }], model);

        if (parsed.stream === false) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({
            model: model,
            created_at: new Date().toISOString(),
            response: content,
            done: true
          }));
          return;
        }

        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Transfer-Encoding': 'chunked',
          'Connection': 'keep-alive'
        });

        const chunks = content.match(/.{1,16}/gs) || [content];
        for (const piece of chunks) {
          res.write(JSON.stringify({
            model: model,
            created_at: new Date().toISOString(),
            response: piece,
            done: false
          }) + '\n');
        }

        res.write(JSON.stringify({
          model: model,
          created_at: new Date().toISOString(),
          response: '',
          done: true
        }) + '\n');
        res.end();
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- OPENAI & LM STUDIO ENDPOINTS ---

  // GET /v1/models or /models
  if ((pathname === '/v1/models' || pathname === '/models') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      object: 'list',
      data: modelsList.map(m => ({ id: m, object: 'model', owned_by: 'dgx-boss' }))
    }));
    return;
  }

  // Gemini / Android Studio Studio Bot responses endpoint (/v1/responses)
  if ((pathname === '/v1/responses' || pathname === '/responses') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const model = parsed.model || 'claude-opus-5.5';
        let msgs = parsed.messages || [];
        if (parsed.contents) {
          // Gemini contents format
          msgs = parsed.contents.map(c => ({
            role: c.role === 'model' ? 'assistant' : 'user',
            content: (c.parts || []).map(p => p.text || '').join('\n')
          }));
        } else if (parsed.prompt) {
          msgs = [{ role: 'user', content: parsed.prompt }];
        }

        const content = await callUpstreamWorker(msgs, model);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: content }],
              role: "model"
            },
            finishReason: "STOP",
            index: 0
          }],
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 }
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // POST /v1/chat/completions (OpenAI compatible)
  if ((pathname === '/v1/chat/completions' || pathname === '/chat/completions') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body || '{}');
        let model = parsed.model;
        if (!model) {
          const auth = req.headers['authorization'] || '';
          const match = auth.match(/Bearer\s+(?:dgx|sk-rusher)-([a-zA-Z0-9\.\-_]+)-/);
          model = match ? match[1] : 'claude-opus-5.5';
        }

        let msgs = parsed.messages;
        if (!msgs || !Array.isArray(msgs) || msgs.length === 0) {
          if (parsed.prompt) msgs = [{ role: 'user', content: parsed.prompt }];
          else if (parsed.input) msgs = [{ role: 'user', content: parsed.input }];
          else msgs = [{ role: 'user', content: 'Hello' }];
        }

        const content = await callUpstreamWorker(msgs, model, parsed.thinking, parsed.deepSearch);

        // SSE Streaming support for OpenAI clients
        if (parsed.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          const chunks = content.match(/.{1,16}/gs) || [content];
          for (const piece of chunks) {
            res.write(`data: ${JSON.stringify({
              id: 'chatcmpl-dgx-' + Math.random().toString(36).substring(2),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
            })}\n\n`);
          }

          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-dgx-' + Math.random().toString(36).substring(2),
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // Standard non-streaming OpenAI response
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

  // POST /v1/images/generations
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

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`DGx Boss Server listening on http://127.0.0.1:${PORT}`);
});
