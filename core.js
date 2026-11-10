/* core.js - loads league data (static JSON + live Supabase rows) and merges them into one league object. */
(function () {
  const C = window.LEAGUE_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const mode = params.get('data') || 'live'; /* live | demo | full */
  const FILES = { live: 'data/league.json', demo: 'data/demo.json', full: 'data/demo-full.json' };
  const hasBackend = () => !!(C.supabaseUrl && C.supabaseAnonKey) && mode === 'live';

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not load ' + url + ' (' + r.status + ')');
    return r.json();
  }

  async function sb(path, opts) {
    opts = opts || {};
    const r = await fetch(C.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path, Object.assign({}, opts, {
      headers: Object.assign({
        apikey: C.supabaseAnonKey,
        Authorization: 'Bearer ' + C.supabaseAnonKey,
        'Content-Type': 'application/json',
      }, opts.headers || {}),
    }));
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!r.ok) throw new Error((data && (data.message || data.hint)) || (typeof data === 'string' && data) || 'Request failed (' + r.status + ')');
    return data;
  }
  const rpc = (name, args) => sb('rpc/' + name, { method: 'POST', body: JSON.stringify(args) });
  const teamKey = (players) => players.slice().sort().join('+');

  /* fold database rows into the static league definition */
  function merge(base, db) {
    const league = JSON.parse(JSON.stringify(base));
    const W = {};
    league.weeks.forEach((w) => { W[w.n] = w; w.stamps = {}; });
    (db.meta || []).forEach((m) => {
      const w = W[m.week];
      if (!w) return;
      const d = m.data || {};
      ['teams', 'overrides', 'excused', 'skinsPlayers', 'skinsOut', 'date', 'locked', 'skins'].forEach((k) => { if (d[k] !== undefined) w[k] = d[k]; });
      if (d.course) w.course = Object.assign({}, w.course, d.course);
    });
    (db.subs || []).forEach((s) => {
      const w = W[s.week];
      if (!w) return;
      (w.rounds = w.rounds || {})[s.player_id] = s.holes;
      w.stamps[s.player_id] = s.updated_at;
    });
    (db.teams || []).forEach((t) => {
      const w = W[t.week];
      if (!w || !w.teams) return;
      const team = w.teams.find((x) => teamKey(x.players) === t.team_key);
      if (team) { team.holes = t.holes; w.stamps[t.team_key] = t.updated_at; }
    });
    return league;
  }

  async function load() {
    const base = await getJSON(FILES[mode] || FILES.live);
    let db = { subs: [], teams: [], meta: [] };
    if (hasBackend()) {
      const [subs, teams, meta] = await Promise.all([
        sb('submissions?select=*'), sb('team_submissions?select=*'), sb('week_meta?select=*'),
      ]);
      db = { subs, teams, meta };
    }
    return { base, db, league: merge(base, db), live: hasBackend(), mode };
  }

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    sget: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  window.Core = { mode, hasBackend, load, merge, rpc, sb, teamKey, store, params };
})();
