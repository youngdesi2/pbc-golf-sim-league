/* admin.js - commissioner tools: lock weeks, set scramble teams, settle playoff ties, fix scores, override a course card. */
(function () {
  const R = window.Render, L = window.League;
  const app = document.getElementById('app');
  const esc = R.esc;
  let D = null, S = null, PIN = '', week = 1;

  const $ = (id) => document.getElementById(id);
  const flash = (html, kind) => { const m = $('flash'); if (m) m.innerHTML = '<div class="msg ' + (kind || 'ok') + '">' + html + '</div>'; };

  async function init() {
    try {
      D = await Core.load();
      S = R.makeState(D);
      if (!D.live) { app.innerHTML = '<section class="panel"><h3>Database not connected</h3><p class="muted">Add your Supabase URL and anon key to config.js first (see the README).</p></section>'; return; }
      const saved = Core.store.sget('pbc_admin');
      if (saved) { PIN = saved; try { if ((await Core.rpc('whoami', { p_pin: PIN })) !== 'none') return panel(); } catch (e) { /* fall through to login */ } }
      login();
    } catch (e) { app.innerHTML = '<section class="panel"><h3>Could not load</h3><p class="muted">' + esc(e.message) + '</p></section>'; }
  }

  function login() {
    app.innerHTML = '<section class="panel"><h3>Admin password</h3><div class="form" style="margin-top:12px"><input id="apin" type="password" placeholder="Your admin password" autocomplete="off"><button class="btn dark" id="alogin" type="button">Unlock</button><div id="flash"></div></div></section>';
    const go = async () => {
      PIN = $('apin').value.trim();
      try {
        if ((await Core.rpc('whoami', { p_pin: PIN })) === 'none') return flash('That password is not recognized.', 'err');
        Core.store.sset('pbc_admin', PIN);
        panel();
      } catch (e) { flash(esc(e.message), 'err'); }
    };
    $('alogin').addEventListener('click', go);
    $('apin').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  const metaOf = (n) => { const m = (D.db.meta || []).find((x) => x.week === n); return JSON.parse(JSON.stringify(m ? m.data || {} : {})); };
  async function reload() { D = await Core.load(); S = R.makeState(D); }
  async function saveMeta(n, data, okMsg) {
    try {
      await Core.rpc('admin_set_meta', { p_pin: PIN, p_week: n, p_data: data });
      await reload(); panel(); flash(okMsg || 'Saved.');
    } catch (e) { flash(esc(e.message), 'err'); }
  }
  const listNums = (s) => s.split(/[\s,]+/).filter(Boolean).map(Number);

  function panel() {
    const w = R.wk(S, week);
    const src = S.league.weeks.find((x) => x.n === week) || {};
    const meta = metaOf(week);
    const players = S.league.players;
    const opt = (sel) => '<option value="">-</option>' + players.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
    let h = '<div id="flash"></div>';
    h += rosterPanel();
    h += '<section class="panel"><label class="f">Week<select id="wk">' + S.res.weeks.map((x) => '<option value="' + x.n + '"' + (x.n === week ? ' selected' : '') + '>' + esc(R.weekName(x)) + ' · ' + esc(x.course.name) + '</option>').join('') + '</select></label></section>';

    /* basics */
    h += '<section class="panel"><h3>Week settings</h3><div class="form" style="margin-top:12px"><div class="row2"><label class="f">Date<input id="date" type="date" value="' + esc(src.date || '') + '"></label>' +
      '<label class="f">Status<select id="locked"><option value="0"' + (!src.locked ? ' selected' : '') + '>Open</option><option value="1"' + (src.locked ? ' selected' : '') + '>Final: week is closed</option></select></label></div>' +
      '<label class="f">Skins<select id="skinson"><option value="1"' + (src.skins !== false ? ' selected' : '') + '>Skins on</option><option value="0"' + (src.skins === false ? ' selected' : '') + '>No skins this week</option></select></label>' +
      '<button class="btn dark" id="saveBasics" type="button">Save week settings</button></div>' +
      '<p class="fine"><a href="submit.html?week=' + week + '">Enter or correct a score</a> (use your admin password there).</p></section>';

    /* scramble teams */
    if (w.type === 'scramble') {
      const cur = (src.teams || []).map((t) => t.players);
      const rows = [];
      for (let i = 0; i < Math.floor(players.length / 2); i++) rows.push('<div class="teamrow"><select class="ta">' + opt(cur[i] && cur[i][0]) + '</select><select class="tb">' + opt(cur[i] && cur[i][1]) + '</select><span class="muted">Team ' + (i + 1) + '</span></div>');
      h += '<section class="panel"><h3>Scramble teams</h3><p class="muted">Lowest handicap with highest, no repeat partners. Lock these in before the round. Changing a team after scores are in orphans that team\'s scorecard.</p><div class="admin-grid" id="teams">' + rows.join('') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn small" id="suggest" type="button">Suggest pairings</button><button class="btn dark small" id="saveTeams" type="button">Save teams</button></div></section>';
    }

    /* playoff overrides */
    if (w.type === 'playoff') {
      const ov = meta.overrides || {};
      h += '<section class="panel"><h3>Settle matches</h3><p class="muted">Use this for a sudden-death tiebreak or a forfeit. Leave blank when the scores decide it.</p><div class="admin-grid">' +
        (w.matches || []).filter((m) => m.a && m.b).map((m) => '<div class="teamrow" style="grid-template-columns:1fr 1fr"><span><b>' + esc(m.label) + '</b><br><small class="muted">' + esc(R.nm(S, m.a) + ' v ' + R.nm(S, m.b)) + (m.status === 'needs-tiebreak' ? ' · ALL SQUARE' : '') + '</small></span><select class="ov" data-m="' + esc(m.id) + '"><option value="">Scores decide</option><option value="' + esc(m.a) + '"' + (ov[m.id] === m.a ? ' selected' : '') + '>' + esc(R.nm(S, m.a)) + ' wins</option><option value="' + esc(m.b) + '"' + (ov[m.id] === m.b ? ' selected' : '') + '>' + esc(R.nm(S, m.b)) + ' wins</option></select></div>').join('') +
        '</div><button class="btn dark small" id="saveOv" type="button" style="margin-top:12px">Save results</button></section>';
    }

    /* excused + skins sit-outs */
    if (w.type !== 'scramble') {
      const ex = meta.excused || [], out = meta.skinsOut || [];
      const chk = (cls, list) => players.map((p) => '<label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" class="' + cls + '" value="' + esc(p.id) + '"' + (list.includes(p.id) ? ' checked' : '') + '> ' + esc(p.name) + '</label>').join('');
      h += '<section class="panel"><h3>Excused / sit-outs</h3>' + (w.type === 'regular' ? '<h4>Excused absences (get their average points)</h4><div class="pairs">' + chk('ex', ex) + '</div>' : '') +
        '<h4>Sitting out of skins this week</h4><div class="pairs">' + chk('so', out) + '</div><button class="btn dark small" id="saveEx" type="button" style="margin-top:12px">Save</button></section>';
    }

    /* course override */
    const c = w.course;
    h += '<section class="panel"><h3>Course card</h3><p class="muted">Compare to the scorecard on the sim screen. If a par or handicap number is off, fix it here and every score recalculates.</p><div class="form">' +
      '<label class="f">Course name<input id="cname" type="text" value="' + esc(c.name) + '"></label>' +
      '<label class="f">Par, holes 1-18 (comma separated)<textarea id="cpar">' + c.par.join(', ') + '</textarea></label>' +
      '<label class="f">Handicap / stroke index, holes 1-18<textarea id="csi">' + c.si.join(', ') + '</textarea></label>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn dark small" id="saveCourse" type="button">Save course card</button>' + (meta.course ? '<button class="btn small" id="resetCourse" type="button">Revert to scheduled card</button>' : '') + '</div></div></section>';

    /* submissions */
    const stamps = src.stamps || {};
    const solo = Object.keys(src.rounds || {});
    const teamsWith = (src.teams || []).filter((t) => t.holes && t.holes.length === 18);
    h += '<section class="panel"><h3>Submitted scores</h3><div class="sublist">' +
      (solo.map((id) => '<div><span><b>' + esc(R.nm(S, id)) + '</b> <small class="muted">' + esc(R.fmtStamp(stamps[id])) + '</small></span><button class="btn small" data-del="' + esc(id) + '" type="button">Delete</button></div>').join('') +
        teamsWith.map((t) => { const k = Core.teamKey(t.players); return '<div><span><b>' + esc(R.nm(S, k)) + '</b> <small class="muted">team · ' + esc(R.fmtStamp(stamps[k])) + '</small></span><button class="btn small" data-delteam="' + esc(k) + '" type="button">Delete</button></div>'; }).join('') ||
        '<span class="muted">Nothing submitted for this week yet.</span>') + '</div></section>';
    h += '<section class="panel"><h3>Recent activity</h3><div class="sublist" id="log"><span class="muted">Loading...</span></div></section>';
    app.innerHTML = h;
    bind(w, src, meta);
    loadLog();
  }

  async function loadLog() {
    const el = $('log');
    if (!el) return;
    try {
      const rows = await Core.sb('submission_log?select=*&order=at.desc&limit=25');
      el.innerHTML = rows.length ? rows.map((r) => '<div><span>' + esc(r.action) + ' · Wk ' + r.week + ' · <b>' + esc(R.nm(S, r.who)) + '</b>' + (r.admin_name ? ' <span class="tag">by ' + esc(r.admin_name) + '</span>' : '') + (r.witness ? ' <span class="tag green">witness ' + esc(R.nm(S, r.witness)) + '</span>' : '') + '</span><small class="muted">' + esc(new Date(r.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</small></div>').join('') : '<span class="muted">No activity yet.</span>';
    } catch (e) { el.innerHTML = '<span class="muted">Could not load the log.</span>'; }
  }

  function rosterPanel() {
    const players = S.league.players, cfg = S.league.config || {};
    const used = new Set();
    S.league.weeks.forEach((x) => { Object.keys(x.rounds || {}).forEach((id) => used.add(id)); (x.teams || []).forEach((t) => { if (t.holes) t.players.forEach((id) => used.add(id)); }); });
    const row = (p) => '<div class="teamrow" style="grid-template-columns:1fr 90px auto" data-id="' + esc(p.id) + '"><input class="rname" type="text" value="' + esc(p.name) + '" aria-label="Name"><input class="ridx" type="number" step="0.1" value="' + p.startIndex + '" aria-label="Starting index">' +
      (used.has(p.id) ? '<span class="muted" title="Has scores">&nbsp;</span>' : '<button class="btn small rdel" type="button">Remove</button>') + '</div>';
    return '<details class="panel" id="roster"><summary><b>Roster &amp; league settings</b></summary>' +
      '<p class="muted" style="margin-top:10px">Rename players, change starting handicap indexes, add or remove players. Players with scores entered cannot be removed. Week 1 is the baseline round, so starting indexes only matter until then. The playoff format needs exactly 10 players.</p>' +
      '<div class="admin-grid" id="rlist">' + players.map(row).join('') + '</div>' +
      '<div style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap"><button class="btn small" id="radd" type="button">Add player</button></div>' +
      '<div class="form"><div class="row2"><label class="f">League name<input id="cfgName" type="text" value="' + esc(cfg.leagueName || '') + '"></label><label class="f">Season<input id="cfgSeason" type="text" value="' + esc(cfg.season || '') + '"></label></div>' +
      '<label class="f">Skins buy-in per player ($)<input id="cfgSkins" type="number" step="1" min="0" value="' + (cfg.skinsBuyIn != null ? cfg.skinsBuyIn : 10) + '"></label>' +
      '<button class="btn dark" id="rsave" type="button">Save roster &amp; settings</button></div></details>';
  }

  function bindRoster() {
    const list = $('rlist');
    list.addEventListener('click', (e) => { if (e.target.classList.contains('rdel')) e.target.closest('.teamrow').remove(); });
    $('radd').addEventListener('click', () => {
      const ids = new Set(Array.from(list.querySelectorAll('.teamrow')).map((r) => r.dataset.id).concat(S.league.players.map((p) => p.id)));
      let n = 1; while (ids.has('p' + n)) n++;
      const d = document.createElement('div'); d.className = 'teamrow'; d.style.gridTemplateColumns = '1fr 90px auto'; d.dataset.id = 'p' + n;
      d.innerHTML = '<input class="rname" type="text" value="New player" aria-label="Name"><input class="ridx" type="number" step="0.1" value="18" aria-label="Starting index"><button class="btn small rdel" type="button">Remove</button>';
      list.appendChild(d);
    });
    $('rsave').addEventListener('click', async () => {
      const players = Array.from(list.querySelectorAll('.teamrow')).map((r) => ({ id: r.dataset.id, name: r.querySelector('.rname').value.trim(), startIndex: parseFloat(r.querySelector('.ridx').value) }));
      if (players.some((p) => !p.name || isNaN(p.startIndex))) return flash('Every player needs a name and a starting index.', 'err');
      if (new Set(players.map((p) => p.name.toLowerCase())).size !== players.length) return flash('Two players have the same name.', 'err');
      const config = { leagueName: $('cfgName').value.trim() || undefined, season: $('cfgSeason').value.trim() || undefined, skinsBuyIn: parseFloat($('cfgSkins').value) || 0 };
      try {
        await Core.rpc('admin_set_config', { p_pin: PIN, p_data: { players, config } });
        await reload(); panel(); flash('Roster and settings saved.' + (players.length !== 10 ? ' Note: the playoff format needs exactly 10 players.' : ''));
      } catch (e) { flash(esc(e.message), 'err'); }
    });
  }

  function bind(w, src, meta) {
    bindRoster();
    $('wk').addEventListener('change', () => { week = parseInt($('wk').value, 10); panel(); });
    $('saveBasics').addEventListener('click', () => {
      const d = metaOf(week);
      d.date = $('date').value || undefined;
      d.locked = $('locked').value === '1';
      if ($('skinson').value === '0') d.skins = false; else delete d.skins;
      saveMeta(week, d, 'Week settings saved.');
    });
    const sg = $('suggest');
    if (sg) {
      sg.addEventListener('click', () => {
        const pairs = L.suggestPairings(S.league, week);
        const A = document.querySelectorAll('.ta'), B = document.querySelectorAll('.tb');
        pairs.forEach((p, i) => { if (A[i]) { A[i].value = p[0]; B[i].value = p[1]; } });
      });
      $('saveTeams').addEventListener('click', () => {
        const A = document.querySelectorAll('.ta'), B = document.querySelectorAll('.tb');
        const teams = [], seen = new Set();
        for (let i = 0; i < A.length; i++) {
          if (!A[i].value || !B[i].value) return flash('Fill in every team.', 'err');
          if (A[i].value === B[i].value) return flash('A player cannot be paired with themselves.', 'err');
          [A[i].value, B[i].value].forEach((id) => seen.add(id));
          teams.push({ players: [A[i].value, B[i].value] });
        }
        if (seen.size !== A.length * 2) return flash('Each player can only be on one team.', 'err');
        const d = metaOf(week); d.teams = teams;
        saveMeta(week, d, 'Teams saved.');
      });
    }
    const so = $('saveOv');
    if (so) so.addEventListener('click', () => {
      const d = metaOf(week), ov = {};
      document.querySelectorAll('.ov').forEach((s) => { if (s.value) ov[s.dataset.m] = s.value; });
      if (Object.keys(ov).length) d.overrides = ov; else delete d.overrides;
      saveMeta(week, d, 'Match results saved.');
    });
    const se = $('saveEx');
    if (se) se.addEventListener('click', () => {
      const d = metaOf(week);
      const ex = Array.from(document.querySelectorAll('.ex:checked')).map((x) => x.value);
      const out = Array.from(document.querySelectorAll('.so:checked')).map((x) => x.value);
      if (ex.length) d.excused = ex; else delete d.excused;
      if (out.length) d.skinsOut = out; else delete d.skinsOut;
      saveMeta(week, d, 'Saved.');
    });
    $('saveCourse').addEventListener('click', () => {
      const par = listNums($('cpar').value), si = listNums($('csi').value);
      if (par.length !== 18 || par.some((x) => !(x >= 3 && x <= 6))) return flash('Par needs 18 numbers between 3 and 6.', 'err');
      if (si.length !== 18 || si.slice().sort((a, b) => a - b).join() !== Array.from({ length: 18 }, (_, i) => i + 1).join()) return flash('Handicap needs each number from 1 to 18 exactly once.', 'err');
      const d = metaOf(week); d.course = { name: $('cname').value.trim() || w.course.name, par, si };
      saveMeta(week, d, 'Course card saved. Everything recalculated.');
    });
    const rc = $('resetCourse');
    if (rc) rc.addEventListener('click', () => { const d = metaOf(week); delete d.course; saveMeta(week, d, 'Back to the scheduled course card.'); });
    app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this scorecard?')) return;
      try { await Core.rpc('admin_delete_round', { p_pin: PIN, p_week: week, p_player: b.dataset.del }); await reload(); panel(); flash('Deleted.'); } catch (e) { flash(esc(e.message), 'err'); }
    }));
    app.querySelectorAll('[data-delteam]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Delete this team scorecard?')) return;
      try { await Core.rpc('admin_delete_team_round', { p_pin: PIN, p_week: week, p_team: b.dataset.delteam }); await reload(); panel(); flash('Deleted.'); } catch (e) { flash(esc(e.message), 'err'); }
    }));
  }

  init();
})();
