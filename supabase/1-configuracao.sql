-- ============================================================
-- Linha a Linha: configuração do banco no Supabase
-- Cole TUDO no SQL Editor do Supabase e clique em "Run".
-- Pode rodar de novo sem problema: nada é apagado.
-- ============================================================

-- ---------- 1. Turmas (organizam os alunos; o cadastro pelo site não pede código) ----------
create table if not exists public.turmas (
  id         bigint generated always as identity primary key,
  nome       text not null,
  codigo     text not null unique,
  publico    text not null default 'adulto' check (publico in ('adulto', 'kids')),
  ativa      boolean not null default true,
  criada_em  timestamptz not null default now()
);

-- ---------- 2. Perfil de cada aluno ----------
create table if not exists public.perfis (
  id         uuid primary key references auth.users (id) on delete cascade,
  nome       text not null,
  perfil     text not null default 'adulto' check (perfil in ('adulto', 'kids')),
  turma_id   bigint references public.turmas (id) on delete set null,
  ultima     text,               -- última atividade aberta ("trilha/aula/etapa")
  criado_em  timestamptz not null default now()
);

-- ---------- 3. Progresso: uma linha por etapa concluída ----------
create table if not exists public.progresso (
  aluno_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  trilha        text not null,
  aula          text not null,
  etapa         text not null,     -- conteudo, codigo, quiz, jogo...
  acertos       int,               -- só no quiz
  total         int,               -- só no quiz
  concluido_em  timestamptz not null default now(),
  primary key (aluno_id, trilha, aula, etapa)
);

-- ---------- 4. Segurança (RLS): cada aluno só vê e mexe no que é dele ----------
alter table public.turmas    enable row level security;   -- sem políticas: ninguém lê pelo site
alter table public.perfis    enable row level security;
alter table public.progresso enable row level security;

drop policy if exists "aluno lê o próprio perfil" on public.perfis;
create policy "aluno lê o próprio perfil" on public.perfis
  for select to authenticated using (id = (select auth.uid()));

drop policy if exists "aluno atualiza o próprio perfil" on public.perfis;
create policy "aluno atualiza o próprio perfil" on public.perfis
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- o aluno só pode alterar o nome e a última aula (não pode trocar de turma nem virar "adulto")
revoke update on public.perfis from anon, authenticated;
grant  update (nome, ultima) on public.perfis to authenticated;
revoke insert, delete on public.perfis from anon, authenticated;

drop policy if exists "aluno vê o próprio progresso" on public.progresso;
create policy "aluno vê o próprio progresso" on public.progresso
  for select to authenticated using (aluno_id = (select auth.uid()));

drop policy if exists "aluno registra o próprio progresso" on public.progresso;
create policy "aluno registra o próprio progresso" on public.progresso
  for insert to authenticated with check (aluno_id = (select auth.uid()));

drop policy if exists "aluno atualiza o próprio progresso" on public.progresso;
create policy "aluno atualiza o próprio progresso" on public.progresso
  for update to authenticated using (aluno_id = (select auth.uid())) with check (aluno_id = (select auth.uid()));

drop policy if exists "aluno apaga o próprio progresso" on public.progresso;
create policy "aluno apaga o próprio progresso" on public.progresso
  for delete to authenticated using (aluno_id = (select auth.uid()));

revoke all on public.turmas from anon, authenticated;
revoke all on public.progresso from anon;

-- ---------- 5. Perfil criado automaticamente a cada nova conta ----------
-- Cadastro aberto: qualquer pessoa cria conta com nome, e-mail e senha (sem código de turma).
-- Contas kids criadas pela professora (função privado.criar_conta_kids) recebem o perfil kids.
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create or replace function privado.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'nome', '')), '');
begin
  -- conta kids criada pela professora
  if coalesce(new.raw_app_meta_data ->> 'criado_pela_professora', '') = 'true' then
    insert into public.perfis (id, nome, perfil, turma_id)
    values (new.id,
            coalesce(v_nome, split_part(new.email, '@', 1)),
            'kids',
            nullif(new.raw_app_meta_data ->> 'turma_id', '')::bigint);
    return new;
  end if;

  -- o domínio das contas kids é reservado
  if lower(new.email) like '%@kids.linhaalinha.com.br' then
    raise exception 'DOMINIO_RESERVADO' using errcode = 'P0001';
  end if;

  -- cadastro pelo site: aberto, sem turma
  insert into public.perfis (id, nome, perfil)
  values (new.id, coalesce(v_nome, split_part(new.email, '@', 1)), 'adulto');
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function privado.ao_criar_usuario();

-- ---------- 6. (removido) Conferência do código da turma ----------
-- O cadastro não pede mais código. Apaga a função, se sobrou de uma versão antiga.
drop function if exists public.codigo_turma_valido(text);

-- ---------- 7. Criar conta kids (só a professora, pelo SQL Editor) ----------
-- Uso: select privado.criar_conta_kids('apelido', 'senha', 'Nome da turma kids');
-- O login da criança é só o apelido. Nenhum e-mail real é guardado.
create or replace function privado.criar_conta_kids(p_apelido text, p_senha text, p_turma text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid := gen_random_uuid();
  v_apelido text := lower(trim(p_apelido));
  v_email   text;
  v_turma   bigint;
begin
  if v_apelido !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Apelido inválido: use de 3 a 30 letras sem acento, números, ponto, hífen ou _';
  end if;
  if length(p_senha) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres';
  end if;

  v_email := v_apelido || '@kids.linhaalinha.com.br';
  if exists (select 1 from auth.users where email = v_email) then
    raise exception 'Já existe uma criança com o apelido %', v_apelido;
  end if;

  if p_turma is not null then
    select id into v_turma from public.turmas where nome = p_turma or codigo = p_turma limit 1;
    if v_turma is null then raise exception 'Turma "%" não encontrada', p_turma; end if;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_senha, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                       'criado_pela_professora', true, 'turma_id', v_turma),
    jsonb_build_object('nome', v_apelido),
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  return 'Conta criada! Login: ' || v_apelido;
end;
$$;

revoke all on function privado.criar_conta_kids(text, text, text) from public, anon, authenticated;
