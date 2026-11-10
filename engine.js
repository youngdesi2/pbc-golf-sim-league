/* Winter Sim League - scoring engine.
 * Pure functions: league JSON in, full season state out. Runs in the browser and in Node.
 *
 * Rules implemented
 *  - Regular weeks: net Stableford, round-robin points (win 1 / tie 0.5 vs every other player,
 *    scaled to 0..9) + 1 attendance point.
 *  - Scramble weeks: 2-person net scramble, team handicap 35% low + 15% high, fixed points ladder
 *    paid to both partners. Scramble rounds never touch handicaps.
 *  - Rolling handicap: best 5 of last 8 differentials, capped +2 / -3 per week, frozen for playoffs.
 *  - Weekly net skins (rollover on ties, unwon pot carries to next week).
 *  - Playoffs: top 6 match play bracket (1 and 2 get byes), seeds 7-10 round-robin consolation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.League = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PICKUP = 'P';
  const DEFAULT_PAR = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
  const DEFAULT_SI = [7, 11, 17, 1, 9, 5, 15, 3, 13, 8, 12, 18, 2, 10, 6, 16, 4, 14];

  /* round rules: league defaults (config.rules) with optional per-week overrides (week.rules) */
  const RULE_FIELDS = [
    { key: 'tees', label: 'Tees' },
    { key: 'mulligans', label: 'Mulligans' },
    { key: 'retees', label: 'Re-hits / re-tees' },
    { key: 'gimmes', label: 'Gimmes' },
    { key: 'putting', label: 'Putting' },
    { key: 'wind', label: 'Wind' },
    { key: 'pins', label: 'Pin positions' },
    { key: 'conditions', label: 'Course conditions' },
    { key: 'notes', label: 'Other' },
  ];
  const DEFAULT_RULES = { tees: '', mulligans: 'None', retees: 'None', gimmes: '', putting: '', wind: '', pins: '', conditions: '', notes: '' };

  const DEFAULT_CONFIG = {
    rules: DEFAULT_RULES,
    leagueName: 'Pearl Bee Cave Winter Golf League',
    season: '2026-27',
    attendancePoint: 1,
    scramblePoints: [18, 14, 11, 8, 5],
    scrambleLowPct: 0.35,
    scrambleHighPct: 0.15,
    skinsBuyIn: 10,
    skinsMaxHcp: 36,
    matchSpreadCap: 36,
    hcp: { bestOf: 5, ofLast: 8, capUp: 2, capDown: 3, minIndex: -6, maxIndex: 50, fieldAdjust: true },
    defaultCourse: { name: 'TBD', par: DEFAULT_PAR, si: DEFAULT_SI, rating: null, slope: 113 },
  };

  function mergeConfig(c) {
    c = c || {};
    return Object.assign({}, DEFAULT_CONFIG, c, {
      hcp: Object.assign({}, DEFAULT_CONFIG.hcp, c.hcp || {}),
      defaultCourse: Object.assign({}, DEFAULT_CONFIG.defaultCourse, c.defaultCourse || {}),
      rules: Object.assign({}, DEFAULT_RULES, c.rules || {}),
    });
  }

  /* ---------- small helpers ---------- */
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const r1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const isPickup = (v) => typeof v === 'string' && v.toUpperCase() === PICKUP;
  const isNum = (v) => typeof v === 'number' && isFinite(v) && v > 0;
  const isHole = (v) => isNum(v) || isPickup(v);
  const completeRound = (r, n) => Array.isArray(r) && r.length === (n || 18) && r.every(isHole);
  const completeTeam = (r, n) => Array.isArray(r) && r.length === (n || 18) && r.every(isNum);

  function fmtIndex(v) {
    if (v == null || isNaN(v)) return '-';
    return v < 0 ? '+' + Math.abs(v).toFixed(1) : v.toFixed(1);
  }
  function fmtHcp(h) {
    if (h == null || isNaN(h)) return '-';
    return h < 0 ? '+' + Math.abs(h) : String(h);
  }
  function fmtMoney(v) {
    const s = Math.abs(v).toFixed(2).replace(/\.00$/, '');
    return (v < 0 ? '-$' : '$') + s;
  }

  /* Strokes received on a hole. Positive handicaps get strokes on the hardest holes first,
   * plus handicaps give strokes back on the easiest holes first. */
  function strokesOnHole(hcp, si, n) {
    n = n || 18; /* n = holes in the round (9 or 18); si runs 1..n */
    if (hcp >= 0) return Math.floor(hcp / n) + (si <= hcp % n ? 1 : 0);
    const give = -hcp;
    return -(Math.floor(give / n) + (si > n - (give % n) ? 1 : 0));
  }
  const strokeArray = (hcp, si) => si.map((s) => strokesOnHole(hcp, s, si.length));

  /* Score used for posting / totals: a pickup is recorded as net double bogey. */
  const postedGross = (v, par, st) => (isPickup(v) ? par + st + 2 : v);
  /* Score used for hole-vs-hole comparison (skins, match play): a pickup always loses. */
  const compareGross = (v, par, st) => (isPickup(v) ? par + st + 10 : v);

  function courseFor(week, cfg) {
    const d = cfg.defaultCourse;
    const w = week.course || {};
    const par18 = w.par && w.par.length === 18 ? w.par : d.par;
    const si18 = w.si && w.si.length === 18 ? w.si : d.si;
    /* a week can be a 9-hole round (front or back nine of the course card) */
    const n = week.holes === 9 ? 9 : 18;
    const off = n === 9 && week.nine === 'back' ? 9 : 0;
    const par = par18.slice(off, off + n);
    const siCard = si18.slice(off, off + n);
    /* strokes are allotted over the holes actually played: re-rank the card's handicap numbers 1..n */
    const sorted = siCard.slice().sort((a, b) => a - b);
    const si = n === 18 ? siCard : siCard.map((v) => sorted.indexOf(v) + 1);
    const parTotal = sum(par);
    return {
      name: w.name || d.name,
      par,
      si,
      siCard,
      holes: n,
      nine: n === 9 ? (off ? 'back' : 'front') : null,
      holeNums: par.map((_, i) => off + i + 1),
      parTotal,
      rating: n === 18 && w.rating != null ? w.rating : parTotal,
      slope: w.slope != null ? w.slope : 113,
    };
  }
  /* course handicap for the holes being played (a 9-hole round gets half the 18-hole handicap) */
  const courseHcp = (index, c) => Math.round(((index * c.slope) / 113) * ((c.holes || 18) / 18) + (c.rating - c.parTotal));

  function nextIndex(start, prev, diffs, h) {
    const pool = Array(h.ofLast).fill(start).concat(diffs).slice(-h.ofLast);
    const best = pool.slice().sort((a, b) => a - b).slice(0, h.bestOf);
    const raw = sum(best) / best.length;
    return r1(clamp(clamp(raw, prev - h.capDown, prev + h.capUp), h.minIndex, h.maxIndex));
  }

  /* ---------- skins ---------- */
  function skinsRound(units, carryIn, buyIn) {
    const nPlayers = sum(units.map((u) => u.members.length));
    const pot = nPlayers * buyIn + carryIn;
    const won = units.map(() => 0);
    const holes = [];
    let pending = 0;
    const nHoles = units.length ? units[0].net.length : 18;
    for (let i = 0; i < nHoles; i++) {
      pending++;
      let best = Infinity;
      units.forEach((u) => { if (u.net[i] < best) best = u.net[i]; });
      const winners = [];
      units.forEach((u, k) => { if (u.net[i] === best) winners.push(k); });
      if (winners.length === 1) {
        won[winners[0]] += pending;
        holes.push({ hole: i + 1, winner: units[winners[0]].id, net: best, skins: pending });
        pending = 0;
      } else {
        holes.push({ hole: i + 1, winner: null, net: best, skins: 0, tied: winners.length });
      }
    }
    const totalWon = sum(won);
    const value = totalWon > 0 ? pot / totalWon : 0;
    return {
      pot, carryIn, buyIn, entrants: nPlayers,
      skinsWon: totalWon, value, deadSkins: pending,
      carryOut: totalWon > 0 ? 0 : pot,
      holes,
      winners: units
        .map((u, k) => ({ id: u.id, members: u.members, skins: won[k], amount: won[k] * value }))
        .filter((w) => w.skins > 0),
    };
  }

  /* ---------- main ---------- */
  function compute(league) {
    const cfg = mergeConfig(league.config);
    const players = league.players.slice();
    const byId = {};
    players.forEach((p) => { byId[p.id] = p; });
    const name = (id) => (byId[id] ? byId[id].name : id);

    const idx = {}, diffs = {}, idxLog = {}, totals = {}, money = {}, startOf = {};
    players.forEach((p) => {
      idx[p.id] = p.startIndex;
      startOf[p.id] = p.startIndex;
      diffs[p.id] = [];
      idxLog[p.id] = [];
      totals[p.id] = { rr: 0, attend: 0, scramble: 0, total: 0, stableford: 0, played: 0, lowGross: 0, rrHist: [] };
      money[p.id] = { in: 0, won: 0 };
    });
    const warnings = [];
    const weeks = [];
    const race = [];
    const matchResults = {};
    const matchOrder = [];
    let seeds = null;
    let carry = 0;
    const rrMax = players.length - 1;

    const rank = () =>
      players.map((p) => p.id).sort((a, b) =>
        totals[b].total - totals[a].total ||
        totals[b].stableford - totals[a].stableford ||
        name(a).localeCompare(name(b)));

    const sorted = league.weeks.slice().sort((a, b) => a.n - b.n);

    for (const week of sorted) {
      const course = courseFor(week, cfg);
      const out = {
        n: week.n, type: week.type, round: week.round || null, date: week.date || null,
        course, hcpBefore: Object.assign({}, idx), played: false, points: {}, skins: null,
        /* only the rules that differ from the league defaults */
        ruleChanges: RULE_FIELDS.filter((f) => week.rules && String(week.rules[f.key] || '').trim() && String(week.rules[f.key]).trim() !== String(cfg.rules[f.key] || '').trim())
          .map((f) => ({ key: f.key, label: f.label, value: String(week.rules[f.key]).trim(), def: String(cfg.rules[f.key] || '').trim() })),
      };
      const skinsOn = week.skins !== false;
      let skinsUnits = [];

      /* ===== regular week ===== */
      if (week.type === 'regular') {
        const rows = {};
        /* a week can count for less (week 1 baseline round = 0.5) */
        const mult = week.multiplier != null ? week.multiplier : 1;
        out.multiplier = mult;
        out.baseline = !!week.baseline;
        players.forEach((p) => {
          const r = week.rounds && week.rounds[p.id];
          if (r == null) return;
          if (!completeRound(r, course.par.length)) {
            warnings.push(`Week ${week.n}: ${p.name} has an incomplete scorecard, so it was not counted.`);
            return;
          }
          const hcp = courseHcp(idx[p.id], course);
          const st = strokeArray(hcp, course.si);
          let gross = 0, sf = 0, adj = 0;
          r.forEach((v, i) => {
            const g = postedGross(v, course.par[i], st[i]);
            gross += g;
            sf += Math.max(0, 2 - (g - st[i] - course.par[i]));
            adj += Math.min(g, course.par[i] + 2 + st[i]);
          });
          rows[p.id] = {
            id: p.id, hcp, st, round: r, gross, net: gross - hcp, stableford: sf,
            diff: r1((((adj - course.rating) * 113) / course.slope) * (18 / course.par.length)),
          };
        });
        const ids = Object.keys(rows);
        const n = ids.length;
        ids.forEach((id) => {
          let w = 0;
          ids.forEach((o) => {
            if (o === id) return;
            const a = rows[id].stableford, b = rows[o].stableford;
            w += a > b ? 1 : a === b ? 0.5 : 0;
          });
          rows[id].rrRaw = n > 1 ? r2((rrMax * w) / (n - 1)) : 0;
          rows[id].rr = r2(rows[id].rrRaw * mult);
          rows[id].attend = r2(cfg.attendancePoint * mult);
        });
        /* excused absences get the player's average round-robin points so far */
        (week.excused || []).forEach((id) => {
          if (!byId[id] || rows[id]) return;
          const h = totals[id].rrHist;
          rows[id] = {
            id, excused: true, rr: r2(mult * (h.length ? sum(h) / h.length : rrMax / 2)), attend: 0,
            hcp: null, gross: null, net: null, stableford: null,
          };
        });
        const rankedIds = Object.keys(rows).filter((id) => !rows[id].excused)
          .sort((a, b) => rows[b].stableford - rows[a].stableford);
        rankedIds.forEach((id, i) => {
          rows[id].rank = i > 0 && rows[id].stableford === rows[rankedIds[i - 1]].stableford ? rows[rankedIds[i - 1]].rank : i + 1;
        });
        const minGross = Math.min.apply(null, rankedIds.map((id) => rows[id].gross));
        Object.keys(rows).forEach((id) => {
          const t = totals[id], row = rows[id];
          row.total = r2(row.rr + row.attend);
          out.points[id] = row.total;
          t.rr += row.rr; t.attend += row.attend; t.total = r2(t.total + row.total);
          if (!row.excused) {
            t.stableford += row.stableford; t.played++; t.rrHist.push(row.rrRaw);
            if (row.gross === minGross) { t.lowGross++; row.lowGross = true; }
          }
        });
        out.rows = rows;
        out.order = Object.keys(rows).sort((a, b) =>
          (rows[b].excused ? -1 : 0) - (rows[a].excused ? -1 : 0) ||
          rows[b].total - rows[a].total || (rows[b].stableford || 0) - (rows[a].stableford || 0));
        out.played = ids.length > 0;

        if (skinsOn) {
          const allow = week.skinsPlayers;
          skinsUnits = ids.filter((id) => (!allow || allow.includes(id)) && !(week.skinsOut || []).includes(id)).map((id) => {
            const r = rows[id];
            const sst = strokeArray(Math.min(r.hcp, Math.round(cfg.skinsMaxHcp * course.par.length / 18)), course.si);
            return { id, members: [id], net: r.round.map((v, i) => compareGross(v, course.par[i], sst[i]) - sst[i]) };
          });
        }

        /* handicap update (after skins, which use the pre-round handicap).
         * Course-difficulty adjustment: every differential is shifted by how much harder or easier
         * the whole field played versus their own handicaps, so a brutal course week doesn't inflate
         * everyone's index. Indexes stay relative to the league. */
        let offset = 0;
        if (cfg.hcp.fieldAdjust && ids.length >= 4) {
          offset = r1(sum(ids.map((id) => rows[id].diff - idx[id])) / ids.length);
        }
        out.difficulty = offset;
        ids.forEach((id) => {
          const before = idx[id];
          const d = r1(rows[id].diff - offset);
          rows[id].diffAdj = d;
          if (week.baseline) {
            /* baseline round: your index is set from this round (no weekly cap), and it becomes your anchor */
            idx[id] = r1(clamp(d, cfg.hcp.minIndex, cfg.hcp.maxIndex));
            startOf[id] = idx[id];
            diffs[id] = [];
          } else {
            diffs[id].push(d);
            idx[id] = nextIndex(startOf[id], before, diffs[id], cfg.hcp);
          }
          idxLog[id].push({ week: week.n, before, diff: d, raw: rows[id].diff, after: idx[id], baseline: !!week.baseline });
          rows[id].idxAfter = idx[id];
        });
      }

      /* ===== scramble week ===== */
      else if (week.type === 'scramble') {
        const lo = cfg.scrambleLowPct, hi = cfg.scrambleHighPct;
        const teams = (week.teams || []).filter((t) => t.players && t.players.length === 2 && byId[t.players[0]] && byId[t.players[1]]).map((t) => {
          const ha = courseHcp(idx[t.players[0]], course), hb = courseHcp(idx[t.players[1]], course);
          const teamHcp = Math.round(lo * Math.min(ha, hb) + hi * Math.max(ha, hb));
          const holes = t.holes || [];
          const complete = completeTeam(holes, course.par.length);
          const gross = complete ? sum(holes) : t.gross != null ? t.gross : null;
          return {
            players: t.players, hcps: [ha, hb], teamHcp, holes, complete, gross,
            net: gross != null ? gross - teamHcp : null,
          };
        });
        const scored = teams.filter((t) => t.net != null).sort((a, b) => a.net - b.net);
        const ladder = cfg.scramblePoints;
        for (let i = 0; i < scored.length;) {
          let j = i;
          while (j + 1 < scored.length && scored[j + 1].net === scored[i].net) j++;
          const pool = [];
          for (let k = i; k <= j; k++) pool.push(ladder[k] != null ? ladder[k] : 0);
          const pts = r2(sum(pool) / pool.length);
          for (let k = i; k <= j; k++) { scored[k].rank = i + 1; scored[k].points = pts; }
          i = j + 1;
        }
        scored.forEach((t) => t.players.forEach((id) => {
          out.points[id] = t.points;
          totals[id].scramble += t.points;
          totals[id].total = r2(totals[id].total + t.points);
        }));
        out.teams = scored.concat(teams.filter((t) => t.net == null));
        out.played = scored.length > 0;
        if (skinsOn) {
          skinsUnits = teams.filter((t) => t.complete).map((t) => {
            const st = strokeArray(t.teamHcp, course.si);
            return { id: t.players.join('+'), members: t.players, net: t.holes.map((v, i) => v - st[i]) };
          });
        }
      }

      /* ===== playoff week ===== */
      else if (week.type === 'playoff') {
        if (!seeds) seeds = rank();
        const rnd = week.round || 1;
        const S = (n) => seeds[n - 1] || null;
        const win = (id) => (matchResults[id] && matchResults[id].winner) || null;
        const defs = [];
        if (rnd === 1) {
          defs.push({ id: 'QF-A', label: 'Quarterfinal A', bracket: 'playoff', a: S(3), b: S(6) });
          defs.push({ id: 'QF-B', label: 'Quarterfinal B', bracket: 'playoff', a: S(4), b: S(5) });
          defs.push({ id: 'C1-A', label: 'Consolation 1A', bracket: 'consolation', a: S(7), b: S(10) });
          defs.push({ id: 'C1-B', label: 'Consolation 1B', bracket: 'consolation', a: S(8), b: S(9) });
        } else if (rnd === 2) {
          const w1 = win('QF-A'), w2 = win('QF-B');
          let sf1 = null, sf2 = null;
          if (w1 && w2) {
            const lowest = seeds.indexOf(w1) > seeds.indexOf(w2) ? w1 : w2;
            sf1 = lowest; sf2 = lowest === w1 ? w2 : w1;
          }
          defs.push({ id: 'SF-1', label: 'Semifinal 1 (Seed 1)', bracket: 'playoff', a: S(1), b: sf1 });
          defs.push({ id: 'SF-2', label: 'Semifinal 2 (Seed 2)', bracket: 'playoff', a: S(2), b: sf2 });
          defs.push({ id: 'C2-A', label: 'Consolation 2A', bracket: 'consolation', a: S(7), b: S(9) });
          defs.push({ id: 'C2-B', label: 'Consolation 2B', bracket: 'consolation', a: S(8), b: S(10) });
        } else {
          defs.push({ id: 'F', label: 'Championship Final', bracket: 'playoff', a: win('SF-1'), b: win('SF-2') });
          defs.push({ id: 'C3-A', label: 'Consolation 3A', bracket: 'consolation', a: S(7), b: S(8) });
          defs.push({ id: 'C3-B', label: 'Consolation 3B', bracket: 'consolation', a: S(9), b: S(10) });
        }

        defs.forEach((def) => {
          const m = { id: def.id, label: def.label, bracket: def.bracket, round: rnd, week: week.n, a: def.a, b: def.b, status: 'tbd', winner: null, holes: [], played: 0, aw: 0, bw: 0, up: 0 };
          matchOrder.push(def.id);
          matchResults[def.id] = m;
          if (!def.a || !def.b) return;
          m.status = 'pending';
          const ha = courseHcp(idx[def.a], course), hb = courseHcp(idx[def.b], course);
          const nH = course.par.length;
          const spread = Math.min(Math.round(cfg.matchSpreadCap * nH / 18), Math.abs(ha - hb));
          const zero = Array(nH).fill(0);
          const sa = ha > hb ? strokeArray(spread, course.si) : zero;
          const sb = hb > ha ? strokeArray(spread, course.si) : zero;
          m.hcp = { a: ha, b: hb }; m.spread = spread;
          m.strokesTo = ha === hb ? null : ha > hb ? def.a : def.b;
          const ra = week.rounds && week.rounds[def.a], rb = week.rounds && week.rounds[def.b];
          let clinched = false;
          if (ra && rb) {
            for (let i = 0; i < nH; i++) {
              if (!isHole(ra[i]) || !isHole(rb[i])) break;
              const na = compareGross(ra[i], course.par[i], sa[i]) - sa[i];
              const nb = compareGross(rb[i], course.par[i], sb[i]) - sb[i];
              let res = 'h';
              if (na < nb) { m.up++; m.aw++; res = 'a'; }
              else if (nb < na) { m.up--; m.bw++; res = 'b'; }
              m.holes.push(res);
              m.played++;
              if (Math.abs(m.up) > nH - m.played) { clinched = true; break; }
            }
          }
          const ov = week.overrides && week.overrides[def.id];
          const done = clinched || m.played === nH;
          if (!done) m.status = m.played ? 'live' : 'pending';
          if (done && m.up !== 0) {
            m.winner = m.up > 0 ? def.a : def.b;
            m.status = 'final';
            m.text = clinched ? Math.abs(m.up) + '&' + (nH - m.played) : Math.abs(m.up) + ' UP';
          } else if (done) {
            m.text = 'AS';
            if (def.bracket === 'consolation') m.status = 'halved';
            else if (ov === def.a || ov === def.b) { m.winner = ov; m.status = 'final'; m.text = 'AS, won on tiebreak'; }
            else m.status = 'needs-tiebreak';
          }
          if (!done && (ov === def.a || ov === def.b)) { m.winner = ov; m.status = 'final'; m.text = 'Won by decision'; }
        });
        out.matches = defs.map((d) => matchResults[d.id]);
        out.played = out.matches.some((m) => m.played > 0 || m.status === 'final');
      }

      /* ===== skins (all week types) ===== */
      if (skinsOn && skinsUnits.length >= 2) {
        const res = skinsRound(skinsUnits, carry, cfg.skinsBuyIn);
        res.holes.forEach((h) => { h.hole = course.holeNums[h.hole - 1]; });
        carry = res.carryOut;
        out.skins = res;
        skinsUnits.forEach((u) => u.members.forEach((id) => { money[id].in += cfg.skinsBuyIn; }));
        res.winners.forEach((w) => w.members.forEach((id) => { money[id].won += w.amount / w.members.length; }));
      }

      if (out.played && week.type !== 'playoff') {
        const cum = {};
        players.forEach((p) => { cum[p.id] = totals[p.id].total; });
        race.push({ n: week.n, cum });
      }
      weeks.push(out);
    }

    if (!seeds) seeds = rank();
    const regularDone = sorted.filter((w) => w.type !== 'playoff');
    const provisional = weeks.some((w) => w.type !== 'playoff' && !w.played) || regularDone.length === 0;

    /* standings */
    const order = rank();
    const standings = order.map((id, i) => {
      const t = totals[id];
      const prev = order[i - 1];
      const tied = i > 0 && totals[prev].total === t.total && totals[prev].stableford === t.stableford;
      return {
        rank: i + 1, id, name: name(id), index: idx[id], startIndex: byId[id].startIndex,
        played: t.played, rr: r2(t.rr), attend: r2(t.attend), scramble: r2(t.scramble),
        total: r2(t.total), stableford: t.stableford, lowGross: t.lowGross,
        skinsNet: r2(money[id].won - money[id].in), skinsWon: r2(money[id].won), skinsIn: money[id].in,
        tied,
      };
    });

    /* consolation round robin */
    const cons = {};
    seeds.slice(6, 10).forEach((id) => { cons[id] = { id, name: name(id), pts: 0, w: 0, l: 0, h: 0, holesWon: 0, holesLost: 0, played: 0 }; });
    matchOrder.forEach((mid) => {
      const m = matchResults[mid];
      if (m.bracket !== 'consolation' || !(m.status === 'final' || m.status === 'halved')) return;
      [['a', 'b'], ['b', 'a']].forEach(([x, y]) => {
        const c = cons[m[x]];
        if (!c) return;
        c.played++;
        c.holesWon += m[x === 'a' ? 'aw' : 'bw']; c.holesLost += m[y === 'a' ? 'aw' : 'bw'];
        if (m.status === 'halved') { c.h++; c.pts += 0.5; }
        else if (m.winner === m[x]) { c.w++; c.pts += 1; }
        else c.l++;
      });
    });
    const consolation = Object.keys(cons).map((k) => cons[k]).sort((a, b) =>
      b.pts - a.pts || b.holesWon - a.holesWon || (b.holesWon - b.holesLost) - (a.holesWon - a.holesLost));

    const final = matchResults['F'];
    const champion = final && final.status === 'final' ? final.winner : null;

    return {
      cfg, players, byId, weeks, standings, seeds, provisional, matches: matchOrder.map((i) => matchResults[i]),
      consolation, champion, money, carry, idx, idxLog, race, warnings,
    };
  }

  /* Suggested scramble pairings: lowest index with highest, avoiding repeat partners from earlier scrambles. */
  function suggestPairings(league, weekN) {
    const state = compute({ config: league.config, players: league.players, weeks: league.weeks.filter((w) => w.n < weekN) });
    const ids = league.players.map((p) => p.id).sort((a, b) => state.idx[a] - state.idx[b] || (a < b ? -1 : 1));
    const half = ids.length / 2;
    const lows = ids.slice(0, half), highs = ids.slice(half).reverse();
    const used = new Set();
    league.weeks.filter((w) => w.type === 'scramble' && w.n < weekN && w.teams).forEach((w) =>
      w.teams.forEach((t) => { used.add(t.players.slice().sort().join('|')); }));
    for (let k = 0; k < half; k++) {
      const pairs = lows.map((l, i) => [l, highs[(i + k) % half]]);
      if (!pairs.some((p) => used.has(p.slice().sort().join('|')))) return pairs;
    }
    return lows.map((l, i) => [l, highs[i]]);
  }

  return { compute, suggestPairings, mergeConfig, fmtIndex, fmtHcp, fmtMoney, strokesOnHole, strokeArray, courseHcp, courseFor, isPickup, isHole, completeRound, RULE_FIELDS, DEFAULT_RULES, DEFAULT_CONFIG, DEFAULT_PAR, DEFAULT_SI, PICKUP };
});
