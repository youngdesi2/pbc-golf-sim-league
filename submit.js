/* submit.js - players enter their own hole-by-hole scorecard. */
(function () {
  const R = window.Render, L = window.League;
  const app = document.getElementById('app');
  const esc = R.esc;
  let S = null;

  const $ = (id) => document.getElementById(id);
  const VALID = /^([1-9]|1\d|20|P)$/;

  async function init() {
    try {
      const d = await Core.load();
      S = R.makeState(d);
      if (!d.live) {
        app.innerHTML = '<section class="panel"><h3>Live submission is not connected yet</h3><p class="muted">The commissioner needs to connect the database (see the README).</p></section>';
        return;
      }
      render();
    } catch (e) {
      app.innerHTML = '<section class="panel"><h3>Could not load</h3><p class="muted">' + esc(e.message) + '</p></section>';
    }
  }

  function render() {
    const players = S.league.players;
    const q = Core.params;
    const defWeek = parseInt(q.get('week'), 10) || (R.nextWeek(S) || {}).n || R.currentWeek(S);
    const savedPlayer = Core.store.get('pbc_player') || '';
    app.innerHTML =
      '<section class="panel"><div class="form">' +
      '<label class="f">Whose round is this?<select id="player"><option value="">Choose the player</option>' + players.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === (q.get('player') || savedPlayer) ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<label class="f">Week<select id="week">' + S.res.weeks.map((w) => '<option value="' + w.n + '"' + (w.n === defWeek ? ' selected' : '') + '>' + esc(R.weekName(w)) + ' · ' + esc(w.course.name) + (w.type === 'scramble' ? ' (scramble)' : '') + '</option>').join('') + '</select></label>' +
      '<label class="f">Witness (who watched the round)<select id="witness"><option value="">Choose the witness</option>' + players.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '<label class="f">Admin password<input id="pin" type="password" inputmode="text" autocomplete="off" placeholder="League admins only" value="' + esc(Core.store.get('pbc_pin') || '') + '"></label>' +
      '</div></section>' +
      '<div id="card"></div>';
    $('player').addEventListener('change', build);
    $('week').addEventListener('change', build);
    $('pin').addEventListener('change', () => Core.store.set('pbc_pin', $('pin').value.trim()));
    build();
  }

  function build() {
    const pid = $('player').value;
    const n = parseInt($('week').value, 10);
    const box = $('card');
    if (!pid) { box.innerHTML = '<div class="msg info">Pick your name to start your scorecard.</div>'; return; }
    Core.store.set('pbc_player', pid);
    const w = R.wk(S, n);
    const src = S.league.weeks.find((x) => x.n === n) || {};
    const course = w.course;
    let strokes, existing = null, head, team = null;

    if (w.type === 'scramble') {
      team = (w.teams || []).find((t) => t.players.includes(pid));
      if (!team) { box.innerHTML = '<div class="msg info">Scramble teams for this week have not been set yet. The commissioner posts them before the round.</div>'; return; }
      const partner = team.players.find((x) => x !== pid);
      strokes = L.strokeArray(team.teamHcp, course.si);
      existing = team.complete ? team.holes : null;
      head = '<div class="msg info"><b>Team scramble</b> with ' + esc(R.nm(S, partner)) + '. Enter the TEAM score on each hole. Team handicap: <b>' + team.teamHcp + '</b>.</div>';
    } else {
      const idx = w.hcpBefore[pid];
      const hcp = L.courseHcp(idx, { slope: 113, rating: course.parTotal, parTotal: course.parTotal });
      strokes = L.strokeArray(hcp, course.si);
      existing = src.rounds && L.completeRound(src.rounds[pid]) ? src.rounds[pid] : null;
      head = '<div class="msg info">Course handicap this week: <b>' + L.fmtHcp(hcp) + '</b> (index ' + L.fmtIndex(idx) + '). The dots show where you get strokes. Enter a <b>P</b> for a pickup.' + (w.baseline ? '<br><b>Baseline round:</b> counts half points and sets your handicap for the rest of the season.' : '') + '</div>';
    }

    const hole = (i) => {
      const s = strokes[i];
      return '<div class="hole"><div class="hn">' + (i + 1) + '</div><div class="hp"><span>Par ' + course.par[i] + '</span><span>Hcp ' + course.si[i] + '</span></div><div class="dots">' + (s > 0 ? '•'.repeat(Math.min(s, 4)) : s < 0 ? '−' : '') + '</div>' +
        '<input data-i="' + i + '" type="text" inputmode="numeric" maxlength="2" autocomplete="off" aria-label="Hole ' + (i + 1) + '" value="' + (existing ? existing[i] : '') + '"></div>';
    };
    let front = '', back = '';
    for (let i = 0; i < 9; i++) { front += hole(i); back += hole(i + 9); }

    box.innerHTML =
      '<section class="panel">' + R.weekName(w) + ' &middot; <b>' + esc(course.name) + '</b> &middot; Par ' + course.parTotal + (existing ? ' <span class="tag green">already submitted: editing</span>' : '') +
      '<div style="margin:12px 0">' + head + '</div>' +
      '<div class="legend-h" style="margin:6px 0 4px">Front nine</div><div class="holes">' + front + '</div>' +
      '<div class="legend-h" style="margin:12px 0 4px">Back nine</div><div class="holes">' + back + '</div>' +
      '<div class="totals" style="margin-top:14px"><div><b id="tg">0</b><span>Gross</span></div><div><b id="tn">0</b><span>Net</span></div><div><b id="ts">' + (team ? '-' : '0') + '</b><span>' + (team ? 'To par' : 'Stableford') + '</span></div><div><b id="td">0/18</b><span>Holes</span></div></div>' +
      '<div style="margin-top:14px;display:grid;gap:10px"><button class="btn dark" id="go" type="button">' + (existing ? 'Update scorecard' : 'Submit scorecard') + '</button><div id="msg"></div></div></section>';

    const inputs = Array.from(box.querySelectorAll('.hole input'));
    const calc = () => {
      let gross = 0, st = 0, sf = 0, done = 0;
      inputs.forEach((inp, i) => {
        const v = inp.value.trim().toUpperCase();
        inp.classList.remove('bad', 'birdie', 'bogey');
        if (!v) return;
        if (!VALID.test(v) || (team && v === 'P')) { inp.classList.add('bad'); return; }
        done++;
        const g = v === 'P' ? course.par[i] + strokes[i] + 2 : parseInt(v, 10);
        gross += g; st += strokes[i];
        sf += Math.max(0, 2 - (g - strokes[i] - course.par[i]));
        if (g < course.par[i]) inp.classList.add('birdie'); else if (g > course.par[i]) inp.classList.add('bogey');
      });
      $('tg').textContent = gross; $('tn').textContent = gross - st; $('td').textContent = done + '/18';
      if (team) { const pp = course.par.slice().filter((_, i) => VALID.test(inputs[i].value.trim().toUpperCase())).reduce((a, b) => a + b, 0); $('ts').textContent = done ? (gross - pp > 0 ? '+' : '') + (gross - pp) : '-'; } else $('ts').textContent = sf;
    };
    inputs.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/[^0-9pP]/g, '').toUpperCase();
        const v = inp.value;
        if (v && inputs[i + 1] && (v === 'P' || v.length === 2 || (v.length === 1 && parseInt(v, 10) >= 2))) inputs[i + 1].focus();
        calc();
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !inp.value && inputs[i - 1]) inputs[i - 1].focus(); });
      inp.addEventListener('focus', () => inp.select());
    });
    calc();
    $('go').addEventListener('click', () => submit(n, pid, team, inputs));
  }

  async function submit(n, pid, team, inputs) {
    const msg = $('msg');
    const pin = $('pin').value.trim();
    const holes = inputs.map((inp) => inp.value.trim().toUpperCase());
    const witness = $('witness').value;
    const bad = holes.findIndex((v) => !VALID.test(v) || (team && v === 'P'));
    if (!pin) { msg.innerHTML = '<div class="msg err">Enter your admin password first.</div>'; $('pin').focus(); return; }
    if (!witness) { msg.innerHTML = '<div class="msg err">Pick the witness who watched this round.</div>'; $('witness').focus(); return; }
    if (witness === pid) { msg.innerHTML = '<div class="msg err">The witness cannot be the player.</div>'; $('witness').focus(); return; }
    if (bad > -1) { msg.innerHTML = '<div class="msg err">Hole ' + (bad + 1) + ' needs a whole number from 1 to 20' + (team ? '' : ' (or P)') + '.</div>'; inputs[bad].focus(); return; }
    const payload = holes.map((v) => (v === 'P' ? 'P' : parseInt(v, 10)));
    const btn = $('go');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      if (team) await Core.rpc('submit_team_round', { p_pin: pin, p_week: n, p_team: Core.teamKey(team.players), p_holes: payload, p_witness: witness });
      else await Core.rpc('submit_round', { p_pin: pin, p_week: n, p_player: pid, p_holes: payload, p_witness: witness });
      Core.store.set('pbc_pin', pin);
      msg.innerHTML = '<div class="msg ok"><b>Saved.</b> The scorecard is on the leaderboard. <a href="index.html#weekly/' + n + '">See this week &rarr;</a></div>';
      const d = await Core.load(); S = R.makeState(d);
      btn.textContent = 'Update scorecard';
    } catch (e) {
      msg.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>';
      btn.textContent = 'Try again';
    } finally { btn.disabled = false; }
  }

  init();
})();
