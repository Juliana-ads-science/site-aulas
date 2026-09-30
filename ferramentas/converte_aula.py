"""Converte uma aula em Markdown (formato novo da professora) para o JSON do site, sem reescrever o texto.

Uso (na pasta do projeto):
    python3 ferramentas/converte_aula.py _materiais/python/aula-13-interface-grafica-streamlit-ii.md python

- Gera conteudo/<trilha>/aula-NN.json (NN vem do nome do arquivo .md).
- Coloca "aula-NN" na trilha, em ordem numérica, no conteudo/indice.json.
- Confere se cada linha do .md chegou ao JSON e avisa o que faltou.
- Deixa de fora só as "Observações para os slides" (regra do projeto).

Seções reconhecidas pelo título ("## N. Título"):
    "Código explicado..."  → um código comentado por exemplo ("### Exemplo X"), com as tabelas "Linha | O que acontece"
    "Quiz..."              → quiz (Resposta · Dica · Acerto · Erro · Explicação)
    "Atividades"           → enunciados por nível ("**Nível fácil**" + lista numerada)
    "Gabarito"             → soluções, liberadas só em "Ver solução"
    qualquer outra         → leitura
"""
import json, re, sys, unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
AVISO_ATIVIDADES = ("Escreva ou cole a sua tentativa no campo de cada atividade para liberar a solução. "
                    "Outras soluções também valem, desde que passem nos testes do enunciado.")


def slug(t):
    t = unicodedata.normalize("NFD", t.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40]


def sem_crases(t):
    return t.replace("`", "")


def celulas(ln):
    return [c.strip() for c in ln.strip().strip("|").split("|")]


def sem_notas_de_slide(linhas):
    """Remove notas internas que não vão para o site: '**Observações/Observação para os
    slides:**' ou '**Observação sobre o slide:**' (e a lista ou o texto que vem logo depois)
    e a seção '### Outras correções do material original' (e a lista que vem depois)."""
    out, pulando, fence = [], False, False
    for ln in linhas:
        s = ln.strip()
        if s.startswith("```"):
            fence = not fence
        if not fence and (re.match(r"^\*\*Observaç(ões|ão) (para|sobre) (os |o )?slides?", s, re.I)
                           or re.match(r"^###\s+Outras correções do material original", s, re.I)):
            pulando = True
            continue
        if pulando:
            if s == "" or s.startswith("- "):
                continue
            pulando = False
        out.append(ln)
    return out


def blocos(linhas):
    """Markdown → blocos do site: parágrafo, {h}, {lista}, {passos}, {codigo}, {tabela}."""
    out, i, par = [], 0, []

    def fecha_par():
        if par:
            out.append(" ".join(par))
            par.clear()

    while i < len(linhas):
        s = linhas[i].strip()
        if s.startswith("```"):
            fecha_par()
            cod, i = [], i + 1
            while not linhas[i].strip().startswith("```"):
                cod.append(linhas[i])
                i += 1
            out.append({"codigo": "\n".join(cod)})
            i += 1
            continue
        if s.startswith("### "):
            fecha_par(); out.append({"h": s[4:].strip()}); i += 1; continue
        if s.startswith("|"):
            fecha_par(); tab = []
            while i < len(linhas) and linhas[i].strip().startswith("|"):
                if not re.match(r"^\|[\s\-:|]+\|$", linhas[i].strip()):
                    tab.append(celulas(linhas[i]))
                i += 1
            out.append({"tabela": tab}); continue
        if s.startswith("- "):
            fecha_par(); itens = []
            while i < len(linhas) and linhas[i].strip().startswith("- "):
                itens.append(linhas[i].strip()[2:]); i += 1
            out.append({"lista": itens}); continue
        if re.match(r"^\d+\.\s", s):
            fecha_par(); itens = []
            while i < len(linhas) and re.match(r"^\d+\.\s", linhas[i].strip()):
                itens.append(re.sub(r"^\d+\.\s+", "", linhas[i].strip())); i += 1
            out.append({"passos": itens}); continue
        if s == "":
            fecha_par()
        else:
            par.append(s)
        i += 1
    fecha_par()
    return out


def exemplos(linhas):
    """'### Exemplo X — ...' + bloco de código + tabela 'Linha | O que acontece' → código comentado por faixas."""
    ex, cur = [], None
    for ln in linhas:
        m = re.match(r"^###\s+(.*)$", ln)
        if m:
            cur = {"titulo": m.group(1).strip(), "linhas": []}; ex.append(cur)
        elif cur is not None:
            cur["linhas"].append(ln)
    etapas = []
    for k, e in enumerate(ex):
        ls, i, codigo, explic, resto = e["linhas"], 0, None, [], []
        while i < len(ls):
            s = ls[i].strip()
            if codigo is None and s.startswith("```"):
                codigo, i = [], i + 1
                while not ls[i].strip().startswith("```"):
                    codigo.append(ls[i]); i += 1
                i += 1; continue
            if s.startswith("|"):
                while i < len(ls) and ls[i].strip().startswith("|"):
                    c = celulas(ls[i])
                    if re.match(r"^\d+(\s*[–-]\s*\d+)?$", c[0]):
                        a, _, b = re.sub(r"\s", "", c[0]).replace("-", "–").partition("–")
                        explic.append({"linhas": [int(a), int(b or a)], "texto": c[-1]})
                    i += 1
                continue
            resto.append(ls[i]); i += 1
        fora = [x["linhas"] for x in explic if not (1 <= x["linhas"][0] <= x["linhas"][1] <= len(codigo or []))]
        if fora:
            sys.exit(f"{e['titulo']}: a tabela cita linhas que não existem no código ({len(codigo or [])} linhas): {fora}")
        m = re.match(r"^Exemplo\s+([A-Z0-9]+)", e["titulo"])
        etapa = {"id": f"exemplo-{m.group(1).lower()}" if m else f"exemplo-{k + 1}", "tipo": "codigo",
                 "nome": sem_crases(e["titulo"]), "codigo": codigo or [], "explicacoes": explic}
        fim = blocos(resto)
        if fim:
            etapa["fechamento"] = fim
        etapas.append(etapa)
    return etapas


def quiz(titulo, linhas):
    perguntas = []
    for bloco in re.split(r"\n(?=\*\*Q\d+\.)", "\n".join(linhas).strip()):
        m = re.match(r"^\*\*Q\d+\.\s*(.*?)\*\*\s*\n(.*)$", bloco, re.S)
        if not m:
            continue
        corpo = m.group(2)
        cm = re.search(r"```[^\n]*\n(.*?)\n```", corpo, re.S)
        opcoes = re.findall(r"^([A-E])\)\s*(.*)$", corpo, re.M)
        rm = re.search(r'^Resposta:\s*([A-E])\s*·\s*Dica:\s*(.*?)\s*·\s*Acerto:\s*"(.*?)"\s*·\s*Erro:\s*"(.*?)"\s*·\s*Explicação:\s*(.*)$', corpo, re.M)
        if not rm:
            sys.exit(f"Quiz: não achei 'Resposta · Dica · Acerto · Erro · Explicação' na pergunta: {m.group(1)[:60]}")
        d = {"pergunta": m.group(1).strip()}
        if cm:
            d["codigo"] = cm.group(1)
        d.update({"opcoes": [o[1].strip() for o in opcoes], "correta": "ABCDE".index(rm.group(1)),
                  "dica": rm.group(2).strip(), "acerto": rm.group(3), "erro": rm.group(4),
                  "explicacao": rm.group(5).strip()})
        perguntas.append(d)
    return {"id": "quiz", "tipo": "quiz", "nome": sem_crases(titulo), "perguntas": perguntas}


def enunciados(linhas):
    """Cada item começa em 'N. texto' e pode ter linhas depois (ex.: um bloco de código de
    apoio), até o próximo item, o próximo nível ou o fim da seção. O texto antes do primeiro
    item (ex.: uma instrução geral para todas as atividades) vira o intro da etapa."""
    intro, nivel, out, cur, fence = [], None, {}, None, False
    for ln in linhas:
        s = ln.strip()
        if s.startswith("```"):
            fence = not fence
            (out[cur][1] if cur is not None else intro).append(ln); continue
        if not fence:
            m = re.match(r"^\*\*Nível\s+(.*?)\*\*$", s)
            if m:
                nivel, cur = m.group(1).strip().capitalize(), None; continue
            m = re.match(r"^(\d+)\.\s+(.*)$", s)
            if m:
                cur = int(m.group(1)); out[cur] = (nivel, [m.group(2)]); continue
        (out[cur][1] if cur is not None else intro).append(ln)
    return intro, out


def gabarito(linhas, numeros):
    """Marcador de cada solução: '1.' (sozinho na linha, formato antigo) ou '**1.**' /
    '**9. Resposta esperada:** texto...' (negrito, com rótulo opcional na mesma linha)."""
    intro, itens, cur, i = [], {}, None, 0
    while i < len(linhas):
        s = linhas[i].strip()
        if s.startswith("```"):   # bloco de código inteiro (pode ter "1." dentro)
            bloco, i = [linhas[i]], i + 1
            while not linhas[i].strip().startswith("```"):
                bloco.append(linhas[i]); i += 1
            bloco.append(linhas[i]); i += 1
            (itens[cur] if cur else intro).extend(bloco); continue
        m = re.match(r"^\*\*(\d+)\.\s*(.*?)\*\*\s*(.*)$", s) or re.match(r"^(\d+)\.\s*(.*)$", s)
        if m and int(m.group(1)) in numeros:
            cur = int(m.group(1))
            resto = f"{m.group(2)} {m.group(3)}".strip() if m.lastindex == 3 else m.group(2)
            itens[cur] = [resto] if resto else []
            i += 1; continue
        (itens[cur] if cur else intro).append(linhas[i]); i += 1
    return blocos(intro), itens


def converter(md_path):
    L = md_path.read_text(encoding="utf-8").split("\n")
    titulo = re.sub(r"^#\s*.*?Aula\s*\d+\s*—\s*", "", L[0]).strip()
    secoes, atual = [], None
    for ln in L[1:]:
        m = re.match(r"^##\s+\d+\.\s+(.*)$", ln)
        if m:
            atual = {"titulo": m.group(1).strip(), "linhas": []}; secoes.append(atual)
        elif atual is not None:
            atual["linhas"].append(ln)

    etapas, atv_titulo, atv_intro, enun, gab = [], "Atividades", [], {}, None
    for sec in secoes:
        t, linhas = sec["titulo"], sem_notas_de_slide(sec["linhas"])
        if re.match(r"^Código explicado", t, re.I):
            etapas += exemplos(linhas)
        elif re.match(r"^Quiz", t, re.I):
            etapas.append(quiz(t, linhas))
        elif re.match(r"^Atividades", t, re.I):
            atv_titulo, (atv_intro, enun) = t, enunciados(linhas)
        elif re.match(r"^Gabarito", t, re.I):
            gab = linhas
        else:
            etapas.append({"id": slug(t.split(":")[0]), "tipo": "leitura", "nome": sem_crases(t), "blocos": blocos(linhas)})

    if enun:
        intro, sol = gabarito(gab or [], set(enun))
        faltam = [n for n in enun if n not in sol]
        if faltam:
            sys.exit(f"Gabarito: não achei a solução das atividades {faltam}")
        etapas.append({"id": "atividades", "tipo": "atividades", "nome": sem_crases(atv_titulo),
                       "intro": blocos(atv_intro) + intro + [AVISO_ATIVIDADES],
                       "itens": [{"n": n, "nivel": enun[n][0], "enunciado": blocos(enun[n][1]), "solucao": blocos(sol[n])}
                                 for n in sorted(enun)]})
    return titulo, etapas


def textos(v):
    if isinstance(v, str): return [v]
    if isinstance(v, list): return [t for x in v for t in textos(x)]
    if isinstance(v, dict): return [t for x in v.values() for t in textos(x)]
    return []


def conferir(md_path, aula):
    """Cada linha de texto do .md (fora as notas internas) precisa aparecer no JSON."""
    tudo = "\n".join(textos(aula))
    faltando, fence, pulando, comecou = [], False, False, False
    ignorar = {"fácil", "médio", "difícil", "linha", "o que acontece"}
    for n, ln in enumerate(md_path.read_text(encoding="utf-8").split("\n")[1:], 2):
        s = ln.rstrip()
        if not comecou:   # título e qualquer nota solta antes da 1ª seção não viram JSON
            if re.match(r"^##\s+\d+\.", s.strip()):
                comecou = True
            else:
                continue
        if s.strip().startswith("```"):
            fence = not fence; continue
        if not fence:   # mesmas notas internas que o conversor deixa de fora
            if (re.match(r"^\*\*Observaç(ões|ão) (para|sobre) (os |o )?slides?", s.strip(), re.I)
                    or re.match(r"^###\s+Outras correções do material original", s.strip(), re.I)):
                pulando = True; continue
            if pulando and (not s.strip() or s.strip().startswith("- ")):
                continue
            pulando = False
            mg = re.match(r"^\*\*(\d+)\.\s*(.*?)\*\*\s*(.*)$", s.strip())   # gabarito: "**1.**" / "**9. Rótulo:** texto"
            if mg:
                s = f"{mg.group(2)} {mg.group(3)}".strip()
        if fence:
            pedacos = [s]
        else:
            st = s.strip()
            if (not st or re.match(r"^\|[\s\-:|]+\|$", st) or re.match(r"^##\s+\d+\.", st)
                    or re.match(r"^\d+\.$", st)):          # "4." sozinho só numera a solução do gabarito
                continue
            if st.startswith("Resposta:"):
                pedacos = [re.sub(r'^(Resposta:\s*[A-E]|Dica:|Acerto:|Erro:|Explicação:)\s*', "", x).strip().strip('"')
                           for x in st.split(" · ")]
            else:
                pedacos = celulas(st) if st.startswith("|") else [st]
                pedacos = [re.sub(r"^(#+\s*|\d+\.\s+|- |[A-E]\)\s*|\*\*Q\d+\.\s*|\*\*Nível\s+)", "", p) for p in pedacos]
                pedacos = [p.strip() for p in pedacos]
                pedacos = [p[2:-2].strip() if p.startswith("**") and p.endswith("**") else p for p in pedacos]
                pedacos = [p[:-2].strip() if p.endswith("**") and "**" not in p[:-2] else p for p in pedacos]
        for p in pedacos:
            if not p or p.lower().strip(":*") in ignorar:
                continue
            if not fence and re.match(r"^\d+(\s*[–-]\s*\d+)?$", p):   # nº de linha da tabela → vira faixa numérica
                continue
            if p not in tudo and sem_crases(p) not in tudo:
                faltando.append((n, p))
    return faltando


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    md_path, trilha = Path(sys.argv[1]), sys.argv[2]
    m = re.search(r"aula-(\d+)", md_path.name)
    if not m:
        sys.exit("O nome do arquivo precisa ter 'aula-NN', ex.: aula-13-streamlit-ii.md")
    numero, aula_id = int(m.group(1)), f"aula-{int(m.group(1)):02d}"

    titulo, etapas = converter(md_path)
    aula = {"numero": numero, "titulo": titulo, "etapas": etapas}

    indice_path = RAIZ / "conteudo" / "indice.json"
    indice = json.loads(indice_path.read_text(encoding="utf-8"))
    T = next((t for t in indice["trilhas"] if t["id"] == trilha), None)
    if T is None:
        sys.exit(f"Trilha '{trilha}' não existe no indice.json. Trilhas: {[t['id'] for t in indice['trilhas']]}")

    destino = RAIZ / "conteudo" / T["pasta"] / f"{aula_id}.json"
    destino.write_text(json.dumps(aula, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if aula_id not in T["aulas"]:
        T["aulas"] = sorted(T["aulas"] + [aula_id], key=lambda a: int(re.search(r"\d+", a).group()))
        indice_path.write_text(json.dumps(indice, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"{destino.relative_to(RAIZ)}: \"{titulo}\", {len(etapas)} etapas")
    for e in etapas:
        extra = {"quiz": lambda: f"{len(e['perguntas'])} perguntas",
                 "atividades": lambda: f"{len(e['itens'])} atividades",
                 "codigo": lambda: f"{len(e['explicacoes'])} explicações"}.get(e["tipo"], lambda: "")()
        print(f"  - {e['tipo']:<10} {e['nome']}" + (f" ({extra})" if extra else ""))
    print(f"Trilha '{trilha}': {', '.join(T['aulas'])}")

    faltando = conferir(md_path, aula)
    if faltando:
        print(f"\nATENÇÃO: {len(faltando)} trecho(s) do .md não chegaram ao JSON:")
        for n, p in faltando:
            print(f"  linha {n}: {p[:100]}")
        sys.exit(1)
    print("Conferência: todo o texto do .md está no JSON (fora as notas de slide).")


if __name__ == "__main__":
    main()
