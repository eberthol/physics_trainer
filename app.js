/* ================= CONFIG ================= */
const BOX_INTERVALS = [0, 1, 3, 7, 16, 35]; // days until due, indexed by box level 0..5
const TOPIC_PALETTE = ['#5FD4E3', '#9B87F5', '#F2B84B', '#5FD98A', '#F27F5F', '#7FA9F2', '#E38FD1', '#8FE3C0'];

const NAV_ITEMS = [
  {id:'overview', label:'Overview', icon:'ring'},
  {id:'collections', label:'Collections', icon:'book'},
  {id:'train', label:'Train', icon:'bolt'},
  {id:'library', label:'Library', icon:'book'},
  {id:'add', label:'Add card', icon:'plus'},
];

const ICONS = {
  ring: '<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" opacity="0.5"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z" fill="none" stroke="currentColor"/><path d="M4 19.5V4.5" stroke="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

/* ================= STATE ================= */
let deckCatalog = [];     // list from decks/index.json
let currentDeck = null;   // id of the selected deck
let currentDeckInfo = null;
let currentCollection = null;
let deckCards = [];       // cards from the currently loaded deck
let deckIndex = {};

let lastDeckByCollection = {};

let state = {
  customCards: [],       // user-added cards
  progress: {},          // cardId -> {box, nextDue, correct, incorrect, lastReviewed}
  meta: {totalReviews:0, correctReviews:0, runsCompleted:0},
  loaded: false,
};

let session = null;      // active training session
let expandedLibraryCard = null;
let currentView = 'overview';
let diffSelected = 2;
let newTopicMode = false;



/* ================= STORAGE ================= */
function storageKey(name) {
    return `${name}:${currentDeck}`;
}

function loadJSON(key, fallback) {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (e) {
        console.error(e);
        return fallback;
    }
}

function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function loadCollectionMemory() {
    lastDeckByCollection = loadJSON(
        "lastDeckByCollection",
        {}
    );
}

function saveCollectionMemory() {
    saveJSON(
        "lastDeckByCollection",
        lastDeckByCollection
    );
}

async function loadState() {

    state.customCards = loadJSON(storageKey("user-cards"), []);

    state.progress = loadJSON(storageKey("progress"), {});

    state.meta = loadJSON(storageKey("meta"), {
        totalReviews: 0,
        correctReviews: 0,
        runsCompleted: 0,
    });

    state.loaded = true;
}

async function saveCustomCards() {
    saveJSON(storageKey("user-cards"), state.customCards);
}

async function saveProgress() {
    saveJSON(storageKey("progress"), state.progress);
}

async function saveMeta() {
    saveJSON(storageKey("meta"), state.meta);
}

async function loadDeckCatalog() {

    const response = await fetch("decks/catalog.json", {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("Cannot load deck catalog");
    }

    deckCatalog = await response.json();
}

async function loadDeck(deckId) {
    const info = deckCatalog.find(d => d.id === deckId);

    if (!info) {
        throw new Error(`Unknown deck "${deckId}"`);
    }

    const response = await fetch(info.file, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`Cannot load ${info.file}`);
    }

    const deck = await response.json();

    currentDeck = info.id;
    currentDeckInfo = info;

    deckCards = deck.cards.map(card => ({
        ...card,
        id: makeCardId(info.id, card)
    }));
}

/* ================= HELPERS ================= */
async function loadDeckMetadata() {

    deckIndex = {};

    for (const deck of deckCatalog) {

        const response = await fetch(deck.file, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`Cannot load ${deck.file}`);
        }

        const json = await response.json();

        deckIndex[deck.id] = {
            cardCount: json.cards.length
        };
    }
}

function selectDeckForCollection(collection) {

    const decks = deckCatalog
        .filter(deck => deck.collection === collection)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    const remembered = lastDeckByCollection[collection];

    if (
        remembered &&
        decks.some(deck => deck.id === remembered)
    ) {
        return remembered;
    }

    return decks[0]?.id ?? null;
}

function hashString(str) {
    let h = 0;

    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h |= 0;   // keep as 32-bit integer
    }

    return Math.abs(h).toString(36);
}

function makeCardId(deckId, card) {

    const key = [
        card.topic.trim(),
        card.sub.trim(),
        card.q.trim()
    ].join("|");

    return `${deckId}:${hashString(key)}`;
}


function allCards(){ return deckCards.concat(state.customCards); }

function todayStr(){ return new Date().toISOString().slice(0,10); }
function addDays(dateStr, n){
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0,10);
}

function getProgress(cardId){
  return state.progress[cardId] || {box:0, nextDue: todayStr(), correct:0, incorrect:0, lastReviewed:null};
}
function isDue(cardId){
  const p = state.progress[cardId];
  if(!p) return true;
  return p.nextDue <= todayStr();
}
function purityOf(cardId){
  const p = state.progress[cardId];
  if(!p) return 0;
  return Math.round((p.box/5)*100);
}

function topicsInOrder(){
  const order = [];
  const seen = new Set();
  allCards().forEach(c=>{ if(!seen.has(c.topic)){ seen.add(c.topic); order.push(c.topic); } });
  return order;
}
function topicColor(topic){
  const order = topicsInOrder();
  const idx = order.indexOf(topic);
  return TOPIC_PALETTE[idx % TOPIC_PALETTE.length];
}
function subtopicsForTopic(topic){
  const set = new Set();
  allCards().forEach(c=>{ if(c.topic===topic) set.add(c.sub); });
  return [...set];
}

function topicStats(topic){
  const cards = allCards().filter(c=>c.topic===topic);
  const total = cards.length;
  if(total===0) return {total:0, avgPurity:0, due:0, mastered:0};
  let sum=0, due=0, mastered=0;
  cards.forEach(c=>{
    sum += purityOf(c.id);
    if(isDue(c.id)) due++;
    if((state.progress[c.id]||{}).box===5) mastered++;
  });
  return {total, avgPurity: Math.round(sum/total), due, mastered};
}

function deckStats(deckId) {

    const progress = loadJSON(`progress:${deckId}`, {});

    const total = deckIndex[deckId]?.cardCount ?? 0;

    let due = 0;
    let mastered = 0;
    let sumBoxes = 0;

    for (const p of Object.values(progress)) {

        sumBoxes += p.box;

        if (p.box === 5)
            mastered++;

        if (p.nextDue <= todayStr())
            due++;
    }

    return {
        total,
        due,
        mastered,
        purity: total
            ? Math.round(100 * sumBoxes / (5 * total))
            : 0
    };
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function renderMath(el){
  if(window.renderMathInElement){
    try{
      renderMathInElement(el, {
        delimiters: [
          {left:'$$', right:'$$', display:true},
          {left:'$', right:'$', display:false}
        ],
        throwOnError:false
      });
    }catch(e){ /* ignore */ }
  }
}

function showToast(msg, kind){
  const t = document.getElementById('toast');
  const dot = t.querySelector('.toast-dot');
  dot.style.background = kind==='bad' ? 'var(--bad)' : (kind==='amber' ? 'var(--amber)' : 'var(--good)');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ================= NAV / VIEWS ================= */
function buildSidebar(){
  const nav = document.getElementById('navList');
  nav.innerHTML = NAV_ITEMS.map(item=>{
    const due = item.id==='train' ? dueCountAll() : 0;
    const badge = (item.id==='train' && due>0) ? `<span class="nav-badge">${due}</span>` : '';
    return `<div class="nav-item ${item.id===currentView?'active':''}" onclick="goTo('${item.id}')">
      <svg viewBox="0 0 24 24">${ICONS[item.icon]}</svg>
      <span>${item.label}</span>${badge}
    </div>`;
  }).join('');
}

function dueCountAll(){
  return allCards().filter(c=>isDue(c.id)).length;
}

function goTo(view){
  currentView = view;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  buildSidebar();
  if(view==='overview') renderOverview();
  if(view==='collections') renderCollections();
  if(view==='train') renderTrainSetup();
  if(view==='library') renderLibrary();
  if(view==='add') renderAddForm();
}

function decksInCurrentCollection() {
    return deckCatalog
        .filter(deck => deck.collection === currentCollection)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

function buildCollectionSelector() {

    const sel = document.getElementById("collectionSelect");

    const collections = [...new Set(
        deckCatalog.map(deck => deck.collection)
    )];

    sel.innerHTML = collections.map(collection =>
        `<option value="${collection}">${collection}</option>`
    ).join("");

    if (!currentCollection) {
        currentCollection = collections[0];
    }

    sel.value = currentCollection;

    sel.onchange = async () => {

        currentCollection = sel.value;

        buildDeckSelector();

        const deckId = selectDeckForCollection(currentCollection);

        if (deckId) {
            await switchDeck(deckId);
        }
    };
}

function buildDeckSelector() {

    const sel = document.getElementById("deckSelect");

    const decks = decksInCurrentCollection();

    // Populate the selector
    sel.innerHTML = decks.map(deck =>
        `<option value="${deck.id}">${deck.name}</option>`
    ).join("");

    // Select the current deck if it belongs to this collection.
    // Otherwise select the first deck.
    const selected =
        decks.some(deck => deck.id === currentDeck)
            ? currentDeck
            : decks[0]?.id;

    if (selected) {
        sel.value = selected;
    }

    // Change deck
    sel.onchange = async () => {
        await switchDeck(sel.value);
    };
}


async function switchDeck(deckId) {

  await loadDeck(deckId);
  await loadState();

  currentCollection = currentDeckInfo.collection;

  lastDeckByCollection[currentCollection] = currentDeck;
  saveCollectionMemory();

  localStorage.setItem("selectedDeck", currentDeck);

  expandedLibraryCard = null;
  session = null;

  buildSidebar();
  goTo(currentView);
}

/* ================= OVERVIEW ================= */
function renderOverview(){

  const total = allCards().length;
  const due = dueCountAll();
  const mastered = allCards().filter(c=>(state.progress[c.id]||{}).box===5).length;
  const eff = state.meta.totalReviews>0 ? Math.round(100*state.meta.correctReviews/state.meta.totalReviews) : null;
  const deckSelect = document.getElementById("deckSelect");
  if (deckSelect) deckSelect.value = currentDeck;

  document.getElementById('statRow').innerHTML = `
    <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total cards</div></div>
    <div class="stat-card"><div class="stat-value amber">${due}</div><div class="stat-label">Due today</div></div>
    <div class="stat-card"><div class="stat-value alt">${mastered}</div><div class="stat-label">Mastered (Box 5)</div></div>
    <div class="stat-card"><div class="stat-value">${eff===null?'—':eff+'%'}</div><div class="stat-label">Efficiency (all-time)</div></div>
  `;

  const topics = topicsInOrder();
  document.getElementById('topicHistogram').innerHTML = topics.map(t=>{
    const s = topicStats(t);
    const color = topicColor(t);
    return `<div class="topic-row">
      <div class="topic-label">
        <div class="topic-name">${escapeHtml(t)}</div>
        <div class="topic-count">${s.total} cards · ${s.mastered} mastered</div>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${s.avgPurity}%;background:${color};color:${color};"></div></div>
      <div class="topic-pct">${s.avgPurity}%</div>
    </div>`;
  }).join('') + `
    <div style="margin-top:20px;text-align:right;">
      <button class="btn btn-ghost" onclick="confirmReset()">Reset all progress</button>
    </div>`;
}

function confirmReset(){
  if(confirm('This clears all review progress (box levels, due dates, efficiency stats). Custom cards you added are kept. Continue?')){
    state.progress = {};
    state.meta = {totalReviews:0, correctReviews:0, runsCompleted:0};
    saveProgress(); saveMeta();
    showToast('Progress reset', 'amber');
    renderOverview();
    buildSidebar();
  }
}

/* ================= COLLECTIONS ================= */
function renderCollections() {

    const groups = {};

    // Group decks by collection
    for (const deck of deckCatalog) {

        if (!groups[deck.collection]) {
            groups[deck.collection] = [];
        }

        groups[deck.collection].push(deck);
    }

    // Build the HTML
    let html = "";

    for (const [collection, decks] of Object.entries(groups)) {

        html += `
            <div class="panel" style="margin-bottom:20px;">
                <div class="panel-title">${collection}</div>
        `;

        for (const deck of decks) {

            const stats = deckStats(deck.id);

            html += `
            <div class="list-row"
                style="cursor:pointer; display:block;"
                onclick="switchDeck('${deck.id}')">

                <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:center;
                ">
                    <strong>${deck.name}</strong>

                    <span style="font-weight:600;">
                        ${stats.purity}%
                    </span>
                </div>

                <div class="bar-track" style="margin:10px 0 8px;">
                    <div class="bar-fill"
                        style="width:${stats.purity}%;"></div>
                </div>

                <div style="
                    font-size:12px;
                    color:var(--text-faint);
                ">
                    ${stats.total} cards ·
                    ${stats.due} due ·
                    ${stats.mastered} mastered
                </div>

            </div>
            `;
        }

        html += `</div>`;
    }

    document.getElementById("collectionsView").innerHTML = html;
}

/* ================= TRAIN ================= */
function renderTrainSetup(){
  // document.getElementById("trainDeckTitle").textContent = currentDeckInfo.title;
  document.getElementById("trainDeckTitle").textContent = currentDeckInfo?.name ?? "Train";
  document.getElementById("trainDeckSubtitle").textContent = "Select the topics you want to study.";
  document.getElementById('trainSetup').style.display = '';
  document.getElementById('trainStage').style.display = 'none';
  document.getElementById('trainSummary').style.display = 'none';
  document.getElementById('trainEmpty').style.display = 'none';

  const topics = topicsInOrder();
  const chipWrap = document.getElementById('topicChips');
  if(!chipWrap.dataset.init){
    chipWrap.innerHTML = topics.map(t=>`<div class="chip on" data-topic="${escapeHtml(t)}" onclick="toggleChip(this)">${escapeHtml(t)}</div>`).join('');
    chipWrap.dataset.init = '1';
  }
}

function toggleChip(el){ el.classList.toggle('on'); }

function toggleLibraryCard(cardId) {

    if (expandedLibraryCard === cardId)
        expandedLibraryCard = null;
    else
        expandedLibraryCard = cardId;

    renderLibrary();
}

function setAllTopics(selected) {

    document.querySelectorAll("#topicChips .chip").forEach(chip => {
            chip.classList.toggle("on", selected);
        });
}

function startSession(){
  const activeTopics = [...document.querySelectorAll('#topicChips .chip.on')].map(c=>c.dataset.topic);
  if(activeTopics.length===0){ showToast('Select at least one topic', 'bad'); return; }
  const mode = document.getElementById('queueMode').value;
  const shuffle = document.getElementById('shuffleToggle').checked;
  const diffFilter = document.getElementById('diffFilter').value;

  let pool = allCards().filter(c=>activeTopics.includes(c.topic));
  if(diffFilter !== 'all') pool = pool.filter(c=>c.diff === parseInt(diffFilter, 10));
  if(mode==='due') pool = pool.filter(c=>isDue(c.id));
  if(mode==='weak') pool = pool.slice().sort((a,b)=>purityOf(a.id)-purityOf(b.id));
  else if(shuffle) pool = pool.slice().sort(()=>Math.random()-0.5);

  if(pool.length===0){
    document.getElementById('trainSetup').style.display = '';
    document.getElementById('trainEmpty').style.display = '';
    document.getElementById('trainEmpty').innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>
        <h3>No cards match</h3>
        <p>Nothing due for this topic/difficulty combination. Try "All cards (practice)" or widen the difficulty filter.</p>
      </div>`;
    return;
  }

  session = {queue: pool, pos:0, revealed:false, reviewed:0, correct:0, masteredDelta:0};
  document.getElementById('trainSetup').style.display = 'none';
  document.getElementById('trainEmpty').style.display = 'none';
  document.getElementById('trainStage').style.display = '';
  renderCard();
}

function renderCard(){
  const card = session.queue[session.pos];
  const p = getProgress(card.id);
  session.revealed = false;

  document.getElementById('sessionPos').textContent = `${session.pos+1} / ${session.queue.length}`;
  document.getElementById('sessionFill').style.width = `${Math.round(100*session.pos/session.queue.length)}%`;
  document.getElementById('sessionAcc').textContent = session.reviewed>0 ? `${Math.round(100*session.correct/session.reviewed)}% acc.` : '— acc.';

  document.getElementById('cardTopic').textContent = card.topic;
  document.getElementById('cardSub').textContent = card.sub;
  document.getElementById('cardQuestion').innerHTML = escapeHtml(card.q).replace(/\n/g,'<br>');
  document.getElementById('cardAnswer').innerHTML = escapeHtml(card.a).replace(/\n/g,'<br>');
  document.getElementById('cardAnswer').classList.add('hidden');
  document.getElementById('cardDiffTag').innerHTML = `<span class="difficulty-tag diff-${card.diff}">${['','foundational','intermediate','advanced'][card.diff]}</span>`;

  const dots = [1,2,3,4,5].map(n=>`<div class="box-dot ${n<=p.box?'filled':''}"></div>`).join('');
  document.getElementById('boxDots').innerHTML = dots;

  document.getElementById('cardActionsReveal').style.display = '';
  document.getElementById('cardActionsGrade').style.display = 'none';

  renderMath(document.getElementById('cardQuestion'));
  renderMath(document.getElementById('cardAnswer'));
}

function revealAnswer(){
  if(session.revealed) return;
  session.revealed = true;
  document.getElementById('cardAnswer').classList.remove('hidden');
  document.getElementById('cardActionsReveal').style.display = 'none';
  document.getElementById('cardActionsGrade').style.display = '';
}

async function gradeCard(correct){
  if(!session.revealed) return;
  const card = session.queue[session.pos];
  const p = getProgress(card.id);
  const prevBox = p.box;
  const newBox = correct ? Math.min(p.box+1, 5) : 0;

  state.progress[card.id] = {
    box: newBox,
    nextDue: addDays(todayStr(), BOX_INTERVALS[newBox]),
    correct: p.correct + (correct?1:0),
    incorrect: p.incorrect + (correct?0:1),
    lastReviewed: todayStr(),
  };

  session.reviewed++;
  if(correct) session.correct++;
  if(newBox===5 && prevBox!==5) session.masteredDelta++;

  state.meta.totalReviews++;
  if(correct) state.meta.correctReviews++;

  await saveProgress();
  await saveMeta();

  session.pos++;
  if(session.pos >= session.queue.length){
    finishSession();
  } else {
    renderCard();
  }
  buildSidebar();
}

async function finishSession(){
  state.meta.runsCompleted++;
  await saveMeta();
  document.getElementById('trainStage').style.display = 'none';
  document.getElementById('trainSummary').style.display = '';
  document.getElementById('sumReviewed').textContent = session.reviewed;
  document.getElementById('sumAcc').textContent = session.reviewed>0 ? Math.round(100*session.correct/session.reviewed)+'%' : '0%';
  document.getElementById('sumMastered').textContent = session.masteredDelta;
  session = null;
}

function backToSetup(){
  renderTrainSetup();
}

/* keyboard shortcuts during training */
document.addEventListener('keydown', (e)=>{
  if(currentView!=='train' || !session) return;
  if(e.code==='Space'){ e.preventDefault(); if(!session.revealed) revealAnswer(); }
  if(e.key==='1' && session.revealed) gradeCard(false);
  if(e.key==='2' && session.revealed) gradeCard(true);
});

/* ================= LIBRARY ================= */
function renderLibrary(){
  const filterSel = document.getElementById('libTopicFilter');
  if(!filterSel.dataset.init){
    const topics = topicsInOrder();
    filterSel.innerHTML = `<option value="">All topics</option>` + topics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    filterSel.dataset.init = '1';
  }

  const q = document.getElementById('libSearch').value.trim().toLowerCase();
  const topicFilter = filterSel.value;

  let cards = allCards();
  if(topicFilter) cards = cards.filter(c=>c.topic===topicFilter);
  if(q) cards = cards.filter(c=>
    c.q.toLowerCase().includes(q) || c.a.toLowerCase().includes(q) ||
    c.sub.toLowerCase().includes(q) || c.topic.toLowerCase().includes(q)
  );

  if(cards.length===0){
    document.getElementById('libraryList').innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
        <h3>No cards match</h3><p>Try a different search or filter.</p>
      </div>`;
    return;
  }

  const groups = {};
  cards.forEach(c=>{ groups[c.topic] = groups[c.topic] || []; groups[c.topic].push(c); });

  const html = topicsInOrder().filter(t=>groups[t]).map(t=>{
    const color = topicColor(t);
    const items = groups[t].map(c=>{
      const isCustom = c.id.startsWith('c-');
      const pct = purityOf(c.id);
      const expanded = expandedLibraryCard === c.id;
      const answer = expanded
          ? escapeHtml(c.a)
          : escapeHtml(c.a).slice(0,180) +
            (c.a.length > 180 ? "…" : "");
      return `<div class="lib-card" onclick="toggleLibraryCard('${c.id}')">
        <div class="lib-card-body">
          <div class="lib-card-q">${escapeHtml(c.q)}</div>
          <div class="lib-card-a">${answer}</div>

          <div style="
              margin-top:8px;
              font-size:11px;
              color:var(--text-faint);
          ">
              ${expanded ? "▲ Click to collapse" : "▼ Click to expand"}
          </div>
        </div>
        
        <div class="lib-card-meta">
          <span class="purity-pill">${pct}%</span>
          ${isCustom ? `<button class="icon-btn" title="Delete card" onclick="deleteCard('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg></button>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="lib-group">
      <div class="lib-group-head">
        <div class="lib-group-dot" style="background:${color};"></div>
        <div class="lib-group-title">${escapeHtml(t)}</div>
        <div class="lib-group-count">${groups[t].length} cards</div>
      </div>
      ${items}
    </div>`;
  }).join('');

  document.getElementById('libraryList').innerHTML = html;
  renderMath(document.getElementById('libraryList'));
}

async function deleteCard(id){
  if(!confirm('Delete this custom card? This cannot be undone.')) return;
  state.customCards = state.customCards.filter(c=>c.id!==id);
  delete state.progress[id];
  await saveCustomCards();
  await saveProgress();
  showToast('Card deleted', 'amber');
  renderLibrary();
}

/* ---- Export / Import as standalone .json packs ----
   This keeps card content decoupled from the app itself: new topics or
   deeper decks can be shipped as small .json files and loaded here,
   instead of growing this HTML file forever. */
function exportDeck(){
  const payload = allCards().map(c=>({topic:c.topic, sub:c.sub, q:c.q, a:c.a, diff:c.diff}));
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nuclide-deck-' + todayStr() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`Exported ${payload.length} cards`, 'good');
}

function triggerImportFile(){
  document.getElementById('importFileInput').click();
}

async function onImportFileChosen(event){
  const file = event.target.files[0];
  event.target.value = ''; // allow re-selecting the same file later
  if(!file) return;
  try{
    const text = await file.text();
    const parsed = JSON.parse(text);
    if(!Array.isArray(parsed)) throw new Error('Expected a JSON array of cards');

    let added = 0, skipped = 0;
    parsed.forEach(item=>{
      if(!item || !item.topic || !item.sub || !item.q || !item.a){ skipped++; return; }
      const diff = [1,2,3].includes(item.diff) ? item.diff : 2;
      state.customCards.push({
        id: 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
        topic: String(item.topic).trim(),
        sub: String(item.sub).trim(),
        q: String(item.q).trim(),
        a: String(item.a).trim(),
        diff,
      });
      added++;
    });

    if(added>0) await saveCustomCards();
    showToast(`Imported ${added} card${added===1?'':'s'}${skipped?`, skipped ${skipped}`:''}`, added>0?'good':'bad');
    buildSidebar();
    renderLibrary();
  }catch(e){
    showToast('Could not read that file — expecting a JSON array of {topic, sub, q, a, diff}', 'bad');
  }
}

/* ================= ADD CARD ================= */
function renderAddForm(){
  const sel = document.getElementById('fTopicSelect');
  const topics = topicsInOrder();
  sel.innerHTML = topics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') + `<option value="__new__">+ New topic…</option>`;
  onTopicSelectChange();
  updateSubList();

  document.querySelectorAll('.diff-opt').forEach(el=>{
    el.onclick = ()=>{
      document.querySelectorAll('.diff-opt').forEach(o=>o.classList.remove('sel'));
      el.classList.add('sel');
      diffSelected = parseInt(el.dataset.v, 10);
    };
  });
}

function onTopicSelectChange(){
  const sel = document.getElementById('fTopicSelect');
  newTopicMode = sel.value === '__new__';
  document.getElementById('fNewTopicField').style.display = newTopicMode ? '' : 'none';
  updateSubList();
}

function updateSubList(){
  const sel = document.getElementById('fTopicSelect');
  const dl = document.getElementById('subList');
  if(newTopicMode){ dl.innerHTML=''; return; }
  const subs = subtopicsForTopic(sel.value);
  dl.innerHTML = subs.map(s=>`<option value="${escapeHtml(s)}">`).join('');
}

async function submitCard(){
  const sel = document.getElementById('fTopicSelect');
  let topic = sel.value === '__new__' ? document.getElementById('fNewTopic').value.trim() : sel.value;
  const sub = document.getElementById('fSub').value.trim();
  const q = document.getElementById('fQuestion').value.trim();
  const a = document.getElementById('fAnswer').value.trim();

  if(!topic){ showToast('Give this topic a name', 'bad'); return; }
  if(!sub){ showToast('Add a subtopic label', 'bad'); return; }
  if(!q || !a){ showToast('Question and answer are both required', 'bad'); return; }

  const card = {
    id: 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
    topic, sub, q, a, diff: diffSelected,
  };
  state.customCards.push(card);
  await saveCustomCards();

  document.getElementById('fSub').value = '';
  document.getElementById('fQuestion').value = '';
  document.getElementById('fAnswer').value = '';
  document.getElementById('fNewTopic').value = '';

  showToast(`Added to ${topic}`, 'good');
  buildSidebar();
  renderAddForm();
}
/* ================= APP VERSION ================= */
async function loadAppVersion() {
  try {
    const response = await fetch("version.json", { cache: "no-store" });
    if (!response.ok) return "unknown";

    const data = await response.json();
    return String(data.version || "unknown");
  } catch {
    return "unknown";
  }
}

/* ================= INIT ================= */
async function init() {

    document.getElementById("sidebarFoot").textContent = "syncing…";

    const version = await loadAppVersion();
    document.getElementById("appVersion").textContent = version;

    await loadDeckCatalog();
    await loadDeckMetadata();

    loadCollectionMemory();

    const savedDeck = localStorage.getItem("selectedDeck");

    const deckToLoad = deckCatalog.some(deck => deck.id === savedDeck)
        ? savedDeck
        : deckCatalog[0].id;

    // Establish the initial collection BEFORE building the selectors
    currentCollection =
        deckCatalog.find(deck => deck.id === deckToLoad).collection;

    // Build the selectors
    buildCollectionSelector();
    buildDeckSelector();

    // Load the selected deck
    await switchDeck(deckToLoad);

    document.getElementById("sidebarFoot").innerHTML =
        `Version ${version}<br>${allCards().length} cards loaded<br>local session`;
}
init();