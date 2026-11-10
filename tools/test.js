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
  ok(reg.every((w) => near(Object.values(w.rows).filter((r) => !r.excused).reduce((s, r) => s + r.rr, 0), (Object.keys(w.rows).length * (n - 1)) / 2, 0.05 * n)),
    f + ': round-robin points per week add up');
  const sc = S.weeks.filter((w) => w.type === 'scramble' && w.played);
  ok(sc.every((w) => near(w.teams.reduce((s, t) => s + t.points * 2, 0), lg.config.scramblePoints ? 0 : 2 * (18 + 14 + 11 + 8 + 5), 0.1)), f + ': scramble ladder paid to both partners');
  const inn = Object.values(S.money).reduce((s, m) => s + m.in, 0);
  const won = Object.values(S.money).reduce((s, m) => s + m.won, 0);
  ok(near(inn, won + S.carry, 0.05), f + ': skins money conserved (in = paid out + unclaimed carry)  in=' + inn + ' won=' + won.toFixed(2) + ' carry=' + S.carry);
  ok(S.standings.every((r) => r.index >= -6 && r.index <= 50), f + ': indexes stay inside min/max');
  ok(S.idxLog && Object.values(S.idxLog).every((l) => l.every((e) => e.after - e.before <= 2.0001 && e.before - e.after <= 3.0001)), f + ': weekly index change capped at +2 / -3');
  if (f === 'demo-full.json') {
    ok(S.matches.length === 11, 'full season: 5 playoff + 6 consolation matches, got ' + S.matches.length);
    ok(!!S.champion, 'full season: a champion is crowned -> ' + (S.champion && S.byId[S.champion].name));
    ok(S.matches.filter((m) => m.bracket === 'playoff').every((m) => m.winner), 'every playoff match has a winner');
    ok(S.consolation.length === 4 && S.consolation.every((c) => c.played === 3), 'consolation: 4 players, 3 matches each');
  }
  console.log('\n' + f + ' standings:');
  S.standings.forEach((r) => console.log(String(r.rank).padStart(2), r.name.padEnd(8), 'idx', L.fmtIndex(r.index).padStart(5), 'pts', String(r.total).padStart(6), 'sf', String(r.stableford).padStart(4), 'skins', L.fmtMoney(r.skinsNet)));
  if (S.warnings.length) console.log('warnings:', S.warnings);
}
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
