// Intermediario seguro hacia Groq para Cloudflare Workers.
// La clave vive como secreto GROQ_API_KEY en Cloudflare (nunca en el HTML).
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const MAX_BODY_CHARS = 512 * 1024;
const MAX_MESSAGES = 60;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function handleChat(request, env) {
  if (!env.GROQ_API_KEY) return json({ error: { message: 'El servidor no tiene configurada la clave de la IA.' } }, 500);

  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) return json({ error: { message: 'Pedido demasiado grande.' } }, 413);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: { message: 'JSON inválido.' } }, 400); }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0 || payload.messages.length > MAX_MESSAGES) {
    return json({ error: { message: 'Formato de mensajes inválido.' } }, 400);
  }

  const body = { model: MODEL, messages: payload.messages };
  if (Array.isArray(payload.tools)) body.tools = payload.tools;
  if (payload.tool_choice) body.tool_choice = payload.tool_choice;

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    const timeout = e && e.name === 'TimeoutError';
    return json({ error: { message: timeout ? 'La IA tardó demasiado en responder.' : 'No se pudo contactar a la IA.' } }, timeout ? 504 : 502);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/chat') {
      if (request.method !== 'POST') return json({ error: { message: 'Método no permitido.' } }, 405);
      return handleChat(request, env);
    }
    // Todo lo demás (index.html, imágenes) lo sirven los archivos estáticos de /public
    return env.ASSETS.fetch(request);
  },
};
