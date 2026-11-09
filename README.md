# Akali Companion

Controle o cliente do **League of Legends pelo celular** — entrar na fila, aceitar partida, banir, escolher campeão, feitiços, skin e runas do OP.GG — mais um app de PC com builds, matchups, estatísticas, previsão de maestria e **monitor da partida ao vivo**, com splash arts e ícones oficiais.

**Campeões acompanhados:** Akali (meio/topo), Lulu (suporte/meio), Twitch (atirador/selva) e Nami (suporte) — escolha no seletor da barra lateral.

## Instalação
1. Abra a página de **[Releases](https://github.com/luizhenriquevfernandes2008-ops/akali-companion/releases/latest)** e baixe o `AkaliCompanion-Setup-<versão>.exe`.
2. Execute o instalador: ele mostra os termos, deixa escolher a pasta e cria atalhos na área de trabalho e no menu Iniciar.
3. Abra o **Akali Companion** pelo atalho. Não precisa instalar Node nem rodar nenhum `.bat`.

> O instalador não tem assinatura digital paga. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**. Com o **Smart App Control** ativado, o Windows bloqueia apps sem assinatura: desative em Segurança do Windows → Controle de aplicativos e navegador.

Para desinstalar: Configurações do Windows → Aplicativos.

## 🎬 Overlay da partida e replay

Com o app aberto, um **overlay** aparece por cima do jogo quando a partida começa: sua rota contra o oponente (nível, CS, ouro em itens e itens), timers de Dragão e Barão, placar, matchup do OP.GG e dicas de build.
Ao mesmo tempo, o app grava a tela num buffer e o atalho salva os **últimos 30 segundos** num `.mp4` (com FFmpeg, usando NVENC, AMF ou Quick Sync quando existem).

| Atalho padrão | O que faz |
|---|---|
| `Ctrl + Shift + A` | Mostra/esconde o overlay |
| `Ctrl + Shift + S` | Salva o replay dos últimos segundos |

- Tudo se configura em **Configurações → Overlay & replay**: atalhos (clique e aperte as teclas), lado e tamanho do overlay, duração (15/30/60/90 s), FPS, qualidade, monitor e áudio.
- Os vídeos ficam em `Vídeos\Akali Companion`.
- O FFmpeg é gratuito; se não estiver instalado, o botão **Instalar FFmpeg** instala pelo winget.
- Deixe o LoL em **Sem bordas** (Vídeo → Modo de janela). Em Tela cheia o jogo cobre o overlay.
- Som do jogo no replay: ative a *Mixagem estéreo* do Windows (ou use o VB-Audio Cable) e escolha em **Áudio**. Microfone também funciona.
- O overlay só mostra o que a Live Client Data API oficial da Riot e o OP.GG fornecem, e não recebe cliques (o mouse passa direto para o jogo).

## Desenvolvimento
- Gerar o instalador: `npm install` e `npm run dist` (sai em `dist/`).
- Testar o app de desktop sem empacotar: `npm run app`.
- Rodar só no navegador: `iniciar.bat` ou `npm start` e abrir http://localhost:3000 (sem overlay e sem atalhos globais).
- Teste visual do overlay sem estar em partida: abra `http://localhost:3000/overlay.html?mock`.

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
- `server/desktop.js` — configurações de overlay, atalhos e replay
- `server/recorder.js` — buffer de replay com FFmpeg
- `electron/main.js` — janela principal, overlay e atalhos globais
- `public/overlay.*` — interface do overlay
- `public/` — interface (HTML/CSS/JS puro)

Projeto de fã, não afiliado à Riot Games.
