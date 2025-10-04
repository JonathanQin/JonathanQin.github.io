/* ---------- Site constants: add/remove stocks here ---------- */
const STOCKS = [
  { symbol: "AAPL", name: "Apple Inc.", page: "AAPL.html" },
  // Add more stocks as you create pages:
  // { symbol: "MSFT", name: "Microsoft Corporation", page: "MSFT.html" },
  // { symbol: "GOOGL", name: "Alphabet Inc.", page: "GOOGL.html" },
];

/* ---------- Helpers ---------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

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
