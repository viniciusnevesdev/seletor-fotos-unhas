/**
 * Cloudflare Worker opcional para esconder a chave da OpenAI do navegador.
 *
 * Secrets/variáveis recomendadas:
 *   OPENAI_API_KEY = chave da OpenAI (Secret)
 *   ALLOWED_ORIGIN = https://viniciusnevesdev.github.io
 *
 * O PWA envia o payload da Responses API para este Worker; a chave nunca
 * precisa ser exposta no GitHub Pages.
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://viniciusnevesdev.github.io';
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Vary': 'Origin',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Use POST' }), { status: 405, headers: cors });
    if (origin && origin !== allowedOrigin) return new Response(JSON.stringify({ error: 'Origin não permitida' }), { status: 403, headers: cors });
    if (!env.OPENAI_API_KEY) return new Response(JSON.stringify({ error: 'OPENAI_API_KEY não configurada' }), { status: 500, headers: cors });

    try {
      const body = await request.json();
      const allowedModels = new Set(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']);
      if (!allowedModels.has(body.model)) return new Response(JSON.stringify({ error: 'Modelo não permitido' }), { status: 400, headers: cors });
      if (!Array.isArray(body.input)) return new Response(JSON.stringify({ error: 'Payload inválido' }), { status: 400, headers: cors });

      const upstream = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 500, headers: cors });
    }
  },
};