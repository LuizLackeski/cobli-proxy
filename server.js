const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// Agora puxamos a chave do Gemini
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Função post ajustada (O Gemini manda a chave direto na URL, então não precisa de headers customizados)
function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(url, opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Proxy de imagem: GET /proxy?url=...
  if (req.method === 'GET' && req.url.startsWith('/proxy?url=')) {
    const rawUrl = req.url.slice('/proxy?url='.length);
    let targetUrl;
    try { targetUrl = decodeURIComponent(rawUrl); new URL(targetUrl); }
    catch { res.writeHead(400); res.end(JSON.stringify({ error: 'URL inválida' })); return; }

    const allowed = ['s3.amazonaws.com', 'fieldcontrol.com.br'];
    const hostname = new URL(targetUrl).hostname;
    if (!allowed.some(d => hostname.endsWith(d))) {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Domínio não permitido' })); return;
    }

    try {
      const { status, headers, body } = await fetchUrl(targetUrl);
      const ct = headers['content-type'] || 'image/jpeg';
      if (!ct.startsWith('image/')) { res.writeHead(422); res.end(JSON.stringify({ error: 'Não é imagem' })); return; }
      res.writeHead(status, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' });
      res.end(body);
    } catch(e) {
      res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Analisa imagem: POST /analyze { imageUrl }
  if (req.method === 'POST' && req.url === '/analyze') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { imageUrl } = JSON.parse(body);
        if (!imageUrl) throw new Error('imageUrl obrigatório');
        if (!GEMINI_KEY) throw new Error('Chave API do Gemini não configurada no servidor.');

        // 1. Baixa a imagem
        const { status, headers, body: imgBuf } = await fetchUrl(imageUrl, 20000);
        if (status !== 200) throw new Error('Erro ao baixar imagem: HTTP ' + status);
        const mime = headers['content-type'] || 'image/jpeg';
        const b64 = imgBuf.toString('base64');

        // 2. Prepara o prompt
        const prompt = `Analise esta foto de veículo. Extraia:
1. Placa do veículo brasileiro (ex: ABC1234 ou ABC1D23), sem espaços.
2. Número Cobli visível em etiqueta/adesivo próximo ao QR code. Pode aparecer como "N. Cobli: XXXX". Retorne apenas os caracteres (ex: W65T).
Se não identificar algum, retorne null.
Responda APENAS usando a estrutura JSON abaixo:
{"placa":"XXXXXXX","cobli":"XXXX"}`;

        // 3. Monta o payload no formato exigido pelo Gemini
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_KEY}`;
        const payload = {
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: mime, data: b64 } }
            ]
          }],
          // Força a IA a retornar o texto estritamente em formato JSON
          generationConfig: { responseMimeType: "application/json" }
        };

        // 4. Faz a requisição
        const aiRes = await postJson(geminiUrl, payload);
        const aiData = JSON.parse(aiRes.body);

        if (aiData.error) throw new Error(aiData.error.message);

        // 5. O Gemini retorna o texto dentro de candidates[0].content.parts[0].text
        const txt = aiData.candidates[0].content.parts[0].text.trim();
        const parsed = JSON.parse(txt);

        // 6. Devolve pro Front-end
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ placa: parsed.placa || null, cobli: parsed.cobli || null }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log('Servidor rodando na porta ' + PORT));
