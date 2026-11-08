# Akali Companion

Controle o cliente do **League of Legends pelo celular** — entrar na fila, aceitar partida, banir, escolher campeão, feitiços, skin e runas do OP.GG — mais um app de PC para quem joga de Akali: builds por rota, matchups, estatísticas pessoais e previsão de maestria, com splash arts e ícones oficiais.

## 📱 App de celular (controle remoto)

O celular não fala direto com o LoL: o **app do PC** lê o cliente do jogo e serve a versão mobile pela sua rede Wi-Fi.

```
Celular (navegador / tela inicial)  ──Wi-Fi──▶  Akali Companion no PC  ──API local──▶  Cliente do LoL
```

1. Instale e abra o Akali Companion no PC (veja abaixo).
2. Em **Configurações → Permitir acesso pelo celular**, aparece um QR code.
3. Com o celular no mesmo Wi-Fi, aponte a câmera para o QR.
4. No navegador do celular, toque em **Adicionar à tela inicial**.

| Tela | O que faz |
|---|---|
| Sala | Criar sala (Solo/Duo, Flex, Normal, Partida Rápida, ARAM), escolher rotas, procurar/cancelar fila |
| Partida encontrada | Aceitar/recusar com contagem regressiva, vibração e som |
| Seleção | Times, bans e cronômetro; buscar, pré-selecionar, banir, escolher e confirmar |
| Finalização | Feitiços (ou os do OP.GG), skin, runas do OP.GG, banco do ARAM |
| Fim de jogo | Jogar de novo |

Código da versão mobile: `public/mobile.html`, `public/mobile.js`, `public/mobile.css`.
Teste visual sem mexer no cliente: `npm start` e abra `http://localhost:3000/m?mock`.

## App de desktop
- Instalador: `dist\AkaliCompanion-Setup-<versão>.exe` (cria atalho na área de trabalho)
- Sem instalar: `dist\AkaliCompanion-Portable-<versão>.exe`
- Gerar de novo após mudanças: `npm run dist` · testar sem empacotar: `npm run app`
- A chave da Riot e o cache ficam em `%APPDATA%\Akali Companion` (cole a chave em **Configurações** dentro do app).

## Como rodar no navegador (modo desenvolvimento)
1. Dê dois cliques em `iniciar.bat` (ou rode `npm install` e depois `npm start`).
2. Abra http://localhost:3000

## Como ele conecta na sua conta
- **Cliente do LoL aberto** → detecta sua conta sozinho (maestria + últimas ~100 partidas). Não precisa de chave.
- **Riot API (opcional, mais completo)** → copie `.env.example` para `.env` e cole sua chave de https://developer.riotgames.com.
  Libera: elo, oponente de rota em cada partida (matchups reais) e funciona com o cliente fechado.
  A Development Key expira a cada 24h.

## Controle ao vivo do cliente (PC e celular)
Usa a API local do cliente do LoL (`server/lcu.js`, `server/live.js`):
- Criar sala, escolher rotas, entrar/sair da fila, aceitar/recusar partida
- Seleção de campeões: pré-seleção, banir, escolher e confirmar, feitiços, skin, runas do OP.GG, banco do ARAM
- Automações opcionais (desligadas por padrão): aceitar partida, importar runas ao confirmar o campeão

**Celular:** em Configurações ative "Permitir acesso pelo celular" e escaneie o QR code (mesmo Wi-Fi).
O acesso exige um token secreto (no QR) e fica bloqueado quando desativado. "Gerar novo código" desconecta os celulares.
Na primeira vez, o Windows pergunta sobre o firewall: permita em **redes privadas**.
Teste visual sem mexer no cliente: `http://localhost:3000/m?mock` (modo demonstração).

## OP.GG
O app usa a API pública oficial do OP.GG (`https://mcp-api.op.gg/mcp`), sem precisar de chave:
- **Builds:** build/runas/skills mais jogadas no patch atual, com winrate e pick rate
- **Matchups:** winrate da Akali contra cada campeão e guia do confronto (dica, vantagem de lane, build contra ele)
- **Estatísticas:** seu elo, suas stats de Akali na temporada e seus campeões mais jogados

Os dados ficam em cache por 6h (meta) e 5 min (perfil). Código em `server/opgg.js`.

## Editar builds e matchups
Tudo fica em `public/data/akali.json` (IDs de itens/runas do Data Dragon). Basta editar e recarregar a página.

## Estrutura
- `server/index.js` — servidor Express + rotas `/api/*`
- `server/riot.js` — Riot API (conta, maestria, elo, partidas com cache em `cache/`)
- `server/lcu.js` — leitura do cliente local do LoL
- `public/` — interface (HTML/CSS/JS puro)

Projeto de fã, não afiliado à Riot Games.
