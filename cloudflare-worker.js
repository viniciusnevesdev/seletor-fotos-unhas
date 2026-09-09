// Cloudflare Worker opcional para esconder a chave da OpenAI do navegador.
// 1) Crie um Worker no Cloudflare.
// 2) Cole este código.
// 3) Em Settings > Variables and Secrets, crie OPENAI_API_KEY como secret.
// 4) Implante e cole a URL do Worker no PWA, escolhendo "Proxy seguro".

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Content-Type": "application/json"
    };
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
    if (request.method !== "POST") return new Response(JSON.stringify({error:"Use POST"}),{status:405,headers:cors});
    if (!env.OPENAI_API_KEY) return new Response(JSON.stringify({error:"OPENAI_API_KEY não configurada"}),{status:500,headers:cors});
    try {
      const body = await request.text();
      const upstream = await fetch("https://api.openai.com/v1/responses",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${env.OPENAI_API_KEY}`},
        body
      });
      return new Response(await upstream.text(),{status:upstream.status,headers:cors});
    } catch (error) {
      return new Response(JSON.stringify({error:String(error?.message||error)}),{status:500,headers:cors});
    }
  }
};