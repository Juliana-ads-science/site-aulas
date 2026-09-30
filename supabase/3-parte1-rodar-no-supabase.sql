-- ============================================================
-- Linha a Linha: cadastro sem código da turma
-- Para um banco que já rodou a versão antiga do 1-configuracao.sql.
-- Cole a PARTE 1 inteira no SQL Editor do Supabase e clique em "Run".
-- Nenhuma tabela é apagada: turmas, perfis e progresso continuam iguais.
-- ============================================================


-- ---------- PARTE 1: tirar a exigência do código ----------

-- Nova versão do gatilho: cria o perfil do aluno sem pedir código de turma.
-- Continua cuidando das contas kids e bloqueando o domínio reservado delas.
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

-- Liga de novo o gatilho à função (garante que ele existe e aponta para a versão nova).
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function privado.ao_criar_usuario();

-- Remove a conferência de código que o site chamava antes do cadastro (o site não usa mais).
drop function if exists public.codigo_turma_valido(text);

