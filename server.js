const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // CORS liberado para qualquer origem
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (!req.url.startsWith('/proxy?url=')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Use /proxy?url=SEU_LINK_AQUI' }));
    return;
  }

  const rawUrl = req.url.slice('/proxy?url='.length);
  let targetUrl;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl); // valida
  } catch(e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'URL inválida' }));
    return;
  }

  // Só permite S3 da Fieldcontrol
  const allowed = ['s3.amazonaws.com', 'fieldcontrol.com.br'];
  const hostname = new URL(targetUrl).hostname;
  if (!allowed.some(d => hostname.endsWith(d))) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Domínio não permitido: ' + hostname }));
    return;
  }

  const lib = targetUrl.startsWith('https') ? https : http;
  const request = lib.get(targetUrl, { timeout: 15000 }, (upstream) => {
    const ct = upstream.headers['content-type'] || 'image/jpeg';
    if (!ct.startsWith('image/')) {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'URL não retornou imagem: ' + ct }));
      return;
    }
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public, max-age=3600' });
    upstream.pipe(res);
  });

  request.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Erro ao buscar imagem: ' + e.message }));
  });

  request.on('timeout', () => {
    request.destroy();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Timeout ao buscar imagem' }));
  });
});

server.listen(PORT, () => console.log('Proxy rodando na porta ' + PORT));
