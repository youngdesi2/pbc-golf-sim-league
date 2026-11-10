/* Sanity tests for the scoring engine.  Run:  node tools/test.js */
const fs = require('fs');
const path = require('path');
const L = require('../engine.js');
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok  :', msg); };
const near = (a, b, e = 0.011) => Math.abs(a - b) <= e;

/* --- strokes distribution --- */
const si = L.DEFAULT_SI;
const total = (h) => si.reduce((s, x) => s + L.strokesOnHole(h, x), 0);
ok([0, 1, 9, 18, 19, 36, 50, 54].every((h) => total(h) === h), 'strokes sum to the course handicap (0..54)');
ok(total(-3) === -3, 'a +3 gives back exactly 3 strokes');
ok(L.strokesOnHole(-3, 18) === -1 && L.strokesOnHole(-3, 16) === -1 && L.strokesOnHole(-3, 15) === 0, '+3 gives strokes back on the three easiest holes');
ok(L.strokesOnHole(20, 1) === 2 && L.strokesOnHole(20, 2) === 2 && L.strokesOnHole(20, 3) === 1, 'handicap 20: 2 strokes on the two hardest holes, 1 on the rest');

/* --- handcrafted week: stableford + round robin --- */
const par = L.DEFAULT_PAR;
const mk = (offset) => par.map((p) => p + offset);
const league = {
  config: {},
  players: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, name: id.toUpperCase(), startIndex: 0 })),
  weeks: [{ n: 1, type: 'regular', rounds: { a: mk(0), b: mk(1), c: mk(1), d: mk(2) } }],
};
const s1 = L.compute(league);
const w1 = s1.weeks[0];
ok(w1.rows.a.stableford === 36 && w1.rows.b.stableford === 18 && w1.rows.d.stableford === 0, 'stableford: net par = 2/hole, bogey = 1, double = 0');
/* 4-player league: round-robin scale is 0..3 */
ok(near(w1.rows.a.rr, 3) && near(w1.rows.b.rr, 1.5) && near(w1.rows.d.rr, 0), 'round robin: beat everyone = max, tie + beat one + lose one = half');
ok(near(w1.rows.a.total, 4), 'winner gets max round-robin points + 1 attendance');

/* --- demo seasons --- */
for (const f of ['demo.json', 'demo-full.json']) {
  const p = path.join(__dirname, '..', 'data', f);
  if (!fs.existsSync(p)) { console.log('skip', f, '(run tools/make-demo.js)'); continue; }
  const lg = JSON.parse(fs.readFileSync(p, 'utf8'));
  const S = L.compute(lg);
  const n = lg.players.length;
  const reg = S.weeks.filter((w) => w.type === 'regular' && w.played);
  ok(reg.every((w) => near(Object.values(w.rows).filter((r) => !r.excused).reduce((s, r) => s + r.rr, 0), ((Object.keys(w.rows).length * (n - 1)) / 2) * w.multiplier, 0.05 * n)),
    f + ': round-robin points per week add up');
  const sc = S.weeks.filter((w) => w.type === 'scramble' && w.played);
  ok(sc.every((w) => near(w.teams.reduce((s, t) => s + t.points * 2, 0), lg.config.scramblePoints ? 0 : 2 * (18 + 14 + 11 + 8 + 5), 0.1)), f + ': scramble ladder paid to both partners');
  const inn = Object.values(S.money).reduce((s, m) => s + m.in, 0);
  const won = Object.values(S.money).reduce((s, m) => s + m.won, 0);
  ok(near(inn, won + S.carry, 0.05), f + ': skins money conserved (in = paid out + unclaimed carry)  in=' + inn + ' won=' + won.toFixed(2) + ' carry=' + S.carry);
  ok(S.standings.every((r) => r.index >= -6 && r.index <= 50), f + ': indexes stay inside min/max');
  ok(S.idxLog && Object.values(S.idxLog).every((l) => l.every((e) => e.baseline || (e.after - e.before <= 2.0001 && e.before - e.after <= 3.0001))), f + ': weekly index change capped at +2 / -3');
  if (f === 'demo-full.json') {
    ok(S.matches.length === 11, 'full season: 5 playoff + 6 consolation matches, got ' + S.matches.length);
    ok(!!S.champion, 'full season: a champion is crowned -> ' + (S.champion && S.byId[S.champion].name));
    ok(S.matches.filter((m) => m.bracket === 'playoff').every((m) => m.winner), 'every playoff match has a winner');
    ok(S.consolation.length === 4 && S.consolation.every((c) => c.played === 3), 'consolation: 4 players, 3 matches each');
  }
  const w1x = S.weeks.find((w) => w.n === 1);
  ok(w1x.baseline && w1x.multiplier === 0.5 && Math.max.apply(null, Object.values(w1x.rows).map((r) => r.total)) <= 5.0001, f + ': week 1 is a baseline round worth half points (max 5)');
  ok(Object.keys(w1x.rows).every((id) => near(S.idxLog[id][0].after, Math.max(-6, Math.min(50, w1x.rows[id].diffAdj)), 0.051)), f + ': week 1 sets each index from the round, with no weekly cap');
  console.log('\n' + f + ' standings:');
  S.standings.forEach((r) => console.log(String(r.rank).padStart(2), r.name.padEnd(8), 'idx', L.fmtIndex(r.index).padStart(5), 'pts', String(r.total).padStart(6), 'sf', String(r.stableford).padStart(4), 'skins', L.fmtMoney(r.skinsNet)));
  if (S.warnings.length) console.log('warnings:', S.warnings);
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');

/* --- 9-hole weeks (front / back nine, set per week by the commissioner) --- */
{
  const mk9 = (off, n) => par.slice(off, off + 9).map((p) => p + n);
  const lg = (extra) => ({
    config: { skinsBuyIn: 10 },
    players: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id.toUpperCase(), startIndex: 18 })),
    weeks: [Object.assign({ n: 1, type: 'regular', holes: 9, nine: 'front', rounds: { a: mk9(0, 0), b: mk9(0, 1), c: mk9(0, 1), d: mk9(0, 2) } }, extra || {})],
  });
  const f = L.compute(lg());
  const cf = f.weeks[0].course;
  ok(cf.par.length === 9 && cf.holeNums.join() === '1,2,3,4,5,6,7,8,9' && cf.si.slice().sort((a, b) => a - b).join() === '1,2,3,4,5,6,7,8,9', '9-hole front: 9 holes, strokes ranked 1..9');
  ok(f.weeks[0].rows.a.hcp === 9, 'index 18 gets a 9-hole course handicap of 9');
  ok(f.weeks[0].rows.a.st.reduce((x, y) => x + y, 0) === 9 && f.weeks[0].rows.a.stableford > 0, '9 strokes spread over 9 holes (one each)');
  ok(f.weeks[0].rows.a.diff === L.compute(lg()).weeks[0].rows.a.diff && typeof f.weeks[0].rows.a.diff === 'number', '9-hole differential computes');
  const bk = L.compute({ config: {}, players: lg().players, weeks: [{ n: 1, type: 'regular', holes: 9, nine: 'back', rounds: { a: mk9(9, 0), b: mk9(9, 1), c: mk9(9, 1), d: mk9(9, 2) } }] });
  ok(bk.weeks[0].course.holeNums[0] === 10 && bk.weeks[0].course.holeNums[8] === 18 && bk.weeks[0].played, '9-hole back: holes 10-18 and the round is counted');
  ok(bk.weeks[0].skins && bk.weeks[0].skins.holes.length === 9 && bk.weeks[0].skins.holes[0].hole === 10, 'skins run over 9 holes and are labelled 10-18');
  const bad = L.compute({ config: {}, players: lg().players, weeks: [{ n: 1, type: 'regular', holes: 9, rounds: { a: mk(0) } }] });
  ok(!bad.weeks[0].played && bad.warnings.length === 1, 'an 18-hole card in a 9-hole week is rejected, not scored');
  const skinsSum = f.weeks[0].skins.winners.reduce((x, w) => x + w.amount, 0);
  ok(!f.weeks[0].skins.skinsWon || Math.abs(skinsSum - f.weeks[0].skins.pot) < 0.01, '9-hole skins: money conserved');
  /* a player who shoots net par on every hole has the same 9-hole stableford ratio as on 18 */
  ok(L.strokeArray(9, f.weeks[0].course.si).every((x) => x === 1), 'strokeArray uses the number of holes played');
}

/* --- round rules: per-week overrides show only when they differ from the defaults --- */
{
  const players = ['a', 'b'].map((id) => ({ id, name: id, startIndex: 0 }));
  const r = L.compute({ config: { rules: { tees: 'White', gimmes: 'Inside 3 ft' } }, players, weeks: [
    { n: 1, type: 'regular' },
    { n: 2, type: 'regular', rules: { tees: 'Blue', gimmes: 'Inside 3 ft', wind: 'Calm', putting: '   ' } },
    { n: 3, type: 'regular', rules: { mulligans: '1 per nine' } },
  ] });
  ok(r.weeks[0].ruleChanges.length === 0, 'rules: a week with no overrides shows nothing');
  ok(r.weeks[1].ruleChanges.map((x) => x.key).join() === 'tees,wind' && r.weeks[1].ruleChanges[0].def === 'White', 'rules: only values that differ from the default are shown (same-as-default and blank are dropped)');
  ok(r.weeks[2].ruleChanges[0].value === '1 per nine' && r.weeks[2].ruleChanges[0].def === 'None', 'rules: mulligans default to None and a week can change it');
}

/* --- scoring format: net total (default) vs Stableford; the cap on a bad hole --- */
{
  const ps = ['a', 'b', 'c'].map((id) => ({ id, name: id, startIndex: 0 }));
  const hole = (extra) => par.map((p, i) => p + (i === 0 ? extra : 0)); /* par everywhere, one hole is extra */
  const mkLg = (cfg) => ({ config: cfg, players: ps, weeks: [{ n: 1, type: 'regular', rounds: { a: hole(0), b: hole(3), c: hole(8) } }] });
  const cap2 = L.compute(mkLg({})).weeks[0].rows, capN = L.compute(mkLg({ netCap: 'none' })).weeks[0].rows, sf = L.compute(mkLg({ scoringFormat: 'stableford' })).weeks[0].rows;
  ok(cap2.b.netScore === cap2.c.netScore && cap2.a.netScore < cap2.b.netScore, 'net total: a hole is capped at net double bogey by default (a triple and a +8 count the same)');
  ok(capN.c.netScore > capN.b.netScore, 'net total: with no cap a disaster hole keeps costing strokes');
  ok(['a', 'b', 'c'].every((id) => cap2[id].rank === sf[id].rank), 'net total capped at net double bogey ranks the same as Stableford');
  ok(L.compute(mkLg({})).weeks[0].format === 'net' && L.compute(mkLg({ scoringFormat: 'stableford' })).weeks[0].format === 'stableford', 'week reports its scoring format');
}
process.exit(fails ? 1 : 0);
