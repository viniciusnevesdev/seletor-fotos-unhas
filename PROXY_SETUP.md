# Proxy seguro opcional para a OpenAI

O PWA funciona com a chave colada diretamente, mas essa chave fica disponível para o JavaScript daquela sessão. Para uso mais seguro, o repositório inclui `openai-proxy-worker.js`, pronto para ser publicado como Cloudflare Worker.

## Configuração resumida

1. Crie um Cloudflare Worker.
2. Use o conteúdo de `openai-proxy-worker.js`.
3. Em **Settings > Variables and Secrets**, crie o secret `OPENAI_API_KEY` com sua chave da OpenAI.
4. Crie a variável `ALLOWED_ORIGIN` com `https://viniciusnevesdev.github.io` (ou o domínio final do PWA).
5. Publique o Worker e copie a URL `https://...workers.dev`.
6. No PWA, cole essa URL no campo **Proxy seguro opcional**. Nesse modo, não é necessário digitar a chave no PWA.

O Worker aceita apenas POST, restringe os modelos usados pelo app e encaminha somente para `/v1/responses`.