/* app.js - the public leaderboard site (index.html). */
(function () {
  const R = window.Render;
  const view = document.getElementById('view');
  const tabs = Array.from(document.querySelectorAll('#tabs a'));
  const refreshBtn = document.getElementById('refresh');
  const stamp = document.getElementById('stamp');
  let S = null;
  let focusId = null;

  function parseHash() {
    const h = (location.hash || '#standings').slice(1).split('/');
    return { tab: h[0] || 'standings', arg: h[1] };
  }

  function draw() {
    if (!S) return;
    let { tab, arg } = parseHash();
    if (tab === 'weekly') { tab = 'schedule'; history.replaceState(null, '', '#schedule' + (arg ? '/' + arg : '')); }
    const fn = R[tab] && ['standings', 'schedule', 'skins', 'handicaps', 'playoffs', 'rules'].includes(tab) ? tab : 'standings';
    tabs.forEach((a) => a.classList.toggle('on', a.dataset.tab === fn));
    view.innerHTML = R[fn](S, arg);
    if (fn === 'schedule' && dir) { view.classList.remove('slide-l', 'slide-r'); void view.offsetWidth; view.classList.add(dir > 0 ? 'slide-l' : 'slide-r'); }
    dir = 0;
    applyFocus();
    if (!draw.first) { draw.first = true; } else { window.scrollTo({ top: 0 }); }
  }

  function applyFocus() {
    const race = view.querySelector('.race');
    if (!race) return;
    race.classList.toggle('focus', !!focusId);
    race.querySelectorAll('.line').forEach((g) => g.classList.toggle('on', g.dataset.id === focusId));
    view.querySelectorAll('.legend button').forEach((b) => b.classList.toggle('on', b.dataset.id === focusId));
  }

  view.addEventListener('click', (e) => {
    const b = e.target.closest('.legend button');
    if (!b) return;
    focusId = focusId === b.dataset.id ? null : b.dataset.id;
    applyFocus();
  });

  async function boot(quiet) {
    try {
      if (refreshBtn) refreshBtn.disabled = true;
      const d = await Core.load();
      S = R.makeState(d);
      document.title = S.cfg.leagueName;
      const banner = document.getElementById('banner');
      if (banner) {
        if (d.mode !== 'live') { banner.hidden = false; banner.textContent = 'Demo data: this is a made-up season so you can see how everything looks.'; }
        else if (!d.live) { banner.hidden = false; banner.textContent = 'Read-only mode: live score submission is not connected yet (see README).'; }
        else banner.hidden = true;
      }
      document.querySelectorAll('.submit-link').forEach((a) => { a.hidden = !d.live; });
      if (stamp) stamp.textContent = 'Updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      draw();
    } catch (err) {
      if (!quiet) view.innerHTML = '<section class="panel"><h3>Could not load the league</h3><p class="muted">' + R.esc(err.message) + '</p></section>';
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }

  /* swipe left/right (or arrow keys) to flip weeks on the Schedule tab */
  let dir = 0;
  function flip(d) {
    if (!S || parseHash().tab !== 'schedule') return;
    const btn = view.querySelector('.flip .btn:' + (d > 0 ? 'last-child' : 'first-child'));
    if (!btn || btn.classList.contains('off')) return;
    dir = d;
    location.hash = btn.getAttribute('href');
  }
  let t0 = null;
  view.addEventListener('touchstart', (e) => {
    const sc = e.target.closest('.scroll, .chips');
    if (e.touches.length !== 1 || e.target.closest('input, select, textarea') || (sc && sc.scrollWidth > sc.clientWidth + 2)) { t0 = null; return; }
    t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!t0) return;
    const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y;
    const fast = Date.now() - t0.t < 700;
    t0 = null;
    if (fast && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) flip(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') flip(1); else if (e.key === 'ArrowLeft') flip(-1);
  });

  window.addEventListener('hashchange', draw);
  if (refreshBtn) refreshBtn.addEventListener('click', () => boot(false));
  setInterval(() => { if (!document.hidden && Core.hasBackend()) boot(true); }, 60000);
  boot(false);
})();
