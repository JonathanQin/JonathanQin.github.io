// -------------------------------
// Auto-update footer year
// -------------------------------
(function () {
  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();


// -------------------------------
// Theme toggle (dark / light mode)
// -------------------------------
(function () {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return; // prevent errors on pages without the button
  const root = document.documentElement;

  function updateIcon() {
    const isDark = root.classList.contains('theme-dark');
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.setAttribute('aria-label', isDark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  btn.addEventListener('click', () => {
    const isDark = root.classList.toggle('theme-dark');
    try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (_) {}
    updateIcon();
  });

  updateIcon();
})();


// -------------------------------
// Dropdown navigation interactivity
// -------------------------------
(function () {
  document.querySelectorAll('.nav-caret').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wrap = btn.closest('.nav-dropdown');
      const nowOpen = !wrap.classList.contains('open');

      // Close other open dropdowns
      document.querySelectorAll('.nav-dropdown.open').forEach(w => {
        if (w !== wrap) w.classList.remove('open');
        const c = w.querySelector('.nav-caret');
        if (c) c.setAttribute('aria-expanded', 'false');
      });

      wrap.classList.toggle('open', nowOpen);
      btn.setAttribute('aria-expanded', String(nowOpen));
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-dropdown.open').forEach(w => {
      w.classList.remove('open');
      const c = w.querySelector('.nav-caret');
      if (c) c.setAttribute('aria-expanded', 'false');
    });
  });

  // Close dropdown with Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.nav-dropdown.open').forEach(w => {
        w.classList.remove('open');
        const c = w.querySelector('.nav-caret');
        if (c) c.setAttribute('aria-expanded', 'false');
      });
    }
  });
})();
