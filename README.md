# Estante — leitor de ebooks (PDF, TXT, EPUB)

App de leitura no estilo Kindle, feito em HTML + CSS + JavaScript puro no front-end,
com **Supabase** cuidando do backend: autenticação por e-mail/senha, banco de dados
(Postgres) para livros/destaques/notas/estatísticas, e Storage para os arquivos PDF.
Isso significa que sua estante sincroniza sozinha entre qualquer aparelho — basta
entrar com o mesmo e-mail.

## Estrutura do projeto

```
estante-app/
├── index.html      → estrutura da página (tem que se chamar exatamente index.html)
├── css/
│   └── style.css   → todo o visual do app
└── js/
    └── app.js      → toda a lógica (login, leitura, destaques, notas, stats...)
```

## Configurar o Supabase (login real + sincronização na nuvem)

### 1. Criar o projeto
1. Crie uma conta grátis em [supabase.com](https://supabase.com) e clique em **New project**.
2. Anote a senha do banco que você definir (só é usada internamente).
3. Espere o projeto terminar de provisionar (1–2 minutos).

### 2. Pegar suas chaves
Em **Settings → API**, copie:
- **Project URL**
- **anon public key**

Cole os dois valores em `js/app.js`, logo no topo:
```js
const SUPABASE_URL = 'COLOQUE_AQUI_A_PROJECT_URL';
const SUPABASE_ANON_KEY = 'COLOQUE_AQUI_A_ANON_PUBLIC_KEY';
```
(A chave `anon` é pública por natureza — protegida pelas regras de RLS abaixo, não tem problema ela ficar visível no código do navegador.)

### 3. Criar a tabela de dados
Em **SQL Editor**, rode:
```sql
create table public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.user_data enable row level security;

create policy "select_own" on public.user_data for select using (auth.uid() = user_id);
create policy "insert_own" on public.user_data for insert with check (auth.uid() = user_id);
create policy "update_own" on public.user_data for update using (auth.uid() = user_id);
create policy "delete_own" on public.user_data for delete using (auth.uid() = user_id);
```

### 4. Criar o bucket para os PDFs
Em **Storage**, crie um bucket chamado exatamente `livros`, marcado como **privado** (não público).
Depois, em **SQL Editor**, rode as políticas de acesso:
```sql
create policy "ler_proprios_arquivos" on storage.objects for select
  using (bucket_id = 'livros' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "enviar_proprios_arquivos" on storage.objects for insert
  with check (bucket_id = 'livros' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "apagar_proprios_arquivos" on storage.objects for delete
  using (bucket_id = 'livros' and (storage.foldername(name))[1] = auth.uid()::text);
```

### 5. (Opcional) Login sem confirmação de e-mail
Por padrão o Supabase exige confirmar o e-mail antes do primeiro login. Para testar mais rápido,
vá em **Authentication → Providers → Email** e desative "Confirm email" (pode reativar depois,
em produção, se quiser mais segurança).

### 6. Subir as mudanças no GitHub
Suba os arquivos atualizados (`index.html` e `js/app.js`) do mesmo jeito que da primeira vez
(commit direto pela interface do GitHub). Espere o GitHub Pages atualizar (1–2 min) e teste
criando uma conta pelo link publicado — agora dá pra abrir em outro aparelho e entrar com o
mesmo e-mail para ver os mesmos livros.

## Colocar no ar com GitHub Pages

1. **Confirme o nome do arquivo principal**: `index.html`, em minúsculas — já está assim nesta pasta.
2. **Crie o repositório no GitHub**: botão *New* → dê um nome (ex: `minha-biblioteca-kindle`) → mantenha **Public** → *Create repository*.
3. **Suba os arquivos**: na tela do repositório, clique em *uploading an existing file*, arraste **a pasta inteira** (`index.html`, `css/`, `js/`) e clique em *Commit changes*.
4. **Ative o GitHub Pages**: aba *Settings* → *Pages* (menu lateral) → em *Build and deployment → Branch*, troque `None` por `main` → *Save*.
5. Espere 1–2 minutos e recarregue. Vai aparecer um link `https://seu-usuario.github.io/minha-biblioteca-kindle` — é a sua estante ao vivo.

### Teste rápido sem GitHub (opcional)

Arraste esta mesma pasta no [Netlify Drop](https://app.netlify.com/drop) para gerar um link de teste na hora.

## Importante sobre os dados

Seus livros, destaques, notas e progresso ficam salvos na nuvem (Supabase), então
sincronizam automaticamente entre qualquer aparelho — basta entrar com o mesmo
e-mail. Ainda assim, vale usar "Exportar biblioteca", nas Configurações do app,
de vez em quando para ter um backup local em `.json` por segurança.

## Ideias guardadas para o futuro

- Transformar em PWA instalável / app nativo (Capacitor)
- Gamificação estilo "pet virtual" que evolui conforme os livros lidos
