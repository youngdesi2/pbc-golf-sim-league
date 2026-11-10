/* Generates fake seasons so you can see the site working before anyone has played.
 *   data/demo.json       weeks 1-7 played  (open the site with ?data=demo)
 *   data/demo-full.json  all 13 weeks      (open the site with ?data=full)
 * Run:  node tools/make-demo.js */
const fs = require('fs');
const path = require('path');
const League = require('../engine.js');
const { compact } = require('./build-league.js');

const base = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'league.json'), 'utf8'));
const NAMES = ['Cole', 'Jake', 'Tyler', 'Brett', 'Mason', 'Wade', 'Reid', 'Tucker', 'Dale', 'Gus'];
base.players.forEach((p, i) => { p.name = NAMES[i]; });
base.config.leagueName = base.config.leagueName + ' (DEMO DATA)';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20261116);
const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const truth = {};
base.players.forEach((p) => { truth[p.id] = p.startIndex + (r() - 0.5) * 5; });

function playRound(id, course, weekBias) {
  const m = (truth[id] + weekBias) / 18;
  const sd = 0.8 + Math.max(0, truth[id]) * 0.012;
  return course.par.map((par) => {
    const d = Math.max(-2, Math.round(m + gauss() * sd));
    if (truth[id] > 30 && d >= 5 && r() < 0.5) return 'P';
    return Math.max(1, par + d);
  });
}
function playScramble(team, course) {
  const lo = Math.min(truth[team[0]], truth[team[1]]), hi = Math.max(truth[team[0]], truth[team[1]]);
  const m = (lo * 0.5 + hi * 0.2) / 18 - 0.3;
  return course.par.map((par) => Math.max(1, par + Math.max(-2, Math.round(m + gauss() * 0.8))));
}

const full = JSON.parse(JSON.stringify(base));
const bias = { 1: 0, 2: 0.5, 3: 3, 4: 0, 6: 1, 7: -1, 8: 2, 10: 3, 11: 1, 12: 2, 13: 2 };

full.weeks.forEach((w, wi) => {
  /* a hot streak and a slump so handicaps and standings move */
  base.players.forEach((p, i) => { truth[p.id] += (i === 3 ? -0.3 : i === 6 ? 0.25 : 0) + (r() - 0.5) * 0.4; });
  if (w.type === 'regular' || w.type === 'playoff') {
    w.rounds = {};
    base.players.forEach((p) => {
      if (w.type === 'regular' && r() < 0.04) return; /* the occasional missed week */
      w.rounds[p.id] = playRound(p.id, w.course, bias[w.n] || 0);
    });
  } else {
    const pairs = League.suggestPairings(full, w.n);
    w.teams = pairs.map((pr) => ({ players: pr, holes: playScramble(pr, w.course) }));
  }
  if (w.type === 'playoff') {
    /* settle any all-square playoff matches so the bracket can advance */
    const state = League.compute({ config: full.config, players: full.players, weeks: full.weeks.filter((x) => x.n <= w.n) });
    const ov = {};
    state.matches.filter((m) => m.week === w.n && m.status === 'needs-tiebreak').forEach((m) => { ov[m.id] = m.a; });
    if (Object.keys(ov).length) w.overrides = ov;
  }
});

const demo = JSON.parse(JSON.stringify(full));
demo.weeks.forEach((w) => {
  if (w.n > 7) { delete w.rounds; delete w.teams; delete w.overrides; }
});

const dir = path.join(__dirname, '..', 'data');
fs.writeFileSync(path.join(dir, 'demo-full.json'), compact(full) + '\n');
fs.writeFileSync(path.join(dir, 'demo.json'), compact(demo) + '\n');
console.log('wrote demo.json and demo-full.json');
