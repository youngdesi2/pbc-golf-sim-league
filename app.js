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
    const { tab, arg } = parseHash();
    const fn = R[tab] && ['standings', 'schedule', 'weekly', 'skins', 'handicaps', 'playoffs', 'rules'].includes(tab) ? tab : 'standings';
    tabs.forEach((a) => a.classList.toggle('on', a.dataset.tab === fn));
    view.innerHTML = R[fn](S, arg);
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

  window.addEventListener('hashchange', draw);
  if (refreshBtn) refreshBtn.addEventListener('click', () => boot(false));
  setInterval(() => { if (!document.hidden && Core.hasBackend()) boot(true); }, 60000);
  boot(false);
})();
