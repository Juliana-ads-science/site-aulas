-- ============================================================
-- Linha a Linha: comandos do dia a dia da professora
-- Use no SQL Editor do Supabase. Rode UM bloco por vez:
-- selecione só as linhas do bloco e clique em "Run".
-- ============================================================


-- ---------- Criar uma turma de adultos (o código é o que você passa aos alunos) ----------
insert into public.turmas (nome, codigo, publico)
values ('Lógica – Turma 1', 'LOGICA-2026-A7K', 'adulto');


-- ---------- Criar uma turma kids (sem código de cadastro: você cria as contas) ----------
insert into public.turmas (nome, codigo, publico)
values ('Kids – Turma 1', 'KIDS-1-USO-INTERNO', 'kids');


-- ---------- Ver todas as turmas ----------
select id, nome, codigo, publico, ativa, criada_em from public.turmas order by id;


-- ---------- Trocar o código de uma turma (o código antigo para de funcionar na hora) ----------
update public.turmas set codigo = 'LOGICA-2026-NOVO' where nome = 'Lógica – Turma 1';


-- ---------- Fechar as inscrições de uma turma ----------
update public.turmas set ativa = false where nome = 'Lógica – Turma 1';
-- para reabrir: troque false por true


-- ---------- Criar conta kids (apelido, senha, nome da turma kids) ----------
-- Use um apelido, NUNCA o nome completo da criança (LGPD).
select privado.criar_conta_kids('estrela.azul', 'bit123', 'Kids – Turma 1');


-- ---------- Trocar a senha de uma criança ----------
update auth.users
set encrypted_password = extensions.crypt('nova-senha', extensions.gen_salt('bf')), updated_at = now()
where email = 'estrela.azul@kids.linhaalinha.com.br';


-- ---------- Ver os alunos de cada turma ----------
select t.nome as turma, p.nome as aluno, p.perfil,
       replace(u.email, '@kids.linhaalinha.com.br', ' (kids)') as login,
       p.criado_em::date as desde, u.last_sign_in_at::date as ultimo_acesso
from public.perfis p
join auth.users u on u.id = p.id
left join public.turmas t on t.id = p.turma_id
order by t.nome, p.nome;


-- ---------- Ver o progresso de todos os alunos ----------
select t.nome as turma, p.nome as aluno,
       count(*) filter (where pr.etapa not like '%:%') as etapas_concluidas,
       string_agg(pr.aula || ' ' || pr.etapa || ': ' || pr.acertos || '/' || pr.total, ', ' order by pr.aula, pr.etapa)
         filter (where pr.acertos is not null) as notas_quiz,
       max(pr.concluido_em)::date as ultima_atividade
from public.perfis p
left join public.turmas t on t.id = p.turma_id
left join public.progresso pr on pr.aluno_id = p.id
group by t.nome, p.nome
order by t.nome, p.nome;


-- ---------- Apagar a conta de um aluno (apaga também o progresso) ----------
-- delete from auth.users where email = 'email@do.aluno';
