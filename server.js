// Servidor de GymFlow AI: sirve la web y hace de proxy seguro hacia Groq.
// La API key vive SOLO acá (variable de entorno GROQ_API_KEY), nunca en el navegador.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3999;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_BODY_BYTES = 512 * 1024;   // tope de tamaño del request
const MAX_MESSAGES = 60;             // tope de mensajes por conversación
const RATE_LIMIT = 20;               // pedidos por minuto por IP
const UPSTREAM_TIMEOUT_MS = 30000;

if (!GROQ_API_KEY) {
  console.warn('[AVISO] Falta la variable de entorno GROQ_API_KEY: el chat no va a responder.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
};

// --- Límite de pedidos por IP (protege tu cuota de Groq de abusos) ---
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.resetAt) { hits.set(ip, { count: 1, resetAt: now + 60000 }); return false; }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k); }, 60000).unref();

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Pedido demasiado grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleChat(req, res) {
  if (!GROQ_API_KEY) return sendJson(res, 500, { error: { message: 'El servidor no tiene configurada la clave de la IA.' } });
  if (limited(clientIp(req))) return sendJson(res, 429, { error: { message: 'Demasiadas consultas seguidas. Esperá un minuto e intentá de nuevo.' } });

  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch (e) { return sendJson(res, e.status || 400, { error: { message: e.status === 413 ? 'Pedido demasiado grande.' : 'JSON inválido.' } }); }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > MAX_MESSAGES) {
    return sendJson(res, 400, { error: { message: 'Formato de mensajes inválido.' } });
  }

  // Solo se reenvían los campos permitidos; el modelo lo fija el servidor.
  const body = { model: MODEL, messages: payload.messages };
  if (Array.isArray(payload.tools)) body.tools = payload.tools;
  if (payload.tool_choice) body.tool_choice = payload.tool_choice;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(text);
  } catch (e) {
    const timeout = e.name === 'AbortError';
    sendJson(res, timeout ? 504 : 502, { error: { message: timeout ? 'La IA tardó demasiado en responder.' : 'No se pudo contactar a la IA.' } });
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  sendFile(filePath, res, true);
}

// Si piden una imagen (ej. logo.png) y existe con otra extensión (logo.jpg), se sirve esa.
const IMG_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
function sendFile(filePath, res, tryAlternates) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const ext = path.extname(filePath).toLowerCase();
      if (tryAlternates && IMG_EXTS.includes(ext)) {
        const base = filePath.slice(0, -ext.length);
        const next = IMG_EXTS.filter((e) => e !== ext).map((e) => base + e);
        const tryNext = (i) => {
          if (i >= next.length) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
          fs.readFile(next[i], (e2, d2) => {
            if (e2) return tryNext(i + 1);
            const t = MIME[path.extname(next[i]).toLowerCase()];
            res.writeHead(200, { 'Content-Type': t, 'Cache-Control': 'public, max-age=3600' });
            res.end(d2);
          });
        };
        return tryNext(0);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname === '/health') return sendJson(res, 200, { ok: true });
  if (pathname === '/api/chat') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
    return handleChat(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
}).listen(PORT, () => console.log(`GymFlow AI escuchando en el puerto ${PORT}`));
