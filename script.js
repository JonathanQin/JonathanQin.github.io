/* ====================== Config ====================== */
const DATA_URL = document.body.dataset.src || "data/stocks.json";

/* ====================== Lenient JSON (.jsqon only) ====================== */
// Keep this only for .jsqon files (comments, trailing commas, etc.)
function parseLenientJSON(text){
  text = text.replace(/^\uFEFF/, "");
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  text = text.replace(/(^|\s)\/\/.*$/gm, "$1");
  text = text.replace(/,\s*([\]}])/g, "$1");
  text = text.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (_, inner) =>
    `"${inner.replace(/\\"/g,'"').replace(/"/g,'\\"')}"`
  );
  return JSON.parse(text);
}

/* ====================== Utilities ====================== */
const $  = (sel,ctx=document)=>ctx.querySelector(sel);
const $$ = (sel,ctx=document)=>[...ctx.querySelectorAll(sel)];
const debounce = (fn, ms=200) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

function parseMoney(x){
  if (x == null || x === "") return NaN;
  const s = String(x).trim().replace(/[\$,]/g,'').toUpperCase();
  const m = s.match(/^([<>]=?|)?\s*(\d*\.?\d+)\s*([KMBT]?)/);
  if (!m) return NaN;
  const num = parseFloat(m[2]);
  const mult = {K:1e3,M:1e6,B:1e9,T:1e12,"":1}[m[3]||""];
  return num * mult;
}
function fmtMoney(n, {decimals=2, prefix="$"}={}){ if (n == null || isNaN(n)) return "—"; return prefix + n.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function parseDate(x){ if (!x) return NaN; const d = new Date(x); const t = d.getTime(); return isNaN(t) ? NaN : t; }
function fmtDate(ts){ if (isNaN(ts)) return "—"; const d = new Date(ts); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), da=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${da}`; }

/* ====================== State ====================== */
const state = {
  stocks: [],
  sort: { key: "name", dir: "asc" },
  filters: {
    name:"", ticker:"", industry:"", market_cap:"",
    last_updated:"", current_price:"", target_price:"",
    rating:"", strategy:""                       // NEW
  },
  global: ""
};


/* ====================== DOM Refs ====================== */
const thead = $("#stocks-table thead");
const tbody = $("#stocks-table tbody");

/* ====================== Data pipeline ====================== */
function normalizeStocks(list){
  return (list || []).map(s=>{
    const name = s.name ?? s.company ?? s.company_name ?? "";
    const ticker = (s.ticker ?? s.symbol ?? "").toUpperCase().trim();
    const industry = s.industry ?? s.sector ?? "";
    // FIX: use ${ticker}, not {ticker}
    const page = s.page || (ticker ? `stocks/{ticker}.html` : "#");

    const capRaw = s.market_cap ?? s.marketcap ?? s["market capitalization"] ?? s.mktcap ?? "";
    const lastRaw = s.last_updated ?? s.updated_at ?? s.as_of ?? s.date ?? "";
    const curRaw  = s.current_price ?? s.price ?? s.last_price ?? s.close ?? "";
    const tgtRaw  = s.target_price ?? s.pt ?? s.price_target ?? "";

    const lastVal = parseDate(lastRaw);
    const curVal  = parseMoney(curRaw);
    const tgtVal  = parseMoney(tgtRaw);

    const ratingRaw  = (s.rating ?? "").trim();
    const strategyRaw = (s.strategy ?? "").trim();

    const ratingNumMatch = ratingRaw.match(/-?\d+(?:\.\d+)?/);
    const ratingVal = ratingNumMatch ? parseFloat(ratingNumMatch[0]) : NaN;

    return {
      name, ticker, industry, page,
      market_cap_raw: capRaw,
      market_cap_val: parseMoney(capRaw),
      last_updated_raw: lastRaw,
      last_updated_val: lastVal,
      current_price_raw: curRaw,
      current_price_val: curVal,
      target_price_raw: tgtRaw,
      target_price_val: tgtVal,
      rating_raw: ratingRaw,
      rating_val: ratingVal,
      strategy_raw: strategyRaw
    };
  });
}

/* ----- Filters & sorting (unchanged) ----- */

function isPresenceQuery(q){
  if (!q) return false;
  const s = q.trim().toLowerCase();
  return s === "*" || s === "has" || s === "nonzero" || s === "empty" || s === "!*";
}
function matchesPresence(valRaw, valNum, q){
  const s = q.trim().toLowerCase();
  const has = !!(valRaw && String(valRaw).trim() !== "");
  if (s === "*" || s === "has") return has;
  if (s === "empty" || s === "!*") return !has;
  if (s === "nonzero"){
    if (typeof valNum === "number" && !isNaN(valNum)) return valNum !== 0;
    // if not numeric, treat any non-empty as "nonzero"
    return has;
  }
  return true;
}

function matchesNumericFilter(val, q){
  if (!q) return true;
  const Q = q.trim().toUpperCase();
  const range = Q.match(/^(\d*\.?\d+\s*[KMBT]?)\s*-\s*(\d*\.?\d+\s*[KMBT]?)$/);
  const cmp = Q.match(/^(>=|>|<=|<)\s*(\d*\.?\d+\s*[KMBT]?)$/);
  if (isNaN(val)) return false;
  if (range){ const lo = parseMoney(range[1]); const hi = parseMoney(range[2]); return val >= lo && val <= hi; }
  if (cmp){ const op = cmp[1], n = parseMoney(cmp[2]); if (op === ">") return val > n; if (op === ">=") return val >= n; if (op === "<") return val < n; if (op === "<=") return val <= n; }
  return fmtMoney(val).toUpperCase().includes(Q);
}
function matchesDateFilter(ts, q){
  if (!q) return true;
  const Q = q.trim(); if (isNaN(ts)) return false;
  const range = Q.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})$/);
  if (range){ const lo = parseDate(range[1]); const hi = parseDate(range[2]); return !isNaN(lo)&&!isNaN(hi)&&ts>=lo&&ts<=hi; }
  const cmp = Q.match(/^(>=|>|<=|<)\s*(\d{4}-\d{2}-\d{2})$/);
  if (cmp){ const op=cmp[1], t=parseDate(cmp[2]); if (isNaN(t)) return false; if (op === ">") return ts>t; if (op === ">=") return ts>=t; if (op === "<") return ts<t; if (op === "<=") return ts<=t; }
  const exact = parseDate(Q); if (!isNaN(exact)) return ts === exact;
  return false;
}
function rowMatchesFilters(r){
  const f = state.filters;

  // require last_updated present
  const hasLast = r.last_updated_raw && String(r.last_updated_raw).trim() !== "";
  if (!hasLast) return false;

  if (f.name && !r.name.toLowerCase().includes(f.name)) return false;
  if (f.ticker && !r.ticker.toLowerCase().includes(f.ticker)) return false;
  if (f.industry && !r.industry.toLowerCase().includes(f.industry)) return false;

  // Rating: presence or numeric-range or text
  if (f.rating){
    if (isPresenceQuery(f.rating)){
      if (!matchesPresence(r.rating_raw, r.rating_val, f.rating)) return false;
    } else {
      // try numeric/range first; if that fails, fallback to substring
      const qNum = f.rating;
      const triedNumeric = matchesNumericFilter(r.rating_val, qNum);
      if (!isNaN(r.rating_val)){
        if (!triedNumeric) return false;
      } else {
        // not numeric -> do substring text match
        if (!r.rating_raw.toLowerCase().includes(f.rating)) return false;
      }
    }
  }

  // Strategy: presence or substring
  if (f.strategy){
    if (isPresenceQuery(f.strategy)){
      if (!matchesPresence(r.strategy_raw, NaN, f.strategy)) return false;
    } else {
      if (!r.strategy_raw.toLowerCase().includes(f.strategy)) return false;
    }
  }

  // Last updated, current price, target price, market cap (existing)
  if (f.last_updated && !matchesDateFilter(r.last_updated_val, f.last_updated)) return false;
  if (f.current_price && !matchesNumericFilter(r.current_price_val, f.current_price)) return false;

  // Target price: add presence keywords
  if (f.target_price){
    if (isPresenceQuery(f.target_price)){
      if (!matchesPresence(r.target_price_raw, r.target_price_val, f.target_price)) return false;
    } else {
      if (!matchesNumericFilter(r.target_price_val, f.target_price)) return false;
    }
  }

  if (f.market_cap && !matchesNumericFilter(r.market_cap_val, f.market_cap)) return false;

  if (state.global){
    const blob = `${r.name} ${r.ticker} ${r.industry} ${r.rating_raw} ${r.strategy_raw} ${r.market_cap_raw} ${r.last_updated_raw} ${r.current_price_raw} ${r.target_price_raw}`.toLowerCase();
    if (!blob.includes(state.global)) return false;
  }
  return true;
}

function sortRows(rows){
  const {key, dir} = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a,b)=>{
    const numCols = new Set(["market_cap","current_price","target_price","rating"]); // rating added
    if (numCols.has(key)){
      const va = key === "rating" ? a.rating_val : a[`${key}_val`];
      const vb = key === "rating" ? b.rating_val : b[`${key}_val`];
      const aNa = isNaN(va), bNa = isNaN(vb);
      if (aNa && bNa) return 0;
      if (aNa) return 1;
      if (bNa) return -1;
      return (va - vb) * mult;
    }
    if (key === "last_updated"){
      const av = a.last_updated_val, bv = b.last_updated_val;
      if (isNaN(av) && isNaN(bv)) return 0;
      if (isNaN(av)) return 1;
      if (isNaN(bv)) return -1;
      return (av - bv) * mult;
    }
    const sa = String(a[key]||"").toLowerCase();
    const sb = String(b[key]||"").toLowerCase();
    if (sa < sb) return -1 * mult;
    if (sa > sb) return  1 * mult;
    return 0;
  });
}


/* ====================== Render ====================== */
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
function renderTable(){
  const filtered = state.stocks.filter(rowMatchesFilters);
  const rows = sortRows(filtered);

  const frag = document.createDocumentFragment();
  rows.forEach(r=>{
    const tr = document.createElement("tr");

    //const tdName = document.createElement("td"); tdName.textContent = r.name || "—";
    const tdTkr  = document.createElement("td"); tdTkr.textContent  = r.ticker || "—";
    const tdInd  = document.createElement("td"); tdInd.textContent  = r.industry || "—";
    const tdCur  = document.createElement("td"); tdCur.className    = "num"; tdCur.textContent = isNaN(r.current_price_val) ? (r.current_price_raw || "—") : fmtMoney(r.current_price_val);
    const tdTgt  = document.createElement("td"); tdTgt.className    = "num"; tdTgt.textContent = isNaN(r.target_price_val) ? (r.target_price_raw || "—") : fmtMoney(r.target_price_val);
    
    const tdRat  = document.createElement("td"); tdRat.textContent  = r.rating_raw || "—";
    const tdStr  = document.createElement("td"); tdStr.textContent  = r.strategy_raw || "—";

    const tdCap  = document.createElement("td"); tdCap.className    = "num";
    tdCap.textContent = isNaN(r.market_cap_val) ? (r.market_cap_raw || "—") :
      (()=>{ const n=r.market_cap_val, u=[[1e12,"T"],[1e9,"B"],[1e6,"M"],[1e3,"K"]]; for(const [v,s] of u){ if(n>=v) return `$${(n/v).toFixed(2).replace(/\.00$/,'')}${s}`;} return `$${n.toLocaleString()}`; })();
    const tdLU   = document.createElement("td"); tdLU.textContent   = isNaN(r.last_updated_val) ? (r.last_updated_raw || "—") : fmtDate(r.last_updated_val);

    const tdAct  = document.createElement("td"); tdAct.className = "action";
    const a = document.createElement("a"); a.className = "btn-link"; a.href = r.page || "#"; a.textContent = "Open";
    a.setAttribute("aria-label", `Open page for ${r.ticker || 'stock'}`);
    tdAct.appendChild(a);

    //[tdName, tdTkr, tdInd, tdLU, tdCur, tdTgt, tdRat, tdStr, tdCap, tdAct].forEach(td=>tr.appendChild(td));
    [tdTkr, tdInd, tdCur, tdTgt, tdRat, tdStr, tdCap, tdLU, tdAct].forEach(td=>tr.appendChild(td));
    frag.appendChild(tr);
  });

  tbody.innerHTML = "";
  tbody.appendChild(frag);
  renderHeadSortIndicators();
}


/* ====================== Events ====================== */
function wireSorting(){ $$("th[data-sortable='true']", thead).forEach(th=>{ th.addEventListener("click", ()=>{ const key=th.dataset.col; if (state.sort.key===key){ state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc"; } else { state.sort.key=key; state.sort.dir = key === "name" ? "asc" : "desc"; } renderTable(); }); }); }
function wireFilters(){
  $$("#stocks-table thead .filters [data-filter]").forEach(inp=>{
    const k = inp.dataset.filter;
    inp.addEventListener("input", debounce(()=>{
      state.filters[k] = inp.value.trim().toLowerCase();
      renderTable();
    }, 150));
  });
  $("#global-search")?.addEventListener("input", debounce(()=>{
    state.global = $("#global-search").value.trim().toLowerCase();
    renderTable();
  }, 150));
}

/* Footer year + back buttons */
(function footerYear(){ $$("#year").forEach(el => el.textContent = new Date().getFullYear()); })();
(function wireBackButtons(){ $$("[data-back]").forEach(btn=>{ btn.addEventListener("click", ()=>{ if (history.length > 1) history.back(); else window.location.href = "index.html"; }); }); })();

/* ====================== Boot (strict JSON for .json) ====================== */
async function loadStocks(){
  try{
    console.group("loadStocks");
    console.log("DATA_URL =", DATA_URL);

    if (Array.isArray(window.STOCKS_DATA)) {
      console.info("Using window.STOCKS_DATA (%d entries)", window.STOCKS_DATA.length);
      state.stocks = normalizeStocks(window.STOCKS_DATA);
      renderTable(); return;
    }

    const inline = $("#stocks-data");
    if (inline && inline.textContent.trim()) {
      console.info("Using inline #stocks-data JSON");
      const rawInline = JSON.parse(inline.textContent); // strict
      if (!Array.isArray(rawInline)) throw new Error("Inline #stocks-data must be a JSON array.");
      state.stocks = normalizeStocks(rawInline);
      renderTable(); return;
    }

    console.info("Fetching:", DATA_URL);
    const res = await fetch(DATA_URL, {cache:"no-store"});
    console.log("Fetch status:", res.status, res.statusText);
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL} (${res.status})`);
    const text = await res.text();
    console.log("Fetched text length:", text.length);

    const isJsqon = /\.jsqon$/i.test(DATA_URL);
    const raw = isJsqon ? parseLenientJSON(text) : JSON.parse(text); // strict for .json

    if (!Array.isArray(raw)) throw new Error(`${DATA_URL} must contain a top-level array.`);
    console.info("Parsed %d records", raw.length);
    state.stocks = normalizeStocks(raw);
    renderTable();
  } catch (err){
    console.error("Stock load error:", err);
    tbody.innerHTML = `<tr><td colspan="8" class="muted">
      Could not load stocks. For file:// use <code>window.STOCKS_DATA</code> or inline JSON, or serve <code>${DATA_URL}</code> over http(s).
    </td></tr>`;
  } finally {
    console.groupEnd();
  }
}

function init(){
  if (document.body.dataset.page === "home"){
    wireSorting();
    wireFilters();
    loadStocks();
  }
}
document.addEventListener("DOMContentLoaded", init);
