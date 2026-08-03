(function(){
"use strict";

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
}

/* ==================================================================
   SUPABASE — preencha com os dados do SEU projeto (Settings > API)
   ================================================================== */
const SUPABASE_URL = 'https://aohdaegzviyqbwejwwfq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_aXMcNtIdJZGBoRVUkyI74Q_VBevt3cg';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BOOKS_BUCKET = 'livros';

/* ==================================================================
   ENTER CONFIRMA — funciona em qualquer input de uma linha do site que
   tenha o atributo data-enter-submit="id-do-botao". Textareas não entram
   aqui de propósito (Enter neles deve quebrar linha, não confirmar).
   ================================================================== */
document.addEventListener('keydown', e=>{
  if(e.key !== 'Enter') return;
  const el = e.target;
  if(!el || el.tagName === 'TEXTAREA') return;
  const btnId = el.getAttribute('data-enter-submit');
  if(!btnId) return;
  const btn = document.getElementById(btnId);
  if(btn && !btn.disabled){ e.preventDefault(); btn.click(); }
});

const uid = () => 'id' + Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayKey = (d=new Date()) => d.toISOString().slice(0,10);
const escapeHtml = s => (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function loadUserData(){
  const { data, error } = await sb.from('user_data').select('data').eq('user_id', state.userId).maybeSingle();
  if(error){ console.error('Erro ao carregar dados', error); }
  if(data && data.data) return data.data;
  return { books:{}, settings:{ theme:'claro', font:'serif', fontSize:19, lineHeight:1.8, goal:20, shelfName:'MY BOOKSHELF', useCollections:false }, stats:{ totalMinutes:0, dailyLog:{} } };
}
function saveUserData(){
  if(!state.userId) return;
  // fire-and-forget: não precisa de await nos lugares que já chamavam saveUserData()
  sb.from('user_data').upsert({ user_id: state.userId, data: state.data, updated_at: new Date().toISOString() }).then(({error})=>{
    if(error){ console.error('Erro ao salvar no Supabase', error); }
  });
}

const state = {
  userId:null,
  userEmail:null,
  data:null,
  currentBookId:null,
  pdfDoc:null,
  pdfPageNum:1,
  pdfPageCache:{}, // pageNum -> {textContent, viewport}
  pdfFullTextCache:null,
  textPages:null, // array of page strings for txt/epub current chapter
  textPageIndex:0,
  epubChapters:null, // array {title, text}
  epubChapterIndex:0,
  readTimerHandle:null,
  readSecondsThisSession:0,
  sideMode:null,
  highlightMode:false,
};

/* ==================================================================
   LOGIN (Supabase Auth por e-mail/senha)
   ================================================================== */
let isCreating = false;
const elLoginSub = document.getElementById('login-sub');
const elToggle = document.getElementById('login-toggle');
const elToggleWrap = document.getElementById('login-toggle-wrap');
const elPassConfirm = document.getElementById('field-pass-confirm');
const elErr = document.getElementById('login-err');

function refreshLoginMode(){
  if(isCreating){
    elLoginSub.textContent = 'Crie sua conta para acessar sua estante em qualquer aparelho.';
    elPassConfirm.classList.remove('hidden');
    elToggleWrap.innerHTML = 'Já tem uma estante aqui? <a id="login-toggle">Entrar</a>';
    document.getElementById('btn-login').textContent = 'Criar minha estante';
  } else {
    elLoginSub.textContent = 'Sua biblioteca pessoal, sincronizada em qualquer aparelho. Entre com seu e-mail.';
    elPassConfirm.classList.add('hidden');
    elToggleWrap.innerHTML = 'Primeira vez aqui? <a id="login-toggle">Criar minha estante</a>';
    document.getElementById('btn-login').textContent = 'Entrar na estante';
  }
  document.getElementById('login-toggle').addEventListener('click', ()=>{ isCreating = !isCreating; elErr.textContent=''; refreshLoginMode(); });
}
refreshLoginMode();

document.getElementById('btn-login').addEventListener('click', async ()=>{
  const email = document.getElementById('in-user').value.trim().toLowerCase();
  const pass = document.getElementById('in-pass').value;
  elErr.textContent = '';
  if(!email){ elErr.textContent = 'Digite seu e-mail.'; return; }
  if(!pass || pass.length < 6){ elErr.textContent = 'A senha precisa ter pelo menos 6 caracteres.'; return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  try{
    if(isCreating){
      const confirmPass = document.getElementById('in-pass-confirm').value;
      if(pass !== confirmPass){ elErr.textContent = 'As senhas não coincidem.'; return; }
      const { data, error } = await sb.auth.signUp({ email, password: pass });
      if(error){ elErr.textContent = traduzErroAuth(error.message); return; }
      if(data.user && !data.session){
        elErr.textContent = '';
        alert('Conta criada! Verifique seu e-mail para confirmar antes de entrar.');
        isCreating = false; refreshLoginMode();
        return;
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if(error){ elErr.textContent = traduzErroAuth(error.message); return; }
    }
    await afterAuth();
  } finally {
    btn.disabled = false;
  }
});
function traduzErroAuth(msg){
  if(/already registered/i.test(msg)) return 'Esse e-mail já tem uma conta. Tente entrar em vez de criar.';
  if(/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if(/email not confirmed/i.test(msg)) return 'Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).';
  return msg;
}

async function afterAuth(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) return;
  state.userId = user.id;
  state.userEmail = user.email;
  state.data = await loadUserData();
  if(!state.data.settings.shelfName) state.data.settings.shelfName = 'MY BOOKSHELF';
  document.getElementById('screen-login').style.display='none';
  document.getElementById('screen-app').classList.add('active');
  document.getElementById('acc-name').textContent = state.userEmail;
  document.getElementById('in-goal').value = String(state.data.settings.goal || 20);
  document.getElementById('in-use-collections').checked = !!state.data.settings.useCollections;
  renderShelfName();
  renderShelf();
  renderStats();
}

document.getElementById('btn-logout').addEventListener('click', doLogout);
document.getElementById('btn-logout2').addEventListener('click', doLogout);
async function doLogout(){
  stopReadTimer();
  saveUserData();
  await sb.auth.signOut();
  location.reload();
}

// mantém a sessão entre visitas (o Supabase guarda o token sozinho)
(async function autoLogin(){
  const { data:{ session } } = await sb.auth.getSession();
  if(session) await afterAuth();
})();

/* ==================================================================
   NAVEGAÇÃO ENTRE VIEWS
   ================================================================== */
document.querySelectorAll('.rail-btn[data-view]').forEach(b=>{
  b.addEventListener('click', ()=> switchView(b.dataset.view));
});
function switchView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.rail-btn[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  document.getElementById('view-'+name).classList.add('active');
  if(name==='stats') renderStats();
  if(name!=='reader') stopReadTimer();
}

/* ==================================================================
   MODAL HELPER
   ================================================================== */
function openModal(html){
  const root = document.getElementById('modal-root');
  root.innerHTML = '<div class="modal-overlay" id="active-overlay"><div class="modal">'+html+'</div></div>';
  document.getElementById('active-overlay').addEventListener('mousedown', e=>{ if(e.target.id==='active-overlay') closeModal(); });
  return root;
}
function closeModal(){ document.getElementById('modal-root').innerHTML = ''; }

/* ==================================================================
   ESTANTE (SHELF)
   ================================================================== */
const genColors = ['#7a5c3e-#e0a458','#3e5c7a-#5e96e0','#3e7a5c-#5ab578','#7a3e6a-#b278e0','#7a3e3e-#d9707a','#5c3e7a-#8a6ae0'];
function coverGradientFor(title){
  let h=0; for(let i=0;i<title.length;i++) h = (h*31 + title.charCodeAt(i))>>>0;
  const pair = genColors[h % genColors.length].split('-');
  return 'linear-gradient(155deg,'+pair[0]+','+pair[1]+')';
}

function booksArray(){ return Object.values(state.data.books); }

function renderShelf(){
  const wrap = document.getElementById('shelf-wrap');
  const q = (document.getElementById('shelf-search').value||'').toLowerCase();
  const filter = document.getElementById('shelf-filter').value;
  const sort = document.getElementById('shelf-sort').value;
  let list = booksArray().filter(b=>{
    if(q && !(b.title.toLowerCase().includes(q) || (b.author||'').toLowerCase().includes(q))) return false;
    if(filter==='lendo' && b.status!=='lendo') return false;
    if(filter==='concluidos' && b.status!=='concluido') return false;
    if(filter==='naoiniciados' && b.status!=='naoiniciado') return false;
    if(filter==='favoritos' && !b.favorito) return false;
    return true;
  });
  if(sort==='titulo') list.sort((a,b)=>a.title.localeCompare(b.title));
  else if(sort==='progresso') list.sort((a,b)=>(b.progress&&b.progress.percent||0)-(a.progress&&a.progress.percent||0));
  else list.sort((a,b)=>b.addedAt-a.addedAt);

  document.getElementById('shelf-count').textContent = booksArray().length ? ' · '+booksArray().length+(booksArray().length===1?' livro':' livros') : '';

  if(list.length===0){
    wrap.innerHTML = '<div class="empty-state"><div class="big">Sua estante está vazia</div>Adicione um PDF, TXT ou EPUB para começar a ler.</div><div class="shelf-grid" style="border:none;max-width:200px;margin:0 auto;"></div>';
    wrap.querySelector('.shelf-grid').appendChild(addTileEl());
    return;
  }
  const grid = document.createElement('div');
  grid.className='shelf-grid';
  grid.style.borderBottom='none';
  list.forEach(b=> grid.appendChild(bookCardEl(b)));
  wrap.innerHTML='';

  if(state.data.settings.useCollections){
    const groups = {};
    list.forEach(b=>{
      const key = b.collection || 'Sem coleção';
      (groups[key] = groups[key] || []).push(b);
    });
    const names = Object.keys(groups).filter(n=>n!=='Sem coleção').sort((a,c)=>a.localeCompare(c));
    if(groups['Sem coleção']) names.push('Sem coleção');
    names.forEach(name=>{
      const section = document.createElement('div');
      section.className = 'shelf-section';
      const title = document.createElement('div');
      title.className = 'shelf-section-title';
      title.textContent = name + ' · ' + groups[name].length;
      const sectionGrid = document.createElement('div');
      sectionGrid.className = 'shelf-grid';
      groups[name].forEach(b=> sectionGrid.appendChild(bookCardEl(b)));
      section.appendChild(title);
      section.appendChild(sectionGrid);
      wrap.appendChild(section);
    });
  } else {
    wrap.appendChild(grid);
  }
}
['shelf-search','shelf-filter','shelf-sort'].forEach(id=>{
  document.getElementById(id).addEventListener('input', renderShelf);
  document.getElementById(id).addEventListener('change', renderShelf);
});
document.getElementById('btn-add-book-top').addEventListener('click', openAddBookModal);
document.getElementById('btn-rename-shelf').addEventListener('click', openRenameShelfModal);

function renderShelfName(){
  document.getElementById('shelf-name').textContent = (state.data.settings.shelfName || 'MY BOOKSHELF');
}
function openRenameShelfModal(){
  const html = `
    <h3>Dar um nome à sua estante</h3>
    <div class="sub">Assim como você nomeia um Kindle, dê um nome à sua estante — algo pessoal, só seu.</div>
    <div class="field"><input id="in-shelf-name" maxlength="40" data-enter-submit="save-rename" value="${escapeHtml(state.data.settings.shelfName || 'MY BOOKSHELF')}"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="cancel-rename">Cancelar</button><button class="btn btn-primary" id="save-rename">Salvar</button></div>`;
  openModal(html);
  const input = document.getElementById('in-shelf-name');
  input.focus(); input.select();
  document.getElementById('cancel-rename').addEventListener('click', closeModal);
  document.getElementById('save-rename').addEventListener('click', ()=>{
    const v = input.value.trim();
    state.data.settings.shelfName = v || 'MY BOOKSHELF';
    saveUserData(); renderShelfName(); closeModal();
  });
}

function addTileEl(){
  const d = document.createElement('div');
  d.className='add-tile';
  d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg><span>Adicionar livro</span>';
  d.addEventListener('click', openAddBookModal);
  return d;
}

function bookCardEl(b){
  const card = document.createElement('div');
  card.className='book-card';
  const pct = (b.progress && b.progress.percent) || 0;
  card.innerHTML = `
    <div class="book-cover">
      ${b.cover ? `<img src="${b.cover}">` : `<div class="gencover" style="background:${coverGradientFor(b.title)}"><div class="ttl">${escapeHtml(b.title)}</div>${b.author?`<div class="aut">${escapeHtml(b.author)}</div>`:''}</div>`}
      ${b.status==='concluido' ? '<div class="badge-finished">CONCLUÍDO</div>' : ''}
      <button class="book-options-btn" title="Editar ou excluir este livro">⋮</button>
    </div>
    <div class="book-meta">
      <div class="title-wrap">
        <div class="t">${escapeHtml(b.title)}</div>
        <div class="mini-progress"><i style="width:${pct}%"></i></div>
      </div>
      <div class="a">${escapeHtml(b.author||'Autor desconhecido')}</div>
      <div class="pct">${b.status==='concluido' ? '★'.repeat(b.rating||0) + '☆'.repeat(5-(b.rating||0)) : (pct>0? pct+'% lido' : 'Não iniciado')}</div>
    </div>`;
  card.addEventListener('click', ()=> openBook(b.id));
  card.querySelector('.book-options-btn').addEventListener('click', (ev)=>{
    ev.stopPropagation();
    openBookOptionsModal(b.id);
  });
  return card;
}

/* ==================================================================
   EDITAR / EXCLUIR LIVRO
   ================================================================== */
function openBookOptionsModal(bookId){
  const b = state.data.books[bookId];
  const existingCollections = [...new Set(booksArray().map(x=>x.collection).filter(Boolean))];
  const useColl = state.data.settings.useCollections;
  const html = `
    <h3>Editar livro</h3>
    <div class="sub">Ajuste as informações ou remova este livro da sua estante.</div>
    <div class="field"><label>Título</label><input id="edit-title" data-enter-submit="save-edit-book" value="${escapeHtml(b.title)}"></div>
    <div class="field"><label>Autor</label><input id="edit-author" data-enter-submit="save-edit-book" value="${escapeHtml(b.author||'')}"></div>
    ${useColl ? `
    <div class="field">
      <label>Coleção</label>
      <input id="edit-collection" data-enter-submit="save-edit-book" list="edit-collections-datalist" value="${escapeHtml(b.collection||'')}" placeholder="Deixe em branco pra não organizar por coleção">
      <datalist id="edit-collections-datalist">${existingCollections.map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist>
    </div>` : ''}
    <div class="modal-actions" style="justify-content:space-between;">
      <button class="btn btn-ghost" id="delete-book" style="color:var(--red);border-color:var(--red)">Excluir livro</button>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-ghost" id="cancel-edit-book">Cancelar</button>
        <button class="btn btn-primary" id="save-edit-book">Salvar</button>
      </div>
    </div>`;
  openModal(html);
  document.getElementById('cancel-edit-book').addEventListener('click', closeModal);
  document.getElementById('save-edit-book').addEventListener('click', ()=>{
    const title = document.getElementById('edit-title').value.trim();
    if(!title) return;
    b.title = title;
    b.author = document.getElementById('edit-author').value.trim();
    const collEl = document.getElementById('edit-collection');
    if(collEl) b.collection = collEl.value.trim();
    saveUserData(); closeModal(); renderShelf();
  });
  document.getElementById('delete-book').addEventListener('click', async ()=>{
    if(!confirm('Excluir "'+b.title+'" da sua estante? Isso apaga o livro, os destaques, notas e marcadores dele. Não tem como desfazer.')) return;
    const delBtn = document.getElementById('delete-book');
    delBtn.disabled = true; delBtn.textContent = 'Excluindo…';
    try{
      if(b.format==='pdf' && b.filePath){
        await sb.storage.from(BOOKS_BUCKET).remove([b.filePath]);
      }
      delete state.data.books[bookId];
      saveUserData();
      closeModal();
      renderShelf();
    }catch(err){
      console.error(err);
      alert('Não consegui excluir o livro: ' + err.message);
      delBtn.disabled = false; delBtn.textContent = 'Excluir livro';
    }
  });
}

/* ==================================================================
   ADICIONAR LIVRO
   ================================================================== */
function openAddBookModal(){
  const useColl = state.data.settings.useCollections;
  const existingCollections = [...new Set(booksArray().map(b=>b.collection).filter(Boolean))];
  const html = `
    <h3>Adicionar livro</h3>
    <div class="sub">Formatos aceitos: PDF, TXT e EPUB (o EPUB é lido como texto simples, sem imagens).</div>
    <div class="dropzone" id="dz">
      <div>Arraste um arquivo aqui ou <label for="file-input">escolha no computador</label></div>
      <input type="file" id="file-input" accept=".pdf,.txt,.epub">
    </div>
    <div id="add-book-fields" class="hidden">
      <div class="field"><label>Título</label><input id="in-title" data-enter-submit="confirm-add"></div>
      <div class="field"><label>Autor (opcional)</label><input id="in-author" data-enter-submit="confirm-add"></div>
      ${useColl ? `
      <div class="field">
        <label>Coleção (opcional) — ex: Terror, Cadernos, Anotações</label>
        <input id="in-collection" list="collections-datalist" data-enter-submit="confirm-add" placeholder="Deixe em branco pra não organizar por coleção">
        <datalist id="collections-datalist">${existingCollections.map(c=>`<option value="${escapeHtml(c)}">`).join('')}</datalist>
      </div>` : ''}
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancel-add">Cancelar</button>
      <button class="btn btn-primary" id="confirm-add" disabled>Adicionar à estante</button>
    </div>`;
  openModal(html);
  const dz = document.getElementById('dz');
  const fileInput = document.getElementById('file-input');
  let pendingFile = null;
  ['dragover','dragleave','drop'].forEach(ev=>{
    dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.toggle('drag', ev==='dragover'); });
  });
  dz.addEventListener('drop', e=>{ if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });
  function handleFile(f){
    pendingFile = f;
    const ext = f.name.split('.').pop().toLowerCase();
    if(!['pdf','txt','epub'].includes(ext)){ alert('Formato não suportado. Use PDF, TXT ou EPUB.'); return; }
    document.getElementById('add-book-fields').classList.remove('hidden');
    document.getElementById('in-title').value = f.name.replace(/\.[^.]+$/,'');
    document.getElementById('confirm-add').disabled = false;
    dz.querySelector('div').textContent = '✓ ' + f.name;
  }
  document.getElementById('cancel-add').addEventListener('click', closeModal);
  document.getElementById('confirm-add').addEventListener('click', async ()=>{
    if(!pendingFile) return;
    const btn = document.getElementById('confirm-add');
    btn.disabled = true; btn.textContent = 'Processando…';
    const collectionEl = document.getElementById('in-collection');
    try{ await addBookFromFile(pendingFile, document.getElementById('in-title').value.trim(), document.getElementById('in-author').value.trim(), collectionEl ? collectionEl.value.trim() : ''); closeModal(); renderShelf(); }
    catch(err){ console.error(err); alert('Não consegui processar esse arquivo: ' + err.message); btn.disabled=false; btn.textContent='Adicionar à estante'; }
  });
}

function fileToDataURL(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(f); }); }
function fileToText(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsText(f); }); }
function fileToArrayBuffer(f){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(f); }); }

async function addBookFromFile(file, title, author, collection){
  const ext = file.name.split('.').pop().toLowerCase();
  const id = uid();
  const book = {
    id, title: title||file.name, author: author||'', format: ext, addedAt: Date.now(),
    collection: collection || '',
    cover:null, status:'naoiniciado', favorito:false, rating:0, review:'',
    progress:{ percent:0, location:null }, highlights:[], notes:[], bookmarks:[], finishedAt:null
  };
  if(ext==='pdf'){
    try{
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({data:buf}).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({scale:0.6});
      const canvas = document.createElement('canvas'); canvas.width=vp.width; canvas.height=vp.height;
      await page.render({canvasContext:canvas.getContext('2d'), viewport:vp}).promise;
      book.cover = canvas.toDataURL('image/jpeg',0.82);
      book.totalUnits = pdf.numPages;
    }catch(e){ console.warn('capa pdf falhou', e); }
    const path = `${state.userId}/${id}.pdf`;
    const { error: upErr } = await sb.storage.from(BOOKS_BUCKET).upload(path, file, { upsert:true, contentType:'application/pdf' });
    if(upErr) throw upErr;
    book.filePath = path; // o arquivo em si fica no Storage, só o caminho vai no jsonb
  } else if(ext==='txt'){
    book.fileData = await fileToText(file);
  } else if(ext==='epub'){
    const buf = await fileToArrayBuffer(file);
    const zip = await JSZip.loadAsync(buf);
    const chapters = await extractEpubChapters(zip);
    book.fileData = chapters; // array salvo direto, sem JSON.stringify
  }
  state.data.books[id] = book;
  saveUserData();
}

async function extractEpubChapters(zip){
  // acha o container -> opf -> spine, em ordem; fallback: todos os .xhtml/.html
  let opfPath = null;
  try{
    const containerXml = await zip.file('META-INF/container.xml').async('string');
    const m = containerXml.match(/full-path="([^"]+)"/);
    if(m) opfPath = m[1];
  }catch(e){}
  let hrefs = [];
  if(opfPath){
    const opf = await zip.file(opfPath).async('string');
    const base = opfPath.split('/').slice(0,-1).join('/');
    const manifest = {};
    [...opf.matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"/g)].forEach(m=> manifest[m[1]] = m[2]);
    [...opf.matchAll(/<item[^>]+href="([^"]+)"[^>]+id="([^"]+)"/g)].forEach(m=> manifest[m[2]] = m[1]);
    const spineIds = [...opf.matchAll(/<itemref[^>]+idref="([^"]+)"/g)].map(m=>m[1]);
    hrefs = spineIds.map(id=>manifest[id]).filter(Boolean).map(h => base? base+'/'+h : h);
  }
  if(hrefs.length===0){
    hrefs = Object.keys(zip.files).filter(n=>/\.(xhtml|html|htm)$/i.test(n));
  }
  const chapters = [];
  for(const href of hrefs){
    const f = zip.file(href) || zip.file(href.replace(/^\.?\//,''));
    if(!f) continue;
    const html = await f.async('string');
    const div = document.createElement('div'); div.innerHTML = html;
    const titleEl = div.querySelector('h1,h2,title');
    let text = (div.body ? div.body.textContent : div.textContent) || div.textContent || '';
    text = text.replace(/\s+/g,' ').trim();
    if(text.length < 5) continue;
    chapters.push({ title: (titleEl?titleEl.textContent.trim():('Capítulo '+(chapters.length+1))).slice(0,80), text });
  }
  return chapters.length? chapters : [{title:'Conteúdo', text:'(Não foi possível extrair texto deste EPUB.)'}];
}

/* ==================================================================
   ABRIR LIVRO -> READER
   ================================================================== */
async function openBook(id){
  state.currentBookId = id;
  const b = state.data.books[id];
  if(b.status==='naoiniciado'){ b.status='lendo'; saveUserData(); }
  switchView('reader');
  document.getElementById('reader-title-b').textContent = b.title;
  document.getElementById('text-pane-outer').classList.add('hidden');
  document.getElementById('pdf-pane-outer').classList.add('hidden');
  closeSide();
  applyDisplaySettings();
  setHighlightMode(false);

  if(b.format==='pdf'){
    document.getElementById('pdf-pane-outer').classList.remove('hidden');
    await loadPdf(b);
  } else if(b.format==='txt'){
    document.getElementById('text-pane-outer').classList.remove('hidden');
    loadTxt(b);
  } else if(b.format==='epub'){
    document.getElementById('text-pane-outer').classList.remove('hidden');
    loadEpub(b);
  }
  startReadTimer();
  bumpStreak();
}

/* ---- modo de destaque: enquanto desligado, selecionar texto é só pra copiar/ler,
   nunca cria destaque sem querer. Precisa ligar de propósito pra destacar. ---- */
function setHighlightMode(on){
  state.highlightMode = on;
  const btn = document.getElementById('btn-highlight-mode');
  btn.classList.toggle('active', on);
  document.getElementById('reader-page-area').classList.toggle('highlight-mode-on', on);
}
document.getElementById('btn-highlight-mode').addEventListener('click', ()=> setHighlightMode(!state.highlightMode));
document.getElementById('btn-back-shelf').addEventListener('click', ()=>{
  saveCurrentProgress();
  stopReadTimer();
  saveUserData();
  renderShelf();
  switchView('shelf');
});

/* ---- PDF ---- */
async function loadPdf(b){
  const { data, error } = await sb.storage.from(BOOKS_BUCKET).download(b.filePath);
  if(error){ alert('Não consegui baixar o PDF: ' + error.message); return; }
  const buf = await data.arrayBuffer();
  state.pdfDoc = await pdfjsLib.getDocument({data:buf}).promise;
  state.pdfPageCache = {};
  b.totalUnits = state.pdfDoc.numPages;
  const startPage = (b.progress.location && b.progress.location.page) || 1;
  state.pdfPageNum = Math.min(Math.max(1,startPage), state.pdfDoc.numPages);
  await renderPdfPage(state.pdfPageNum);
}
async function renderPdfPage(num){
  const b = state.data.books[state.currentBookId];
  const page = await state.pdfDoc.getPage(num);
  const outer = document.getElementById('pdf-pane-outer');
  const targetWidth = Math.min(outer.clientWidth-60, 760);
  const baseVp = page.getViewport({scale:1});
  const scale = targetWidth / baseVp.width;
  const viewport = page.getViewport({scale});
  const canvas = document.getElementById('pdf-canvas');
  canvas.width = viewport.width; canvas.height = viewport.height;
  document.getElementById('pdf-page-wrap').style.width = viewport.width+'px';
  document.getElementById('pdf-page-wrap').style.height = viewport.height+'px';
  await page.render({canvasContext:canvas.getContext('2d'), viewport}).promise;

  // text layer
  const textContent = await page.getTextContent();
  const tl = document.getElementById('pdf-textlayer');
  tl.innerHTML=''; tl.style.width=viewport.width+'px'; tl.style.height=viewport.height+'px';
  const scaleFactor = Math.hypot(viewport.transform[0], viewport.transform[1]) || 1;
  textContent.items.forEach(item=>{
    if(!item.str) return; // pula itens vazios (só espaçamento), não geram span
    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2],tx[3]);
    const span = document.createElement('span');
    span.textContent = item.str;
    span.style.left = tx[4]+'px';
    span.style.top = (tx[5]-fontHeight)+'px';
    span.style.fontSize = fontHeight+'px';
    span.style.lineHeight = fontHeight+'px';
    span.style.height = fontHeight+'px';
    span.style.fontFamily = 'sans-serif';
    span.style.transformOrigin = '0% 0%';
    tl.appendChild(span);
    // a fonte invisível (sans-serif) quase nunca tem a mesma largura da fonte real do PDF.
    // sem isso, arrastar o mouse pra selecionar não bate com o texto visível e "pula"
    // perto do fim da linha/parágrafo — por isso esticamos o span pra largura certa.
    const expectedWidth = (item.width || 0) * scaleFactor;
    const measuredWidth = span.getBoundingClientRect().width;
    if(expectedWidth > 0 && measuredWidth > 0.5){
      span.style.transform = 'scaleX(' + (expectedWidth / measuredWidth) + ')';
    }
  });
  state.pdfPageCache[num] = {textContent, viewport};
  state.pdfPageNum = num;
  renderPdfHighlights(b, num, viewport);
  updateBottomBar(num, state.pdfDoc.numPages);
  document.getElementById('reader-pos-lbl').textContent = 'Página '+num+' de '+state.pdfDoc.numPages;
  saveCurrentProgress();
}
function renderPdfHighlights(b, pageNum, viewport){
  document.getElementById('pdf-textlayer').querySelectorAll('.pdf-hl').forEach(e=>e.remove());
  const tl = document.getElementById('pdf-textlayer');
  (b.highlights||[]).filter(h=>h.format==='pdf' && h.page===pageNum).forEach(h=>{
    (h.rects||[]).forEach(r=>{
      const d = document.createElement('div');
      d.className = 'pdf-hl hl-'+h.color;
      d.style.left = (r.x*viewport.width)+'px'; d.style.top=(r.y*viewport.height)+'px';
      d.style.width=(r.w*viewport.width)+'px'; d.style.height=(r.h*viewport.height)+'px';
      tl.appendChild(d);
    });
  });
}
function pdfGoTo(delta){
  const target = state.pdfPageNum + delta;
  if(target<1 || target>state.pdfDoc.numPages) return;
  renderPdfPage(target);
}

/* ---- TXT ---- */
function computeCharsPerPage(){
  const pane = document.getElementById('text-pane');
  const s = state.data.settings;
  const style = getComputedStyle(pane);
  const padX = parseFloat(style.paddingLeft||0) + parseFloat(style.paddingRight||0);
  const padY = parseFloat(style.paddingTop||0) + parseFloat(style.paddingBottom||0);
  const w = Math.max(200, (pane.clientWidth||680) - padX);
  const h = Math.max(200, (pane.clientHeight||500) - padY);
  const fontSize = s.fontSize || 19;
  const lineHeight = s.lineHeight || 1.8;
  const avgCharWidth = fontSize * 0.52; // aproximação razoável pra serifada/sem-serifa/legível
  const lineHeightPx = fontSize * lineHeight;
  const charsPerLine = Math.max(20, Math.floor(w / avgCharWidth));
  const linesPerPage = Math.max(5, Math.floor(h / lineHeightPx));
  return Math.max(400, charsPerLine * linesPerPage);
}
function paginateText(text, charsPerPage){
  const pages = []; let i=0;
  while(i < text.length){
    let end = Math.min(i+charsPerPage, text.length);
    if(end < text.length){ const brk = text.lastIndexOf(' ', end); if(brk>i+charsPerPage*0.6) end = brk; }
    pages.push(text.slice(i,end));
    i = end;
  }
  return pages.length? pages : [''];
}
function loadTxt(b){
  state.textPages = paginateText(b.fileData, computeCharsPerPage());
  b.totalUnits = state.textPages.length;
  state.textPageIndex = Math.min((b.progress.location && b.progress.location.page)||0, state.textPages.length-1);
  renderTextPage();
}
/* ---- EPUB ---- */
function loadEpub(b){
  state.epubChapters = b.fileData;
  const loc = b.progress.location || {chapter:0, page:0};
  state.epubChapterIndex = Math.min(loc.chapter||0, state.epubChapters.length-1);
  loadEpubChapterPages();
  state.textPageIndex = Math.min(loc.page||0, (state.textPages?state.textPages.length-1:0));
  renderTextPage();
}
function loadEpubChapterPages(){
  const ch = state.epubChapters[state.epubChapterIndex];
  state.textPages = paginateText(ch.text, computeCharsPerPage());
}
function currentPageText(){ return state.textPages[state.textPageIndex] || ''; }

/* recalcula as páginas quando a fonte ou a janela mudam, tentando manter você
   no mesmo trecho de leitura (não simplesmente joga pra página 1 de novo) */
function repaginateCurrentText(){
  const b = state.data.books[state.currentBookId];
  if(!b || (b.format!=='txt' && b.format!=='epub')) return;
  let offset = 0;
  for(let i=0;i<state.textPageIndex;i++) offset += (state.textPages[i]||'').length;
  const newCharsPerPage = computeCharsPerPage();
  if(b.format==='txt'){
    state.textPages = paginateText(b.fileData, newCharsPerPage);
  } else {
    state.textPages = paginateText(state.epubChapters[state.epubChapterIndex].text, newCharsPerPage);
  }
  let acc = 0, newIndex = state.textPages.length-1;
  for(let i=0;i<state.textPages.length;i++){
    acc += state.textPages[i].length;
    if(offset < acc){ newIndex = i; break; }
  }
  state.textPageIndex = newIndex;
  renderTextPage();
}

function renderTextPage(){
  const b = state.data.books[state.currentBookId];
  const pane = document.getElementById('text-pane');
  const raw = currentPageText();
  // aplica highlights por offset
  const hls = (b.highlights||[]).filter(h=>{
    if(b.format==='txt') return h.format==='txt' && h.page===state.textPageIndex;
    return h.format==='epub' && h.chapter===state.epubChapterIndex && h.page===state.textPageIndex;
  }).sort((a,c)=>a.start-c.start);
  let html=''; let cursor=0;
  hls.forEach(h=>{
    if(h.start<cursor) return;
    html += escapeHtml(raw.slice(cursor,h.start));
    html += '<mark class="hl-'+h.color+'" data-hlid="'+h.id+'">'+escapeHtml(raw.slice(h.start,h.end))+'</mark>';
    cursor = h.end;
  });
  html += escapeHtml(raw.slice(cursor));
  pane.innerHTML = html;

  let curPage, totalPages;
  if(b.format==='epub'){
    curPage = state.epubChapters.slice(0,state.epubChapterIndex).reduce((a,c)=>a+ (paginateText(c.text,1600).length),0) + state.textPageIndex + 1;
    // aproximação: total de páginas do livro todo
    if(!b._totalPagesApprox) b._totalPagesApprox = state.epubChapters.reduce((a,c)=>a+paginateText(c.text,1600).length,0);
    totalPages = b._totalPagesApprox;
    document.getElementById('reader-pos-lbl').textContent = state.epubChapters[state.epubChapterIndex].title + ' · pág. '+(state.textPageIndex+1)+'/'+state.textPages.length;
  } else {
    curPage = state.textPageIndex+1; totalPages = state.textPages.length;
    document.getElementById('reader-pos-lbl').textContent = 'Página '+curPage+' de '+totalPages;
  }
  updateBottomBar(curPage, totalPages);
  saveCurrentProgress();
}
function textGoTo(delta){
  const b = state.data.books[state.currentBookId];
  let idx = state.textPageIndex + delta;
  if(idx < 0){
    if(b.format==='epub' && state.epubChapterIndex>0){
      state.epubChapterIndex--; loadEpubChapterPages(); state.textPageIndex = state.textPages.length-1; renderTextPage();
    }
    return;
  }
  if(idx >= state.textPages.length){
    if(b.format==='epub' && state.epubChapterIndex < state.epubChapters.length-1){
      state.epubChapterIndex++; loadEpubChapterPages(); state.textPageIndex = 0; renderTextPage();
    }
    return;
  }
  state.textPageIndex = idx; renderTextPage();
  document.getElementById('text-pane').scrollTop = 0;
}

function updateBottomBar(cur,total){
  const pct = total? Math.round((cur/total)*100) : 0;
  document.getElementById('reader-pos-bar').style.width = pct+'%';
  document.getElementById('reader-pct-lbl').textContent = pct+'%';
  const b = state.data.books[state.currentBookId];
  b.progress.percent = pct;
  if(pct>=99 && b.status!=='concluido'){ /* sugestão sutil; não força */ }
}

function saveCurrentProgress(){
  const b = state.data.books[state.currentBookId]; if(!b) return;
  if(b.format==='pdf'){ b.progress.location = {page: state.pdfPageNum}; }
  else if(b.format==='txt'){ b.progress.location = {page: state.textPageIndex}; }
  else if(b.format==='epub'){ b.progress.location = {chapter: state.epubChapterIndex, page: state.textPageIndex}; }
  saveUserData();
}

/* navegação por clique/teclado */
document.getElementById('tap-left').addEventListener('click', ()=> pageBack());
document.getElementById('tap-right').addEventListener('click', ()=> pageFwd());
function pageFwd(){ const b=state.data.books[state.currentBookId]; if(!b) return; if(b.format==='pdf') pdfGoTo(1); else textGoTo(1); }
function pageBack(){ const b=state.data.books[state.currentBookId]; if(!b) return; if(b.format==='pdf') pdfGoTo(-1); else textGoTo(-1); }
document.addEventListener('keydown', e=>{
  if(!document.getElementById('view-reader').classList.contains('active')) return;
  if(e.key==='ArrowRight') pageFwd();
  if(e.key==='ArrowLeft') pageBack();
});

/* ==================================================================
   DESTAQUES / NOTAS / MARCADORES — seleção de texto
   ================================================================== */
const selToolbar = document.getElementById('sel-toolbar');
let pendingSelection = null; // {format, ...loc, start,end,text} ou {format:'pdf', page, rects, text}

document.addEventListener('mouseup', (e)=>{
  if(selToolbar.contains(e.target)) return;
  setTimeout(()=>{
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.toString().trim()){ selToolbar.style.display='none'; return; }
    const b = state.data.books[state.currentBookId];
    if(!b || !document.getElementById('view-reader').classList.contains('active')){ return; }
    if(!state.highlightMode){ selToolbar.style.display='none'; return; } // seleção livre pra copiar/ler, sem destacar sem querer
    const range = sel.getRangeAt(0);
    if(b.format==='pdf'){
      const tl = document.getElementById('pdf-textlayer');
      if(!tl.contains(range.commonAncestorContainer)) return;
      const rects = [...range.getClientRects()];
      const tlRect = tl.getBoundingClientRect();
      const relRects = rects.map(r=>({ x:(r.left-tlRect.left)/tlRect.width, y:(r.top-tlRect.top)/tlRect.height, w:r.width/tlRect.width, h:r.height/tlRect.height }));
      pendingSelection = { format:'pdf', page: state.pdfPageNum, rects: relRects, text: sel.toString() };
    } else {
      const pane = document.getElementById('text-pane');
      if(!pane.contains(range.commonAncestorContainer)) return;
      const preRange = document.createRange(); preRange.selectNodeContents(pane); preRange.setEnd(range.startContainer, range.startOffset);
      const startOff = preRange.toString().length;
      const endOff = startOff + sel.toString().length;
      if(b.format==='txt'){ pendingSelection = {format:'txt', page: state.textPageIndex, start:startOff, end:endOff, text: sel.toString()}; }
      else { pendingSelection = {format:'epub', chapter: state.epubChapterIndex, page: state.textPageIndex, start:startOff, end:endOff, text: sel.toString()}; }
    }
    const r = range.getBoundingClientRect();
    selToolbar.style.left = Math.max(8, r.left + r.width/2 - 90)+'px';
    selToolbar.style.top = Math.max(8, r.top - 46)+'px';
    selToolbar.style.display = 'flex';
  }, 5);
});
document.addEventListener('mousedown', e=>{
  if(!selToolbar.contains(e.target)) selToolbar.style.display='none';
});
selToolbar.querySelectorAll('[data-hl]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    if(!pendingSelection) return;
    const b = state.data.books[state.currentBookId];
    const h = Object.assign({id:uid(), color:btn.dataset.hl, createdAt:Date.now()}, pendingSelection);
    b.highlights.push(h);
    saveUserData();
    selToolbar.style.display='none';
    window.getSelection().removeAllRanges();
    if(b.format==='pdf') renderPdfPage(state.pdfPageNum); else renderTextPage();
    if(state.sideMode==='notes') renderSideNotes();
  });
});
document.getElementById('sel-copy').addEventListener('click', ()=>{
  if(pendingSelection) navigator.clipboard && navigator.clipboard.writeText(pendingSelection.text).catch(()=>{});
  selToolbar.style.display='none';
});
document.getElementById('sel-note').addEventListener('click', ()=>{
  if(!pendingSelection) return;
  const html = `
    <h3>Adicionar anotação</h3>
    <div class="sub">Trecho selecionado: "${escapeHtml(pendingSelection.text.slice(0,140))}${pendingSelection.text.length>140?'…':''}"</div>
    <textarea class="field-textarea" id="note-text" placeholder="Escreva sua observação sobre este trecho…"></textarea>
    <div class="modal-actions"><button class="btn btn-ghost" id="cancel-note">Cancelar</button><button class="btn btn-primary" id="save-note">Salvar anotação</button></div>`;
  openModal(html);
  selToolbar.style.display='none';
  document.getElementById('cancel-note').addEventListener('click', closeModal);
  document.getElementById('save-note').addEventListener('click', ()=>{
    const txt = document.getElementById('note-text').value.trim();
    if(!txt) return;
    const b = state.data.books[state.currentBookId];
    b.notes.push(Object.assign({id:uid(), text:txt, quote:pendingSelection.text, createdAt:Date.now()}, pendingSelection));
    saveUserData(); closeModal();
    if(state.sideMode==='notes') renderSideNotes();
  });
});

/* marcador manual (posição atual, sem seleção) */
document.getElementById('btn-bookmark').addEventListener('click', ()=>{
  const b = state.data.books[state.currentBookId];
  const loc = b.format==='pdf' ? {page: state.pdfPageNum} : (b.format==='epub' ? {chapter: state.epubChapterIndex, page: state.textPageIndex} : {page: state.textPageIndex});
  const label = b.format==='pdf' ? ('Página '+loc.page) : (b.format==='epub' ? (state.epubChapters[loc.chapter].title+' · pág. '+(loc.page+1)) : ('Página '+(loc.page+1)));
  b.bookmarks.push({id:uid(), label, loc, createdAt:Date.now()});
  saveUserData();
  flashIcon('btn-bookmark');
  if(state.sideMode==='toc') openSide('bookmarks');
});
function flashIcon(id){ const el=document.getElementById(id); el.classList.add('active'); setTimeout(()=>el.classList.remove('active'),700); }

/* ==================================================================
   PAINEL LATERAL (sumário / busca / notas)
   ================================================================== */
function openSide(mode){
  state.sideMode = mode;
  document.getElementById('reader-side').classList.remove('collapsed');
  const titles = {toc:'Sumário', bookmarks:'Marcadores', notes:'Anotações e destaques', search:'Buscar no livro'};
  document.getElementById('side-title').textContent = titles[mode]||'';
  if(mode==='toc') renderSideTOC();
  if(mode==='bookmarks') renderSideBookmarks();
  if(mode==='notes') renderSideNotes();
  if(mode==='search') renderSideSearch();
}
function closeSide(){ document.getElementById('reader-side').classList.add('collapsed'); state.sideMode=null; }
document.getElementById('btn-side-close').addEventListener('click', closeSide);
document.getElementById('btn-toc').addEventListener('click', ()=> state.sideMode==='toc'? closeSide() : openSide('toc'));
document.getElementById('btn-search').addEventListener('click', ()=> state.sideMode==='search'? closeSide() : openSide('search'));
document.getElementById('btn-notes').addEventListener('click', ()=> state.sideMode==='notes'? closeSide() : openSide('notes'));

function renderSideTOC(){
  const b = state.data.books[state.currentBookId];
  const body = document.getElementById('side-body');
  if(b.format==='epub'){
    body.innerHTML='';
    state.epubChapters.forEach((c,i)=>{
      const d = document.createElement('div'); d.className='toc-item'+(i===state.epubChapterIndex?' current':'');
      d.textContent = c.title;
      d.addEventListener('click', ()=>{ state.epubChapterIndex=i; loadEpubChapterPages(); state.textPageIndex=0; renderTextPage(); renderSideTOC(); });
      body.appendChild(d);
    });
  } else if(b.format==='pdf'){
    body.innerHTML = '<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px;">Navegação rápida por página:</div>';
    const wrap = document.createElement('div'); wrap.style.display='grid'; wrap.style.gridTemplateColumns='repeat(4,1fr)'; wrap.style.gap='6px';
    for(let p=1;p<=state.pdfDoc.numPages;p++){
      const d = document.createElement('button'); d.className='seg-btn'; d.textContent=p;
      d.style.cssText='border:1px solid var(--hair);background:var(--surface-2);color:var(--muted);border-radius:6px;padding:6px 0;font-size:11px;';
      if(p===state.pdfPageNum) d.style.color='var(--brass)';
      d.addEventListener('click', ()=> renderPdfPage(p));
      wrap.appendChild(d);
    }
    body.appendChild(wrap);
  } else {
    body.innerHTML='<div style="font-size:12.5px;color:var(--muted);">Livros em .txt não têm capítulos — use a busca ou os marcadores para navegar.</div>';
  }
}
function renderSideBookmarks(){
  const b = state.data.books[state.currentBookId];
  const body = document.getElementById('side-body'); body.innerHTML='';
  if(!b.bookmarks.length){ body.innerHTML = '<div style="font-size:12.5px;color:var(--muted);">Nenhum marcador ainda. Toque no ícone de marcador na barra superior para salvar sua posição.</div>'; return; }
  b.bookmarks.slice().reverse().forEach(bm=>{
    const d = document.createElement('div'); d.className='note-item';
    d.innerHTML = `<button class="del">remover</button><div class="loc">${new Date(bm.createdAt).toLocaleDateString('pt-BR')}</div><div class="txt">${escapeHtml(bm.label)}</div>`;
    d.querySelector('.txt').style.cursor='pointer';
    d.querySelector('.txt').addEventListener('click', ()=> gotoLoc(b, bm.loc));
    d.querySelector('.del').addEventListener('click', (ev)=>{ ev.stopPropagation(); b.bookmarks = b.bookmarks.filter(x=>x.id!==bm.id); saveUserData(); renderSideBookmarks(); });
    body.appendChild(d);
  });
}
function gotoLoc(b, loc){
  if(b.format==='pdf') renderPdfPage(loc.page);
  else if(b.format==='epub'){ state.epubChapterIndex=loc.chapter; loadEpubChapterPages(); state.textPageIndex=loc.page; renderTextPage(); }
  else { state.textPageIndex = loc.page; renderTextPage(); }
}
function renderSideNotes(){
  const b = state.data.books[state.currentBookId];
  const body = document.getElementById('side-body'); body.innerHTML='';
  const items = [...b.highlights.map(h=>({...h,kind:'highlight'})), ...b.notes.map(n=>({...n,kind:'note'}))].sort((a,c)=>c.createdAt-a.createdAt);
  if(!items.length){ body.innerHTML = '<div style="font-size:12.5px;color:var(--muted);">Selecione um trecho do texto para destacar ou anotar.</div>'; return; }
  items.forEach(it=>{
    const d = document.createElement('div'); d.className='note-item';
    const locLabel = it.format==='pdf' ? ('pág. '+it.page) : (it.format==='epub' ? ('cap. '+(it.chapter+1)) : ('pág. '+(it.page+1)));
    d.innerHTML = `<button class="del">remover</button><div class="loc">${it.kind==='highlight'?'🖍 destaque':'📝 nota'} · ${locLabel}</div><div class="txt">${it.kind==='note' ? escapeHtml(it.text)+'<div style="opacity:.6;margin-top:5px;font-style:italic;">"'+escapeHtml((it.quote||'').slice(0,90))+'"</div>' : '"'+escapeHtml(it.text)+'"'}</div>`;
    d.addEventListener('click', (ev)=>{ if(ev.target.classList.contains('del')) return; gotoLoc(b, it); });
    d.querySelector('.del').addEventListener('click', (ev)=>{
      ev.stopPropagation();
      if(it.kind==='highlight') b.highlights = b.highlights.filter(x=>x.id!==it.id);
      else b.notes = b.notes.filter(x=>x.id!==it.id);
      saveUserData(); renderSideNotes();
      if(b.format==='pdf') renderPdfPage(state.pdfPageNum); else renderTextPage();
    });
    body.appendChild(d);
  });
}
function renderSideSearch(){
  const body = document.getElementById('side-body');
  body.innerHTML = '<div class="field"><input id="search-in-book" placeholder="Digite para buscar…" style="width:100%;padding:9px 10px;border-radius:8px;border:1px solid var(--hair);background:var(--surface-2);color:var(--text);"></div><div id="search-results"></div>';
  const input = document.getElementById('search-in-book');
  input.addEventListener('input', async ()=>{
    const q = input.value.trim().toLowerCase();
    const results = document.getElementById('search-results'); results.innerHTML='';
    if(q.length<2) return;
    const b = state.data.books[state.currentBookId];
    let hits = [];
    if(b.format==='txt'){
      state.textPages.forEach((p,i)=>{ const idx=p.toLowerCase().indexOf(q); if(idx>=0) hits.push({label:'Página '+(i+1), ctx:snippet(p,idx,q), go:()=>{state.textPageIndex=i; renderTextPage();}}); });
    } else if(b.format==='epub'){
      state.epubChapters.forEach((c,ci)=>{ const idx=c.text.toLowerCase().indexOf(q); if(idx>=0) hits.push({label:c.title, ctx:snippet(c.text,idx,q), go:()=>{state.epubChapterIndex=ci; loadEpubChapterPages(); state.textPageIndex=0; renderTextPage();}}); });
    } else if(b.format==='pdf'){
      const maxScan = Math.min(state.pdfDoc.numPages, 600);
      for(let p=1;p<=maxScan;p++){
        let tc = state.pdfPageCache[p] && state.pdfPageCache[p].textContent;
        if(!tc){ const page = await state.pdfDoc.getPage(p); tc = await page.getTextContent(); }
        const full = tc.items.map(it=>it.str).join(' ');
        const idx = full.toLowerCase().indexOf(q);
        if(idx>=0) hits.push({label:'Página '+p, ctx:snippet(full,idx,q), go:()=>renderPdfPage(p)});
        if(hits.length>25) break;
      }
    }
    if(!hits.length){ results.innerHTML = '<div style="font-size:12.5px;color:var(--muted);margin-top:10px;">Nada encontrado.</div>'; return; }
    hits.slice(0,30).forEach(h=>{
      const d = document.createElement('div'); d.className='search-results-item';
      d.innerHTML = '<b>'+h.label+'</b><br>…'+h.ctx+'…';
      d.addEventListener('click', h.go);
      results.appendChild(d);
    });
  });
}
function snippet(full, idx, q){ const s=Math.max(0,idx-40); return escapeHtml(full.slice(s, idx)) + '<b>'+escapeHtml(full.slice(idx,idx+q.length))+'</b>' + escapeHtml(full.slice(idx+q.length, idx+q.length+60)); }

/* ==================================================================
   TEXT-TO-SPEECH
   ================================================================== */
let ttsUtter = null;
document.getElementById('btn-tts').addEventListener('click', ()=>{
  const btn = document.getElementById('btn-tts');
  if(window.speechSynthesis.speaking){ window.speechSynthesis.cancel(); btn.classList.remove('active'); return; }
  const b = state.data.books[state.currentBookId];
  let text = '';
  if(b.format==='pdf'){ const tc = state.pdfPageCache[state.pdfPageNum]; text = tc? tc.textContent.items.map(i=>i.str).join(' ') : ''; }
  else { text = currentPageText(); }
  if(!text.trim()){ return; }
  ttsUtter = new SpeechSynthesisUtterance(text);
  ttsUtter.lang = 'pt-BR';
  ttsUtter.onend = ()=> btn.classList.remove('active');
  window.speechSynthesis.speak(ttsUtter);
  btn.classList.add('active');
});

/* ==================================================================
   APARÊNCIA DA LEITURA
   ================================================================== */
document.getElementById('btn-display').addEventListener('click', ()=>{
  const s = state.data.settings;
  const html = `
    <h3>Aparência da leitura</h3>
    <div class="display-row"><label>Tema</label><div class="seg" id="seg-theme">
      <button data-v="claro">Claro</button><button data-v="sepia">Sépia</button><button data-v="escuro">Escuro</button><button data-v="noturno">Noturno</button>
    </div></div>
    <div class="display-row"><label>Fonte</label><div class="seg" id="seg-font">
      <button data-v="serif">Serifada</button><button data-v="sans">Sem serifa</button><button data-v="legivel">Alta legibilidade</button>
    </div></div>
    <div class="display-row"><label>Tamanho do texto (${s.fontSize}px)</label><input type="range" class="slide" id="range-size" min="14" max="30" value="${s.fontSize}"></div>
    <div class="display-row"><label>Espaçamento entre linhas (${s.lineHeight})</label><input type="range" class="slide" id="range-lh" min="1.3" max="2.4" step="0.1" value="${s.lineHeight}"></div>
    <div class="modal-actions"><button class="btn btn-primary" id="close-display">Concluído</button></div>`;
  openModal(html);
  document.querySelectorAll('#seg-theme button').forEach(btn=>{ btn.classList.toggle('on', btn.dataset.v===s.theme); btn.addEventListener('click', ()=>{ s.theme=btn.dataset.v; saveUserData(); applyDisplaySettings(); document.querySelectorAll('#seg-theme button').forEach(x=>x.classList.toggle('on',x===btn)); }); });
  document.querySelectorAll('#seg-font button').forEach(btn=>{ btn.classList.toggle('on', btn.dataset.v===s.font); btn.addEventListener('click', ()=>{ s.font=btn.dataset.v; saveUserData(); applyDisplaySettings(); repaginateCurrentText(); document.querySelectorAll('#seg-font button').forEach(x=>x.classList.toggle('on',x===btn)); }); });
  document.getElementById('range-size').addEventListener('input', e=>{ s.fontSize=+e.target.value; saveUserData(); applyDisplaySettings(); repaginateCurrentText(); });
  document.getElementById('range-lh').addEventListener('input', e=>{ s.lineHeight=+e.target.value; saveUserData(); applyDisplaySettings(); repaginateCurrentText(); });
  document.getElementById('close-display').addEventListener('click', closeModal);
});
function applyDisplaySettings(){
  const s = state.data.settings;
  const pane = document.getElementById('text-pane');
  const outer = document.getElementById('text-pane-outer');
  outer.classList.remove('theme-claro','theme-sepia','theme-escuro','theme-noturno');
  outer.classList.add('theme-'+s.theme);
  pane.style.fontSize = s.fontSize+'px';
  pane.style.lineHeight = s.lineHeight;
  pane.style.fontFamily = s.font==='serif' ? "'Fraunces',serif" : s.font==='sans' ? "'Inter',sans-serif" : "'Atkinson Hyperlegible',sans-serif";
}

/* ==================================================================
   CONCLUIR LIVRO / AVALIAÇÃO
   ================================================================== */
document.getElementById('btn-finish').addEventListener('click', ()=>{
  const b = state.data.books[state.currentBookId];
  const html = `
    <h3>Marcar "${escapeHtml(b.title)}" como concluído</h3>
    <div class="sub">Dê uma nota e, se quiser, conte o que achou. Isso fica salvo no seu perfil do livro.</div>
    <div class="stars" id="stars">${[1,2,3,4,5].map(n=>'<span data-n="'+n+'">★</span>').join('')}</div>
    <textarea class="field-textarea" id="review-text" placeholder="O que você achou deste livro? (opcional)">${escapeHtml(b.review||'')}</textarea>
    <div class="modal-actions"><button class="btn btn-ghost" id="cancel-finish">Cancelar</button><button class="btn btn-primary" id="save-finish">Salvar</button></div>`;
  openModal(html);
  let rating = b.rating||0;
  const starsEl = document.getElementById('stars');
  function paintStars(){ [...starsEl.children].forEach((s,i)=> s.classList.toggle('on', i<rating)); }
  paintStars();
  starsEl.querySelectorAll('span').forEach(s=> s.addEventListener('click', ()=>{ rating = +s.dataset.n; paintStars(); }));
  document.getElementById('cancel-finish').addEventListener('click', closeModal);
  document.getElementById('save-finish').addEventListener('click', ()=>{
    b.status='concluido'; b.rating=rating; b.review=document.getElementById('review-text').value.trim(); b.finishedAt=Date.now(); b.progress.percent=100;
    saveUserData(); closeModal(); renderShelf();
  });
});

/* ==================================================================
   ESTATÍSTICAS / TEMPO DE LEITURA
   ================================================================== */
function startReadTimer(){
  stopReadTimer();
  state.readTimerHandle = setInterval(()=>{
    if(document.visibilityState!=='visible') return;
    state.data.stats.totalMinutes = (state.data.stats.totalMinutes||0) + (1/60);
    const k = todayKey();
    state.data.stats.dailyLog[k] = (state.data.stats.dailyLog[k]||0) + (1/60);
    saveUserData();
  }, 1000);
}
function stopReadTimer(){ if(state.readTimerHandle){ clearInterval(state.readTimerHandle); state.readTimerHandle=null; } }
function bumpStreak(){ /* streak calculado na renderStats a partir do dailyLog */ }

function computeStreak(log){
  let streak=0; let d = new Date();
  while(true){ const k = todayKey(d); if((log[k]||0) >= 1){ streak++; d.setDate(d.getDate()-1); } else break; }
  return streak;
}
function renderStats(){
  const s = state.data.stats;
  const totalMin = Math.round(s.totalMinutes||0);
  const finished = booksArray().filter(b=>b.status==='concluido').length;
  const streak = computeStreak(s.dailyLog||{});
  document.getElementById('stat-grid').innerHTML = `
    <div class="stat-card"><div class="num">${totalMin}</div><div class="lbl">minutos lidos no total</div></div>
    <div class="stat-card"><div class="num">${finished}</div><div class="lbl">livros concluídos</div></div>
    <div class="stat-card"><div class="num">${streak}</div><div class="lbl">dias seguidos lendo</div></div>
    <div class="stat-card"><div class="num">${booksArray().length}</div><div class="lbl">livros na estante</div></div>`;
  const days=[]; const now=new Date();
  for(let i=6;i>=0;i--){ const d=new Date(now); d.setDate(d.getDate()-i); days.push(d); }
  const max = Math.max(1, ...days.map(d=> s.dailyLog[todayKey(d)]||0));
  document.getElementById('week-chart').innerHTML = days.map(d=>{
    const v = s.dailyLog[todayKey(d)]||0;
    const h = Math.max(3, Math.round((v/max)*100));
    return `<div class="week-col"><div class="bar" style="height:100px;"><i style="height:${h}%"></i></div><div class="lbl">${['D','S','T','Q','Q','S','S'][d.getDay()]}</div></div>`;
  }).join('');
  const goal = state.data.settings.goal||20;
  const todayMin = Math.round(s.dailyLog[todayKey()]||0);
  const pct = Math.min(100, Math.round((todayMin/goal)*100));
  document.getElementById('goal-box').innerHTML = `
    <div class="goal-ring" style="background:conic-gradient(var(--brass) ${pct*3.6}deg, var(--surface-3) 0deg)"><div style="background:var(--surface);width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;">${pct}%</div></div>
    <div><div style="font-family:'Fraunces',serif;font-size:16px;">Meta diária: ${goal} min</div><div style="color:var(--muted);font-size:12.5px;margin-top:3px;">Hoje você leu ${todayMin} min. ${todayMin>=goal?'Meta batida — bom trabalho! 🎉':'Continue lendo para bater a meta de hoje.'}</div></div>`;
}
document.getElementById('in-goal').addEventListener('change', e=>{ state.data.settings.goal = +e.target.value; saveUserData(); renderStats(); });
document.getElementById('in-use-collections').addEventListener('change', e=>{ state.data.settings.useCollections = e.target.checked; saveUserData(); renderShelf(); });

/* ==================================================================
   CONFIGURAÇÕES: EXPORTAR / APAGAR
   ================================================================== */
document.getElementById('btn-export').addEventListener('click', ()=>{
  const light = JSON.parse(JSON.stringify(state.data));
  Object.values(light.books).forEach(b=>{ delete b.filePath; delete b.fileData; delete b.cover; });
  const blob = new Blob([JSON.stringify(light,null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'estante-'+state.userEmail+'.json'; a.click();
});
document.getElementById('btn-wipe').addEventListener('click', async ()=>{
  if(!confirm('Tem certeza? Isso vai apagar todos os livros, destaques e notas desta conta, sem volta.')) return;
  const paths = Object.values(state.data.books).filter(b=>b.format==='pdf' && b.filePath).map(b=>b.filePath);
  if(paths.length) await sb.storage.from(BOOKS_BUCKET).remove(paths);
  await sb.from('user_data').delete().eq('user_id', state.userId);
  state.data = await loadUserData();
  renderShelf(); renderStats();
});

/* resize handling: PDF reflui a página, TXT/EPUB repagina (com um pequeno atraso
   pra não recalcular a cada pixel enquanto a janela ainda está sendo arrastada) */
let resizeDebounce = null;
window.addEventListener('resize', ()=>{
  if(!document.getElementById('view-reader').classList.contains('active')) return;
  const b = state.data.books[state.currentBookId];
  if(!b) return;
  if(b.format==='pdf'){
    if(state.pdfDoc) renderPdfPage(state.pdfPageNum);
    return;
  }
  clearTimeout(resizeDebounce);
  resizeDebounce = setTimeout(()=> repaginateCurrentText(), 250);
});
window.addEventListener('beforeunload', ()=>{ saveCurrentProgress(); saveUserData(); });

})();
