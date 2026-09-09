# Proxy seguro opcional

O PWA funciona de duas formas:

1. **Direto** — a chave da OpenAI é colada apenas na sessão atual do navegador. É simples, mas a chamada parte do frontend.
2. **Proxy seguro** — recomendado para uso contínuo. A chave fica como secret no Cloudflare Worker e não é exposta no código público do GitHub Pages.

## Cloudflare Worker

Use o arquivo `cloudflare-worker.js` deste repositório.

1. Crie um Worker no Cloudflare.
2. Cole o conteúdo de `cloudflare-worker.js`.
3. Em **Settings > Variables and Secrets**, crie um secret chamado `OPENAI_API_KEY`.
4. Cole sua chave da OpenAI no valor do secret.
5. Faça o deploy.
6. Copie a URL pública do Worker.
7. No PWA, em **Modo da API**, escolha **Proxy seguro** e cole essa URL.

O Worker simplesmente encaminha o payload para `https://api.openai.com/v1/responses`, adicionando a chave no servidor.

## Observação

Nunca coloque a chave diretamente em `app-v1.js`, `index.html`, commits, issues ou arquivos públicos do repositório.