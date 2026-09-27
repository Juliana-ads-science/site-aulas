/* Configuração do Supabase.
   A "publishable key" foi feita para ficar no navegador: ela é pública.
   Quem protege os dados são as regras (RLS) criadas em supabase/1-configuracao.sql.
   NUNCA coloque aqui a "secret key" (sb_secret_...) nem a "service_role". */
window.CONFIG = {
  supabaseUrl: "https://piawsppnqxjexunesbdf.supabase.co",
  supabaseKey: "sb_publishable_gzpSewAivLbKsf7aaDS0hw_R0L-CK9U",

  /* Contas kids entram só com o apelido; o site completa com este domínio.
     Precisa ser igual ao usado em privado.criar_conta_kids (arquivo SQL). */
  dominioKids: "kids.linhaalinha.com.br"
};
