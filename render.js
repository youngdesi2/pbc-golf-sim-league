/* render.js - turns computed league state into HTML. Shared by index, submit and admin pages. */
(function () {
  const L = window.League;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fp = (v) => (v == null ? '-' : String(Math.round(v * 100) / 100));
  const money = L.fmtMoney;
  const COLORS = ['#c0392b', '#1f6f8b', '#d4a017', '#6a4c93', '#2e8b57', '#e67e22', '#34495e', '#d35d8f', '#7f8c8d', '#8e5b2b'];

  function makeState(d) {
    const res = L.compute(d.league);
    return { league: d.league, base: d.base, res, live: d.live, mode: d.mode, byId: res.byId, cfg: res.cfg };
  }
  const nm = (S, id) => (id && id.indexOf('+') > -1 ? id.split('+').map((x) => nm(S, x)).join(' & ') : S.byId[id] ? S.byId[id].name : id || 'TBD');
  const wk = (S, n) => S.res.weeks.find((w) => w.n === n);
  const fmtDate = (s) => {
    if (!s) return 'TBD';
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const fmtStamp = (s) => (s ? new Date(s).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0]);

  function weekName(w) {
    if (w.type === 'playoff') return ['Playoffs: Round 1', 'Playoffs: Semifinals', 'Championship Final'][(w.round || 1) - 1];
    return 'Week ' + w.n;
  }
  const weekTag = (w) => (w.type === 'scramble' ? '<span class="tag gold">2x points scramble</span>' : w.type === 'playoff' ? '<span class="tag green">Playoffs</span>' : w.baseline ? '<span class="tag green">Baseline round &middot; half points</span>' : '');

  /* the week to show by default: latest with scores, else the first one */
  function currentWeek(S) {
    const played = S.res.weeks.filter((w) => w.played);
    return played.length ? played[played.length - 1].n : 1;
  }
  function nextWeek(S) {
    const open = S.res.weeks.find((w) => !w.played);
    return open || null;
  }

  /* ---------- small building blocks ---------- */
  function holeClass(v, par) {
    if (L.isPickup(v)) return 'h-pick';
    const d = v - par;
    return d <= -2 ? 'h-eagle' : d === -1 ? 'h-birdie' : d === 0 ? 'h-par' : d === 1 ? 'h-bogey' : 'h-dbl';
  }
  function courseTable(c) {
    if (c.par.length === 9) {
      const cs = (arr) => arr.map((x) => '<td>' + x + '</td>').join('');
      return '<div class="scroll"><table class="card mini"><thead><tr><th>Hole</th>' + c.holeNums.map((h) => '<th>' + h + '</th>').join('') + '<th>Tot</th></tr></thead><tbody>' +
        '<tr><th>Par</th>' + cs(c.par) + '<td class="sub">' + c.parTotal + '</td></tr>' +
        '<tr><th>Hcp</th>' + cs(c.siCard) + '<td></td></tr></tbody></table></div>';
    }
    const cells = (arr, a, b) => arr.slice(a, b).map((x) => '<td>' + x + '</td>').join('');
    const sum = (arr, a, b) => arr.slice(a, b).reduce((x, y) => x + y, 0);
    return '<div class="scroll"><table class="card mini"><thead><tr><th>Hole</th>' +
      c.par.slice(0, 9).map((_, i) => '<th>' + (i + 1) + '</th>').join('') + '<th>Out</th>' +
      c.par.slice(9).map((_, i) => '<th>' + (i + 10) + '</th>').join('') + '<th>In</th><th>Tot</th></tr></thead><tbody>' +
      '<tr><th>Par</th>' + cells(c.par, 0, 9) + '<td class="sub">' + sum(c.par, 0, 9) + '</td>' + cells(c.par, 9, 18) + '<td class="sub">' + sum(c.par, 9, 18) + '</td><td class="sub">' + sum(c.par, 0, 18) + '</td></tr>' +
      '<tr><th>Hcp</th>' + cells(c.si, 0, 9) + '<td></td>' + cells(c.si, 9, 18) + '<td></td><td></td></tr></tbody></table></div>';
  }
  function courseHeader(w) {
    const c = w.course;
    return '<div class="course-head' + (c.major ? ' major' : '') + '"><div><div class="eyebrow">' + esc(weekName(w)) + ' &middot; ' + esc(fmtDate(w.date)) + '</div>' +
      '<h2>' + esc(c.name) + '</h2>' + (c.note ? '<div class="note">' + esc(c.note) + '</div>' : '') +
      (w.ruleChanges && w.ruleChanges.length ? '<div class="rulechg"><b>Rules this week:</b> ' + w.ruleChanges.map((r) => '<span class="tag gold" title="' + (r.def ? 'Usually: ' + esc(r.def) : 'Not set by default') + '">' + esc(r.label) + ': ' + esc(r.value) + '</span>').join(' ') + '</div>' : '') + '</div><div>' + weekTag(w) + '<span class="tag">Par ' + c.parTotal + '</span>' + (c.par.length === 9 ? '<span class="tag gold">9 holes &middot; ' + c.nine + ' nine</span>' : '') + '</div></div>';
  }

  /* hole-by-hole scorecards for a set of rows [{label, holes, sub}] */
  function scorecards(rows, course) {
    if (course.par.length === 9) {
      const row9 = (r) => '<tr><th class="who">' + esc(r.label) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</th>' +
        r.holes.map((v, i) => '<td class="' + holeClass(v, course.par[i]) + '"><span>' + (L.isPickup(v) ? 'P' : v) + '</span></td>').join('') +
        '<td class="sub b">' + r.holes.reduce((a, v, i) => a + (L.isPickup(v) ? course.par[i] + 5 : v), 0) + '</td></tr>';
      return '<div class="scroll"><table class="card"><thead><tr><th>Hole</th>' + course.holeNums.map((h) => '<th>' + h + '</th>').join('') + '<th>Tot</th></tr>' +
        '<tr class="parrow"><th>Par</th>' + course.par.map((x) => '<td>' + x + '</td>').join('') + '<td class="sub b">' + course.parTotal + '</td></tr></thead><tbody>' + rows.map(row9).join('') + '</tbody></table></div>' +
        '<div class="key"><span class="h-eagle"><span>2</span></span> eagle+ <span class="h-birdie"><span>3</span></span> birdie <span class="h-par"><span>4</span></span> par <span class="h-bogey"><span>5</span></span> bogey <span class="h-dbl"><span>6</span></span> double+ <span class="h-pick"><span>P</span></span> pickup</div>';
    }
    const row = (r) => {
      const hs = r.holes;
      const cell = (i) => '<td class="' + holeClass(hs[i], course.par[i]) + '"><span>' + (L.isPickup(hs[i]) ? 'P' : hs[i]) + '</span></td>';
      const val = (v, i) => (L.isPickup(v) ? course.par[i] + 5 : v);
      let o = 0, n = 0;
      for (let i = 0; i < 9; i++) { o += val(hs[i], i); n += val(hs[i + 9], i + 9); }
      let front = '', back = '';
      for (let i = 0; i < 9; i++) { front += cell(i); back += cell(i + 9); }
      return '<tr><th class="who">' + esc(r.label) + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + '</th>' + front + '<td class="sub">' + o + '</td>' + back + '<td class="sub">' + n + '</td><td class="sub b">' + (o + n) + '</td></tr>';
    };
    return '<div class="scroll"><table class="card"><thead><tr><th>Hole</th>' + Array.from({ length: 9 }, (_, i) => '<th>' + (i + 1) + '</th>').join('') + '<th>Out</th>' +
      Array.from({ length: 9 }, (_, i) => '<th>' + (i + 10) + '</th>').join('') + '<th>In</th><th>Tot</th></tr>' +
      '<tr class="parrow"><th>Par</th>' + course.par.slice(0, 9).map((x) => '<td>' + x + '</td>').join('') + '<td class="sub">' + course.par.slice(0, 9).reduce((a, b) => a + b, 0) + '</td>' +
      course.par.slice(9).map((x) => '<td>' + x + '</td>').join('') + '<td class="sub">' + course.par.slice(9).reduce((a, b) => a + b, 0) + '</td><td class="sub b">' + course.parTotal + '</td></tr></thead><tbody>' +
      rows.map(row).join('') + '</tbody></table></div>' +
      '<div class="key"><span class="h-eagle"><span>2</span></span> eagle+ <span class="h-birdie"><span>3</span></span> birdie <span class="h-par"><span>4</span></span> par <span class="h-bogey"><span>5</span></span> bogey <span class="h-dbl"><span>6</span></span> double+ <span class="h-pick"><span>P</span></span> pickup</div>';
  }

  /* ---------- STANDINGS ---------- */
  function raceChart(S) {
    const race = S.res.race;
    if (race.length < 1) return '';
    const W = 680, H = 300, pad = { l: 38, r: 70, t: 14, b: 28 };
    const maxY = Math.max.apply(null, race.map((r) => Math.max.apply(null, Object.values(r.cum)))) || 1;
    const x = (i) => pad.l + (race.length === 1 ? 0 : (i * (W - pad.l - pad.r)) / (race.length - 1));
    const y = (v) => H - pad.b - (v / maxY) * (H - pad.t - pad.b);
    const ids = S.res.standings.map((r) => r.id);
    const ticks = 4;
    let g = '';
    for (let t = 0; t <= ticks; t++) {
      const v = (maxY * t) / ticks;
      g += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid"/><text x="' + (pad.l - 6) + '" y="' + (y(v) + 4) + '" class="axis" text-anchor="end">' + Math.round(v) + '</text>';
    }
    race.forEach((r, i) => { g += '<text x="' + x(i) + '" y="' + (H - 8) + '" class="axis" text-anchor="middle">W' + r.n + '</text>'; });
    const lines = ids.map((id, k) => {
      const c = COLORS[k % COLORS.length];
      const pts = race.map((r, i) => x(i) + ',' + y(r.cum[id])).join(' ');
      const last = race[race.length - 1].cum[id];
      return '<g class="line" data-id="' + id + '" style="--c:' + c + '"><polyline points="' + pts + '" fill="none" stroke="' + c + '" stroke-width="2.5" stroke-linejoin="round"/>' +
        race.map((r, i) => '<circle cx="' + x(i) + '" cy="' + y(r.cum[id]) + '" r="3" fill="' + c + '"/>').join('') +
        '<text x="' + (x(race.length - 1) + 8) + '" y="' + (y(last) + 4) + '" class="endlabel" fill="' + c + '">' + esc(nm(S, id).split(' ')[0]) + '</text></g>';
    }).join('');
    const legend = ids.map((id, k) => '<button type="button" data-id="' + id + '"><i style="background:' + COLORS[k % COLORS.length] + '"></i>' + esc(nm(S, id)) + '</button>').join('');
    return '<section class="panel"><h3>Points race</h3><p class="muted">Tap a name to follow one player. The big jumps are the scramble weeks.</p>' +
      '<div class="race"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cumulative points by week">' + g + lines + '</svg></div><div class="legend">' + legend + '</div></section>';
  }

  function standings(S) {
    const st = S.res.standings;
    const any = S.res.weeks.some((w) => w.played);
    const nw = nextWeek(S);
    const leader = st[0];
    let out = '';
    if (nw && S.live) {
      out += '<section class="callout"><div><div class="eyebrow">Up next</div><h2>' + esc(weekName(nw)) + ': ' + esc(nw.course.name) + '</h2><div class="muted">' + esc(fmtDate(nw.date)) + (nw.type === 'scramble' ? ' &middot; <b>double points scramble</b>' : '') + '</div></div>' +
        '<a class="btn" href="submit.html' + (nw.n ? '?week=' + nw.n : '') + '">Submit your score</a></section>';
    } else if (nw) {
      out += '<section class="callout"><div><div class="eyebrow">Up next</div><h2>' + esc(weekName(nw)) + ': ' + esc(nw.course.name) + '</h2><div class="muted">' + esc(fmtDate(nw.date)) + '</div></div></section>';
    }
    if (S.res.champion) out += '<section class="champ"><div class="eyebrow">Season champion</div><h2>' + esc(nm(S, S.res.champion)) + '</h2></section>';
    out += '<section class="panel"><div class="panel-head"><h3>Season standings</h3>' + (S.res.provisional ? '<span class="tag">Provisional</span>' : '<span class="tag green">Final seeds</span>') + '</div>' +
      '<p class="muted">Top 2 earn a playoff bye, seeds 3-6 start in round 1, seeds 7-10 play the consolation round robin.</p>' +
      '<div class="scroll"><table class="t standings"><thead><tr><th>#</th><th class="l">Player</th><th class="pts">Pts</th><th>Idx</th><th>Wks</th><th title="Round-robin points">RR</th><th title="Attendance">Att</th><th title="Scramble points">Scr</th><th title="' + (S.cfg.scoringFormat === 'stableford' ? 'Total net Stableford (tiebreak)' : 'Season net score to par (tiebreak, lower is better)') + '">' + (S.cfg.scoringFormat === 'stableford' ? 'Stbl' : 'Net') + '</th><th title="Weeks with low gross">LG</th><th>Skins</th></tr></thead><tbody>' +
      st.map((r, i) => {
        const zone = i < 2 ? 'bye' : i < 6 ? 'in' : 'out';
        const label = zone === 'bye' ? '<span class="zone bye">BYE</span>' : zone === 'in' ? '' : '<span class="zone out">CONS</span>';
        return '<tr class="z-' + zone + (i === 5 ? ' cut' : '') + '"><td class="rk">' + r.rank + '</td><td class="l"><b>' + esc(r.name) + '</b> ' + label + (r.tied ? ' <span class="tie" title="Tied on points and tiebreak">T</span>' : '') + '</td><td class="pts">' + fp(r.total) + '</td><td>' + L.fmtIndex(r.index) + '</td><td>' + r.played + '</td><td>' + fp(r.rr) + '</td><td>' + r.attend + '</td><td>' + fp(r.scramble) + '</td><td>' + (S.cfg.scoringFormat === 'stableford' ? r.stableford : (r.netPar > 0 ? '+' : '') + r.netPar) + '</td><td>' + r.lowGross + '</td><td class="' + (r.skinsNet >= 0 ? 'pos' : 'neg') + '">' + money(r.skinsNet) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="fine">Idx = handicap index. RR = round-robin points. Att = attendance. Scr = scramble points. ' + (S.cfg.scoringFormat === 'stableford' ? 'Stbl = season net Stableford (tiebreak).' : 'Net = season net score to par (tiebreak).') + ' LG = low gross weeks.' + (any ? '' : ' No scores yet: standings fill in as players submit.') + '</p></section>';
    if (any) out += raceChart(S);
    if (leader && any) out += '';
    return out;
  }

  /* ---------- WEEKLY ---------- */
  function weekChips(S, cur) {
    return '<div class="chips">' + S.res.weeks.map((w) => '<a class="chip' + (w.n === cur ? ' on' : '') + (w.played ? ' done' : '') + (w.type === 'scramble' ? ' gold' : '') + (w.type === 'playoff' ? ' po' : '') + '" href="#schedule/' + w.n + '">' +
      (w.type === 'playoff' ? 'P' + w.round : w.n) + '</a>').join('') + '</div>';
  }

  function skinsBlock(S, w) {
    const sk = w.skins;
    if (!sk) return '<section class="panel"><h3>Skins</h3><p class="muted">No skins yet this week.</p></section>';
    const won = sk.holes.filter((h) => h.winner);
    return '<section class="panel"><div class="panel-head"><h3>Skins</h3><span class="tag gold">Pot ' + money(sk.pot) + '</span></div>' +
      '<p class="muted">' + sk.entrants + ' in at ' + money(sk.buyIn) + (sk.carryIn ? ' + ' + money(sk.carryIn) + ' carried over' : '') + ' &middot; ' + sk.skinsWon + ' skin' + (sk.skinsWon === 1 ? '' : 's') + ' won' + (sk.skinsWon ? ' &middot; <b>' + money(sk.value) + ' per skin</b>' : ' &middot; <b>whole pot carries to next week</b>') + '</p>' +
      (sk.winners.length ? '<div class="scroll"><table class="t"><thead><tr><th class="l">Winner</th><th>Skins</th><th>Payout</th><th class="l">Holes</th></tr></thead><tbody>' +
        sk.winners.sort((a, b) => b.skins - a.skins).map((x) => '<tr><td class="l"><b>' + esc(nm(S, x.id)) + '</b></td><td>' + x.skins + '</td><td class="pos">' + money(x.amount) + '</td><td class="l">' + won.filter((h) => h.winner === x.id).map((h) => h.hole + (h.skins > 1 ? ' (' + h.skins + ')' : '')).join(', ') + '</td></tr>').join('') + '</tbody></table></div>' : '') +
      '<div class="skinsholes">' + sk.holes.map((h) => '<span class="sh' + (h.winner ? ' won' : '') + '" title="' + (h.winner ? esc(nm(S, h.winner)) : 'tied, carries') + '"><b>' + h.hole + '</b>' + (h.winner ? esc(nm(S, h.winner).split(' ')[0].slice(0, 5)) : 'carry') + '</span>').join('') + '</div>' +
      '<p class="fine">Net skins. Strokes capped at a ' + S.cfg.skinsMaxHcp + ' handicap. Ties carry to the next hole; leftover carry from the 18th is dead.</p></section>';
  }

  function matchCard(S, m) {
    const sa = S.res.seeds.indexOf(m.a) + 1, sb = S.res.seeds.indexOf(m.b) + 1;
    const side = (id, seed) => '<div class="side' + (m.winner && m.winner === id ? ' win' : m.winner ? ' lose' : '') + '"><span class="seed">' + (id ? seed : '?') + '</span><b>' + esc(id ? nm(S, id) : 'TBD') + '</b></div>';
    const strip = m.holes && m.holes.length ? '<div class="strip">' + m.holes.map((h, i) => '<i class="' + h + '" title="Hole ' + (i + 1) + '"></i>').join('') + '</div>' : '';
    const status = m.status === 'final' ? '<span class="res">' + esc((m.winner ? nm(S, m.winner).split(' ')[0] + ' wins ' : '') + (m.text || '')) + '</span>' :
      m.status === 'halved' ? '<span class="res">Halved</span>' : m.status === 'needs-tiebreak' ? '<span class="res warn">All square: needs a tiebreak</span>' :
        m.status === 'live' ? '<span class="res live">' + (m.up === 0 ? 'All square' : nm(S, m.up > 0 ? m.a : m.b).split(' ')[0] + ' ' + Math.abs(m.up) + ' up') + ' thru ' + m.played + '</span>' :
          m.status === 'tbd' ? '<span class="res">Waiting on earlier round</span>' : '<span class="res">Not played</span>';
    return '<div class="match ' + m.bracket + '"><div class="mlabel">' + esc(m.label) + '</div>' + side(m.a, sa) + side(m.b, sb) + strip +
      '<div class="mfoot">' + status + (m.strokesTo ? '<span class="strokes">' + esc(nm(S, m.strokesTo).split(' ')[0]) + ' gets ' + m.spread + '</span>' : m.a && m.b ? '<span class="strokes">Even</span>' : '') + '</div></div>';
  }

  function weekly(S, arg) {
    const n = arg ? parseInt(arg, 10) : currentWeek(S);
    const w = wk(S, n) || wk(S, 1);
    const src = S.league.weeks.find((x) => x.n === w.n) || {};
    let out = weekChips(S, w.n) + courseHeader(w);
    const stamps = src.stamps || {};

    if (w.type === 'regular') {
      if (!w.played) {
        out += '<section class="panel"><h3>Not played yet</h3><p class="muted">' + (S.live ? 'Scores appear here the moment players submit them.' : 'No scores recorded for this week.') + '</p>' + courseTable(w.course) + '</section>';
        out += coursehcpBlock(S, w);
        return out;
      }
      out += '<section class="panel"><h3>Results</h3><div class="scroll"><table class="t"><thead><tr><th>#</th><th class="l">Player</th><th class="pts">Pts</th><th>Stbl</th><th>Hcp</th><th>Gross</th><th>Net</th><th>RR</th><th>+Att</th></tr></thead><tbody>' +
        w.order.map((id, i) => {
          const r = w.rows[id];
          if (r.excused) return '<tr class="muted"><td></td><td class="l">' + esc(nm(S, id)) + ' <span class="tag">excused</span></td><td class="pts">' + fp(r.total) + '</td><td></td><td></td><td></td><td></td><td>' + fp(r.rr) + '</td><td>0</td></tr>';
          return '<tr><td class="rk">' + r.rank + '</td><td class="l"><b>' + esc(nm(S, id)) + '</b>' + (r.lowGross ? ' <span class="tag gold" title="Low gross of the week">LG</span>' : '') + '</td><td class="pts">' + fp(r.total) + '</td><td><b>' + r.stableford + '</b></td><td>' + L.fmtHcp(r.hcp) + '</td><td>' + r.gross + '</td><td>' + r.net + '</td><td>' + fp(r.rr) + '</td><td>' + r.attend + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="fine">' + (w.baseline ? '<b>Baseline round:</b> counts half points (max 5) and sets everyone\'s starting handicap. ' : '') + (w.format === 'stableford' ? 'Net Stableford (net par = 2). ' : 'Ranked by net total' + (S.cfg.netCap === 'none' ? '' : ', max net ' + (S.cfg.netCap === 'triple' ? 'triple' : 'double') + ' bogey per hole') + '. ') + 'Each player earns 1 point for every other player they beat, scaled to 9, plus 1 for playing. ' + (w.difficulty ? 'Course played ' + (w.difficulty > 0 ? w.difficulty + ' strokes harder' : Math.abs(w.difficulty) + ' strokes easier') + ' than the field\'s handicaps.' : '') + '</p></section>';
      out += skinsBlock(S, w);
      const rows = w.order.filter((id) => !w.rows[id].excused).map((id) => ({ label: nm(S, id), sub: 'Hcp ' + L.fmtHcp(w.rows[id].hcp) + (stamps[id] ? ' · ' + fmtStamp(stamps[id]) : ''), holes: w.rows[id].round }));
      out += '<section class="panel"><h3>Scorecards</h3>' + scorecards(rows, w.course) + '</section>';
    } else if (w.type === 'scramble') {
      const teams = w.teams || [];
      if (!teams.length) {
        const pairs = L.suggestPairings(S.league, w.n);
        out += '<section class="panel"><h3>Double-points scramble</h3><p class="muted">Teams are paired lowest handicap with highest, with no repeat partners. Both partners earn the team\'s points: ' + S.cfg.scramblePoints.join(' / ') + '.</p>' +
          '<div class="pairs">' + pairs.map((p) => '<div class="pair"><b>' + esc(nm(S, p[0])) + '</b><span>&amp;</span><b>' + esc(nm(S, p[1])) + '</b></div>').join('') + '</div>' +
          '<p class="fine">Suggested pairings from current handicaps. The commissioner locks in the final teams.</p></section>' + courseTable(w.course);
        return out;
      }
      if (!w.played) {
        out += '<section class="panel"><h3>Teams</h3><div class="pairs">' + teams.map((t) => '<div class="pair"><b>' + esc(nm(S, t.players[0])) + '</b><span>&amp;</span><b>' + esc(nm(S, t.players[1])) + '</b><small>Team hcp ' + t.teamHcp + '</small></div>').join('') + '</div><p class="muted">Waiting on scores.</p></section>' + courseTable(w.course);
        return out;
      }
      out += '<section class="panel"><h3>Team results</h3><div class="scroll"><table class="t"><thead><tr><th>#</th><th class="l">Team</th><th class="pts">Pts each</th><th>Net</th><th>Gross</th><th>Team hcp</th></tr></thead><tbody>' +
        w.teams.map((t) => '<tr><td class="rk">' + (t.rank || '-') + '</td><td class="l"><b>' + esc(nm(S, t.players[0])) + '</b> &amp; <b>' + esc(nm(S, t.players[1])) + '</b></td><td class="pts">' + (t.points == null ? '-' : fp(t.points)) + '</td><td>' + (t.net == null ? '-' : t.net) + '</td><td>' + (t.gross == null ? '-' : t.gross) + '</td><td>' + t.teamHcp + '</td></tr>').join('') + '</tbody></table></div>' +
        '<p class="fine">Net scramble. Team handicap = ' + Math.round(S.cfg.scrambleLowPct * 100) + '% of the low + ' + Math.round(S.cfg.scrambleHighPct * 100) + '% of the high course handicap. Scramble rounds do not affect individual handicaps.</p></section>';
      out += skinsBlock(S, w);
      const rows = w.teams.filter((t) => t.complete).map((t) => ({ label: nm(S, t.players[0]) + ' & ' + nm(S, t.players[1]), sub: 'Team hcp ' + t.teamHcp, holes: t.holes }));
      if (rows.length) out += '<section class="panel"><h3>Team scorecards</h3>' + scorecards(rows, w.course) + '</section>';
    } else {
      const ms = w.matches || [];
      out += '<section class="panel"><h3>' + (w.round === 3 ? 'Final' : 'Matches') + '</h3><p class="muted">Match play, net. The higher handicap gets the difference in strokes (capped at ' + S.cfg.matchSpreadCap + ') on the hardest holes. Handicaps are frozen from week 10.</p><div class="matches">' + ms.map((m) => matchCard(S, m)).join('') + '</div>' +
        (w.round === 1 ? '<p class="fine">Seeds 1 and 2 have a bye this week.</p>' : '') + '</section>';
      if (w.played) {
        out += skinsBlock(S, w);
        const rounds = (src.rounds) || {};
        const rows = S.res.players.filter((p) => L.completeRound(rounds[p.id], w.course.par.length)).map((p) => ({ label: p.name, sub: stamps[p.id] ? fmtStamp(stamps[p.id]) : '', holes: rounds[p.id] }));
        if (rows.length) out += '<section class="panel"><h3>Scorecards</h3>' + scorecards(rows, w.course) + '</section>';
      } else out += courseTable(w.course);
    }
    return out;
  }


  /* ---------- SCHEDULE (flip through the season, week by week) ---------- */
  function schedule(S, arg) {
    const weeks = S.res.weeks;
    const n = arg ? parseInt(arg, 10) : currentWeek(S);
    const w = wk(S, n) || weeks[0];
    const i = weeks.indexOf(w);
    const prev = weeks[i - 1], next = weeks[i + 1];
    const src = S.league.weeks.find((x) => x.n === w.n) || {};
    const short = (x) => (x.type === 'playoff' ? 'P' + x.round : x.n);
    const stateOf = (x) => (x.played ? 'done' : '');

    let out = '<div class="flip"><a class="btn small' + (prev ? '' : ' off') + '" href="' + (prev ? '#schedule/' + prev.n : '#schedule/' + w.n) + '" aria-label="Previous week">&larr; ' + (prev ? esc(short(prev) === prev.n ? 'Wk ' + prev.n : weekName(prev)) : 'Start') + '</a>' +
      '<div class="flip-mid"><b>' + esc(weekName(w)) + '</b><small>' + (i + 1) + ' of ' + weeks.length + '</small></div>' +
      '<a class="btn small' + (next ? '' : ' off') + '" href="' + (next ? '#schedule/' + next.n : '#schedule/' + w.n) + '" aria-label="Next week">' + (next ? esc(short(next) === next.n ? 'Wk ' + next.n : weekName(next)) : 'End') + ' &rarr;</a></div>';
    out += '<p class="fine" style="text-align:center;margin:0 0 6px">Swipe left or right to change weeks</p><div class="chips">' + weeks.map((x) => '<a class="chip' + (x.n === w.n ? ' on' : '') + (stateOf(x) ? ' done' : '') + (x.type === 'scramble' ? ' gold' : '') + (x.type === 'playoff' ? ' po' : '') + '" href="#schedule/' + x.n + '" title="' + esc(x.course.name) + '">' + short(x) + '</a>').join('') + '</div>';
    out += courseHeader(w);

    if (!w.played) {
      out += '<section class="panel"><h3>Not played yet</h3><p class="muted">' + (w.type === 'playoff' ? 'Playoff matchups are set as the regular season finishes.' : 'Scores, skins and handicap changes show up here once the round is in.') + '</p></section>';
      if (w.type === 'regular') out += coursehcpBlock(S, w); else out += '<section class="panel"><h3>Course</h3>' + courseTable(w.course) + '</section>';
      out += '<p class="fine"><a href="#standings">Current standings &rarr;</a></p>';
      return out;
    }

    /* rows for every player who has a score this week */
    const idxAfter = (id) => { const e = (S.res.idxLog[id] || []).find((x) => x.week === w.n); return e ? e.after : w.hcpBefore[id]; };
    const rr = S.res.race.find((r) => r.n === w.n);
    const cum = rr ? rr.cum : {};
    const posOf = {};
    const ids = S.res.players.map((p) => p.id);
    ids.slice().sort((a, b) => (cum[b] || 0) - (cum[a] || 0)).forEach((id, k, arr) => { posOf[id] = k > 0 && (cum[id] || 0) === (cum[arr[k - 1]] || 0) ? posOf[arr[k - 1]] : k + 1; });
    const skinAmt = {};
    if (w.skins) w.skins.winners.forEach((x) => { skinAmt[x.id] = x.amount; });

    const data = [];
    if (w.type === 'regular') {
      w.order.forEach((id) => {
        const r = w.rows[id];
        data.push(r.excused ? { id, excused: true, pts: r.total } : { id, rank: r.rank, gross: r.gross, net: w.format === 'stableford' ? r.net : r.netScore, sf: r.stableford, pts: r.total });
      });
    } else if (w.type === 'scramble') {
      (w.teams || []).filter((t) => t.complete).forEach((t) => t.players.forEach((id) => data.push({ id, rank: t.rank, gross: t.gross, net: t.net, pts: w.points[id], team: t })));
    } else {
      const course = w.course, rounds = src.rounds || {};
      S.res.players.forEach((p) => {
        if (!L.completeRound(rounds[p.id], w.course.par.length)) return;
        const h = L.courseHcp(w.hcpBefore[p.id], course);
        const st = L.strokeArray(h, course.si);
        const g = rounds[p.id].reduce((a, v, k) => a + (L.isPickup(v) ? course.par[k] + st[k] + 2 : v), 0);
        data.push({ id: p.id, gross: g, net: g - st.reduce((a, b) => a + b, 0) });
      });
      data.sort((a, b) => a.net - b.net).forEach((d, k, arr) => { d.rank = k > 0 && d.net === arr[k - 1].net ? arr[k - 1].rank : k + 1; });
    }
    if (w.type === 'scramble') data.sort((a, b) => a.rank - b.rank);
    const played = data.filter((d) => !d.excused);

    /* highlights */
    const lowest = (key) => { const m = Math.min.apply(null, played.map((d) => d[key])); return { v: m, who: played.filter((d) => d[key] === m) }; };
    const names = (arr) => arr.map((d) => (d.team ? nm(S, d.team.players[0]) + ' & ' + nm(S, d.team.players[1]) : nm(S, d.id))).filter((x, k, a) => a.indexOf(x) === k).join(', ');
    const tile = (label, big, sub, gold) => '<div class="stat' + (gold ? ' gold' : '') + '"><span>' + label + '</span><b>' + big + '</b><small>' + sub + '</small></div>';
    if (played.length) {
      const lg = lowest('gross'), ln = lowest('net');
      const sfBest = w.type === 'regular' && w.format === 'stableford' ? Math.max.apply(null, played.map((d) => d.sf)) : null;
      let tiles = tile('Lowest score (gross)', lg.v, esc(names(lg.who)), true) + tile('Lowest net', ln.v, esc(names(ln.who)));
      if (sfBest != null) tiles += tile('Top Stableford', sfBest, esc(names(played.filter((d) => d.sf === sfBest))));
      if (w.skins) tiles += tile('Skins pot', money(w.skins.pot), w.skins.skinsWon ? w.skins.skinsWon + ' won · ' + money(w.skins.value) + ' each' : 'rolls to next week');
      out += '<div class="statgrid">' + tiles + '</div>';
    }

    /* every player, this week */
    const isTeam = w.type === 'scramble';
    const head = '<tr><th>#</th><th class="l">Player</th>' + (w.type === 'playoff' ? '' : '<th class="pts">Pts</th><th>Pos</th>') + '<th>Gr/Net</th>' + (w.type === 'regular' && w.format === 'stableford' ? '<th>Stbl</th>' : '') + '<th>Hcp</th>' + (w.skins ? '<th>Skins</th>' : '') + '</tr>';
    const body = data.map((d) => {
      const before = w.hcpBefore[d.id], after = idxAfter(d.id);
      const delta = after - before;
      const hc = L.fmtIndex(before) + (Math.abs(delta) > 0.04 ? '<small class="' + (delta < 0 ? 'pos' : 'neg') + '">&rarr; ' + L.fmtIndex(after) + '</small>' : '');
      if (d.excused) return '<tr class="muted"><td></td><td class="l">' + esc(nm(S, d.id)) + ' <span class="tag">excused</span></td><td class="pts">' + fp(d.pts) + '</td><td>' + (posOf[d.id] || '') + '<small>' + fp(cum[d.id]) + '</small></td><td></td><td></td><td>' + hc + '</td>' + (w.skins ? '<td></td>' : '') + '</tr>';
      const lowTag = lowest('gross').who.includes(d) ? ' <span class="tag gold" title="Lowest gross of the week">LG</span>' : '';
      return '<tr><td class="rk">' + d.rank + '</td><td class="l"><b>' + esc(nm(S, d.id)) + '</b>' + lowTag + '</td>' + (w.type === 'playoff' ? '' : '<td class="pts">' + (d.pts == null ? '-' : fp(d.pts)) + '</td>') +
        (w.type === 'playoff' ? '' : '<td><b>' + (posOf[d.id] || '') + '</b><small>' + fp(cum[d.id]) + '</small></td>') + '<td>' + d.gross + '<small>' + d.net + '</small></td>' + (w.type === 'regular' && w.format === 'stableford' ? '<td><b>' + d.sf + '</b></td>' : '') +
        '<td>' + (isTeam ? '<small class="muted">frozen</small>' : hc) + '</td>' + (w.skins ? '<td class="' + (skinAmt[d.id] ? 'pos' : 'muted') + '">' + (skinAmt[d.id] ? money(skinAmt[d.id]) : '-') + '</td>' : '') + '</tr>';
    }).join('');
    out += '<section class="panel"><h3>' + (isTeam ? 'Everyone, this week (team score shared)' : 'Everyone, this week') + '</h3><div class="scroll"><table class="t tight"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="fine">' + (w.type === 'playoff' ? 'Playoff rounds are match play, so the result is in the matchups below. Gross and net are shown for reference.' : '<b>Pos</b> is the league standing right after this week, with total points underneath. <b>Gr/Net</b> is gross with net underneath' + (w.type === 'regular' && w.format !== 'stableford' ? ' (net counts each hole up to a net ' + (S.cfg.netCap === 'none' ? 'any score' : S.cfg.netCap === 'triple' ? 'triple bogey' : 'double bogey') + ', and lowest net wins the week)' : '') + '. <b>Hcp</b> is the index going in and, if it moved, where it landed.') + (w.baseline ? ' Week 1 sets everyone\'s starting handicap.' : '') + '</p></section>';

    if (w.type === 'playoff') out += '<section class="panel"><h3>Matches</h3><div class="matches">' + (w.matches || []).map((m) => matchCard(S, m)).join('') + '</div></section>';
    out += skinsBlock(S, w);
    const cards = [];
    const stampsS = src.stamps || {};
    if (w.type === 'regular') w.order.filter((id) => !w.rows[id].excused).forEach((id) => cards.push({ label: nm(S, id), sub: 'Hcp ' + L.fmtHcp(w.rows[id].hcp) + (stampsS[id] ? ' · ' + fmtStamp(stampsS[id]) : ''), holes: w.rows[id].round }));
    else if (w.type === 'scramble') (w.teams || []).filter((t) => t.complete).forEach((t) => cards.push({ label: nm(S, t.players[0]) + ' & ' + nm(S, t.players[1]), sub: 'Team hcp ' + t.teamHcp, holes: t.holes }));
    else S.res.players.forEach((p) => { const r = (src.rounds || {})[p.id]; if (L.completeRound(r, w.course.par.length)) cards.push({ label: p.name, sub: stampsS[p.id] ? fmtStamp(stampsS[p.id]) : '', holes: r }); });
    if (cards.length) out += '<section class="panel"><h3>Scorecards</h3>' + scorecards(cards, w.course) + '</section>';
    out += '<section class="panel"><h3>Course card</h3>' + courseTable(w.course) + '</section>';
    return out;
  }

  /* strokes preview for the upcoming week */
  function coursehcpBlock(S, w) {
    const course = w.course;
    const idx = w.hcpBefore;
    const rows = S.res.players.map((p) => ({ p, h: L.courseHcp(idx[p.id], course) })).sort((a, b) => a.h - b.h);
    return '<section class="panel"><h3>Course handicaps for this week</h3><p class="muted">Based on current indexes. Strokes land on the hardest holes first.</p><div class="hcps">' +
      rows.map((r) => '<div class="hcpbox"><span>' + esc(r.p.name) + '</span><b>' + L.fmtHcp(r.h) + '</b></div>').join('') + '</div></section>' + courseTable(course);
  }

  /* ---------- SKINS ---------- */
  function skins(S) {
    const st = S.res.standings.slice().sort((a, b) => b.skinsNet - a.skinsNet);
    const weeks = S.res.weeks.filter((w) => w.skins);
    const totalPot = weeks.reduce((s, w) => s + w.skins.entrants * w.skins.buyIn, 0);
    let out = '<section class="panel"><div class="panel-head"><h3>Skins money list</h3><span class="tag gold">' + money(S.cfg.skinsBuyIn) + ' per player, per week</span></div>' +
      '<div class="scroll"><table class="t"><thead><tr><th>#</th><th class="l">Player</th><th>Paid in</th><th>Won</th><th class="pts">Net</th></tr></thead><tbody>' +
      st.map((r, i) => '<tr><td class="rk">' + (i + 1) + '</td><td class="l"><b>' + esc(r.name) + '</b></td><td>' + money(r.skinsIn) + '</td><td>' + money(r.skinsWon) + '</td><td class="pts ' + (r.skinsNet >= 0 ? 'pos' : 'neg') + '">' + money(r.skinsNet) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<p class="fine">Total entered so far: ' + money(totalPot) + '.' + (S.res.carry ? ' Unclaimed carryover: <b>' + money(S.res.carry) + '</b> rolling into next week.' : '') + '</p></section>';
    out += '<section class="panel"><h3>Week by week</h3><div class="scroll"><table class="t"><thead><tr><th>Wk</th><th class="l">Course</th><th>In</th><th>Pot</th><th>Skins</th><th>$ / skin</th><th class="l">Top skin winner</th></tr></thead><tbody>' +
      (weeks.length ? weeks.map((w) => {
        const sk = w.skins; const top = sk.winners.slice().sort((a, b) => b.skins - a.skins)[0];
        return '<tr><td><a href="#schedule/' + w.n + '">' + (w.type === 'playoff' ? 'P' + w.round : w.n) + '</a></td><td class="l">' + esc(w.course.name) + '</td><td>' + sk.entrants + '</td><td>' + money(sk.pot) + (sk.carryIn ? '<small> (incl. ' + money(sk.carryIn) + ' carry)</small>' : '') + '</td><td>' + sk.skinsWon + '</td><td>' + (sk.skinsWon ? money(sk.value) : 'carries') + '</td><td class="l">' + (top ? esc(nm(S, top.id)) + ' (' + top.skins + ')' : '-') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">No skins played yet.</td></tr>') + '</tbody></table></div>' +
      '<p class="fine">Weekly net skins. Everyone who plays is in. Ties carry hole to hole, and if nobody wins a skin all week the whole pot rolls into the next week. Scramble weeks play team skins.</p></section>';
    return out;
  }

  /* ---------- HANDICAPS ---------- */
  function handicaps(S) {
    const regular = S.res.weeks.filter((w) => w.type !== 'playoff');
    const log = S.res.idxLog;
    let out = '<section class="panel"><h3>Handicap index</h3><p class="muted">Best ' + S.cfg.hcp.bestOf + ' of your last ' + S.cfg.hcp.ofLast + ' differentials. Index moves at most +' + S.cfg.hcp.capUp + ' / -' + S.cfg.hcp.capDown + ' a week. Scramble weeks do not count. Week 1 is the baseline round that sets your starting index. Handicaps freeze after week 10.</p>' +
      '<div class="scroll"><table class="t hcp"><thead><tr><th class="l">Player</th><th>Start</th>' + regular.map((w) => '<th>' + w.n + '</th>').join('') + '<th class="pts">Now</th></tr></thead><tbody>' +
      S.res.standings.slice().sort((a, b) => a.index - b.index).map((r) => {
        const byWeek = {};
        (log[r.id] || []).forEach((e) => { byWeek[e.week] = e; });
        const delta = r.index - r.startIndex;
        return '<tr><td class="l"><b>' + esc(r.name) + '</b></td><td>' + L.fmtIndex(r.startIndex) + '</td>' + regular.map((w) => {
          const e = byWeek[w.n];
          if (w.type === 'scramble') return '<td class="muted">&middot;</td>';
          if (!e) return '<td class="muted">-</td>';
          const dd = e.after - e.before;
          return '<td class="' + (dd < -0.04 ? 'pos' : dd > 0.04 ? 'neg' : '') + '">' + L.fmtIndex(e.after) + '</td>';
        }).join('') + '<td class="pts">' + L.fmtIndex(r.index) + (Math.abs(delta) > 0.04 ? ' <small class="' + (delta < 0 ? 'pos' : 'neg') + '">' + (delta < 0 ? '▼' : '▲') + Math.abs(delta).toFixed(1) + '</small>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="fine">Green = index came down (better). Dots mark scramble weeks. A "+" index means better than scratch.</p></section>';
    const diffs = S.res.weeks.filter((w) => w.type === 'regular' && w.played && w.difficulty != null);
    if (diffs.length) {
      out += '<section class="panel"><h3>Course difficulty adjustment</h3><p class="muted">Each week every round is adjusted by how much harder or easier the whole field played versus their handicaps, so a tough course week does not inflate anyone\'s index.</p><div class="scroll"><table class="t"><thead><tr><th>Wk</th><th class="l">Course</th><th>Field vs handicap</th></tr></thead><tbody>' +
        diffs.map((w) => '<tr><td>' + w.n + '</td><td class="l">' + esc(w.course.name) + '</td><td class="' + (w.difficulty > 0 ? 'neg' : 'pos') + '">' + (w.difficulty > 0 ? '+' : '') + w.difficulty.toFixed(1) + ' strokes</td></tr>').join('') + '</tbody></table></div></section>';
    }
    return out;
  }

  /* ---------- PLAYOFFS ---------- */
  function playoffs(S) {
    const r = S.res;
    const M = {};
    r.matches.forEach((m) => { M[m.id] = m; });
    const byeCard = (seed) => '<div class="match bye"><div class="mlabel">Bye</div><div class="side"><span class="seed">' + seed + '</span><b>' + esc(nm(S, r.seeds[seed - 1])) + '</b></div></div>';
    const col = (title, wkn, cards) => '<div class="bcol"><h4>' + title + (wkn ? '<small>' + esc(fmtDate((wk(S, wkn) || {}).date)) + '</small>' : '') + '</h4>' + cards + '</div>';
    let out = '';
    if (r.champion) out += '<section class="champ"><div class="eyebrow">Champion</div><h2>' + esc(nm(S, r.champion)) + '</h2><div class="muted">Winner takes all</div></section>';
    out += '<section class="panel"><div class="panel-head"><h3>Championship bracket</h3>' + (r.provisional ? '<span class="tag">Projected from current standings</span>' : '') + '</div>' +
      '<p class="muted">Match play, net, winner takes all. Top 6 qualify; seeds 1 and 2 get a bye into the semifinals, where seed 1 plays the lowest remaining seed.</p>' +
      '<p class="fine swipe">Swipe sideways to see the later rounds.</p><div class="bracket">' +
      col('Round 1', 11, [M['QF-A'], M['QF-B']].filter(Boolean).map((m) => matchCard(S, m)).join('') + byeCard(1) + byeCard(2)) +
      col('Semifinals', 12, [M['SF-1'], M['SF-2']].filter(Boolean).map((m) => matchCard(S, m)).join('')) +
      col('Final', 13, M['F'] ? matchCard(S, M['F']) : '') + '</div></section>';
    out += '<section class="panel"><div class="panel-head"><h3>Consolation round robin</h3><span class="tag">Seeds 7-10</span></div><p class="muted">Everyone plays everyone once over the three playoff weeks. Most match points wins the consolation pot, then holes won.</p>' +
      '<div class="scroll"><table class="t"><thead><tr><th>#</th><th class="l">Player</th><th>P</th><th>W</th><th>H</th><th>L</th><th>Holes won</th><th class="pts">Pts</th></tr></thead><tbody>' +
      r.consolation.map((c, i) => '<tr><td class="rk">' + (i + 1) + '</td><td class="l"><b>' + esc(c.name) + '</b></td><td>' + c.played + '</td><td>' + c.w + '</td><td>' + c.h + '</td><td>' + c.l + '</td><td>' + c.holesWon + '</td><td class="pts">' + fp(c.pts) + '</td></tr>').join('') + '</tbody></table></div>' +
      '<div class="matches">' + r.matches.filter((m) => m.bracket === 'consolation').map((m) => matchCard(S, m)).join('') + '</div></section>';
    return out;
  }

  /* ---------- RULES ---------- */
  function rules(S) {
    const c = S.cfg;
    const stand = (f) => String(c.rules[f.key] || '').trim() && !((f.key === 'mulligans' || f.key === 'retees') && /^(none|no)$/i.test(c.rules[f.key]));
    const sched = S.res.weeks.map((w) => '<tr class="' + (w.type === 'scramble' ? 'gold' : '') + '"><td>' + (w.type === 'playoff' ? 'P' + w.round : w.n) + '</td><td>' + esc(fmtDate(w.date)) + '</td><td class="l">' + esc(w.course.name) + (w.course.major ? ' <span class="tag gold">major venue</span>' : '') + '</td><td>' + (w.type === 'scramble' ? '2x Scramble' : w.type === 'playoff' ? (w.round === 3 ? 'Final' : 'Match play') : (w.baseline ? 'Baseline (half points)' : 'Stableford')) + '</td><td>' + w.course.parTotal + '</td></tr>').join('');
    return '<section class="panel prose"><h3>Round rules</h3>' +
      '<ul>' + (/^(none|no)$/i.test(c.rules.mulligans) && /^(none|no)$/i.test(c.rules.retees) ? '<li><b>Play it as it lies.</b> No mulligans, no re-hits and no re-tees, on the tee or anywhere else. The first ball you hit on every shot is the one that counts.</li>' +
      '<li><b>Every stroke counts.</b> Whatever the sim records is your score. No do-overs, no taking a shot back.</li>' : '') +
      '<li><b>Handicaps:</b> your strokes come from your league index, shown on the submit page and the Schedule tab, and land on the hardest holes first. Nobody adjusts their own handicap.</li>' +
      '<li><b>Pickups:</b> if you are out of a hole, pick up. It is posted as a net double bogey for points and handicap, and you lose that hole in skins and match play.</li>' +
      '<li><b>Witness:</b> someone from the league has to watch your round, and the admin records who. Rounds are played on sim nights (Monday or Thursday), or any day that week if you cannot make either night.</li></ul>' +
      (L.RULE_FIELDS.some((f) => stand(f)) ? '<h4>Standing sim settings</h4><ul>' + L.RULE_FIELDS.filter(stand).map((f) => '<li><b>' + esc(f.label) + ':</b> ' + esc(c.rules[f.key]) + '</li>').join('') + '</ul>' : '') +
      '<p class="fine">Any week can change one of these. When it does, the change is listed under that week\'s course name on the Schedule tab.</p></section>' +
      '<section class="panel prose"><h3>How the league works</h3>' +
      '<h4>Format</h4><p>10 players, 10 regular-season weeks on the Full Swing simulator, then a 3-week playoff. Top 6 by season points play a match-play bracket for the whole pot (seeds 1 and 2 get a bye). Seeds 7-10 play a round-robin consolation.</p>' +
      '<h4>Weekly points (regular weeks)</h4><ul><li>Everyone plays the same holes each week (usually 18, but the commissioner can set a week to the front or back nine). ' + (c.scoringFormat === 'stableford' ? 'Score is <b>net Stableford</b> (net par = 2 points, birdie 3, bogey 1, double bogey or worse 0). A blow-up hole can only cost you the points on that hole, which keeps a +3 and a 50 on equal footing.</li><li>Your Stableford total is compared against every other player: win = 1, tie = 0.5, scaled to a 0-9 score.</li>' : 'Score is your <b>net total</b> for the round: gross strokes minus your course handicap, lowest wins. ' + (c.netCap === 'none' ? 'Every stroke counts with no limit on a bad hole.' : 'No hole can cost you more than a net ' + (c.netCap === 'triple' ? 'triple' : 'double') + ' bogey (par + ' + (c.netCap === 'triple' ? '3' : '2') + ' plus your strokes on that hole), so one disaster hole cannot wreck a round.') + '</li><li>Your net total is compared against every other player: beat someone = 1, tie = 0.5, scaled to a 0-9 score. The size of the win does not matter, only the order.</li>') + '<li>+' + c.attendancePoint + ' for playing. Missed week = 0 unless the commissioner excuses it (you get your average).</li></ul>' +
      '<h4>Double-points scramble weeks (weeks 5 and 9)</h4><ul><li>2-person net scramble at major venues. Teams pair low handicap with high, and no repeat partners.</li><li>Team handicap = ' + Math.round(c.scrambleLowPct * 100) + '% of the low + ' + Math.round(c.scrambleHighPct * 100) + '% of the high course handicap.</li><li>Both partners earn the same points by finish: ' + c.scramblePoints.map((p, i) => ordinal(i + 1) + ' ' + p).join(', ') + '. A normal week averages about 5.5 and tops out near 10, so these weeks swing the standings.</li><li>Scramble rounds do not count toward handicaps.</li></ul>' +
      '<h4>Handicaps</h4><ul><li><b>Week 1 is the baseline round.</b> It counts half points (max 5) and your index is set from that round, with no weekly cap. After that it moves gradually.</li><li>Each week your index is the average of your best ' + c.hcp.bestOf + ' of your last ' + c.hcp.ofLast + ' differentials (your starting index fills the history until you have played enough rounds).</li><li>Index moves at most +' + c.hcp.capUp + ' / -' + c.hcp.capDown + ' per week. Max index ' + c.hcp.maxIndex + '.</li><li>Each differential is adjusted for course difficulty using the whole field\'s results, so a hard course does not inflate indexes.</li><li>Net double bogey is the most you can post on a hole. Pickups are fine: enter P.</li><li>Handicaps freeze after week 10 for the playoffs.</li></ul>' +
      '<h4>Skins</h4><ul><li>Everyone who plays is in for ' + money(c.skinsBuyIn) + ' a week. Net skins using your course handicap (strokes capped at ' + c.skinsMaxHcp + ').</li><li>Lowest net score outright on a hole wins it. Ties carry the skin to the next hole. The pot is split across all skins won, and if nobody wins a skin the whole pot rolls into next week.</li><li>Scramble weeks play team skins and partners split winnings.</li></ul>' +
      '<h4>Playoffs</h4><ul><li>Match play, net. The higher handicap gets the difference in strokes (capped at ' + c.matchSpreadCap + ') on the hardest holes. Handicaps are frozen from week 10.</li><li>Round 1: 3 v 6, 4 v 5. Semis: seed 1 plays the lowest remaining seed, seed 2 plays the other. Then the final. A tied playoff match is settled by the commissioner (sudden death).</li></ul>' +
      '<h4>Submitting scores</h4><ul><li>Rounds are played on the sim on Monday or Thursday night with at least one other league player watching. A league admin enters the scorecard and records who witnessed it. If you cannot make either night, you still have to play your round that week. A makeup round needs a witness too.</li><li>Every entry is logged with the admin and the witness. Any admin can correct a score.</li></ul></section>' +
      '<section class="panel"><h3>Schedule and courses</h3><div class="scroll"><table class="t"><thead><tr><th>Wk</th><th>Date</th><th class="l">Course</th><th>Format</th><th>Par</th></tr></thead><tbody>' + sched + '</tbody></table></div>' +
      '<p class="fine">Dates are placeholders until the commissioner confirms them. Course pars and handicap holes come from published scorecards; if the sim\'s card differs, the commissioner can override it for that week.</p></section>';
  }

  window.Render = { makeState, standings, weekly, schedule, skins, handicaps, playoffs, rules, esc, nm, fmtDate, fmtStamp, weekName, currentWeek, nextWeek, courseTable, scorecards, fp, wk, money };
})();
