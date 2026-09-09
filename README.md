# Seletor Inteligente de Fotos de Unhas — v1.0

PWA para selecionar fotos de unhas muito parecidas entre si, combinando agrupamento local, análise multimodal com IA e aprendizado das preferências reais do usuário.

## Fluxo principal

1. Seleciona 2–60 fotos do mesmo ensaio.
2. Calcula assinatura visual e nitidez localmente, sem custo de API.
3. Agrupa fotos semelhantes e escolhe candidatas diversificadas por grupo.
4. Mostra uma estimativa de custo antes da análise.
5. Envia apenas candidatas para a OpenAI em `detail: high`.
6. A IA gera diagnóstico específico, ranking, confiança, comparação entre fotos e crop sugerido quando apropriado.
7. Um número limitado de sobreviventes é reenviado para a comparação final.
8. O app mostra Seleção da IA, Minha escolha e Finais definitivas.
9. O usuário avalia fotos grandes, registra comentários/tags e ensina seu gosto.
10. As fotos escolhidas podem ser compartilhadas com o Fotos como cópias novas sem a data EXIF original.

## Aprendizado de preferência

O perfil v2 combina:

- ❤️ Gostei muito / 👍 Gostei / ➖ Aceitável / 👎 Não gostei;
- comentário livre;
- tags positivas e negativas (reflexo, limpeza, nitidez, pose, visibilidade, exposição e enquadramento);
- indicação de problema corrigível por crop/edição ou aceitável sem correção;
- ⭐ finais definitivas;
- comparações A/B gratuitas entre fotos parecidas;
- resumo automático local;
- refinamento opcional do resumo por IA;
- importação/exportação do perfil em JSON;
- gerenciamento e exclusão de avaliações antigas.

A v1.0 migra automaticamente as avaliações salvas pela versão anterior em `seletor-unhas-training-v1`.

## Custo

Antes de analisar, o app estima uma faixa de custo com base em:

- modelo escolhido;
- quantidade de candidatas por grupo;
- dimensões das imagens;
- limite de finalistas que podem ser reenviadas.

Depois da execução, o app usa `usage.input_tokens` e `usage.output_tokens` retornados pela Responses API para calcular o custo aproximado real da execução. O câmbio US$ → R$ pode ser ajustado no próprio PWA.

## Sessão e histórico

- A sessão atual é salva em IndexedDB para poder ser restaurada após fechamento/recarregamento quando o navegador tiver espaço disponível.
- O histórico guarda os últimos ensaios, quantidade de fotos, escolhidas, custo e concordância entre IA e usuário.
- As imagens escolhidas de sessões recentes também são armazenadas localmente quando houver espaço.

## Diagnóstico e correções

A IA é instruída a indicar onde está cada problema em:

- reflexo;
- limpeza/pó;
- nitidez;
- posição da mão/dedos;
- visibilidade das unhas;
- exposição;
- enquadramento.

Também informa por que uma foto perdeu para outra, confiança da avaliação e empates. Quando sugere corte, o PWA pode mostrar uma prévia de crop sem alterar o original.

## HEIC/HEIF e iPhone

O app tenta `createImageBitmap` primeiro e, se falhar, usa um fallback com `<img>`, aumentando a compatibilidade com arquivos vindos do Fotos no iPhone. Arquivos que o WebKit não conseguir decodificar ainda precisarão ser convertidos individualmente.

## Segurança da API

A chave digitada diretamente nunca é salva pelo PWA. Para uso mais seguro, o repositório inclui:

- `openai-proxy-worker.js` — Cloudflare Worker opcional;
- `PROXY_SETUP.md` — instruções de implantação.

Quando um proxy é configurado, a chave fica como secret no Worker e não precisa ser digitada no navegador.

## Publicação

GitHub Pages:

`https://viniciusnevesdev.github.io/seletor-fotos-unhas/`

## Arquivos principais

- `index.html` — interface e migração de dados antigos;
- `styles.css` — interface compacta (escala fixa 75%);
- `app.js` — agrupamento, IA, custo, treinamento, sessão, histórico e exportação;
- `preference-profile.json` — esquema do perfil v2;
- `sw.js` — cache do PWA;
- `openai-proxy-worker.js` — proxy seguro opcional;
- `PROXY_SETUP.md` — configuração do proxy.

## Limitações conhecidas

- O agrupamento ainda usa perceptual hash simples; Apple Vision/embeddings específicos podem melhorar essa etapa no futuro.
- O crop sugerido pela IA é uma aproximação visual e deve ser tratado como prévia, não edição profissional automática.
- IndexedDB depende da cota de armazenamento do Safari; lotes muito grandes podem não ser totalmente recuperáveis.
- A IA pode errar detalhes microscópicos; o aprendizado humano e as comparações A/B existem justamente para reduzir esse desvio ao longo do uso.
