/* Generates data/league.json (the real league template).  Run:  node tools/build-league.js
 * Edit the player names / starting indexes below, then re-run. Starting index: +3 handicap = -3. */
const fs = require('fs');
const path = require('path');
const weeks = require('./courses');

const players = [
  { id: 'p1', name: 'Player 1', startIndex: -3 },
  { id: 'p2', name: 'Player 2', startIndex: 1.5 },
  { id: 'p3', name: 'Player 3', startIndex: 4 },
  { id: 'p4', name: 'Player 4', startIndex: 7 },
  { id: 'p5', name: 'Player 5', startIndex: 10 },
  { id: 'p6', name: 'Player 6', startIndex: 14 },
  { id: 'p7', name: 'Player 7', startIndex: 18 },
  { id: 'p8', name: 'Player 8', startIndex: 24 },
  { id: 'p9', name: 'Player 9', startIndex: 35 },
  { id: 'p10', name: 'Player 10', startIndex: 50 },
];

const league = {
  config: {
    leagueName: 'Pearl Bee Cave Winter Golf League',
    season: '2026-27',
    skinsBuyIn: 10,
    rules: { tees: 'Blue' },
  },
  players,
  weeks,
};

/* arrays of numbers on one line keeps the file readable and diffs small */
function compact(obj) {
  return JSON.stringify(obj, null, 2).replace(/\[\s+((?:-?[\d.]+|"[^"]*"|null)(?:,\s+(?:-?[\d.]+|"[^"]*"|null))*)\s+\]/g, (m, inner) => '[' + inner.replace(/\s*\n\s*/g, ' ') + ']');
}
module.exports = { compact };
if (require.main === module) {
  const out = path.join(__dirname, '..', 'data', 'league.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, compact(league) + '\n');
  console.log('wrote', out);
}
