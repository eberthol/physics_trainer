/* ================= CONFIG ================= */
const BOX_INTERVALS = [0, 1, 3, 7, 16, 35]; // days until due, indexed by box level 0..5
const TOPIC_PALETTE = ['#5FD4E3', '#9B87F5', '#F2B84B', '#5FD98A', '#F27F5F', '#7FA9F2', '#E38FD1', '#8FE3C0'];

const NAV_ITEMS = [
  {id:'overview', label:'Dashboard', icon:'ring'},
  {id:'train', label:'Train', icon:'bolt'},
  {id:'library', label:'Library', icon:'book'},
  {id:'maps', label:'Concept Maps', icon:'book'}
];

const ICONS = {
  ring: '<circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" opacity="0.5"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z" fill="none" stroke="currentColor"/><path d="M4 19.5V4.5" stroke="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};

/* ================= STATE ================= */
let deckCatalog = [];     // list from decks/catalog.json
let mapCatalog = [];      // list from maps/catalog.json
let chapterCatalog = [];
let chapterManifests = [];
let currentDeck = null;   // id of the selected deck
let currentDeckInfo = null;
let currentCollection = null;
let currentMap = null;
let deckCards = [];       // cards from the currently loaded deck
let deckIndex = {};

let lastDeckByCollection = {};
let pendingStudySelection = null;
let mapDeckFilter = null;
let openDashboardDeckId = null;

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

async function loadMapCatalog() {

    const response = await fetch("maps/catalog.json", {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("Cannot load map catalog");
    }

    mapCatalog = await response.json();
}

async function loadChapterCatalog() {
    const response = await fetch("maps/chapters.json", {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("Cannot load chapter catalog");
    }

    const data = await response.json();

    chapterCatalog = data.map((chapter, index) => ({
        ...chapter,
        chapterKey: (chapter.id?.trim() || chapter.deck?.trim() || `chapter-${index}`)
    }));
}

async function loadChapterManifests() {
    chapterManifests = [];

    await Promise.all(
        chapterCatalog.map(async chapter => {
            const response = await fetch(chapter.manifest, {
                cache: "no-store"
            });

            if (!response.ok) {
                throw new Error(`Cannot load ${chapter.manifest}`);
            }

            const data = await response.json();

            chapterManifests.push({
                ...chapter,
                ...data,
                chapterKey: chapter.chapterKey
            });
        })
    );
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
function renderFigureMarkup(figure) {
    if (!figure) return "";

    const figures = Array.isArray(figure) ? figure : [figure];

    return `
        <div class="figure-stack">
            ${figures
                .filter(f => f && f.src)
                .map(f => {

                    const size = f.size ?? "medium";

                    const alt = f.alt ?? f.caption ?? "";

                    const caption = f.caption
                        ? `<figcaption>${escapeHtml(f.caption)}</figcaption>`
                        : "";

                    return `
                        <figure class="card-figure">
                            <img
                                class="figure-thumb size-${size}"
                                src="${escapeHtml(f.src)}"
                                alt="${escapeHtml(alt)}"
                                data-caption="${escapeHtml(f.caption ?? "")}"
                                loading="lazy"
                                decoding="async"
                                onclick="openFigureModalFromEl(this)">
                            ${caption}
                        </figure>
                    `;
                })
                .join("")}
        </div>
    `;
}

function openFigureModalFromEl(imgEl) {
  openFigureModal(
    imgEl.src,
    imgEl.dataset.caption || "",
    imgEl.alt || ""
  );
}

function openFigureModal(src, caption, alt) {
  const modal = document.getElementById("figureModal");
  const img = document.getElementById("figureModalImg");
  const cap = document.getElementById("figureModalCaption");

  img.src = src;
  img.alt = alt || caption || "";
  cap.textContent = caption || "";

  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeFigureModal() {
  const modal = document.getElementById("figureModal");
  const img = document.getElementById("figureModalImg");

  img.src = "";
  img.alt = "";
  document.getElementById("figureModalCaption").textContent = "";

  modal.classList.remove("show");
  document.body.style.overflow = "";
}

function onLibraryTopicChange() {

    const topic =
        document.getElementById("libTopicFilter").value;

    const sectionSel =
        document.getElementById("libSectionFilter");

    const sections = [...new Set(
        allCards()
            .filter(card =>
                !topic || card.topic === topic
            )
            .map(card => card.sub)
    )];

    sectionSel.innerHTML =
        `<option value="">All sections</option>` +
        sections.map(section =>
            `<option value="${escapeHtml(section)}">
                ${escapeHtml(section)}
            </option>`
        ).join("");

    renderLibrary();
}

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

        const cards = json.cards.map(card => ({
            ...card,
            id: makeCardId(deck.id, card)
        }));

        deckIndex[deck.id] = {
            cardCount: cards.length,
            cards
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

function getCardsForDeck(deckId) {

    const builtInCards =
        deckIndex[deckId]?.cards ?? [];

    const customCards =
        loadJSON(`user-cards:${deckId}`, []);

    return [
        ...builtInCards,
        ...customCards
    ];
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
function sectionsInOrder() {

    const order = [];
    const seen = new Set();

    allCards().forEach(card => {

        if (!seen.has(card.sub)) {
            seen.add(card.sub);
            order.push(card.sub);
        }

    });

    return order;
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

    const builtInCards =
        deckIndex[deckId]?.cards ?? [];

    const customCards =
        loadJSON(`user-cards:${deckId}`, []);

    const cards = [
        ...builtInCards,
        ...customCards
    ];

    const progress =
        loadJSON(`progress:${deckId}`, {});

    const meta =
        loadJSON(`meta:${deckId}`, {
            totalReviews: 0,
            correctReviews: 0,
            runsCompleted: 0
        });

    let due = 0;
    let mastered = 0;
    let sumBoxes = 0;

    for (const card of cards) {

        const cardProgress = progress[card.id];

        // Unreviewed cards are due immediately.
        if (
            !cardProgress ||
            cardProgress.nextDue <= todayStr()
        ) {
            due++;
        }

        const box = cardProgress?.box ?? 0;

        sumBoxes += box;

        if (box === 5) {
            mastered++;
        }
    }

    const total = cards.length;

    const efficiency =
        meta.totalReviews > 0
            ? Math.round(
                100 *
                meta.correctReviews /
                meta.totalReviews
            )
            : null;

    return {
        total,
        due,
        mastered,

        purity:
            total > 0
                ? Math.round(
                    100 * sumBoxes / (5 * total)
                )
                : 0,

        totalReviews: meta.totalReviews,
        correctReviews: meta.correctReviews,
        runsCompleted: meta.runsCompleted,
        efficiency
    };
}

function deckConceptMapStats(deckId) {
    const mapById = Object.fromEntries(
        (mapCatalog ?? []).map(m => [m.id, m])
    );

    const chapters = (chapterManifests ?? [])
        .filter(ch => ch.deck === deckId);

    const mapItems = chapters.flatMap(ch =>
        (ch.items ?? []).filter(item => item.type === "map")
    );

    return mapItems
        .map(item => {
            const meta = mapById[item.id];
            if (!meta) return null;

            const stats = conceptStats(meta);

            return {
                meta,
                stats,
                chapterTitle: chapters.find(ch => (ch.items ?? []).some(i => i.id === item.id))
                    ?.chapterTitle ?? ""
            };
        })
        .filter(Boolean);
}

function deckProgressStats(deckId) {

    const cards = getCardsForDeck(deckId);
    const progress = loadJSON(`progress:${deckId}`, {});

    const groups = {};

    let boxSum = 0;
    let due = 0;
    let mastered = 0;
    let correct = 0;
    let incorrect = 0;

    for (const card of cards) {

        const sub = card.sub ?? "Other";

        if (!groups[sub]) {
            groups[sub] = {
                name: sub,
                total: 0,
                due: 0,
                mastered: 0,
                boxSum: 0,
                correct: 0,
                incorrect: 0
            };
        }

        const group = groups[sub];
        const cardProgress = progress[card.id];

        const box = cardProgress?.box ?? 0;
        const cardCorrect = cardProgress?.correct ?? 0;
        const cardIncorrect = cardProgress?.incorrect ?? 0;

        group.total++;
        group.boxSum += box;
        group.correct += cardCorrect;
        group.incorrect += cardIncorrect;

        boxSum += box;
        correct += cardCorrect;
        incorrect += cardIncorrect;

        if (!cardProgress || cardProgress.nextDue <= todayStr()) {
            due++;
            group.due++;
        }

        if (box === 5) {
            mastered++;
            group.mastered++;
        }
    }

    const subtopics =
        Object.values(groups).map(group => {
            const reviews = group.correct + group.incorrect;

            return {
                name: group.name,
                total: group.total,
                due: group.due,
                mastered: group.mastered,
                purity:
                    group.total > 0
                        ? Math.round(100 * group.boxSum / (5 * group.total))
                        : 0,
                reviews,
                efficiency:
                    reviews > 0
                        ? Math.round(100 * group.correct / reviews)
                        : null
            };
        });

    const total = cards.length;
    const reviews = correct + incorrect;

    return {
        total,
        due,
        mastered,
        purity:
            total > 0
                ? Math.round(100 * boxSum / (5 * total))
                : 0,
        reviews,
        efficiency:
            reviews > 0
                ? Math.round(100 * correct / reviews)
                : null,
        subtopics
    };
}

function renderDeckProgressPanel(deckId) {
    const deck = deckCatalog.find(d => d.id === deckId);
    if (!deck) return "";

    const deckMaps = deckConceptMapStats(deckId);

    if (deckMaps.length === 0) {
        return `
            <div class="dashboard-deck-progress-panel">
                <div class="dashboard-progress-placeholder">
                    No concept maps found for this deck.
                </div>
            </div>
        `;
    }

    const deckStatsSummary = deckStats(deckId);

    const mapRows = deckMaps
        .sort((a, b) =>
            (a.meta.order ?? 999) - (b.meta.order ?? 999) ||
            String(a.meta.title ?? "").localeCompare(String(b.meta.title ?? ""))
        )
        .map(({ meta, stats, chapterTitle }) => {
            const efficiencyText =
                stats.efficiency === null ? "—" : `${stats.efficiency}%`;

            return `
                <div class="concept-map-progress-row">

                    <div class="concept-map-progress-head">
                        <div class="concept-map-progress-name">
                            ${escapeHtml(meta.title)}
                        </div>

                        <div class="concept-map-progress-purity">
                            ${stats.purity}%
                        </div>
                    </div>

                    ${
                        chapterTitle
                            ? `
                                <div class="concept-map-progress-chapter">
                                    ${escapeHtml(chapterTitle)}
                                </div>
                              `
                            : ""
                    }

                    <div class="bar-track concept-map-progress-track">
                        <div
                            class="bar-fill"
                            style="width:${stats.purity}%;background:var(--cherenkov);">
                        </div>
                    </div>

                    <div class="concept-map-progress-meta">
                        <span>${stats.total} cards</span>
                        <span>${stats.due} due</span>
                        <span>${stats.mastered} mastered</span>
                        <span>${efficiencyText} efficiency</span>
                    </div>

                </div>
            `;
        })
        .join("");

    return `
        <div class="dashboard-deck-progress-panel">

            <div class="concept-stats-header">
                <div>
                    <div class="concept-stats-title">
                        Concept maps
                    </div>

                    <div class="concept-stats-subtitle">
                        Progress per concept map in this deck.
                    </div>
                </div>

                <div class="concept-stats-overall">
                    ${deckStatsSummary.purity}%
                </div>
            </div>

            <div class="concept-stats-grid">
                <div class="concept-stat-card">
                    <div class="concept-stat-value">${deckStatsSummary.total}</div>
                    <div class="concept-stat-label">Cards</div>
                </div>
                <div class="concept-stat-card">
                    <div class="concept-stat-value amber">${deckStatsSummary.due}</div>
                    <div class="concept-stat-label">Due</div>
                </div>
                <div class="concept-stat-card">
                    <div class="concept-stat-value alt">${deckStatsSummary.mastered}</div>
                    <div class="concept-stat-label">Mastered</div>
                </div>
                <div class="concept-stat-card">
                    <div class="concept-stat-value">
                        ${
                            deckStatsSummary.efficiency === null
                                ? "—"
                                : `${deckStatsSummary.efficiency}%`
                        }
                    </div>
                    <div class="concept-stat-label">Efficiency</div>
                </div>
            </div>

            <div class="concept-stats-progress">
                <div class="concept-stats-progress-head">
                    <span>Overall deck mastery</span>
                    <span>${deckStatsSummary.purity}%</span>
                </div>

                <div class="bar-track">
                    <div
                        class="bar-fill"
                        style="width:${deckStatsSummary.purity}%;background:var(--scint);">
                    </div>
                </div>
            </div>

            <div class="concept-map-progress-list">
                ${mapRows}
            </div>
        </div>
    `;
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
function buildSidebar() {

  const nav = document.getElementById("navList");

  nav.innerHTML = NAV_ITEMS.map(item => {

    const due =
      item.id === "train"
        ? dueCountAll()
        : 0;

    const badge =
      item.id === "train" && due > 0
        ? `<span class="nav-badge">${due}</span>`
        : "";

    const action =
      item.id === "maps"
        ? "openAllConceptMaps()"
        : `goTo('${item.id}')`;

    return `
      <div
        class="nav-item ${item.id === currentView ? "active" : ""}"
        onclick="${action}"
      >
        <svg viewBox="0 0 24 24">
          ${ICONS[item.icon]}
        </svg>

        <span>${item.label}</span>

        ${badge}
      </div>
    `;
  }).join("");
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
  if(view==='train') renderTrainSetup();
  if(view==='library') renderLibrary();
  if(view==='maps') renderMapBrowser();
  if(view==='map') renderConceptMap();
}

function decksInCurrentCollection() {
    return deckCatalog
        .filter(deck => deck.collection === currentCollection)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

async function switchDeck(deckId, options = {}) {

    const { navigate = true } = options;

    await loadDeck(deckId);
    await loadState();

    initLibraryFilters();

    currentCollection = currentDeckInfo.collection;

    lastDeckByCollection[currentCollection] = currentDeck;
    saveCollectionMemory();

    localStorage.setItem("selectedDeck", currentDeck);

    expandedLibraryCard = null;
    session = null;

    buildSidebar();

    if (navigate) {
        goTo(currentView);
    }
}

async function setCurrentDeck(deckId) {
    if (deckId === currentDeck) {
        return;
    }

    await switchDeck(deckId, { navigate: false });
    renderOverview();
    showToast("Current deck updated");
}

/* ================= DASHBOARD ================= */
function renderOverview() {

    const deckResults = deckCatalog.map(deck => ({
        deck,
        stats: deckStats(deck.id)
    }));

    const globalStats = deckResults.reduce(
        (totals, item) => {

            totals.cards += item.stats.total;
            totals.due += item.stats.due;
            totals.mastered += item.stats.mastered;
            totals.reviews += item.stats.totalReviews;
            totals.correct += item.stats.correctReviews;

            return totals;
        },
        {
            cards: 0,
            due: 0,
            mastered: 0,
            reviews: 0,
            correct: 0
        }
    );

    const globalEfficiency =
        globalStats.reviews > 0
            ? Math.round(
                100 *
                globalStats.correct /
                globalStats.reviews
            )
            : null;

    // ------------------------------------------------------------
    // Global statistics
    // ------------------------------------------------------------

    document.getElementById("dashboardStats").innerHTML = `
        <div class="stat-card">
            <div class="stat-value">
                ${globalStats.cards}
            </div>
            <div class="stat-label">
                Total cards
            </div>
        </div>

        <div class="stat-card">
            <div class="stat-value amber">
                ${globalStats.due}
            </div>
            <div class="stat-label">
                Due now
            </div>
        </div>

        <div class="stat-card">
            <div class="stat-value alt">
                ${globalStats.mastered}
            </div>
            <div class="stat-label">
                Mastered
            </div>
        </div>

        <div class="stat-card">
            <div class="stat-value">
                ${
                    globalEfficiency === null
                        ? "—"
                        : `${globalEfficiency}%`
                }
            </div>
            <div class="stat-label">
                Recall efficiency
            </div>
        </div>
    `;

    // ------------------------------------------------------------
    // Continue studying
    // ------------------------------------------------------------

    const activeDeck =
        deckCatalog.find(deck => deck.id === currentDeck);

    const activeStats =
        activeDeck
            ? deckStats(activeDeck.id)
            : null;

    const continueRoot =
        document.getElementById("dashboardContinue");

    if (activeDeck && activeStats) {

        continueRoot.innerHTML = `
            <section class="dashboard-continue">

                <div class="dashboard-continue-copy">

                    <div class="page-eyebrow">
                        Continue studying
                    </div>

                    <div class="dashboard-continue-title">
                        ${escapeHtml(activeDeck.name)}
                    </div>

                    <div class="dashboard-continue-collection">
                        ${escapeHtml(activeDeck.collection)}
                    </div>

                    <div class="dashboard-continue-meta">
                        ${activeStats.total} cards
                        · ${activeStats.due} due
                        · ${activeStats.purity}% progress
                    </div>

                </div>

                <button
                    class="btn btn-primary"
                    onclick="openDeckView('${activeDeck.id}', 'train')">

                    Continue training

                </button>

            </section>
        `;
    } else {
        continueRoot.innerHTML = "";
    }

    // ------------------------------------------------------------
    // Decks grouped by book / collection
    // ------------------------------------------------------------

    const books = {};

    for (const item of deckResults) {

        const bookTitle =
            item.deck.collection ?? "Other";

        if (!books[bookTitle]) {
            books[bookTitle] = [];
        }

        books[bookTitle].push(item);
    }

    document.getElementById("dashboardDecks").innerHTML =
        Object.entries(books)
            .map(([bookTitle, items]) => {

                const bookStats = items.reduce(
                    (totals, { stats }) => {

                        totals.cards += stats.total;
                        totals.due += stats.due;
                        totals.mastered += stats.mastered;
                        totals.weightedPurity +=
                            stats.purity * stats.total;

                        return totals;
                    },
                    {
                        cards: 0,
                        due: 0,
                        mastered: 0,
                        weightedPurity: 0
                    }
                );

                const bookPurity =
                    bookStats.cards > 0
                        ? Math.round(
                            bookStats.weightedPurity /
                            bookStats.cards
                        )
                        : 0;

                const deckRows = items
                    .slice()
                    .sort(
                        (a, b) =>
                            (a.deck.order ?? 999) -
                            (b.deck.order ?? 999)
                    )
                    .map(({ deck, stats }) => {

                        const isCurrent =
                            deck.id === currentDeck;

                        return `
                            <div class="dashboard-deck-row">
                                <div class="dashboard-deck-main">
                                    <div class="dashboard-deck-heading">
                                        <div>
                                            <div class="dashboard-deck-name">
                                                ${escapeHtml(deck.name)}
                                            </div>
                                            ${
                                                isCurrent
                                                    ? `
                                                        <div class="dashboard-current-label">
                                                            Current deck
                                                        </div>
                                                    `
                                                    : ""
                                            }
                                        </div>
                                        <div class="dashboard-deck-purity">
                                            ${stats.purity}%
                                        </div>
                                    </div>
                                    <div class="bar-track dashboard-deck-track">
                                        <div
                                            class="bar-fill"
                                            style="
                                                width:${stats.purity}%;
                                                background:var(--cherenkov);
                                            ">
                                        </div>
                                    </div>
                                    <div class="dashboard-deck-meta">
                                        <span>${stats.total} cards</span>
                                        <span>${stats.due} due</span>
                                        <span>${stats.mastered} mastered</span>
                                        ${
                                            stats.efficiency === null
                                                ? ""
                                                : `<span>${stats.efficiency}% efficiency</span>`
                                        }
                                    </div>
                                </div>
                                <div class="dashboard-deck-actions">
                                    ${
                                        isCurrent
                                            ? `
                                                <span class="dashboard-current-badge">
                                                    Current
                                                </span>
                                            `
                                            : `
                                                <button
                                                    class="btn btn-ghost dashboard-set-current"
                                                    onclick="setCurrentDeck('${deck.id}')">

                                                    Set current

                                                </button>
                                            `
                                    }
                                    <button
                                        class="btn btn-ghost"
                                        onclick="toggleDeckProgress('${deck.id}')">
                                        View progress
                                    </button>
                                    <button
                                        class="btn btn-primary"
                                        onclick="openDeckView('${deck.id}', 'train')">
                                        Train
                                    </button>
                                    <button
                                        class="btn btn-ghost"
                                        onclick="openDeckView('${deck.id}', 'library')">
                                        Library
                                    </button>
                                    <button
                                        class="btn btn-ghost"
                                        onclick="openDeckMaps('${deck.id}')">
                                        Maps
                                    </button>
                                </div>
                            </div>
                        `;
                    })
                    .join("");

                return `
                    <section class="dashboard-book">

                        <div class="dashboard-book-head">

                            <div>
                                <div class="dashboard-book-label">
                                    Book
                                </div>

                                <div class="dashboard-book-title">
                                    ${escapeHtml(bookTitle)}
                                </div>
                            </div>

                            <div class="dashboard-book-summary">
                                <span>${items.length} deck${items.length === 1 ? "" : "s"}</span>
                                <span>${bookStats.cards} cards</span>
                                <span>${bookStats.due} due</span>
                                <strong>${bookPurity}%</strong>
                            </div>

                        </div>

                        <div class="dashboard-book-progress">
                            <div class="bar-track">
                                <div
                                    class="bar-fill"
                                    style="
                                        width:${bookPurity}%;
                                        background:var(--scint);
                                    ">
                                </div>
                            </div>
                        </div>

                        <div class="dashboard-book-decks">
                            ${deckRows}
                        </div>

                        ${
                            items.some(item => item.deck.id === openDashboardDeckId)
                                ? renderDeckProgressPanel(openDashboardDeckId)
                                : ""
                        }

                    </section>
                `;
            })
            .join("");
}

async function openDeckView(deckId, view) {

    if (!deckCatalog.some(deck => deck.id === deckId)) {
        console.error(`Unknown deck "${deckId}"`);
        return;
    }

    if (currentDeck !== deckId) {
        await switchDeck(deckId, {
            navigate: false
        });
    }

    goTo(view);
}

function toggleDeckProgress(deckId) {
  openDashboardDeckId =
    openDashboardDeckId === deckId ? null : deckId;

  renderOverview();
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

function openDeckMaps(deckId) {
    mapDeckFilter = deckId;
    goTo("maps");
}

/* ================= MAPS ================= */
async function studyCurrentConcept() {
    const study = currentMap?.study;
    const targetDeck = currentMap?.deck;

    if (!targetDeck || !study?.subtopics?.length) {
        showToast("No linked study material for this concept", "amber");
        return;
    }

    pendingStudySelection = {
        subtopics: study.subtopics
    };

    if (currentDeck !== targetDeck) {
        await switchDeck(targetDeck, { navigate: false });
    }

    goTo("train");
}

function renderMapBrowser() {
    const root = document.getElementById("mapsView");
    if (!root) return;

    const mapById = Object.fromEntries(
        (mapCatalog ?? []).map(map => [map.id, map])
    );

    const visibleChapters = (chapterManifests ?? [])
        .filter(chapter => !mapDeckFilter || chapter.deck === mapDeckFilter)
        .sort((a, b) =>
            (a.bookOrder ?? 999) - (b.bookOrder ?? 999) ||
            String(a.book ?? "").localeCompare(String(b.book ?? "")) ||
            (a.chapterOrder ?? 999) - (b.chapterOrder ?? 999) ||
            String(a.chapterTitle ?? "").localeCompare(String(b.chapterTitle ?? ""))
        );

    const books = new Map();

    for (const chapter of visibleChapters) {
        const bookTitle = chapter.book ?? "Other";
        const bookOrder = chapter.bookOrder ?? 999;
        const key = `${bookOrder}::${bookTitle}`;

        if (!books.has(key)) {
            books.set(key, {
                title: bookTitle,
                order: bookOrder,
                chapters: []
            });
        }

        books.get(key).chapters.push(chapter);
    }

    const sortedBooks = [...books.values()].sort(
        (a, b) => a.order - b.order || a.title.localeCompare(b.title)
    );

    let html = "";

    for (const book of sortedBooks) {
        html += `
            <section class="panel map-collection">

                <div class="map-collection-head">
                    <div class="map-collection-title">
                        ${escapeHtml(book.title)}
                    </div>

                    <div class="map-collection-count">
                        ${book.chapters.length}
                        chapter${book.chapters.length === 1 ? "" : "s"}
                    </div>
                </div>
        `;

        const sortedChapters = book.chapters.slice().sort((a, b) =>
            (a.chapterOrder ?? 999) - (b.chapterOrder ?? 999) ||
            String(a.chapterTitle ?? "").localeCompare(String(b.chapterTitle ?? ""))
        );

        for (const chapter of sortedChapters) {
            html += `
                <div class="map-chapter">
                    ${escapeHtml(chapter.chapterTitle ?? chapter.title ?? chapter.chapter ?? "")}
                </div>

                <div class="map-list">
            `;

            for (const item of (chapter.items ?? [])) {
                const meta = mapById[item.id];
                if (!meta) continue;

                const kindLabel =
                    item.type === "intro" ? "Intro" :
                    item.type === "summary" ? "Summary" :
                    "";

                html += `
                    <div
                        class="map-row"
                        onclick="openConceptMap('${meta.id}')"
                        role="button"
                        tabindex="0"
                    >
                        <div class="map-icon">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <circle cx="6" cy="12" r="2"></circle>
                                <circle cx="18" cy="6" r="2"></circle>
                                <circle cx="18" cy="18" r="2"></circle>
                                <path
                                    d="M8 11l8-4M8 13l8 4"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.6"/>
                            </svg>
                        </div>

                        <div class="map-info">
                            <div class="map-title">
                                ${escapeHtml(meta.title)}
                            </div>

                            ${
                                kindLabel
                                    ? `<div class="map-meta">${escapeHtml(kindLabel)}</div>`
                                    : ""
                            }
                        </div>

                        <div class="map-chevron">›</div>
                    </div>
                `;
            }

            html += `</div>`;
        }

        html += `</section>`;
    }

    root.innerHTML = html || `
        <div class="empty-state">
            <h3>No concept maps found</h3>
            <p>Check your chapter manifests and map catalog.</p>
        </div>
    `;
}

async function openConceptMap(id) {

    const meta = mapCatalog.find(m => m.id === id);
    if (!meta) return;

    const response = await fetch(meta.file, {
        cache: "no-store"
    });

    const data = await response.json();

    currentMap = {
        ...meta,
        ...data
    };

    goTo("map");
}

function renderConceptMap() {

    if (!currentMap) return;

    document.getElementById("mapCollection").textContent = currentMap.collection;
    document.getElementById("mapTitle").textContent = currentMap.title;
    document.getElementById("mapChapter").textContent = currentMap.chapter;
    document.getElementById("mapCaption").textContent = currentMap.caption ?? "";


    const statsPanel = document.getElementById("conceptStatsPanel");
    const statsButton = document.getElementById("conceptStatsToggle");

    if (statsPanel) {
        statsPanel.hidden = true;
        statsPanel.innerHTML = "";
    }

    if (statsButton) {
        statsButton.textContent = "View progress";
    }

    const img = document.getElementById("mapImage");

    const layer = currentMap.layers?.[0];

    if (!layer) {
        img.removeAttribute("src");
        img.alt = "";
        img.onclick = null;
        return;
    }

    img.src = layer.image;
    img.alt = currentMap.title;

    img.onclick = () =>
        openFigureModal(
            layer.image,
            currentMap.caption,
            currentMap.title
        );
    
    const idx = getCurrentMapIndex();

    const prev = document.getElementById("mapPrev");
    const next = document.getElementById("mapNext");

    if (idx > 0) {

        prev.disabled = false;
        prev.textContent = "← " + mapCatalog[idx - 1].title;
        prev.onclick = () => openConceptMap(mapCatalog[idx - 1].id);

    } else {

        prev.disabled = true;
        prev.textContent = "← Previous";
        prev.onclick = null;
    }

    if (idx < mapCatalog.length - 1) {

        next.disabled = false;
        next.textContent = mapCatalog[idx + 1].title + " →";
        next.onclick = () => openConceptMap(mapCatalog[idx + 1].id);

    } else {

        next.disabled = true;
        next.textContent = "Next →";
        next.onclick = null;
    }
}

function getCurrentMapIndex() {
    return mapCatalog.findIndex(m => m.id === currentMap.id);
}

function conceptStats(map) {

    const deckId = map?.deck;

    const selectedSubtopics =
        map?.study?.subtopics ?? [];

    if (!deckId) {
        console.warn(
            `Concept map "${map?.title ?? "unknown"}" has no deck`
        );

        return emptyConceptStats();
    }

    if (selectedSubtopics.length === 0) {
        console.warn(
            `Concept map "${map?.title ?? "unknown"}" has no study subtopics`
        );

        return emptyConceptStats();
    }

    const selectedSet =
        new Set(selectedSubtopics);

    const cards = getCardsForDeck(deckId)
        .filter(card => selectedSet.has(card.sub));

    const progress =
        loadJSON(`progress:${deckId}`, {});

    let boxSum = 0;
    let due = 0;
    let mastered = 0;
    let correct = 0;
    let incorrect = 0;

    const subtopicResults =
        selectedSubtopics.map(subtopic => {

            const subtopicCards =
                cards.filter(card => card.sub === subtopic);

            let subBoxSum = 0;
            let subDue = 0;
            let subMastered = 0;
            let subCorrect = 0;
            let subIncorrect = 0;

            for (const card of subtopicCards) {

                const cardProgress =
                    progress[card.id];

                const box =
                    cardProgress?.box ?? 0;

                const cardCorrect =
                    cardProgress?.correct ?? 0;

                const cardIncorrect =
                    cardProgress?.incorrect ?? 0;

                boxSum += box;
                subBoxSum += box;

                correct += cardCorrect;
                incorrect += cardIncorrect;

                subCorrect += cardCorrect;
                subIncorrect += cardIncorrect;

                if (
                    !cardProgress ||
                    cardProgress.nextDue <= todayStr()
                ) {
                    due++;
                    subDue++;
                }

                if (box === 5) {
                    mastered++;
                    subMastered++;
                }
            }

            const subTotal =
                subtopicCards.length;

            const subReviews =
                subCorrect + subIncorrect;

            return {
                name: subtopic,
                total: subTotal,
                due: subDue,
                mastered: subMastered,

                purity:
                    subTotal > 0
                        ? Math.round(
                            100 *
                            subBoxSum /
                            (5 * subTotal)
                        )
                        : 0,

                reviews: subReviews,

                efficiency:
                    subReviews > 0
                        ? Math.round(
                            100 *
                            subCorrect /
                            subReviews
                        )
                        : null
            };
        });

    const total =
        cards.length;

    const reviews =
        correct + incorrect;

    return {
        total,
        due,
        mastered,

        purity:
            total > 0
                ? Math.round(
                    100 * boxSum / (5 * total)
                )
                : 0,

        reviews,

        efficiency:
            reviews > 0
                ? Math.round(
                    100 * correct / reviews
                )
                : null,

        subtopics: subtopicResults
    };
}

function emptyConceptStats() {

    return {
        total: 0,
        due: 0,
        mastered: 0,
        purity: 0,
        reviews: 0,
        efficiency: null,
        subtopics: []
    };
}

function renderConceptStats() {

    const panel =
        document.getElementById("conceptStatsPanel");

    if (!panel || !currentMap) {
        return;
    }

    const stats =
        conceptStats(currentMap);

    if (stats.total === 0) {

        panel.innerHTML = `
            <div class="concept-stats-title">
                Concept progress
            </div>

            <div class="concept-stats-empty">
                No matching flashcards were found for this concept.
            </div>
        `;

        return;
    }

    const efficiencyText =
        stats.efficiency === null
            ? "—"
            : `${stats.efficiency}%`;

    const subtopicsHtml =
        stats.subtopics
            .filter(subtopic => subtopic.total > 0)
            .sort((a, b) => a.purity - b.purity)
            .map(subtopic => {

                const subEfficiency =
                    subtopic.efficiency === null
                        ? "—"
                        : `${subtopic.efficiency}%`;

                return `
                    <div class="concept-subtopic-row">

                        <div class="concept-subtopic-main">

                            <div class="concept-subtopic-head">

                                <div class="concept-subtopic-name">
                                    ${escapeHtml(subtopic.name)}
                                </div>

                                <div class="concept-subtopic-purity">
                                    ${subtopic.purity}%
                                </div>

                            </div>

                            <div class="bar-track concept-subtopic-track">
                                <div
                                    class="bar-fill"
                                    style="
                                        width:${subtopic.purity}%;
                                        background:var(--cherenkov);
                                    ">
                                </div>
                            </div>

                            <div class="concept-subtopic-meta">
                                <span>${subtopic.total} cards</span>
                                <span>${subtopic.due} due</span>
                                <span>${subtopic.mastered} mastered</span>
                                <span>${subtopic.reviews} reviews</span>
                                <span>${subEfficiency} efficiency</span>
                            </div>

                        </div>

                    </div>
                `;
            })
            .join("");

    panel.innerHTML = `
        <div class="concept-stats-header">

            <div>
                <div class="concept-stats-title">
                    Concept progress
                </div>

                <div class="concept-stats-subtitle">
                    Statistics for the flashcards linked to this concept map.
                </div>
            </div>

            <div class="concept-stats-overall">
                ${stats.purity}%
            </div>

        </div>

        <div class="concept-stats-grid">

            <div class="concept-stat-card">
                <div class="concept-stat-value">
                    ${stats.total}
                </div>
                <div class="concept-stat-label">
                    Cards
                </div>
            </div>

            <div class="concept-stat-card">
                <div class="concept-stat-value amber">
                    ${stats.due}
                </div>
                <div class="concept-stat-label">
                    Due
                </div>
            </div>

            <div class="concept-stat-card">
                <div class="concept-stat-value alt">
                    ${stats.mastered}
                </div>
                <div class="concept-stat-label">
                    Mastered
                </div>
            </div>

            <div class="concept-stat-card">
                <div class="concept-stat-value">
                    ${efficiencyText}
                </div>
                <div class="concept-stat-label">
                    Efficiency
                </div>
            </div>

        </div>

        <div class="concept-stats-progress">

            <div class="concept-stats-progress-head">
                <span>Overall mastery</span>
                <span>${stats.purity}%</span>
            </div>

            <div class="bar-track">
                <div
                    class="bar-fill"
                    style="
                        width:${stats.purity}%;
                        background:var(--scint);
                    ">
                </div>
            </div>

        </div>

        ${
            subtopicsHtml
                ? `
                    <div class="concept-subtopics">

                        <div class="concept-subtopics-title">
                            Subtopics
                        </div>

                        ${subtopicsHtml}

                    </div>
                `
                : ""
        }
    `;
}

function openAllConceptMaps() {
    mapDeckFilter = null;
    goTo("maps");
}

function toggleConceptStats() {

    const panel =
        document.getElementById("conceptStatsPanel");

    const button =
        document.getElementById("conceptStatsToggle");

    if (!panel || !button || !currentMap) {
        return;
    }

    const willOpen =
        panel.hidden;

    if (willOpen) {
        renderConceptStats();
    }

    panel.hidden =
        !willOpen;

    button.textContent =
        willOpen
            ? "Hide progress"
            : "View progress";
}

/* ================= TRAIN ================= */
function renderTrainSetup() {

    document.getElementById("trainCollectionTitle").textContent =
        currentDeckInfo.collection;

    document.getElementById("trainDeckTitle").textContent =
        currentDeckInfo.name;

    document.getElementById("trainSetup").style.display = "";
    document.getElementById("trainStage").style.display = "none";
    document.getElementById("trainSummary").style.display = "none";
    document.getElementById("trainEmpty").style.display = "none";

    const sections = sectionsInOrder();

    const chipWrap = document.getElementById("topicChips");

    chipWrap.innerHTML = sections.map(section => {
        const nCards = allCards().filter(
            c => c.sub === section
        ).length;
        return `
            <div class="chip on"
                 data-section="${escapeHtml(section)}"
                 onclick="toggleChip(this)">

                ${escapeHtml(section)}
                <span style="opacity:.65">(${nCards})</span>

            </div>
        `;
    }).join("");

    if (pendingStudySelection) {
      document
          .querySelectorAll("#topicChips .chip")
          .forEach(chip => {

              chip.classList.toggle(
                  "on",
                  pendingStudySelection.subtopics.includes(
                      chip.dataset.section
                  )
              );
          });
      pendingStudySelection = null;
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
  const activeSections =
    [...document.querySelectorAll("#topicChips .chip.on")]
        .map(c => c.dataset.section);

  if (activeSections.length === 0) {
      showToast("Select at least one section", "bad");
      return;
  }
  const mode = document.getElementById('queueMode').value;
  const shuffle = document.getElementById('shuffleToggle').checked;
  const diffFilter = document.getElementById('diffFilter').value;

  let pool = allCards().filter(
    c => activeSections.includes(c.sub)
    );
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
  document.getElementById('cardAnswer').innerHTML = `<div>${escapeHtml(card.a).replace(/\n/g,'<br>')}</div>` + renderFigureMarkup(card.figure);
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
  if(e.key === "Escape") closeFigureModal();
});

/* ================= LIBRARY ================= */
function initLibraryFilters() {
  const topicSel = document.getElementById("libTopicFilter");
  const sectionSel = document.getElementById("libSectionFilter");

  if (!topicSel || !sectionSel) return;

  const topics = topicsInOrder();

  topicSel.innerHTML =
    `<option value="">All topics</option>` +
    topics.map(topic =>
      `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`
    ).join("");

  topicSel.value = "";
  onLibraryTopicChange();
}

function onLibraryTopicChange() {
  const topicSel = document.getElementById("libTopicFilter");
  const sectionSel = document.getElementById("libSectionFilter");

  if (!topicSel || !sectionSel) return;

  const topicFilter = topicSel.value;

  const sections = [...new Set(
    allCards()
      .filter(card => !topicFilter || card.topic === topicFilter)
      .map(card => card.sub)
  )];

  sectionSel.innerHTML =
    `<option value="">All sections</option>` +
    sections.map(section =>
      `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`
    ).join("");

  sectionSel.value = "";
  renderLibrary();
}

function renderLibrary() {
  const topicSel = document.getElementById("libTopicFilter");
  const sectionSel = document.getElementById("libSectionFilter");
  const searchEl = document.getElementById("libSearch");
  const root = document.getElementById("libraryList");

  if (!topicSel || !sectionSel || !searchEl || !root) return;

  const topicFilter = topicSel.value;
  const sectionFilter = sectionSel.value;
  const q = searchEl.value.trim().toLowerCase();

  let cards = allCards();

  if (topicFilter) {
    cards = cards.filter(c => c.topic === topicFilter);
  }

  if (sectionFilter) {
    cards = cards.filter(c => c.sub === sectionFilter);
  }

  if (q) {
    cards = cards.filter(c =>
      c.q.toLowerCase().includes(q) ||
      c.a.toLowerCase().includes(q) ||
      c.sub.toLowerCase().includes(q) ||
      c.topic.toLowerCase().includes(q)
    );
  }

  if (cards.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>No cards match</h3>
        <p>Try a different search or filter.</p>
      </div>
    `;
    return;
  }

  const groups = {};

  for (const c of cards) {
    const key = sectionFilter ? "__all__" : c.sub;
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);
  }

  const groupOrder = sectionFilter
    ? ["__all__"]
    : sectionsInOrder().filter(section => groups[section]);

  let html = "";

  for (const groupKey of groupOrder) {
    const groupCards = groups[groupKey];
    if (!groupCards || groupCards.length === 0) continue;

    if (!sectionFilter) {
      html += `
        <div class="lib-group">
          <div class="lib-group-head">
            <div class="lib-group-title">${escapeHtml(groupKey)}</div>
            <div class="lib-group-count">${groupCards.length} cards</div>
          </div>
      `;
    }

    for (const c of groupCards) {
      const expanded = expandedLibraryCard === c.id;
      const answer = expanded
        ? escapeHtml(c.a).replace(/\n/g, "<br>")
        : "";

      html += `
        <div class="lib-card" onclick="toggleLibraryCard('${c.id}')">
          <div class="lib-card-body">
            <div class="lib-card-q">${escapeHtml(c.q)}</div>

            ${
              expanded
                ? `
                  <div class="lib-card-a">
                    ${answer}
                  </div>
                  ${renderFigureMarkup(c.figure)}
                `
                : ""
            }
          </div>

          <div class="lib-card-meta">
            <span class="purity-pill">${purityOf(c.id)}%</span>
            ${
              c.id.startsWith("c-")
                ? `<button class="icon-btn" title="Delete card" onclick="deleteCard('${c.id}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/></svg></button>`
                : ""
            }
          </div>
        </div>
      `;
    }

    if (!sectionFilter) {
      html += `</div>`;
    }
  }

  root.innerHTML = html;
  renderMath(root);
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
  const payload = allCards().map(c => ({
    topic: c.topic,
    sub: c.sub,
    q: c.q,
    a: c.a,
    diff: c.diff,
    ...(c.figure ? { figure: c.figure } : {})
  }));
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
        ...(item.figure ? { figure: item.figure } : {})
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
// function renderAddForm(){
//   const sel = document.getElementById('fTopicSelect');
//   const topics = topicsInOrder();
//   sel.innerHTML = topics.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') + `<option value="__new__">+ New topic…</option>`;
//   onTopicSelectChange();
//   updateSubList();

//   document.querySelectorAll('.diff-opt').forEach(el=>{
//     el.onclick = ()=>{
//       document.querySelectorAll('.diff-opt').forEach(o=>o.classList.remove('sel'));
//       el.classList.add('sel');
//       diffSelected = parseInt(el.dataset.v, 10);
//     };
//   });
// }

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
  // renderAddForm();
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
    await loadMapCatalog();
    await loadChapterCatalog();
    await loadChapterManifests();

    loadCollectionMemory();

    const savedDeck = localStorage.getItem("selectedDeck");

    const deckToLoad = deckCatalog.some(deck => deck.id === savedDeck)
        ? savedDeck
        : deckCatalog[0].id;

    // Establish the initial collection BEFORE building the selectors
    currentCollection =
        deckCatalog.find(deck => deck.id === deckToLoad).collection;


    // Load the selected deck
    await switchDeck(deckToLoad);

    document.getElementById("sidebarFoot").innerHTML =
        `Version ${version}<br>${allCards().length} cards loaded<br>local session`;
}
init();

