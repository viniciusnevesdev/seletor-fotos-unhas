# Proxy seguro opcional

O PWA funciona de duas formas:

1. **Direto** — a chave da OpenAI é colada apenas na sessão atual do navegador. Ela não é salva pelo PWA, mas a chamada parte do frontend.
2. **Proxy seguro** — recomendado para uso contínuo. A chave fica como Secret no Cloudflare Worker e não aparece no código público do GitHub Pages.

## Configuração do Cloudflare Worker

Use o arquivo `cloudflare-worker.js` deste repositório.

1. Crie um Worker no Cloudflare.
2. Cole o conteúdo de `cloudflare-worker.js`.
3. Em **Settings > Variables and Secrets**, crie um Secret chamado `OPENAI_API_KEY` e coloque sua chave da OpenAI.
4. Crie a variável `ALLOWED_ORIGIN` com o valor `https://viniciusnevesdev.github.io`.
5. Faça o deploy.
6. Copie a URL pública do Worker, normalmente `https://...workers.dev`.
7. No PWA, cole essa URL no campo **Proxy seguro opcional**. Quando esse campo estiver preenchido, você não precisa digitar a chave da API no PWA.

## Proteções incluídas

O Worker:

- aceita apenas `POST`/`OPTIONS`;
- restringe a origem ao GitHub Pages configurado;
- aceita apenas os modelos Luna, Terra e Sol usados pelo PWA;
- encaminha somente para `https://api.openai.com/v1/responses`;
- mantém `OPENAI_API_KEY` no servidor.

Nunca coloque a chave em `app.js`, `index.html`, commits, issues ou qualquer arquivo público do repositório.