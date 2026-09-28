# Site de aulas: contexto do projeto

Este arquivo resume tudo o que já foi decidido sobre o site. Leia antes de qualquer tarefa.

## Objetivo

Site de aulas de programação da professora Juliana Carvalho. Os alunos entram com login e senha, de qualquer lugar, e estudam os assuntos dados em aula. Existem duas trilhas de público: **adulto** e **kids**.

## Stack

- **Hospedagem:** GitHub Pages (site estático, HTML + CSS + JavaScript puro, sem framework e sem build).
- **Login e progresso:** Supabase (Auth com e-mail e senha, criação de conta, recuperação de senha; tabela de progresso por aluno).
- **Teste local:** o conteúdo é carregado com `fetch`, então o site precisa rodar num servidor (extensão Live Server do VS Code ou `python -m http.server`). Não funciona abrindo o arquivo direto.

## Visual (já aprovado)

- Inspirado na **organização** da área do aluno da Alura (menu lateral fixo, "Continue de onde parou", trilhas com barra de progresso, aula com lista de atividades na lateral e botão "Próxima atividade"). Não copiar logo, marca nem textos da Alura.
- Cores: branco e azul marinho. Tokens: `--navy:#0A2342`, `--navy-2:#16345F`, `--navy-3:#2C5282`, `--sky:#E8EEF7`, `--line:#DCE3EE`, `--ok:#1B7F52`, `--err:#B83A34`, `--sun:#FFC845` (destaque só no kids).
- Fontes: Sora (títulos), Nunito Sans (texto), JetBrains Mono (código), Baloo 2 (área kids).
- Navegação de página única (hash routing): o aluno transita sem recarregar a página.
- O arquivo `prototipo/index.html` é o protótipo aprovado. A página inicial foi aprovada pela professora. Usar como referência visual e de comportamento.
- Nome do site: **Linha a Linha** (definido pela professora).

## Logo (aprovada)

- Símbolo: a letra L formada por pontos conectados (rede), em azul marinho com degradê, e o último ponto em amarelo (#FFC845).
- Arquivos na pasta `logo/`: `simbolo.svg` (fundo claro), `icone.svg` (quadrado azul marinho, para app e redes), `favicon.svg` (versão simplificada para a aba do navegador) e as versões PNG.
- Usar o símbolo no menu lateral e no login (no lugar do "</>" do protótipo) e o `favicon.svg` como favicon do site.

## Funcionalidades já existentes no protótipo

- Login (hoje de demonstração; trocar por Supabase).
- Início com "Continue de onde parou" e cards das trilhas.
- Página da trilha com lista de aulas e etapas concluídas.
- Aula com etapas: Explicação, Código comentado, Quiz e (kids) Desafio do Bit.
- **Código comentado:** o aluno clica numa linha e a explicação aparece ao lado; navegação linha a linha; contador de linhas exploradas.
- **Quiz:** mensagem de acerto, mensagem de erro, destaque da resposta certa, explicação, placar final e refazer.
- **Kids:** mascote original "Bit" (robô em SVG), conversa em balões de fala, reações no quiz e jogo de programar o caminho do Bit numa grade até a estrela, desviando de pedras.
- Busca de aulas no topo e página "Meu progresso".

## Estrutura de pastas planejada

```
site-aulas/
├── index.html
├── css/
├── js/
└── conteudo/
    ├── indice.json        ← lista das trilhas e aulas
    ├── logica/            ← primeiro assunto
    ├── javascript/
    ├── python/
    └── kids/
```

Cada aula é um arquivo JSON dentro da pasta do assunto. O site lê as pastas automaticamente; adicionar aula não deve exigir mexer no código.

## Como o material da professora é organizado

Cada assunto terá: definições; para que usamos; como usamos; quando usamos; estruturas; como aplicar; sintaxe; explicação dos símbolos e do motivo deles; a lógica por trás; explicação do código linha por linha; quiz de código com dicas; atividades em diferentes níveis de dificuldade.

A professora entrega o documento **completo, com as respostas**. Cabe ao Claude converter para JSON e decidir o que o aluno vê e quando.

- **Quiz:** a resposta vai no JSON (necessária para o feedback imediato), mas só aparece depois que o aluno responde. Dicas só quando o aluno pedir.
- **Atividades:** gabarito liberado só depois da tentativa ("Ver solução"), ou sem gabarito, ou correção automática para exercícios de código simples. Escolher conforme o tipo de atividade.
- **A escolha da interatividade de cada assunto fica a critério do Claude**, combinando com a estrutura do conteúdo (ex.: código comentado, montar código em blocos, completar lacunas, ordenar linhas, simulação de variáveis passo a passo).

**Importante:** o material bruto com respostas NÃO deve ir para o repositório público do GitHub Pages. Guardar fora do repositório (ou num repositório privado).

## Regras para a área kids

- Visual e linguagem próprios: frases curtas, fonte grande, mascote Bit, no máximo 3 opções no quiz.
- Por causa da LGPD, não coletar e-mail nem dados pessoais de crianças. Contas kids criadas pela professora (apelido e senha simples).

## Plano de publicação

1. Colocar o site no ar com o primeiro assunto: **lógica de computação** (material da aula 1 pronto).
2. Adicionar os outros assuntos aos poucos, conforme as aulas acontecem.

## Decisões tomadas

- **Nome do site:** Linha a Linha.

- **Cadastro:** aberto a qualquer pessoa que tenha o **código da turma**. O código deve ser validado no Supabase (função ou trigger no servidor), não só no JavaScript da página, para não poder ser contornado. A professora precisa conseguir trocar o código e ter um código por turma.
- **Conteúdo:** acessível pelo link direto, de qualquer lugar. O login serve para identificar o aluno e salvar o progresso (aulas concluídas, notas dos quizzes). O conteúdo fica nos arquivos JSON do próprio site.
- **Contas kids:** continuam sendo criadas pela professora (LGPD), sem e-mail da criança.

## Implementação (setembro de 2026)

- Arquivos: `index.html`, `css/estilo.css`, `js/config.js` (URL + publishable key), `js/app.js` (motor), `conteudo/indice.json` + `conteudo/<pasta>/<aula>.json`. Adicionar aula = criar o JSON e colocar o id dele na lista `aulas` da trilha no `indice.json`.
- Uma aula é `{titulo, duracao, etapas: [...]}`. Cada etapa tem `id`, `nome`, `tipo` e os dados do tipo:
  - `leitura`: `blocos` (texto, `{h}`, `{lista}`, `{passos}`, `{codigo}`, `{tabela}`, `{nota}`, `{fluxograma, legenda}` em Mermaid);
  - `codigo`: `linhas[{linha, explica}]`; `simulacao` (teste de mesa): `codigo[]` + `passos[{linha, explica, memoria?, tela?}]`;
  - `quiz`: `perguntas[{pergunta, codigo?, opcoes, correta, dica, explicacao}]`;
  - `atividades`: `itens[{n, nivel, titulo, enunciado, testes?, dica, solucao, observar?}]` (solução só depois de escrever a tentativa);
  - kids: `conversa` (`falas[]`) e `jogo` (`missao, tamanho, inicio, estrela, paredes`).
- Progresso: uma linha por etapa na tabela `progresso`; quizzes guardam `acertos/total`; cada atividade marcada vira a etapa `atividades:<n>`.
- Supabase: `supabase/1-configuracao.sql` (tabelas `turmas`, `perfis`, `progresso`, RLS, gatilho que valida o código da turma, função `privado.criar_conta_kids`) e `supabase/2-comandos-da-professora.sql`.
- Contas kids: login só com apelido; o site completa com `@kids.linhaalinha.com.br` (domínio reservado, nenhum e-mail real). Criadas pela professora via `select privado.criar_conta_kids(...)`.
- Material bruto da professora fica em `materiais/` (no `.gitignore`, nunca vai para o GitHub). Ler `materiais/LEIA-ME.md` antes de converter uma aula. `prototipo/` também fica fora do repositório.
- Trilha **Python** (`conteudo/python/`, id `python`): aulas 1, 2, 3, 4, 8 e 12. Trilha **JavaScript** (`conteudo/javascript/`, id `javascript`): aula 3. Tudo feito só a partir dos PDFs de `materiais/` (os slides não são fonte). Faltam no material: Python 5 a 7 e 9 a 11, JavaScript 1 e 2.
- Cada aula tem o campo `numero` (a trilha tem lacunas; a lista mostra "Aula 8", não a posição). A trilha tem `linguagem` no `indice.json` (`python` ou `javascript`), que define o realce de sintaxe.
- Simulação: `memoria` com valor `null` remove a variável (ex.: locais de uma função que terminou); `limparTela` recomeça a saída (ex.: rerun do Streamlit); `rotuloTela` troca o nome da caixa ("Console" no JavaScript).
- Regras do LEIA-ME: não publicar "Na correção", "Observação para o slide", "Ajustes em alguns exemplos dos slides" nem instruções do tipo "peça que o aluno"; gabaritos só atrás de "Ver solução". Nas aulas 1 a 4 (formato Material Complementar), as mensagens de acerto/erro dos quizzes são escritas por Claude, curtas. As aulas 8 e 12 (Python) e a 3 (JavaScript) já trazem essas mensagens.

## Segurança (não desfazer)

- **Chaves:** no código só entram chaves públicas: a publishable key do Supabase e a Site Key do Turnstile (`js/config.js`). A Secret Key do Turnstile e a service_role/secret key do Supabase **nunca** vão para o repositório.
- **Dados:** RLS em todas as tabelas; cada aluno só lê e grava o próprio progresso. O código da turma é validado no servidor (gatilho em `auth.users`), não só no JavaScript.
- **CAPTCHA (Cloudflare Turnstile):** protege login (inclusive o kids, pelo apelido), cadastro e "Esqueci minha senha". Widget com `appearance: "interaction-only"` e `language: "pt-br"`, um por formulário, criado quando o formulário aparece. O token vai em `options.captchaToken` (`signInWithPassword`, `signUp`) e em `captchaToken` (`resetPasswordForEmail`); o "Nova senha" (`updateUser`) não usa. Cada token vale uma vez: `turnstile.reset` depois de toda chamada. O botão fica bloqueado até existir token.
  - A **Secret Key fica só no painel do Supabase** (Authentication → Attack Protection → CAPTCHA, provedor Turnstile). Com o CAPTCHA ligado lá, o login só funciona com a Site Key certa em `js/config.js`.
  - O script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` é carregado **sem** `integrity`, porque o Cloudflare não permite fixar a versão dele.
- **Ainda não existe:** Content-Security-Policy no `index.html` e `integrity` (SRI) nos scripts da jsDelivr. Se forem criados, incluir `https://challenges.cloudflare.com` em `script-src` e `frame-src`.

## Decisões pendentes

- Domínio próprio (sugestão: linhaalinha.com.br, verificar disponibilidade no registro.br). Até lá, usar o endereço gratuito do GitHub Pages.
