# Seletor de Fotos de Unhas — protótipo híbrido v0.1

## O que ele faz

1. Você seleciona um lote de fotos.
2. O navegador calcula uma assinatura visual localmente.
3. As fotos são agrupadas por semelhança sem enviar imagens para servidor.
4. O sistema pré-seleciona até 4 candidatas por grupo.
5. Apenas essas candidatas são enviadas à API OpenAI em `detail: high`.
6. A IA ranqueia cada grupo considerando reflexo, poeira/resíduos, nitidez, pose, enquadramento e apresentação.

## Segurança da API

**Não coloque sua chave em nenhum arquivo deste repositório.**
A chave é digitada manualmente na página e fica apenas na memória da aba atual.

Este é um protótipo pessoal. Em uma versão definitiva, a chamada à OpenAI deve passar por um backend/proxy para que a chave não fique acessível no navegador.

## Publicação rápida no GitHub Pages

1. Abra `Settings` no repositório.
2. Abra `Pages`.
3. Em `Build and deployment`, escolha **Deploy from a branch**.
4. Selecione a branch `main` e a pasta `/ (root)`.
5. Salve.

O endereço esperado é:
`https://viniciusnevesdev.github.io/seletor-fotos-unhas/`

## Uso no iPhone

1. Abra o endereço no Safari.
2. Selecione as fotos.
3. Toque em **Agrupar fotos**.
4. Confira os grupos; toque em qualquer foto para incluir/remover da análise fina.
5. Cole sua chave da API.
6. Deixe `GPT-5.6 Terra` inicialmente.
7. Toque em **Analisar candidatas**.
8. Após validar o funcionamento, Safari → Compartilhar → Adicionar à Tela de Início.

## Limitações desta primeira versão

- O agrupamento usa perceptual hash simples e serve como MVP; ele ainda não entende especificamente unhas.
- Fotos com composição muito parecida mas iluminação muito diferente podem cair no mesmo grupo.
- A IA pode errar defeitos microscópicos. O objetivo inicial é ranking/pré-seleção, não substituir decisão humana em 100%.
- A chamada direta do navegador à API é adequada apenas para teste pessoal; a versão definitiva deve usar backend.

## Próximas melhorias

- feature embedding mais robusto para agrupamento;
- recorte automático da mão/unhas antes de comparar;
- detector local de blur/exposição;
- estimativa de custo antes de enviar;
- backend seguro para a API;
- salvar suas escolhas para aprender preferências;
- comparação entre ranking da IA e sua seleção manual.
