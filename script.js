/* ====================== Config ====================== */
// CSV must live alongside these files (or adjust path below).
// Expected headers (case-insensitive): name,ticker,industry,market_cap
const CSV_FILE = document.body.dataset.csv || "stocks.csv";

/* ====================== Utilities ====================== */
const $  = (sel,ctx=document)=>ctx.querySelector(sel);
const $$ = (sel,ctx=document)=>[...ctx.querySelectorAll(sel)];

// Debounce helper
const debounce = (fn, ms=200) => {
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
};

/* ---------- Footer year ---------- */
(function setYear(){
  const y = new Date().getFullYear();
  $$("#year").forEach(n => n.textContent = y);
})();

/* ---------- Back button behavior ---------- */
(function wireBackButtons(){
  const backBtns = $$("[data-back]");
  backBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      // Prefer a real back if available, otherwise go home
      if (window.history.length > 1) {
        history.back();
      } else {
        window.location.href = "index.html";
      }
    });
  });
})();

/* ---------- Dynamic stock list on the landing page ---------- */
(function buildStockList(){
  const list = $("#stock-list");
  if (!list || list.getAttribute("data-dynamic") !== "true") return;

  // Clear any existing (non-noscript) content
  list.innerHTML = "";

  STOCKS.forEach(({symbol, name, page}) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "btn-link";
    a.href = page;
    a.textContent = `${name} (${symbol})`;
    li.appendChild(a);
    list.appendChild(li);
  });

  // Filter behavior
  const filter = $("#stock-filter");
  if (!filter) return;
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    for (const li of list.children) {
      const text = li.textContent.toLowerCase();
      li.style.display = text.includes(q) ? "" : "none";
    }
  });
})();


// script.js
(async () => {
  // Progressive enhancement: only run if the list is marked dynamic
  const listEl = document.getElementById('stock-list');
  const filterEl = document.getElementById('stock-filter');
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  if (!listEl || listEl.dataset.dynamic !== 'true') return;

  // Fetch the manifest
  let stocks = [];
  try {
    const res = await fetch('data/stocks.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    stocks = await res.json();
  } catch (err) {
    console.error('Failed to load stocks manifest:', err);
    listEl.innerHTML = `<li class="error">Could not load stocks. Please try again later.</li>`;
    return;
  }

  // Render helper
  const render = (items) => {
    if (!Array.isArray(items)) return;
    if (items.length === 0) {
      listEl.innerHTML = `<li class="muted small">No matches.</li>`;
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach(({ symbol, name, href }) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'btn-link';
      a.href = href;
      a.textContent = `${name} (${symbol})`;
      a.setAttribute('aria-label', `${name} (${symbol})`);
      li.appendChild(a);
      frag.appendChild(li);
    });
    listEl.innerHTML = '';
    listEl.appendChild(frag);
  };

  // Initial render
  render(stocks);

  // Filter logic (by symbol or name)
  if (filterEl) {
    const normalize = (s) => (s || '').toLowerCase().trim();
    filterEl.addEventListener('input', () => {
      const q = normalize(filterEl.value);
      if (!q) {
        render(stocks);
        return;
      }
      const filtered = stocks.filter(s =>
        normalize(s.symbol).includes(q) || normalize(s.name).includes(q)
      );
      render(filtered);
    });
  }
})();


// Parse number with K/M/B/T suffix or plain number
function parseMoney(x){
  if (x == null) return NaN;
  const s = String(x).trim().replace(/[\$,]/g,'').toUpperCase();
  const m = s.match(/^([<>]=?|)(\d*\.?\d+)\s*([KMBT]?)/);
  if (!m) return NaN;
  const [, , numRaw, suf] = m;
  const num = parseFloat(numRaw);
  const mult = {K:1e3,M:1e6,B:1e9,T:1e12,"":1}[suf||""];
  return num * mult;
}

// Pretty print large numbers with suffix
function fmtMoney(n){
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const units = [
    {v:1e12, s:"T"},
    {v:1e9,  s:"B"},
    {v:1e6,  s:"M"},
    {v:1e3,  s:"K"},
  ];
  for (const u of units) if (abs >= u.v) return (n/u.v).toFixed(2).replace(/\.00$/,'') + u.s;
  return String(n);
}

// Robust CSV parser (handles quoted commas & quotes)
function parseCSV(text){
  const rows = [];
  let cur = [], val = "", inQ = false;
  for (let i=0;i<text.length;i++){
    const c = text[i];
    if (inQ){
      if (c === '"'){
        if (text[i+1] === '"'){ val += '"'; i++; }
        else inQ = false;
      } else val += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ','){ cur.push(val); val = ""; }
      else if (c === '\n' || c === '\r'){
        if (c === '\r' && text[i+1] === '\n') i++;
        cur.push(val); rows.push(cur); cur = []; val = "";
      } else val += c;
    }
  }
  if (val.length || cur.length) { cur.push(val); rows.push(cur); }
  return rows;
}

// Map array of rows to objects using header row
function rowsToObjects(rows){
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).filter(r=>r.some(x=>String(x).trim()!=="")).map(r=>{
    const o = {};
    headers.forEach((h, i)=>o[h] = r[i] ?? "");
    return o;
  });
}

/* ====================== App State ====================== */
const state = {
  raw: [],        // original rows
  rows: [],       // filtered/sorted rows
  sort: { key: "name", dir: "asc" },
  filters: { name:"", ticker:"", industry:"", market_cap:"" },
  global: ""
};

/* ====================== DOM Refs ====================== */
const table = $("#stocks-table");
const tbody = $("#stocks-table tbody");
const thead = $("#stocks-table thead");
const globalSearch = $("#global-search");

/* ====================== Rendering ====================== */
function renderHeadSortIndicators(){
  $$("th[data-sortable='true']", thead).forEach(th=>{
    th.querySelector(".sort-indicator")?.remove();
    const key = th.dataset.col;
    if (key === state.sort.key){
      const span = document.createElement("span");
      span.className = "sort-indicator";
      span.textContent = state.sort.dir === "asc" ? "▲" : "▼";
      th.appendChild(span);
    }
  });
}

function rowMatchesFilters(r){
  // Text filters
  const f = state.filters;
  const haystacks = {
    name: (r.name||"").toLowerCase(),
    ticker: (r.ticker||"").toLowerCase(),
    industry: (r.industry||"").toLowerCase(),
  };
  if (f.name && !haystacks.name.includes(f.name)) return false;
  if (f.ticker && !haystacks.ticker.includes(f.ticker)) return false;
  if (f.industry && !haystacks.industry.includes(f.industry)) return false;

  // Market cap: >, >=, <, <=, range "a-b", plain substring fallback
  if (f.market_cap){
    const q = f.market_cap.trim().toUpperCase();
    const val = parseMoney(r.market_cap);
    const range = q.match(/^(\d*\.?\d+\s*[KMBT]?)\s*-\s*(\d*\.?\d+\s*[KMBT]?)$/i);
    const cmp = q.match(/^(>=|>|<=|<)\s*(\d*\.?\d+\s*[KMBT]?)$/);
    if (!isNaN(val)){
      if (range){
        const lo = parseMoney(range[1]);
        const hi = parseMoney(range[2]);
        if (!(val >= lo && val <= hi)) return false;
      } else if (cmp){
        const op = cmp[1], n = parseMoney(cmp[2]);
        if (op === ">"  && !(val >  n)) return false;
        if (op === ">=" && !(val >= n)) return false;
        if (op === "<"  && !(val <  n)) return false;
        if (op === "<=" && !(val <= n)) return false;
      } else {
        // substring on formatted value as last resort
        if (!fmtMoney(val).toUpperCase().includes(q)) return false;
      }
    } else {
      // if value not numeric, require substring match on raw
      if (!String(r.market_cap||"").toUpperCase().includes(q)) return false;
    }
  }

  // Global search over all stringified columns
  if (state.global){
    const blob = `${r.name} ${r.ticker} ${r.industry} ${r.market_cap}`.toLowerCase();
    if (!blob.includes(state.global)) return false;
  }

  return true;
}

function sortRows(rows){
  const {key, dir} = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a,b)=>{
    if (key === "market_cap"){
      const va = parseMoney(a.market_cap);
      const vb = parseMoney(b.market_cap);
      if (isNaN(va) && isNaN(vb)) return 0;
      if (isNaN(va)) return 1; // push NaN to bottom
      if (isNaN(vb)) return -1;
      return (va - vb) * mult;
    } else {
      const sa = String(a[key]||"").toLowerCase();
      const sb = String(b[key]||"").toLowerCase();
      if (sa < sb) return -1 * mult;
      if (sa > sb) return  1 * mult;
      return 0;
    }
  });
}

function renderTable(){
  const filtered = state.raw.filter(rowMatchesFilters);
  state.rows = sortRows(filtered);

  // Build rows
  const frag = document.createDocumentFragment();
  state.rows.forEach(r=>{
    const tr = document.createElement("tr");

    const tdName = document.createElement("td");
    tdName.textContent = r.name || "—";

    const tdTicker = document.createElement("td");
    tdTicker.textContent = r.ticker || "—";

    const tdInd = document.createElement("td");
    tdInd.textContent = r.industry || "—";

    const tdMkt = document.createElement("td");
    tdMkt.className = "num";
    const cap = parseMoney(r.market_cap);
    tdMkt.textContent = isNaN(cap) ? (r.market_cap || "—") : fmtMoney(cap);

    const tdAct = document.createElement("td");
    tdAct.className = "action";
    const a = document.createElement("a");
    a.className = "btn-link";
    // Link to <TICKER>.html by convention
    const ticker = (r.ticker||"").toUpperCase().trim();
    a.href = ticker ? `${ticker}.html` : "#";
    a.textContent = "Open";
    a.setAttribute("aria-label", `Open page for ${ticker || 'stock'}`);
    tdAct.appendChild(a);

    [tdName, tdTicker, tdInd, tdMkt, tdAct].forEach(td=>tr.appendChild(td));
    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
  renderHeadSortIndicators();
}

/* ====================== Events ====================== */
function wireSorting(){
  $$("th[data-sortable='true']", thead).forEach(th=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.col;
      if (state.sort.key === key){
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort.key = key;
        state.sort.dir = key === "name" ? "asc" : "desc"; // sensible defaults
      }
      renderTable();
    });
  });
}

function wireFilters(){
  $$("#stocks-table thead .filters [data-filter]").forEach(inp=>{
    const k = inp.dataset.filter;
    inp.addEventListener("input", debounce(()=>{
      state.filters[k] = inp.value.trim().toLowerCase();
      renderTable();
    }, 200));
  });

  globalSearch?.addEventListener("input", debounce(()=>{
    state.global = globalSearch.value.trim().toLowerCase();
    renderTable();
  }, 200));
}

(function footerYear(){
  $$("#year").forEach(el => el.textContent = new Date().getFullYear());
})();

(function wireBackButtons(){
  $$("[data-back]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if (history.length > 1) history.back();
      else window.location.href = "index.html";
    });
  });
})();

/* ====================== Boot ====================== */
async function loadCSV(){
  try{
    const res = await fetch(CSV_FILE, {cache:"no-store"});
    if (!res.ok) throw new Error(`Failed to load ${CSV_FILE} (${res.status})`);
    const text = await res.text();
    const objects = rowsToObjects(parseCSV(text));

    // Normalize header names (support variants)
    state.raw = objects.map(o=>{
      const map = (kArr)=>kArr.find(k=>k in o && o[k] !== undefined && o[k] !== "") ?? kArr[0];
      const nameKey   = map(["name","company","company_name"]);
      const tickKey   = map(["ticker","symbol"]);
      const indKey    = map(["industry","sector"]);
      const mcapKey   = map(["market_cap","marketcap","market capitalization","mktcap"]);
      return {
        name: o[nameKey] ?? "",
        ticker: o[tickKey]?.toUpperCase() ?? "",
        industry: o[indKey] ?? "",
        market_cap: o[mcapKey] ?? ""
      };
    });

    renderTable();
  } catch (e){
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Error loading CSV. Make sure you're running a local server and that <code>${CSV_FILE}</code> exists.</td></tr>`;
  }
}

function init(){
  if (document.body.dataset.page === "home"){
    wireSorting();
    wireFilters();
    loadCSV();
  }
}
document.addEventListener("DOMContentLoaded", init);
