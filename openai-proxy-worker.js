/**
 * Cloudflare Worker opcional para esconder a chave da OpenAI do navegador.
 * Configure:
 *   OPENAI_API_KEY = sua chave da OpenAI (secret)
 *   ALLOWED_ORIGIN = https://viniciusnevesdev.github.io (recomendado)
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowed === '*' ? '*' : allowed,
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
    if (allowed !== '*' && origin !== allowed) return new Response('Origin not allowed', { status: 403, headers: cors });
    if (!env.OPENAI_API_KEY) return new Response('OPENAI_API_KEY is not configured', { status: 500, headers: cors });

    let body;
    try { body = await request.json(); }
    catch { return new Response('Invalid JSON', { status: 400, headers: cors }); }

    const allowedModels = new Set(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']);
    if (!allowedModels.has(body.model)) return new Response('Model not allowed', { status: 400, headers: cors });

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};