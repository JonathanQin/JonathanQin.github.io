/* ====================== Config ====================== */
const DATA_URL = document.body.dataset.src || "data/stocks.json";

/* ====================== Lenient JSON(.jsqon) Parser ====================== */
// Supports comments (//, /* */) and trailing commas.
function parseLenientJSON(text){
  // Strip BOM
  text = text.replace(/^\uFEFF/, "");
  // Remove /* block */ comments
  text = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // line comments
  text = text.replace(/(^|\s)\/\/.*$/gm, "$1");
  // Remove trailing commas before } or ]
  text = text.replace(/,\s*([\]}])/g, "$1");
  // Optional: allow single quotes -> convert to double (only for keys/strings)
  // Careful approach: replace only quotes around keys/values not containing quotes
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
  if (x == null) return NaN;
  const s = String(x).trim().replace(/[\$,]/g,'').toUpperCase();
  const m = s.match(/^([<>]=?|)?\s*(\d*\.?\d+)\s*([KMBT]?)/);
  if (!m) return NaN;
  const num = parseFloat(m[2]);
  const mult = {K:1e3,M:1e6,B:1e9,T:1e12,"":1}[m[3]||""];
  return num * mult;
}
function fmtMoney(n){
  if (n == null || isNaN(n)) return "—";
  const abs = Math.abs(n);
  const units = [{v:1e12,s:"T"},{v:1e9,s:"B"},{v:1e6,s:"M"},{v:1e3,s:"K"}];
  for (const u of units) if (abs >= u.v) return (n/u.v).toFixed(2).replace(/\.00$/,'')+u.s;
  return String(n);
}

/* ====================== State ====================== */
const state = {
  stocks: [],
  sort: { key: "name", dir: "asc" },
  filters: { name:"", ticker:"", industry:"", market_cap:"" },
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
    const page = s.page || (ticker ? `${ticker}.html` : "#");
    const capRaw = s.market_cap ?? s.marketcap ?? s["market capitalization"] ?? s.mktcap ?? "";
    return {
      name, ticker, industry,
      market_cap_raw: capRaw,
      market_cap_val: parseMoney(capRaw),
      page
    };
  });
}

function rowMatchesFilters(r){
  const f = state.filters;
  if (f.name && !r.name.toLowerCase().includes(f.name)) return false;
  if (f.ticker && !r.ticker.toLowerCase().includes(f.ticker)) return false;
  if (f.industry && !r.industry.toLowerCase().includes(f.industry)) return false;

  if (f.market_cap){
    const q = f.market_cap.trim().toUpperCase();
    const range = q.match(/^(\d*\.?\d+\s*[KMBT]?)\s*-\s*(\d*\.?\d+\s*[KMBT]?)$/);
    const cmp = q.match(/^(>=|>|<=|<)\s*(\d*\.?\d+\s*[KMBT]?)$/);
    const val = r.market_cap_val;

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
        if (!fmtMoney(val).toUpperCase().includes(q)) return false;
      }
    } else {
      if (!r.market_cap_raw.toUpperCase().includes(q)) return false;
    }
  }

  if (state.global){
    const blob = `${r.name} ${r.ticker} ${r.industry} ${r.market_cap_raw}`.toLowerCase();
    if (!blob.includes(state.global)) return false;
  }
  return true;
}

function sortRows(rows){
  const {key, dir} = state.sort;
  const mult = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a,b)=>{
    if (key === "market_cap"){
      const va = a.market_cap_val, vb = b.market_cap_val;
      if (isNaN(va) && isNaN(vb)) return 0;
      if (isNaN(va)) return 1;
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

    const tdName = document.createElement("td"); tdName.textContent = r.name || "—";
    const tdTkr  = document.createElement("td"); tdTkr.textContent  = r.ticker || "—";
    const tdInd  = document.createElement("td"); tdInd.textContent  = r.industry || "—";
    const tdCap  = document.createElement("td"); tdCap.className    = "num";
    tdCap.textContent = isNaN(r.market_cap_val) ? (r.market_cap_raw || "—") : fmtMoney(r.market_cap_val);

    const tdAct  = document.createElement("td"); tdAct.className    = "action";
    const a = document.createElement("a"); a.className = "btn-link"; a.href = r.page || "#"; a.textContent = "Open";
    a.setAttribute("aria-label", `Open page for ${r.ticker || 'stock'}`);
    tdAct.appendChild(a);

    [tdName, tdTkr, tdInd, tdCap, tdAct].forEach(td=>tr.appendChild(td));
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
        state.sort.dir = key === "name" ? "asc" : "desc";
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
    }, 150));
  });
  $("#global-search")?.addEventListener("input", debounce(()=>{
    state.global = $("#global-search").value.trim().toLowerCase();
    renderTable();
  }, 150));
}

/* Footer year + back buttons (for subpages) */
(function footerYear(){ $$("#year").forEach(el => el.textContent = new Date().getFullYear()); })();
(function wireBackButtons(){
  $$("[data-back]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if (history.length > 1) history.back();
      else window.location.href = "index.html";
    });
  });
})();

/* ====================== Boot ====================== */
async function loadStocks(){
  try{
    const res = await fetch(DATA_URL, {cache:"no-store"});
    if (!res.ok) throw new Error(`Failed to load ${DATA_URL} (${res.status})`);
    const text = await res.text();
    const raw = parseLenientJSON(text);
    if (!Array.isArray(raw)) throw new Error("stocks.jsqon must contain a top-level array.");
    state.stocks = normalizeStocks(raw);
    renderTable();
  } catch (err){
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="muted">Could not load <code>${DATA_URL}</code>. Ensure you're running a local server and the file contains an array of stock objects.</td></tr>`;
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
