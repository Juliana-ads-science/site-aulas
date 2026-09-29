/* ============================================================
   Linha a Linha — motor do site
   O conteúdo das aulas fica em conteudo/ (indice.json + um JSON por aula).
   Para adicionar uma aula não é preciso mexer neste arquivo.
   ============================================================ */

/* ---------- utilitários ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* `código` e **negrito**; o negrito só vale fora do código (ex.: `**kwargs` fica intacto) */
const fmt = s => esc(s).split(/`([^`]+)`/).map((p, i) => i % 2 ? `<code>${p}</code>`
  : p.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>")).join("");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const semAcento = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const poucoMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;

let toastTimer = null;
function toast(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg; t.className = `toast ${tipo}`; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

/* ============================================================
   SUPABASE
   ============================================================ */
/* Lê o que veio no endereço antes de o Supabase limpar (links de e-mail). */
const paramsHash = new URLSearchParams(location.hash.replace(/^#\/?/, ""));
const veioDeRecuperacao = paramsHash.get("type") === "recovery";
const erroDoLink = paramsHash.get("error_code") || paramsHash.get("error");
const hashDeAuth = () => /(^#\/?)(access_token|error|type)=/.test(location.hash) || /[&#]access_token=/.test(location.hash);

const db = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const urlDoSite = location.origin + location.pathname;

let usuario = null;        // { id, nome, perfil }
let emRecuperacao = veioDeRecuperacao;

db.auth.onAuthStateChange(evento => {
  // setTimeout: não chamar o Supabase de dentro do próprio aviso de mudança
  if (evento === "PASSWORD_RECOVERY") setTimeout(() => { emRecuperacao = true; mostrarLogin("novaSenha"); }, 0);
  if (evento === "SIGNED_OUT") setTimeout(() => { usuario = null; mostrarLogin(); }, 0);
});

const emailDoLogin = id => {
  id = id.trim().toLowerCase();
  return id.includes("@") ? id : `${id}@${CONFIG.dominioKids}`;
};

/* ============================================================
   CONTEÚDO (arquivos JSON)
   ============================================================ */
const CURSO = { trilhas: [] };

async function lerJSON(caminho) {
  const r = await fetch(caminho, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
  return r.json();
}

async function carregarConteudo() {
  const indice = await lerJSON("conteudo/indice.json");
  CURSO.trilhas = await Promise.all(indice.trilhas.map(async t => {
    const aulas = await Promise.all(t.aulas.map(async id => {
      try {
        const A = await lerJSON(`conteudo/${t.pasta}/${id}.json`);
        A.id = id;
        return A;
      } catch (e) { console.warn("Aula não carregada:", e.message); return null; }
    }));
    return { ...t, aulas: aulas.filter(A => A && etapasDe(A).length) };
  }));
}

/* ============================================================
   PROGRESSO (tabela "progresso" no Supabase + cópia em memória)
   ============================================================ */
let P = { feito: {}, quiz: {}, ultima: null };
const prog = () => P;

async function carregarProgresso() {
  P = { feito: {}, quiz: {}, ultima: usuario.ultima || null };
  const { data, error } = await db.from("progresso").select("trilha,aula,etapa,acertos,total");
  if (error) { console.error(error); toast("Não foi possível carregar seu progresso.", "err"); return; }
  for (const r of data) {
    P.feito[`${r.trilha}/${r.aula}/${r.etapa}`] = true;
    if (r.acertos != null) P.quiz[`${r.trilha}/${r.aula}/${r.etapa}`] = { acertos: r.acertos, total: r.total };
  }
}

async function gravar(linha) {
  const { error } = await db.from("progresso").upsert(
    { aluno_id: usuario.id, ...linha, concluido_em: new Date().toISOString() },
    { onConflict: "aluno_id,trilha,aula,etapa" }
  );
  if (error) { console.error(error); toast("Não foi possível salvar seu progresso. Confira sua internet.", "err"); }
}

function marcar(t, a, e) {
  if (P.feito[`${t}/${a}/${e}`]) return;
  P.feito[`${t}/${a}/${e}`] = true;
  gravar({ trilha: t, aula: a, etapa: e });
}
const feito = (t, a, e) => !!P.feito[`${t}/${a}/${e}`];

function desmarcar(t, a, e) {
  if (!P.feito[`${t}/${a}/${e}`]) return;
  delete P.feito[`${t}/${a}/${e}`];
  db.from("progresso").delete().match({ aluno_id: usuario.id, trilha: t, aula: a, etapa: e })
    .then(({ error }) => error && (console.error(error), toast("Não foi possível salvar seu progresso. Confira sua internet.", "err")));
}

function salvarQuiz(t, a, e, acertos, total) {
  P.quiz[`${t}/${a}/${e}`] = { acertos, total };
  P.feito[`${t}/${a}/${e}`] = true;
  gravar({ trilha: t, aula: a, etapa: e, acertos, total });
}

let ultimaTimer = null;
function salvarUltima(valor) {
  if (P.ultima === valor) return;
  P.ultima = valor;
  clearTimeout(ultimaTimer);
  ultimaTimer = setTimeout(() => db.from("perfis").update({ ultima: valor }).eq("id", usuario.id).then(({ error }) => error && console.error(error)), 800);
}

async function zerarProgresso() {
  const { error } = await db.from("progresso").delete().eq("aluno_id", usuario.id);
  if (error) { toast("Não foi possível apagar o progresso. Tente de novo.", "err"); return; }
  await db.from("perfis").update({ ultima: null }).eq("id", usuario.id);
  P = { feito: {}, quiz: {}, ultima: null };
  rota();
}

/* ============================================================
   DADOS DAS TRILHAS
   ============================================================ */
const trilhasVisiveis = () => CURSO.trilhas.filter(t => usuario.perfil === "adulto" || t.publico === "kids");
const achaTrilha = id => CURSO.trilhas.find(t => t.id === id);
const achaAula = (T, id) => T && T.aulas.find(a => a.id === id);
const ehKids = T => T && T.publico === "kids";
/* Cada aula traz a lista "etapas"; cada etapa tem id, nome, tipo e os dados do tipo.
   Tipos: leitura, conversa (kids), codigo, simulacao, quiz, atividades, jogo (kids). */
const TIPOS = ["leitura", "conversa", "codigo", "simulacao", "quiz", "atividades", "jogo"];
const etapasDe = A => (A.etapas || []).filter(e => e && e.id && TIPOS.includes(e.tipo));
const passos = T => T.aulas.flatMap(A => etapasDe(A).map(e => ({ A, e })));
function pct(T) { const ps = passos(T); return ps.length ? Math.round(ps.filter(p => feito(T.id, p.A.id, p.e.id)).length / ps.length * 100) : 0; }
function pendente(T, A) {
  const lista = A ? etapasDe(A).map(e => ({ A, e })) : passos(T);
  return lista.find(p => !feito(T.id, p.A.id, p.e.id));
}
const link = (t, a, e) => `#/aula/${t}/${a}/${e}`;
const rotaPadrao = () => {
  if (usuario.perfil === "adulto") return "#/inicio";
  const k = trilhasVisiveis()[0];
  return k ? `#/trilha/${k.id}` : "#/progresso";
};

/* ---------- realce de sintaxe ----------
   A linguagem vem da trilha ("linguagem" no indice.json); o padrão é Python. */
const LINGUAGENS = {
  python: {
    kw: new Set("if elif else for while in def return import from as and or not True False None class try except with break continue pass lambda global".split(" ")),
    fn: new Set("print input int str float len range type list dict".split(" ")),
    re: /(#.*$)|([fF]?"(?:[^"\\]|\\.)*"|[fF]?'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g
  },
  javascript: {
    kw: new Set("let const var if else while do for break continue function return true false null undefined new typeof of in".split(" ")),
    fn: new Set("console log prompt Number String Math isNaN".split(" ")),
    re: /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g
  }
};
let linguagemAtual = "python";
function hl(src) {
  const L = LINGUAGENS[linguagemAtual] || LINGUAGENS.python, KW = L.kw, FN = L.fn;
  const re = new RegExp(L.re.source, "g");
  let out = "", last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += `<span class="c">${esc(t)}</span>`;
    else if (m[2]) out += `<span class="s">${esc(t)}</span>`;
    else if (m[3]) out += `<span class="n">${t}</span>`;
    else if (KW.has(t)) out += `<span class="k">${t}</span>`;
    else if (FN.has(t) || src[re.lastIndex] === "(") out += `<span class="f">${t}</span>`;
    else out += t;
    last = re.lastIndex;
  }
  return out + esc(src.slice(last));
}

/* ---------- mascote Bit ---------- */
function mascote(humor = "feliz") {
  const boca = humor === "triste"
    ? '<path d="M40 73 Q50 65 60 73" stroke="#0A2342" stroke-width="4" fill="none" stroke-linecap="round"/>'
    : humor === "uau"
      ? '<ellipse cx="50" cy="70" rx="5" ry="6" fill="#0A2342"/>'
      : '<path d="M38 66 Q50 78 62 66" stroke="#0A2342" stroke-width="4" fill="none" stroke-linecap="round"/>';
  return `<svg viewBox="0 0 100 110" aria-hidden="true">
    <line x1="50" y1="20" x2="50" y2="9" stroke="#0A2342" stroke-width="4"/>
    <circle cx="50" cy="8" r="6" fill="#FFC845" stroke="#0A2342" stroke-width="3"/>
    <circle cx="13" cy="54" r="7" fill="#FFC845" stroke="#0A2342" stroke-width="3"/>
    <circle cx="87" cy="54" r="7" fill="#FFC845" stroke="#0A2342" stroke-width="3"/>
    <rect x="14" y="20" width="72" height="66" rx="20" fill="#16345F" stroke="#0A2342" stroke-width="4"/>
    <rect x="24" y="32" width="52" height="46" rx="14" fill="#E8EEF7"/>
    <circle cx="38" cy="50" r="6" fill="#0A2342"/><circle cx="62" cy="50" r="6" fill="#0A2342"/>
    <circle cx="40" cy="48" r="2" fill="#fff"/><circle cx="64" cy="48" r="2" fill="#fff"/>
    ${boca}
    <rect x="30" y="88" width="40" height="16" rx="8" fill="#FFC845" stroke="#0A2342" stroke-width="4"/>
  </svg>`;
}

/* ============================================================
   TELA DE LOGIN
   ============================================================ */
const DEMO = [
  { linha: 'nome = "Ana"', explica: "Guarda o texto \"Ana\" na variável nome." },
  { linha: "if nome:", explica: "Só continua se nome não estiver vazio." },
  { linha: '    print("Olá,", nome)', explica: "Mostra a saudação na tela: Olá, Ana." }
];
let demoTimer = null;
function iniciarDemo() {
  const box = $("#demoLinhas"), nota = $("#demoNota");
  box.innerHTML = DEMO.map((l, i) => `<div class="ln" data-i="${i}"><span class="num">${i + 1}</span><span class="src">${hl(l.linha)}</span></div>`).join("");
  let i = 0;
  const passo = () => {
    $$(".ln", box).forEach((el, j) => el.classList.toggle("ativa", j === i));
    nota.textContent = DEMO[i].explica;
    i = (i + 1) % DEMO.length;
  };
  passo();
  clearInterval(demoTimer);
  if (!poucoMovimento) demoTimer = setInterval(passo, 2600);
}

const FORMS = { entrar: "#formLogin", criar: "#formCadastro", recuperar: "#formRecuperar", novaSenha: "#formNovaSenha" };
function mostrarPainel(qual) {
  Object.entries(FORMS).forEach(([k, sel]) => ($(sel).hidden = k !== qual));
  $("#abas").hidden = qual === "novaSenha" || qual === "recuperar";
  $("#abaEntrar").setAttribute("aria-selected", qual === "entrar");
  $("#abaCriar").setAttribute("aria-selected", qual === "criar");
  $$(".login-form .aviso").forEach(a => { a.textContent = ""; a.className = "aviso"; });
  // o widget é criado quando o formulário aparece pela primeira vez (num formulário escondido ele não mede direito)
  const ERROS = { entrar: "#erroLogin", criar: "#erroCadastro", recuperar: "#erroRecuperar" };
  if (ERROS[qual]) prepararCaptcha($(FORMS[qual]), ERROS[qual]);
}
function aviso(sel, msg, tipo = "err") { const a = $(sel); a.textContent = msg; a.className = `aviso ${tipo}`; }

function mostrarLogin(painel = "entrar") {
  clearInterval(demoTimer);
  $("#carregando").hidden = true;
  $("#app").hidden = true; $("#login").hidden = false;
  document.body.classList.remove("kids");
  mostrarPainel(painel);
  iniciarDemo();
}

async function abrirSessao(user) {
  const { data: perfil, error } = await db.from("perfis").select("nome,perfil,ultima").eq("id", user.id).maybeSingle();
  if (error) console.error(error);
  const kidsPeloEmail = (user.email || "").endsWith("@" + CONFIG.dominioKids);
  usuario = {
    id: user.id,
    nome: (perfil && perfil.nome) || (user.user_metadata && user.user_metadata.nome) || user.email.split("@")[0],
    perfil: (perfil && perfil.perfil) || (kidsPeloEmail ? "kids" : "adulto"),
    ultima: perfil && perfil.ultima
  };
  await carregarProgresso();
  $("#carregando").hidden = true;
  if (hashDeAuth() || !location.hash) history.replaceState(null, "", urlDoSite + rotaPadrao());
  rota();
}

$("#abaEntrar").onclick = () => mostrarPainel("entrar");
$("#abaCriar").onclick = () => mostrarPainel("criar");
$("#irCriar").onclick = () => { mostrarPainel("criar"); $("#cadNome").focus(); };
$("#irRecuperar").onclick = () => {
  const u = $("#usuario").value.trim();
  mostrarPainel("recuperar");
  if (u.includes("@")) $("#recEmail").value = u;
  $("#recEmail").focus();
};
$$("[data-voltar]").forEach(b => (b.onclick = () => mostrarPainel("entrar")));

/* ============================================================
   CAPTCHA (Cloudflare Turnstile)
   Um widget por formulário (entrar, criar conta, recuperar senha), quase sempre invisível.
   O Supabase confere o token no servidor com a Secret Key, que fica só no painel dele.
   Cada token vale uma vez: depois de toda chamada ao Supabase, o widget é reiniciado.
   ============================================================ */
const CAPTCHA_ATIVO = !!CONFIG.turnstileSiteKey && !/^COLE_AQUI/.test(CONFIG.turnstileSiteKey);
const MSG_ROBO = "Não conseguimos confirmar que você não é um robô. Tente de novo.";
const captchas = new Map();   // form -> { id, token, erroSel }
if (!CAPTCHA_ATIVO) console.warn("CAPTCHA desligado: preencha turnstileSiteKey em js/config.js.");

function esperarTurnstile(limiteMs = 15000) {
  return new Promise((ok, falha) => {
    const inicio = Date.now();
    (function tenta() {
      if (window.turnstile) return ok(window.turnstile);
      if (Date.now() - inicio > limiteMs) return falha(new Error("Turnstile não carregou"));
      setTimeout(tenta, 150);
    })();
  });
}

function estadoCaptcha(form, texto) {
  const st = $(".captcha-status", form);
  if (!st) return;   // "Nova senha" não tem CAPTCHA
  st.textContent = texto || "";
  st.hidden = !texto;
}

/* O botão só libera quando não há envio em andamento e (com CAPTCHA) já existe um token. */
function atualizarBotao(form) {
  const b = $("button[type=submit]", form), c = captchas.get(form);
  const esperandoCaptcha = CAPTCHA_ATIVO && form.id !== "formNovaSenha" && !(c && c.token);
  b.disabled = !!form.dataset.ocupado || esperandoCaptcha;
  if (!form.dataset.ocupado) estadoCaptcha(form,
    !esperandoCaptcha || (c && c.falhou) ? ""
    : c && c.expirou ? "A verificação de segurança expirou e está sendo renovada. Aguarde um instante."
    : "Verificando a segurança…");
}

async function prepararCaptcha(form, erroSel) {
  if (!CAPTCHA_ATIVO || captchas.has(form)) return;
  const c = { id: null, token: null, falhou: false, expirou: false, erroSel };
  captchas.set(form, c);
  atualizarBotao(form);
  try {
    const ts = await esperarTurnstile();
    c.id = ts.render($("[data-captcha]", form), {
      sitekey: CONFIG.turnstileSiteKey,
      language: "pt-br",
      appearance: "interaction-only",
      callback: token => {
        c.token = token; c.falhou = false; c.expirou = false;
        if ($(erroSel).textContent === MSG_ROBO) aviso(erroSel, "", "");   // a nova tentativa deu certo
        atualizarBotao(form);
      },
      "expired-callback": () => {   // o token expirou antes do envio; o Turnstile renova sozinho
        c.token = null; c.expirou = true; atualizarBotao(form);
      },
      "error-callback": () => {
        c.token = null; c.falhou = true; atualizarBotao(form);
        aviso(erroSel, MSG_ROBO);
      },
      "timeout-callback": () => {
        c.token = null; c.falhou = true; atualizarBotao(form);
        aviso(erroSel, MSG_ROBO);
        ts.reset(c.id);
      }
    });
  } catch (e) {
    console.error(e);
    c.falhou = true; atualizarBotao(form);
    aviso(erroSel, "Não conseguimos carregar a verificação de segurança. Confira sua internet (ou desative bloqueadores de anúncio) e recarregue a página.");
  }
}

/* Token atual para mandar ao Supabase (undefined com o CAPTCHA desligado). */
const tokenCaptcha = form => (CAPTCHA_ATIVO ? (captchas.get(form) || {}).token : undefined);

/* Descarta o token usado e pede um novo. */
function renovarCaptcha(form) {
  const c = captchas.get(form);
  if (!c || c.id == null || !window.turnstile) return;
  c.token = null; c.falhou = false; c.expirou = false;
  window.turnstile.reset(c.id);
  atualizarBotao(form);
}

/* Segurança extra: não envia sem token, mesmo que o botão seja contornado (ex.: Enter). */
function captchaPronto(form) {
  if (!CAPTCHA_ATIVO || tokenCaptcha(form)) return true;
  const c = captchas.get(form);
  aviso(c ? c.erroSel : "#avisoGeral", c && c.falhou ? MSG_ROBO : "Aguarde um instante: estamos terminando a verificação de segurança.");
  return false;
}

const erroDeCaptcha = error => !!error && (error.code === "captcha_failed" || /captcha/i.test(error.message || ""));

function ocupado(form, sim) {
  const b = $("button[type=submit]", form);
  if (sim) { form.dataset.ocupado = "1"; b.dataset.txt = b.textContent; b.textContent = "Aguarde…"; }
  else { delete form.dataset.ocupado; if (b.dataset.txt) b.textContent = b.dataset.txt; }
  estadoCaptcha(form, "");
  atualizarBotao(form);
}

/* Entrar */
$("#formLogin").addEventListener("submit", async ev => {
  ev.preventDefault();
  const u = $("#usuario").value.trim(), s = $("#senha").value;
  if (!u || !s) { aviso("#erroLogin", "Preencha e-mail (ou apelido) e senha."); return; }
  if (!captchaPronto(ev.target)) return;
  ocupado(ev.target, true);
  // vale também para o login kids: o apelido vira e-mail em emailDoLogin e o CAPTCHA é o mesmo, invisível
  const { data, error } = await db.auth.signInWithPassword({
    email: emailDoLogin(u), password: s, options: { captchaToken: tokenCaptcha(ev.target) }
  });
  renovarCaptcha(ev.target);
  ocupado(ev.target, false);
  if (error) {
    const msg = erroDeCaptcha(error) ? MSG_ROBO
      : error.code === "email_not_confirmed"
      ? "Falta confirmar seu e-mail. Abra a mensagem que enviamos e clique no link."
      : error.status === 400 || error.code === "invalid_credentials"
        ? "E-mail/apelido ou senha incorretos. Confira e tente de novo."
        : "Não foi possível entrar agora. Confira sua internet e tente de novo.";
    aviso("#erroLogin", msg);
    return;
  }
  $("#senha").value = "";
  await abrirSessao(data.user);
});

/* Criar conta */
$("#formCadastro").addEventListener("submit", async ev => {
  ev.preventDefault();
  const nome = $("#cadNome").value.trim(), email = $("#cadEmail").value.trim().toLowerCase();
  const senha = $("#cadSenha").value, codigo = $("#cadCodigo").value.trim().toUpperCase();
  if (!nome || !email || !senha || !codigo) { aviso("#erroCadastro", "Preencha todos os campos."); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { aviso("#erroCadastro", "Esse e-mail não parece certo. Confira."); return; }
  if (email.endsWith("@" + CONFIG.dominioKids)) { aviso("#erroCadastro", "Use o seu e-mail pessoal."); return; }
  if (senha.length < 6) { aviso("#erroCadastro", "A senha precisa ter pelo menos 6 caracteres."); return; }
  if (!captchaPronto(ev.target)) return;

  ocupado(ev.target, true);
  try {
    // conferência rápida só para dar uma mensagem clara; a validação real é feita no servidor
    const { data: ok, error: e1 } = await db.rpc("codigo_turma_valido", { codigo });
    if (!e1 && ok === false) { aviso("#erroCadastro", "Código da turma inválido. Confira com a professora."); return; }

    const { data, error } = await db.auth.signUp({
      email, password: senha,
      options: { data: { nome, codigo_turma: codigo }, emailRedirectTo: urlDoSite, captchaToken: tokenCaptcha(ev.target) }
    });
    renovarCaptcha(ev.target);
    if (error) {
      const m = (error.message || "").toLowerCase();
      aviso("#erroCadastro",
        erroDeCaptcha(error) ? MSG_ROBO
        : m.includes("database error") ? "Código da turma inválido. Confira com a professora."
        : error.code === "user_already_exists" ? "Já existe uma conta com esse e-mail. Use Entrar."
        : error.code === "weak_password" ? "Essa senha é fraca demais. Tente uma maior, com letras e números."
        : error.code === "over_email_send_rate_limit" || error.status === 429 ? "Muitos cadastros em pouco tempo. Espere alguns minutos e tente de novo."
        : "Não foi possível criar a conta agora. Tente de novo em instantes.");
      return;
    }
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      aviso("#erroCadastro", "Já existe uma conta com esse e-mail. Use Entrar ou \"Esqueci minha senha\".");
      return;
    }
    if (data.session) { await abrirSessao(data.user); return; }
    ev.target.reset();
    mostrarPainel("entrar");
    $("#usuario").value = email;
    aviso("#avisoGeral", `Conta criada! Enviamos um link de confirmação para ${email}. Abra o e-mail, clique no link e depois entre aqui.`, "ok");
  } finally {
    ocupado(ev.target, false);
  }
});

/* Esqueci a senha */
$("#formRecuperar").addEventListener("submit", async ev => {
  ev.preventDefault();
  const email = $("#recEmail").value.trim().toLowerCase();
  if (!email.includes("@")) { aviso("#erroRecuperar", "Digite o e-mail da sua conta."); return; }
  if (email.endsWith("@" + CONFIG.dominioKids)) { aviso("#erroRecuperar", "Contas kids: peça uma senha nova para a professora."); return; }
  if (!captchaPronto(ev.target)) return;
  ocupado(ev.target, true);
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: urlDoSite, captchaToken: tokenCaptcha(ev.target) });
  renovarCaptcha(ev.target);
  ocupado(ev.target, false);
  if (erroDeCaptcha(error)) { aviso("#erroRecuperar", MSG_ROBO); return; }
  if (error && error.status === 429) { aviso("#erroRecuperar", "Muitos pedidos em pouco tempo. Espere alguns minutos e tente de novo."); return; }
  if (error) { aviso("#erroRecuperar", "Não foi possível enviar agora. Tente de novo em instantes."); return; }
  mostrarPainel("entrar");
  aviso("#avisoGeral", `Se existir uma conta com ${email}, enviamos um link para criar uma senha nova. Confira também a caixa de spam.`, "ok");
});

/* Nova senha */
$("#formNovaSenha").addEventListener("submit", async ev => {
  ev.preventDefault();
  const s1 = $("#novaSenha").value, s2 = $("#novaSenha2").value;
  if (s1.length < 6) { aviso("#erroNovaSenha", "A senha precisa ter pelo menos 6 caracteres."); return; }
  if (s1 !== s2) { aviso("#erroNovaSenha", "As duas senhas não são iguais."); return; }
  ocupado(ev.target, true);
  const { data, error } = await db.auth.updateUser({ password: s1 });
  ocupado(ev.target, false);
  if (error) {
    aviso("#erroNovaSenha", error.code === "same_password" ? "A nova senha precisa ser diferente da anterior."
      : "Não foi possível salvar. O link pode ter expirado: peça um novo em \"Esqueci minha senha\".");
    return;
  }
  emRecuperacao = false;
  ev.target.reset();
  toast("Senha alterada com sucesso!");
  await abrirSessao(data.user);
});

$("#sair").addEventListener("click", async () => {
  await db.auth.signOut();
  usuario = null;
  history.replaceState(null, "", urlDoSite);
  mostrarLogin();
});

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function desenharNav(ativo) {
  const ts = trilhasVisiveis();
  const item = (href, txt, extra = "", cls = "") => `<a href="${href}" class="${cls} ${ativo === href ? "ativo" : ""}">${txt}${extra}</a>`;
  let h = "";
  const kids = ts.filter(ehKids);
  if (usuario.perfil === "adulto") {
    h += item("#/inicio", "Início");
    if (kids.length) h += item(`#/trilha/${kids[0].id}`, "Espaço Kids");
  } else {
    h += kids.map(t => item(`#/trilha/${t.id}`, esc(t.titulo))).join("");
  }
  h += item("#/progresso", "Meu progresso");
  const adultas = ts.filter(t => !ehKids(t));
  if (adultas.length) {
    h += `<div class="nav-grupo">Trilhas</div>`;
    h += adultas.map(t => item(`#/trilha/${t.id}`, esc(t.titulo), `<span class="pct">${pct(t)}%</span>`, "trilha-link")).join("");
  }
  $("#nav").innerHTML = h;
}

function rota() {
  if (!usuario || emRecuperacao) return;
  clearInterval(demoTimer);
  $("#login").hidden = true; $("#app").hidden = false;
  $("#avatar").textContent = usuario.nome.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
  $("#nomeUsuario").textContent = usuario.nome;

  if (hashDeAuth()) { location.replace(rotaPadrao()); return; }
  const [v, ...r] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  let navAtivo = "#/" + [v, r[0]].filter(Boolean).join("/");

  if (v === "trilha" && achaTrilha(r[0]) && trilhasVisiveis().includes(achaTrilha(r[0]))) viewTrilha(achaTrilha(r[0]));
  else if (v === "aula") {
    const T = achaTrilha(r[0]), A = achaAula(T, r[1]);
    if (!A || !trilhasVisiveis().includes(T)) { location.hash = rotaPadrao(); return; }
    const es = etapasDe(A);
    const e = es.find(x => x.id === r[2]) ? r[2] : es[0].id;
    navAtivo = `#/trilha/${T.id}`;
    viewAula(T, A, e);
  }
  else if (v === "progresso") { document.body.classList.toggle("kids", usuario.perfil === "kids"); viewProgresso(); }
  else if (v === "inicio" && usuario.perfil === "adulto") { document.body.classList.remove("kids"); viewInicio(); }
  else { location.hash = rotaPadrao(); return; }

  desenharNav(navAtivo);
  window.scrollTo(0, 0);
  const h1 = $("#view h1"); if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
}
window.addEventListener("hashchange", rota);

/* ============================================================
   TELAS
   ============================================================ */
function cardTrilha(T) {
  const p = pct(T);
  return `<a class="trilha-card ${ehKids(T) ? "kids" : ""}" href="#/trilha/${T.id}">
    <span class="tag">${ehKids(T) ? "Kids" : T.aulas.length + (T.aulas.length === 1 ? " aula" : " aulas")}</span>
    <h3>${esc(T.titulo)}</h3><p>${esc(T.descricao)}</p>
    <div class="barra" aria-hidden="true"><i style="width:${p}%"></i></div>
    <div class="barra-info"><span>${p === 100 ? "Concluída" : p ? "Em andamento" : "Não iniciada"}</span><span>${p}%</span></div>
  </a>`;
}

function viewInicio() {
  let alvo = null;
  if (P.ultima) {
    const [t, a, e] = P.ultima.split("/");
    const T = achaTrilha(t), A = achaAula(T, a);
    if (A && !ehKids(T)) {
      const pend = pendente(T, A);
      const eOk = etapasDe(A).some(x => x.id === e) ? e : etapasDe(A)[0].id;
      alvo = { T, A, e: pend ? pend.e.id : eOk };
    }
  }
  if (!alvo) for (const T of trilhasVisiveis().filter(t => !ehKids(t))) { const p = pendente(T); if (p) { alvo = { T, A: p.A, e: p.e.id }; break; } }
  const nomeEtapa = alvo ? etapasDe(alvo.A).find(x => x.id === alvo.e).nome : "";

  $("#view").innerHTML = `
    <div class="saudacao"><h1>Olá, ${esc(usuario.nome.split(" ")[0])}</h1><p class="muted">Escolha uma trilha ou continue de onde parou.</p></div>
    ${alvo ? `<div class="continuar">
      <div><small>Continue de onde parou</small><h2>${esc(alvo.A.titulo)}</h2><p>${esc(alvo.T.titulo)}, próxima atividade: ${esc(nomeEtapa)}</p></div>
      <a class="btn claro" href="${link(alvo.T.id, alvo.A.id, alvo.e)}">Continuar aula</a>
    </div>` : `<div class="continuar"><div><h2>Você concluiu todas as trilhas</h2><p>Novas aulas aparecem aqui assim que forem publicadas.</p></div></div>`}
    <h2 class="secao-titulo">Suas trilhas</h2>
    <div class="trilhas">${trilhasVisiveis().map(cardTrilha).join("")}</div>`;
}

function viewTrilha(T) {
  document.body.classList.toggle("kids", ehKids(T));
  const p = pct(T);
  $("#view").innerHTML = `
    <div class="trilha-topo">
      <div><span class="tag">${ehKids(T) ? "Espaço Kids" : "Trilha"}</span><h1>${esc(T.titulo)}</h1><p class="muted">${esc(T.descricao)}</p></div>
      <div class="resumo"><div class="barra-info" style="margin-bottom:6px"><span>Seu progresso</span><span>${p}%</span></div><div class="barra"><i style="width:${p}%"></i></div></div>
    </div>
    ${ehKids(T) ? `<div class="bit-cena" style="margin:0 0 28px"><div class="bit">${mascote()}</div><div class="balao"><p>Escolha uma fase e vamos programar juntos!</p></div></div>` : ""}
    ${T.aulas.length ? "" : `<p class="muted">As aulas desta trilha aparecem aqui em breve.</p>`}
    <ol class="aulas">${T.aulas.map((A, i) => {
      const es = etapasDe(A);
      const nFeitas = es.filter(e => feito(T.id, A.id, e.id)).length;
      const pend = pendente(T, A);
      const txt = nFeitas === es.length ? "Revisar" : nFeitas ? "Continuar" : "Começar";
      return `<li class="aula-item">
        <span class="aula-num ${nFeitas === es.length ? "ok" : ""}">${nFeitas === es.length ? "✓" : (A.numero || i + 1)}</span>
        <div><h3>${A.numero ? `Aula ${A.numero}: ` : ""}${esc(A.titulo)}</h3><span class="muted" style="font-size:.9rem">${esc(A.duracao || "")}</span>
          <div class="chips">${es.map(e => `<span class="chip ${feito(T.id, A.id, e.id) ? "ok" : ""}">${esc(e.nome)}</span>`).join("")}</div></div>
        <a class="btn ${ehKids(T) ? "sol" : ""}" href="${link(T.id, A.id, pend ? pend.e.id : es[0].id)}">${txt}</a>
      </li>`;
    }).join("")}</ol>`;
}

function railHTML(T, A, eid) {
  const kids = ehKids(T);
  return `<h3>${esc(A.titulo)}</h3>
    ${etapasDe(A).map(e => `<a href="${link(T.id, A.id, e.id)}" class="${e.id === eid ? "ativo" : ""}" ${e.id === eid ? 'aria-current="page"' : ""}>
      <span class="st ${feito(T.id, A.id, e.id) ? "ok" : ""}">${feito(T.id, A.id, e.id) ? "✓" : ""}</span>${esc(e.nome)}</a>`).join("")}
    ${T.aulas.length > 1 ? `<div class="outras"><h3>Outras ${kids ? "fases" : "aulas"}</h3>${T.aulas.filter(x => x !== A).map(x => `<a href="${link(T.id, x.id, etapasDe(x)[0].id)}">${esc(x.titulo)}</a>`).join("")}</div>` : ""}`;
}
function atualizarRail(T, A, eid) { const r = $("#rail"); if (r) r.innerHTML = railHTML(T, A, eid); desenharNav(`#/trilha/${T.id}`); }

function viewAula(T, A, eid) {
  document.body.classList.toggle("kids", ehKids(T));
  linguagemAtual = T.linguagem || "python";
  salvarUltima(`${T.id}/${A.id}/${eid}`);
  const ps = passos(T);
  const idx = ps.findIndex(p => p.A === A && p.e.id === eid);
  const ant = ps[idx - 1], prox = ps[idx + 1];
  const es = etapasDe(A);
  const etapa = es.find(e => e.id === eid);

  $("#view").innerHTML = `
    <div class="migalha"><a href="#/trilha/${T.id}">${esc(T.titulo)}</a> <span class="muted">/ ${esc(A.titulo)}</span></div>
    <div class="aula-layout">
      <nav class="rail" id="rail" aria-label="Atividades da aula">${railHTML(T, A, eid)}</nav>
      <article>
        <div class="etapa-topo"><small>Etapa ${es.indexOf(etapa) + 1} de ${es.length}</small><h1>${esc(etapa.nome)}</h1></div>
        <div id="etapa"></div>
        <div class="rodape-aula">
          ${ant ? `<a class="btn ghost" href="${link(T.id, ant.A.id, ant.e.id)}">Anterior</a>` : "<span></span>"}
          <a class="btn ${ehKids(T) ? "sol" : ""}" id="btnProx" href="${prox ? link(T.id, prox.A.id, prox.e.id) : `#/trilha/${T.id}`}">${prox ? "Próxima atividade" : "Concluir trilha"}</a>
        </div>
      </article>
    </div>`;

  $("#btnProx").addEventListener("click", () => { if (["leitura", "codigo", "simulacao"].includes(etapa.tipo)) marcar(T.id, A.id, eid); });
  const box = $("#etapa");
  const telas = { leitura: viewLeitura, conversa: viewConversa, codigo: viewCodigo, simulacao: viewSimulacao, quiz: viewQuiz, atividades: viewAtividades, jogo: viewJogo };
  telas[etapa.tipo](T, A, etapa, box);
}

/* ---------- blocos de texto (usados na leitura e nas atividades) ----------
   "texto"                         → parágrafo (aceita `código` e **negrito**)
   {h}  {lista}  {passos}          → subtítulo, lista, lista numerada
   {codigo}                        → bloco de código
   {tabela: [[cabeçalho], [linha]...]}
   {nota}                          → destaque
   {fluxograma, legenda?}          → fluxograma em sintaxe Mermaid */
function blocos(lista) {
  return (lista || []).map(b => {
    if (typeof b === "string") return `<p>${fmt(b)}</p>`;
    if (b.h) return `<h2>${fmt(b.h)}</h2>`;
    if (b.lista) return `<ul>${b.lista.map(x => `<li>${fmt(x)}</li>`).join("")}</ul>`;
    if (b.passos) return `<ol>${b.passos.map(x => `<li>${fmt(x)}</li>`).join("")}</ol>`;
    if (b.codigo != null) return `<pre class="bloco-codigo">${b.codigo.split("\n").map(hl).join("\n")}</pre>`;
    if (b.nota) return `<div class="nota">${fmt(b.nota)}</div>`;
    if (b.tabela) {
      const [cab, ...linhas] = b.tabela;
      return `<div class="tab-wrap"><table class="tabela conteudo"><thead><tr>${cab.map(c => `<th>${fmt(c)}</th>`).join("")}</tr></thead>
        <tbody>${linhas.map(l => `<tr>${l.map(c => `<td>${fmt(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    if (b.fluxograma) return `<figure class="fluxo"><pre class="mermaid-fonte">${esc(b.fluxograma)}</pre>${b.legenda ? `<figcaption>${fmt(b.legenda)}</figcaption>` : ""}</figure>`;
    return "";
  }).join("");
}

/* Fluxogramas: a biblioteca Mermaid só é baixada quando a página tem um. */
let mermaidPronto = null;
async function desenharFluxogramas(box) {
  const fontes = $$(".mermaid-fonte", box);
  if (!fontes.length) return;
  try {
    if (!mermaidPronto) mermaidPronto = import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs").then(m => {
      m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: "Nunito Sans, system-ui, sans-serif",
        flowchart: { padding: 14, htmlLabels: true, useMaxWidth: true },
        themeVariables: { primaryColor: "#E8EEF7", primaryBorderColor: "#2C5282", primaryTextColor: "#0A2342", lineColor: "#16345F", fontSize: "15px" } });
      return m.default;
    });
    const mermaid = await mermaidPronto;
    if (document.fonts) await document.fonts.ready;   // mede o texto já com a fonte certa (senão corta)
    for (const f of fontes) {
      const { svg } = await mermaid.render("fx" + Math.random().toString(36).slice(2), f.textContent);
      const div = document.createElement("div");
      div.className = "fluxo-svg"; div.innerHTML = svg;
      f.replaceWith(div);
    }
  } catch (e) { console.warn("Fluxograma não desenhado:", e); }
}

function viewLeitura(T, A, etapa, box) {
  box.innerHTML = `<div class="leitura">${blocos(etapa.blocos)}</div>`;
  desenharFluxogramas(box);
}

function viewConversa(T, A, etapa, box) {
  const falas = etapa.falas || [];
  let i = 0;
  const desenhar = () => {
    const ultimo = i === falas.length - 1;
    box.innerHTML = `<div class="bit-cena">
      <div class="bit">${mascote(i === 0 ? "uau" : "feliz")}</div>
      <div><div class="balao" aria-live="polite"><p>${fmt(falas[i])}</p></div>
        <div class="balao-nav">
          <button class="btn ghost" id="bVolta" ${i === 0 ? "disabled" : ""}>Voltar</button>
          <button class="btn sol" id="bVai">${ultimo ? "Bora lá!" : "Próximo"}</button>
          <div class="pontos" aria-label="Balão ${i + 1} de ${falas.length}">${falas.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</div>
        </div></div></div>`;
    $("#bVolta").onclick = () => { i--; desenhar(); $("#bVolta").focus(); };
    $("#bVai").onclick = () => {
      if (ultimo) { marcar(T.id, A.id, etapa.id); location.hash = $("#btnProx").getAttribute("href"); return; }
      i++; desenhar(); $("#bVai").focus();
    };
  };
  desenhar();
}

/* Código comentado. Dois formatos:
   - linhas: [{linha, explica}]  → uma explicação por linha;
   - codigo: [...] + explicacoes: [{linhas: [de, ate], texto}]  → explicações por faixa, como nas
     tabelas "Linha | O que acontece" do material; linhas sem explicação não são clicáveis.
   "fechamento" (blocos) aparece depois do código. */
function viewCodigo(T, A, etapa, box) {
  if (etapa.explicacoes) return viewCodigoFaixas(T, A, etapa, box);
  const L = etapa.linhas; const vistas = new Set(); let atual = 0;
  box.innerHTML = `${etapa.intro ? `<div class="leitura">${blocos([].concat(etapa.intro))}</div>` : ""}
    <p class="dica-topo">Clique em qualquer linha para ver o que ela faz, ou use os botões para ir passo a passo.</p>
    <div class="explorer">
      <div class="code" role="list">${L.map((l, i) => `<button class="ln" role="listitem" data-i="${i}" aria-label="Linha ${i + 1}"><span class="num">${i + 1}</span><span class="src">${hl(l.linha) || " "}</span></button>`).join("")}</div>
      <div class="explain" aria-live="polite"><div id="expTexto"></div>
        <div class="explain-nav"><button class="btn ghost" id="lAnt">Linha anterior</button><button class="btn" id="lProx">Próxima linha</button></div>
        <div class="contagem" id="contagem"></div></div>
    </div>`;
  const mostrar = i => {
    atual = i; vistas.add(i);
    $$(".ln", box).forEach((el, j) => { el.classList.toggle("ativa", j === i); el.classList.toggle("vista", vistas.has(j)); });
    $("#expTexto").innerHTML = `<div class="qual">Linha ${i + 1}</div>${L[i].linha.trim() ? `<pre>${hl(L[i].linha)}</pre>` : "<pre> </pre>"}<p>${fmt(L[i].explica)}</p>`;
    $("#lAnt").disabled = i === 0; $("#lProx").disabled = i === L.length - 1;
    $("#contagem").textContent = `${vistas.size} de ${L.length} linhas exploradas`;
    if (vistas.size === L.length && !feito(T.id, A.id, etapa.id)) { marcar(T.id, A.id, etapa.id); atualizarRail(T, A, etapa.id); }
  };
  $$(".ln", box).forEach(el => el.addEventListener("click", () => mostrar(+el.dataset.i)));
  $("#lAnt").onclick = () => mostrar(atual - 1);
  $("#lProx").onclick = () => mostrar(atual + 1);
  mostrar(0);
}

function viewCodigoFaixas(T, A, etapa, box) {
  const C = etapa.codigo, X = etapa.explicacoes, vistas = new Set(); let atual = 0;
  const faixa = x => [x.linhas[0], x.linhas[1] || x.linhas[0]];
  const daLinha = n => X.findIndex(x => n >= faixa(x)[0] && n <= faixa(x)[1]);
  box.innerHTML = `${etapa.intro ? `<div class="leitura">${blocos([].concat(etapa.intro))}</div>` : ""}
    <p class="dica-topo">Clique em qualquer linha para ver o que ela faz, ou use os botões para ir passo a passo.</p>
    <div class="explorer">
      <div class="code" role="list">${C.map((l, i) => {
        const x = daLinha(i + 1), conteudo = `<span class="num">${i + 1}</span><span class="src">${hl(l) || " "}</span>`;
        return x < 0 ? `<div class="ln" role="listitem">${conteudo}</div>`
          : `<button class="ln" role="listitem" data-x="${x}" aria-label="Linha ${i + 1}">${conteudo}</button>`;
      }).join("")}</div>
      <div class="explain" aria-live="polite"><div id="expTexto"></div>
        <div class="explain-nav"><button class="btn ghost" id="lAnt">Anterior</button><button class="btn" id="lProx">Próxima</button></div>
        <div class="contagem" id="contagem"></div></div>
    </div>
    ${etapa.fechamento ? `<div class="leitura" style="margin-top:18px">${blocos([].concat(etapa.fechamento))}</div>` : ""}`;
  const mostrar = k => {
    atual = k; vistas.add(k);
    const [de, ate] = faixa(X[k]);
    $$(".ln", box).forEach((el, j) => {
      el.classList.toggle("ativa", j + 1 >= de && j + 1 <= ate);
      el.classList.toggle("vista", el.dataset.x != null && vistas.has(+el.dataset.x));
    });
    const trecho = C.slice(de - 1, ate).map(hl).join("\n");
    $("#expTexto").innerHTML = `<div class="qual">${de === ate ? `Linha ${de}` : `Linhas ${de}–${ate}`}</div><pre>${trecho || " "}</pre><p>${fmt(X[k].texto)}</p>`;
    $("#lAnt").disabled = k === 0; $("#lProx").disabled = k === X.length - 1;
    $("#contagem").textContent = `${vistas.size} de ${X.length} explicações vistas`;
    if (vistas.size === X.length && !feito(T.id, A.id, etapa.id)) { marcar(T.id, A.id, etapa.id); atualizarRail(T, A, etapa.id); }
  };
  $$("button.ln", box).forEach(el => el.addEventListener("click", () => mostrar(+el.dataset.x)));
  $("#lAnt").onclick = () => mostrar(atual - 1);
  $("#lProx").onclick = () => mostrar(atual + 1);
  mostrar(0);
}

/* Simulação (teste de mesa): o código roda passo a passo, mostrando memória e tela.
   Cada passo: { linha (1 = primeira; 0 = fim), explica, memoria?: {nome: [valor, tipo] | null}, tela?: "texto", limparTela? }
   A etapa pode trocar o nome da caixa de saída com "rotuloTela" (ex.: "Console"). */
function viewSimulacao(T, A, etapa, box) {
  const C = etapa.codigo, S = etapa.passos; let k = 0;
  box.innerHTML = `${etapa.intro ? `<div class="leitura">${blocos([].concat(etapa.intro))}</div>` : ""}
    <div class="simulador">
      <div class="code" aria-label="Código">${C.map((l, i) => `<div class="ln" data-i="${i}"><span class="num">${i + 1}</span><span class="src">${hl(l) || " "}</span></div>`).join("")}</div>
      <div class="sim-lado">
        <div class="sim-caixa"><h3>Memória</h3><div id="simMem"></div></div>
        <div class="sim-caixa"><h3>${esc(etapa.rotuloTela || "Tela")}</h3><pre class="console" id="simTela"></pre></div>
      </div>
    </div>
    <div class="explain sim-exp" aria-live="polite"><div class="qual" id="simQual"></div><p id="simTexto"></p>
      <div class="explain-nav"><button class="btn ghost" id="sAnt">Passo anterior</button><button class="btn" id="sProx">Próximo passo</button></div></div>`;
  const mostrar = () => {
    const mem = {}, tela = [];
    let mudou = [];
    S.slice(0, k + 1).forEach((p, j) => {
      if (p.memoria) {   // valor null = a variável deixou de existir (ex.: local de uma função que terminou)
        for (const [nome, v] of Object.entries(p.memoria)) v === null ? delete mem[nome] : (mem[nome] = v);
        if (j === k) mudou = Object.keys(p.memoria);
      }
      if (p.limparTela) tela.length = 0;   // ex.: o Streamlit redesenha a página a cada re-execução
      if (p.tela != null) tela.push(p.tela);
    });
    const p = S[k];
    $$(".ln", box).forEach((el, j) => el.classList.toggle("ativa", j === p.linha - 1));
    const nomes = Object.keys(mem);
    $("#simMem").innerHTML = nomes.length
      ? `<table class="tabela mem"><thead><tr><th>Variável</th><th>Valor</th><th>Tipo</th></tr></thead><tbody>${nomes.map(n =>
          `<tr class="${mudou.includes(n) ? "mudou" : ""}"><td><code>${esc(n).replace(/\./g, ".<wbr>")}</code></td><td><code>${esc(mem[n][0])}</code></td><td>${esc(mem[n][1] || "")}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted">Nenhuma variável ainda.</p>`;
    $("#simTela").textContent = tela.join("\n");
    $("#simQual").textContent = `Passo ${k + 1} de ${S.length}${p.linha ? ` · linha ${p.linha}` : " · fim do programa"}`;
    $("#simTexto").innerHTML = fmt(p.explica);
    $("#sAnt").disabled = k === 0; $("#sProx").disabled = k === S.length - 1;
    if (k === S.length - 1 && !feito(T.id, A.id, etapa.id)) { marcar(T.id, A.id, etapa.id); atualizarRail(T, A, etapa.id); }
  };
  $("#sAnt").onclick = () => { k--; mostrar(); };
  $("#sProx").onclick = () => { k++; mostrar(); };
  mostrar();
}

function viewQuiz(T, A, etapa, box) {
  const Q = etapa.perguntas, kids = ehKids(T); let i = 0, acertos = 0;
  const letras = "ABCDEFG";
  const pergunta = () => {
    const q = Q[i];
    box.innerHTML = `<div class="quiz">
      <div class="q-prog" aria-hidden="true">${Q.map((_, j) => `<i class="${j < i ? "feita" : ""}"></i>`).join("")}</div>
      <div class="q-num">Pergunta ${i + 1} de ${Q.length}</div>
      <div class="q-pergunta">${fmt(q.pergunta)}</div>
      ${q.codigo ? `<pre class="bloco-codigo">${q.codigo.split("\n").map(hl).join("\n")}</pre>` : ""}
      ${q.dica ? `<div class="q-dica"><button class="link-btn" id="verDica" aria-expanded="false">Ver dica</button><div class="caixa" id="caixaDica" hidden>${fmt(q.dica)}</div></div>` : ""}
      <div id="opcoes">${q.opcoes.map((o, j) => `<button class="opcao" data-j="${j}"><span class="letra">${letras[j]}</span><span>${fmt(o)}</span></button>`).join("")}</div>
      <div id="fb" aria-live="polite"></div></div>`;
    $$(".opcao", box).forEach(b => b.addEventListener("click", () => responder(+b.dataset.j)));
    if (q.dica) $("#verDica").onclick = ev => { $("#caixaDica").hidden = false; ev.target.setAttribute("aria-expanded", "true"); ev.target.hidden = true; };
  };
  const responder = j => {
    const q = Q[i], certo = j === q.correta;
    if (certo) acertos++;
    $$(".opcao", box).forEach((b, k) => {
      b.disabled = true;
      if (k === q.correta) b.classList.add("certa");
      else if (k === j) b.classList.add("errada");
    });
    const ultimo = i === Q.length - 1;
    $("#fb").innerHTML = `<div class="feedback ${certo ? "ok" : "err"}">
        ${kids ? `<div class="mini">${mascote(certo ? "feliz" : "triste")}</div>` : ""}
        <div><strong>${fmt(certo ? (q.acerto || "Isso mesmo!") : (q.erro || "Não foi dessa vez."))}</strong>${q.explicacao ? `<p>${fmt(q.explicacao)}</p>` : ""}</div></div>
      <button class="btn ${kids ? "sol" : ""}" id="qProx">${ultimo ? "Ver resultado" : "Próxima pergunta"}</button>`;
    $("#qProx").focus();
    $("#qProx").onclick = () => { if (ultimo) resultado(); else { i++; pergunta(); } };
  };
  const resultado = () => {
    salvarQuiz(T.id, A.id, etapa.id, acertos, Q.length);
    atualizarRail(T, A, etapa.id);
    const tudo = acertos === Q.length;
    box.innerHTML = `<div class="resultado quiz">
      ${kids ? `<div style="width:110px;margin:0 auto">${mascote(tudo ? "uau" : "feliz")}</div>` : ""}
      <div class="placar">${acertos}/${Q.length}</div>
      <p>${tudo ? "Você acertou tudo!" : "Revise as explicações e tente de novo quando quiser."}</p>
      <div class="acoes"><button class="btn ghost" id="refazer">Refazer quiz</button><a class="btn ${kids ? "sol" : ""}" href="${$("#btnProx").getAttribute("href")}">Próxima atividade</a></div></div>`;
    $("#refazer").onclick = () => { i = 0; acertos = 0; pergunta(); };
  };
  pergunta();
}

/* Atividades: a solução só é liberada depois que o aluno escreve a tentativa.
   O rascunho fica salvo só neste navegador; "Marcar como feita" vai para o progresso. */
function viewAtividades(T, A, etapa, box) {
  const itens = etapa.itens;
  const chaveItem = it => `${etapa.id}:${it.n}`;
  const chaveRascunho = it => `rascunho:${usuario.id}:${T.id}/${A.id}/${chaveItem(it)}`;
  const lerRascunho = it => { try { return localStorage.getItem(chaveRascunho(it)) || ""; } catch (e) { return ""; } };
  const MIN = 15;
  const contagem = () => {
    const n = itens.filter(it => feito(T.id, A.id, chaveItem(it))).length;
    $("#atvConta").textContent = `${n} de ${itens.length} atividades feitas`;
    if (n === itens.length) { if (!feito(T.id, A.id, etapa.id)) { marcar(T.id, A.id, etapa.id); atualizarRail(T, A, etapa.id); } }
    else if (feito(T.id, A.id, etapa.id)) { desmarcar(T.id, A.id, etapa.id); atualizarRail(T, A, etapa.id); }
  };

  box.innerHTML = `<div class="leitura">${blocos([].concat(etapa.intro || []))}</div>
    <p class="contagem" id="atvConta"></p>
    <div class="atividades">${itens.map(it => {
      const r = lerRascunho(it);
      return `<section class="atividade" data-n="${it.n}">
        <header><span class="tag nivel-${semAcento(it.nivel)}">${esc(it.nivel)}</span><h2>Atividade ${it.n}${it.titulo ? `: ${esc(it.titulo)}` : ""}</h2></header>
        <div class="leitura">${blocos(it.enunciado)}</div>
        ${it.testes ? `<div class="testes"><strong>Para testar</strong>${blocos(it.testes)}</div>` : ""}
        ${it.dica ? `<div class="q-dica"><button class="link-btn ver-dica" aria-expanded="false">Ver dica</button><div class="caixa" hidden>${fmt(it.dica)}</div></div>` : ""}
        <label for="rasc-${it.n}">Sua tentativa</label>
        <textarea id="rasc-${it.n}" class="rascunho" rows="6" spellcheck="false" placeholder="Escreva sua resposta ou cole seu código aqui para liberar a solução.">${esc(r)}</textarea>
        <p class="ajuda-campo">Fica salvo só neste navegador.</p>
        <div class="atv-acoes">
          <button class="btn ghost ver-solucao" ${r.trim().length >= MIN ? "" : "disabled"}>Ver solução</button>
          <label class="check"><input type="checkbox" class="marcar-feita" ${feito(T.id, A.id, chaveItem(it)) ? "checked" : ""}> Marcar como feita</label>
        </div>
        <div class="solucao" hidden>
          <h3>Solução de referência</h3>
          <div class="leitura">${blocos(it.solucao)}</div>
          ${it.observar ? `<div class="nota"><strong>O que observar:</strong> ${fmt(it.observar)}</div>` : ""}
        </div>
      </section>`;
    }).join("")}</div>`;

  $$(".atividade", box).forEach(sec => {
    const it = itens.find(x => x.n === +sec.dataset.n);
    const ta = $(".rascunho", sec), bSol = $(".ver-solucao", sec);
    ta.addEventListener("input", () => {
      try { localStorage.setItem(chaveRascunho(it), ta.value); } catch (e) { /* sem armazenamento: segue sem salvar */ }
      bSol.disabled = ta.value.trim().length < MIN;
    });
    ta.addEventListener("keydown", e => {   // Tab insere espaços, como num editor
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); ta.setRangeText("    ", ta.selectionStart, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); }
    });
    bSol.onclick = () => {
      const s = $(".solucao", sec); s.hidden = !s.hidden;
      bSol.textContent = s.hidden ? "Ver solução" : "Esconder solução";
      if (!s.hidden) desenharFluxogramas(s);
    };
    const bDica = $(".ver-dica", sec);
    if (bDica) bDica.onclick = () => { bDica.nextElementSibling.hidden = false; bDica.setAttribute("aria-expanded", "true"); bDica.hidden = true; };
    $(".marcar-feita", sec).onchange = e => { e.target.checked ? marcar(T.id, A.id, chaveItem(it)) : desmarcar(T.id, A.id, chaveItem(it)); contagem(); };
  });
  contagem();
}

function viewJogo(T, A, etapa, box) {
  const J = etapa, n = J.tamanho, paredes = J.paredes || [];
  const SET = { cima: { i: "⬆️", d: [0, -1] }, direita: { i: "➡️", d: [1, 0] }, baixo: { i: "⬇️", d: [0, 1] }, esquerda: { i: "⬅️", d: [-1, 0] } };
  const parede = (x, y) => paredes.some(p => p[0] === x && p[1] === y);
  let seq = [], rodando = false;
  let cels = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ehP = parede(x, y), ehE = J.estrela[0] === x && J.estrela[1] === y;
    cels += `<div class="cel ${ehP ? "parede" : ""}">${ehP ? "🪨" : ehE ? "⭐" : ""}</div>`;
  }
  box.innerHTML = `<p class="leitura" style="margin-top:14px">${fmt(J.missao)}</p>
    <div class="jogo">
      <div class="grade" style="grid-template-columns:repeat(${n},1fr);grid-template-rows:repeat(${n},1fr)" aria-label="Tabuleiro do jogo">${cels}
        <div class="robo" id="robo" style="width:${100 / n}%;height:${100 / n}%">${mascote()}</div></div>
      <div class="controles">
        <h3>Comandos</h3>
        <div class="paleta">${Object.entries(SET).map(([k, v]) => `<button data-c="${k}" aria-label="Andar para ${k}">${v.i}</button>`).join("")}</div>
        <h3 style="margin-top:18px">Seu algoritmo</h3>
        <div class="sequencia" id="seq"></div>
        <div class="acoes-jogo"><button class="btn sol" id="rodar">▶ Executar</button><button class="btn ghost" id="limpar">Apagar tudo</button></div>
        <p class="jogo-msg" id="msg" role="status"></p>
      </div></div>`;
  const robo = $("#robo"), seqEl = $("#seq"), msg = $("#msg");
  const pos = (x, y) => robo.style.transform = `translate(${x * 100}%,${y * 100}%)`;
  const humor = h => robo.innerHTML = mascote(h);
  const desenhaSeq = () => {
    seqEl.innerHTML = seq.length ? seq.map((c, k) => `<button data-k="${k}" aria-label="Remover comando ${k + 1}" title="Clique para remover">${SET[c].i}</button>`).join("")
      : `<span class="vazio">Clique nas setas para montar o caminho do Bit.</span>`;
    $$("button", seqEl).forEach(b => b.onclick = () => { if (!rodando) { seq.splice(+b.dataset.k, 1); desenhaSeq(); } });
  };
  const trava = v => { rodando = v; $$(".paleta button, #rodar, #limpar", box).forEach(b => b.disabled = v); };
  $$(".paleta button", box).forEach(b => b.onclick = () => {
    if (seq.length >= 20) { msg.className = "jogo-msg err"; msg.textContent = "Máximo de 20 comandos."; return; }
    seq.push(b.dataset.c); desenhaSeq(); msg.textContent = "";
  });
  $("#limpar").onclick = () => { seq = []; desenhaSeq(); pos(...J.inicio); humor("feliz"); msg.textContent = ""; };
  $("#rodar").onclick = async () => {
    if (!seq.length) { msg.className = "jogo-msg err"; msg.textContent = "Coloque pelo menos um comando."; return; }
    trava(true); humor("feliz"); robo.classList.remove("bateu");
    let [x, y] = J.inicio; pos(x, y); msg.className = "jogo-msg"; msg.textContent = "Rodando...";
    const vel = poucoMovimento ? 120 : 420;
    await sleep(250);
    const chips = $$("button", seqEl);
    for (let k = 0; k < seq.length; k++) {
      chips.forEach((c, j) => c.classList.toggle("rodando", j === k));
      const [dx, dy] = SET[seq[k]].d, nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || parede(nx, ny)) {
        robo.classList.add("bateu"); humor("triste");
        msg.className = "jogo-msg err";
        msg.textContent = `Ops! No comando ${k + 1} o Bit bateu ${parede(nx, ny) ? "numa pedra" : "na borda"}. Mude a ordem e tente de novo.`;
        trava(false); return;
      }
      x = nx; y = ny; pos(x, y); await sleep(vel);
    }
    chips.forEach(c => c.classList.remove("rodando"));
    if (x === J.estrela[0] && y === J.estrela[1]) {
      humor("uau"); msg.className = "jogo-msg ok";
      msg.textContent = `Uhuul! O Bit chegou na estrela com ${seq.length} comandos! 🎉`;
      marcar(T.id, A.id, etapa.id); atualizarRail(T, A, etapa.id);
    } else {
      humor("triste"); msg.className = "jogo-msg err";
      msg.textContent = "Quase! O Bit parou antes da estrela. Adicione mais comandos.";
    }
    trava(false);
  };
  pos(...J.inicio); desenhaSeq();
}

function viewProgresso() {
  const ts = trilhasVisiveis();
  $("#view").innerHTML = `<div class="saudacao" style="margin-bottom:24px"><h1>Meu progresso</h1><p class="muted">Atividades concluídas e resultados dos quizzes.</p></div>
    ${ts.length ? "" : `<p class="muted">Ainda não há aulas por aqui. Elas aparecem assim que forem publicadas.</p>`}
    ${ts.map(T => `<section class="prog-trilha">
      <header><h2 style="font-size:1.15rem">${esc(T.titulo)}</h2><strong>${pct(T)}%</strong></header>
      <div class="barra" style="margin-bottom:10px"><i style="width:${pct(T)}%"></i></div>
      <div class="tab-wrap"><table class="tabela"><thead><tr><th>${ehKids(T) ? "Fase" : "Aula"}</th><th>Etapas</th><th>Quizzes</th></tr></thead><tbody>
      ${T.aulas.map(A => {
        const es = etapasDe(A);
        const quizzes = es.filter(e => e.tipo === "quiz").map(e => { const q = P.quiz[`${T.id}/${A.id}/${e.id}`];
          return `<div>${esc(e.nome)}: ${q ? `<strong>${q.acertos}/${q.total}</strong>` : "<span class='muted'>não feito</span>"}</div>`; }).join("");
        return `<tr><td><a href="${link(T.id, A.id, es[0].id)}">${esc(A.titulo)}</a></td>
          <td>${es.filter(e => feito(T.id, A.id, e.id)).length} de ${es.length}</td>
          <td>${quizzes || "<span class='muted'>—</span>"}</td></tr>`; }).join("")}
      </tbody></table></div></section>`).join("")}
    ${ts.length ? `<button class="btn ghost" id="zerar">Zerar meu progresso</button>` : ""}`;
  const z = $("#zerar");
  if (z) z.onclick = () => { if (confirm("Apagar todo o seu progresso? Essa ação não pode ser desfeita.")) zerarProgresso(); };
}

/* ============================================================
   BUSCA
   ============================================================ */
const textos = v => typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(textos) : v && typeof v === "object" ? Object.values(v).flatMap(textos) : [];
const inBusca = $("#busca"), res = $("#resultados");
inBusca.addEventListener("input", () => {
  const q = semAcento(inBusca.value.trim());
  if (!q) { res.classList.remove("aberto"); return; }
  const achados = [];
  trilhasVisiveis().forEach(T => T.aulas.forEach(A => {
    const alvo = semAcento([A.titulo, ...etapasDe(A).map(e => e.nome), ...etapasDe(A).filter(e => ["leitura", "conversa", "codigo"].includes(e.tipo))
      .flatMap(e => textos(e.blocos || e.falas || (e.linhas || []).map(l => l.explica)))].join(" "));
    if (alvo.includes(q)) achados.push({ T, A });
  }));
  res.innerHTML = achados.length ? achados.slice(0, 8).map(({ T, A }) => `<a href="${link(T.id, A.id, etapasDe(A)[0].id)}">${esc(A.titulo)}<small>${esc(T.titulo)}</small></a>`).join("")
    : `<a aria-disabled="true">Nenhuma aula encontrada<small>Tente outra palavra, como "variável" ou "if".</small></a>`;
  res.classList.add("aberto");
});
res.addEventListener("click", () => { res.classList.remove("aberto"); inBusca.value = ""; });
inBusca.addEventListener("keydown", e => { if (e.key === "Escape") { res.classList.remove("aberto"); inBusca.blur(); } if (e.key === "ArrowDown") { const a = $("a", res); if (a) { e.preventDefault(); a.focus(); } } });
document.addEventListener("click", e => { if (!e.target.closest(".busca")) res.classList.remove("aberto"); });

/* ============================================================
   INÍCIO
   ============================================================ */
(async function iniciar() {
  try {
    await carregarConteudo();
  } catch (e) {
    console.error(e);
    $("#carregando").innerHTML = `<div class="falha"><h2>Não foi possível carregar as aulas</h2>
      <p>Se você está testando no computador, abra o site por um servidor (Live Server ou <code>python -m http.server</code>), e não clicando direto no arquivo.</p></div>`;
    return;
  }

  const { data: { session } } = await db.auth.getSession();

  if (emRecuperacao && session) { history.replaceState(null, "", urlDoSite); mostrarLogin("novaSenha"); return; }
  if (session) { await abrirSessao(session.user); return; }

  if (hashDeAuth()) history.replaceState(null, "", urlDoSite);
  mostrarLogin();
  if (erroDoLink) {
    aviso("#avisoGeral", erroDoLink === "otp_expired"
      ? "Esse link expirou ou já foi usado. Entre com sua senha ou peça um novo link em \"Esqueci minha senha\"."
      : "Não foi possível usar esse link. Tente entrar com sua senha.");
  }
})();
