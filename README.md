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

## Colocar no ar com GitHub Pages

1. **Confirme o nome do arquivo principal**: `index.html`, em minúsculas — já está assim nesta pasta.
2. **Crie o repositório no GitHub**: botão *New* → dê um nome (ex: `minha-biblioteca-kindle`) → mantenha **Public** → *Create repository*.
3. **Suba os arquivos**: na tela do repositório, clique em *uploading an existing file*, arraste **a pasta inteira** (`index.html`, `css/`, `js/`) e clique em *Commit changes*.
4. **Ative o GitHub Pages**: aba *Settings* → *Pages* (menu lateral) → em *Build and deployment → Branch*, troque `None` por `main` → *Save*.
5. Espere 1–2 minutos e recarregue. Vai aparecer um link `https://seu-usuario.github.io/minha-biblioteca-kindle` — é a sua estante ao vivo.

### Teste rápido sem GitHub (opcional)

Arraste esta mesma pasta no [Netlify Drop](https://app.netlify.com/drop) para gerar um link de teste na hora.

## Importante sobre os dados

Como não há servidor, os livros e anotações ficam **só no navegador** onde você
usou o app — não sincronizam entre aparelhos diferentes. Use "Exportar biblioteca",
nas Configurações do app, para gerar um backup em `.json` sempre que quiser.

## Ideias guardadas para o futuro

- Sincronização real entre aparelhos (via Supabase ou Firebase)
- Transformar em PWA instalável / app nativo (Capacitor)
- Gamificação estilo "pet virtual" que evolui conforme os livros lidos
