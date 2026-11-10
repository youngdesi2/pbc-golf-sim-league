# Pearl Bee Cave Winter Golf League

Live leaderboard + score submission for the league. Static site (GitHub Pages) plus a free Supabase
database for the scores. No build step.

**Pages:** `index.html` (standings, weekly, skins, handicaps, playoffs, rules) · `submit.html` (players enter
scores) · `admin.html` (commissioner).

Preview with fake data before anyone plays: `index.html?data=demo` (7 weeks) or `?data=full` (whole season).

## 1. Names and starting handicaps
Edit the `players` list in `tools/build-league.js` (+3 handicap = `-3`), then run `node tools/build-league.js`.
Or edit `data/league.json` directly. Dates and courses live in `tools/courses.js` / `data/league.json`.

## 2. Turn on live score submission (about 5 minutes, free)
1. Create a free project at supabase.com.
2. SQL Editor -> paste all of `supabase/schema.sql`. **Edit the admin names and passwords at the bottom first**
   (3-4 admins, one password each). Run it.
3. Project Settings -> API: copy the Project URL and the **anon** key into `config.js`.
   (The anon key is meant to be public. Never use the service_role key.)

Everyone can read scores; only league admins (own password each) can write; every submission is logged.

## 3. Publish on GitHub Pages
1. Create a repo (e.g. `sim-league`) and push this folder to it.
2. Repo Settings -> Pages -> Deploy from branch -> `main` / root.
3. Site is live at `https://<your-username>.github.io/sim-league/`.

## Weekly routine
- Before the round: Commissioner page -> check the course card against the sim's scorecard screen (fix par/handicap
  numbers if the sim differs). Scramble weeks: Suggest pairings -> Save teams.
- Round rules (tees, mulligans, gimmes, putting, wind, pins, conditions) have league defaults in the admin roster panel and optional per-week overrides in Week settings; only changes show on the week page.
- Each week can be set to 18 holes, front nine or back nine in the admin "Week settings" (stored in the database; default is 18).
- Admins can edit the roster, starting handicaps, league name and skins buy-in in the "Roster & league settings" panel on the admin page.
- Admins enter scores on `submit.html` with their own password and name the witness. Players only read the site.
- After the round: lock the week. Settle any all-square playoff match (sudden death) on the Commissioner page.

## Rules in one screen
- Regular weeks: net Stableford, round-robin points (0-9) + 1 for playing.
- Weeks 5 and 9: 2-person net scramble at Pebble Beach and St Andrews, 18/14/11/8/5 to both partners, no handicap impact.
- Handicap: best 5 of last 8 differentials, max +2/-3 a week, adjusted for course difficulty by the field, frozen after week 10.
- Skins: weekly net skins, $10 in, ties carry, unwon pot rolls to next week, strokes capped at a 36 handicap.
- Playoffs: top 6 match play (1-2 byes), seeds 7-10 round-robin consolation.
All numbers are in `engine.js` (`DEFAULT_CONFIG`) and can be overridden in the `config` block of `data/league.json`.

## Tests
`node tools/test.js` checks the scoring engine. `node tools/make-demo.js` regenerates the demo seasons.
