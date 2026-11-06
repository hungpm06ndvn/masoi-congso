// Ma Sói Công Sở — máy chủ nhiều người chơi (Express + Socket.IO)
// Máy chủ giữ toàn bộ trạng thái ván chơi. Mỗi điện thoại chỉ nhận đúng phần thông tin mình được phép thấy.
const path = require('path');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });
const PORT = process.env.PORT || 3000;
const TS = Number(process.env.TIME_SCALE || 1); // chỉ dùng khi kiểm thử

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.send('ok'));
app.get('/qr/:code.svg', async (req, res) => {
  try {
    const base = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
    const svg = await QRCode.toString(`${base}/?room=${encodeURIComponent(req.params.code)}`, { type: 'svg', margin: 1, color: { dark: '#111111', light: '#ffffff' } });
    res.type('image/svg+xml').send(svg);
  } catch (e) { res.status(500).end(); }
});

/* ------------------------------------------------------------------ */
/* Cấu hình game                                                       */
/* ------------------------------------------------------------------ */
const ROLES = {
  wolf: { n: 'Sói', team: 'wolf' }, seer: { n: 'Tiên tri', team: 'vil' }, guard: { n: 'Bảo vệ', team: 'vil' },
  witch: { n: 'Phù thủy', team: 'vil' }, hunter: { n: 'Thợ săn', team: 'vil' }, cupid: { n: 'Cupid', team: 'vil' }, vil: { n: 'Dân làng', team: 'vil' }
};
const TEAMN = { wolf: 'PHE SÓI', vil: 'PHE DÂN LÀNG' };
const DIST = {
  6: ['wolf', 'wolf', 'seer', 'guard', 'witch', 'vil'],
  7: ['wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'vil'],
  8: ['wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'vil'],
  9: ['wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'vil', 'vil'],
  10: ['wolf', 'wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'vil', 'vil'],
  11: ['wolf', 'wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'vil', 'vil', 'vil'],
  12: ['wolf', 'wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'cupid', 'vil', 'vil', 'vil', 'vil']
};
const BOT_NAMES = ['Lan', 'Minh', 'Hùng', 'Trang', 'Tuấn', 'Hà', 'Phong', 'Ngọc', 'Khoa', 'Linh', 'Quân', 'Mai'];
const COLORS = ['#7aa7ff', '#ff9db5', '#ffc46b', '#7fe0b8', '#c3a4ff', '#ff9a8a', '#79d6e6', '#e9c27d', '#a8b3ff', '#ffb0d9', '#9be38f', '#f7a26b'];
const CAUSE = { wolf: 'đã bị Sói tấn công đêm qua', poison: 'đã trúng bình độc của Phù thủy', love: 'chết theo người yêu vì quá đau lòng', vote: 'bị cả bàn biểu quyết loại', shot: 'trúng một phát súng bất ngờ' };
const STICKERS = ['nghi', 'oan', 'haha', 'soc', 'gian', 'tim'];

const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const B = p => `<b>${esc(p.name)}</b>`;

const rooms = new Map();

/* ------------------------------------------------------------------ */
/* Tiện ích phòng                                                      */
/* ------------------------------------------------------------------ */
const P = (room, id) => room.players.find(p => p.id === id);
const alive = room => room.players.filter(p => p.alive);
const humans = room => room.players.filter(p => !p.isBot);
const team = p => ROLES[p.role].team;
const F = room => (room.settings.speed === 'demo' ? 0.5 : 1);

function newRoom(code) {
  return {
    code, hostId: null, players: [], nextId: 0, phase: 'lobby', round: 0, gameNo: 0,
    settings: { seats: 8, speed: 'real' }, timer: null, tos: [], endsAt: 0, total: 0, onEnd: null,
    feed: [], wfeed: [], gfeed: [], log: [], sus: {}, botKnown: {}, lovers: null, witch: { save: true, poison: true },
    guardLast: null, claim: null, claimDone: false, wTarget: null, wSuggest: null, witchSave: false, witchPoison: null,
    deaths: [], dctx: null, dtitle: '', hunterDone: false, hunterId: null, hctx: null, tally: null, result: null, lastActive: Date.now()
  };
}
function clearTimers(room) { if (room.timer) clearTimeout(room.timer); room.timer = null; room.tos.forEach(clearTimeout); room.tos = []; }
function safe(fn) { return (...a) => { try { fn(...a); } catch (e) { console.error('[game error]', e); } }; }
function phase(room, name, secs, onEnd) {
  clearTimers(room);
  room.phase = name;
  room.total = secs ? (TS < 1 ? Math.max(0.3, secs * F(room) * TS) : Math.max(4, Math.round(secs * F(room)))) : 0;
  room.endsAt = secs ? Date.now() + room.total * 1000 : 0;
  room.onEnd = onEnd || null;
  if (secs && onEnd) room.timer = setTimeout(safe(() => { room.timer = null; onEnd(); }), room.total * 1000);
  push(room);
}
function shorten(room, s) {
  if (!room.timer || !room.onEnd) return;
  s = s * TS;
  if ((room.endsAt - Date.now()) / 1000 <= s) return;
  clearTimeout(room.timer);
  room.endsAt = Date.now() + s * 1000;
  const f = room.onEnd;
  room.timer = setTimeout(safe(() => { room.timer = null; f(); }), s * 1000);
  push(room);
}
function later(room, fn, ms) { ms = ms * TS; const t = setTimeout(safe(() => { room.tos = room.tos.filter(x => x !== t); fn(); }), ms); room.tos.push(t); }
function log(room, icon, t) { room.log.push({ r: room.round, ph: ['night', 'witch'].includes(room.phase) ? 'night' : 'day', i: icon, t }); }
function emitReact(room, from, to, k) { io.to('room:' + room.code).emit('react', { from, to, k }); }

/* ------------------------------------------------------------------ */
/* Góc nhìn riêng của từng người chơi                                   */
/* ------------------------------------------------------------------ */
function nkind(room, p) {
  if (!['night', 'witch'].includes(room.phase)) return null;
  if (!p.alive) return 'ghost';
  if (room.phase === 'witch') return p.role === 'witch' ? 'witch' : 'wait';
  if (p.role === 'wolf') return 'wolf';
  if (p.role === 'seer') return 'seer';
  if (p.role === 'guard') return 'guard';
  if (p.role === 'cupid' && room.round === 1) return 'cupid';
  return 'cover';
}
function ncand(room, p, k) {
  const al = alive(room);
  switch (k) {
    case 'wolf': return al.filter(x => x.role !== 'wolf').map(x => x.id);
    case 'seer': return al.filter(x => x.id !== p.id).map(x => x.id);
    case 'guard': return al.filter(x => x.id !== room.guardLast).map(x => x.id);
    case 'cupid': return al.map(x => x.id);
    case 'cover': return al.filter(x => x.id !== p.id).map(x => x.id);
    case 'witch': return room.witch.poison ? al.filter(x => x.id !== p.id).map(x => x.id) : [];
    default: return [];
  }
}
function view(room, me) {
  const started = room.phase !== 'lobby';
  const ended = room.phase === 'end';
  const spect = started && !me.alive;
  const loverVis = room.lovers && (ended || me.role === 'cupid' || room.lovers.includes(me.id));
  const kind = nkind(room, me);
  const v = {
    now: Date.now(), code: room.code, phase: room.phase, round: room.round, gameNo: room.gameNo, endsAt: room.endsAt, total: room.total,
    hostId: room.hostId, settings: room.settings, dist: distOf(started ? room.players.length : Math.max(room.settings.seats, humans(room).length)),
    me: { id: me.id, name: me.name, role: started ? me.role : null, alive: me.alive, kind, done: !!me.done, pick: me.pick || [], note: me.note || '', bet: me.bet || null, readyVote: !!me.readyVote, vote: me.vote ?? null, vdone: !!me.vdone, ready: !!me.ready },
    players: room.players.map(p => {
      const o = { id: p.id, name: p.name, color: p.color, isBot: p.isBot, connected: p.isBot || p.connected, alive: started ? p.alive : true, revealed: !!p.revealed };
      if (started && (ended || p.id === me.id || (me.role === 'wolf' && p.role === 'wolf'))) o.role = p.role;
      if (p.revealed) o.team = team(p);
      if (me.known && p.id in me.known) o.known = me.known[p.id];
      if (loverVis && room.lovers.includes(p.id)) o.lover = true;
      if (kind === 'wolf' && p.role === 'wolf' && p.id !== me.id) o.wsel = p.isBot ? (room.wSuggest != null ? [room.wSuggest] : []) : (p.sel || []);
      if (room.phase === 'vote') o.voted = !p.isBot && !!p.vdone;
      if (room.phase === 'reveal') o.ready = p.isBot || !!p.ready;
      if (room.phase === 'day') o.readyVote = !p.isBot && !!p.readyVote;
      return o;
    }),
    feed: ['day', 'vote', 'tally', 'deaths', 'hunter', 'end'].includes(room.phase) ? room.feed : [],
    wfeed: (me.role === 'wolf' && (me.alive || ended)) ? room.wfeed : [],
    gfeed: (spect || ended) ? room.gfeed : [],
    typing: room.phase === 'day' ? room.typing ?? null : null
  };
  if (kind) v.cand = ncand(room, me, kind);
  if (kind === 'witch') v.witch = { target: room.wTarget, save: room.witch.save, poison: room.witch.poison, chosenSave: !!room.witchSave, chosenPoison: room.witchPoison };
  if (room.phase === 'deaths') { v.deaths = room.deaths; v.dtitle = room.dtitle; v.dctx = room.dctx; }
  if (room.phase === 'hunter') { v.hunterId = room.hunterId === me.id ? me.id : -1; if (room.hunterId === me.id) v.cand = alive(room).map(p => p.id); }
  if (room.phase === 'tally') v.tally = room.tally;
  if (ended) {
    const w = room.result.w, won = team(me) === w, st = me.stats || {};
    const betOk = me.bet === w;
    v.result = { w, won, alive: me.alive, hits: st.hits || 0, votes: st.votes || 0, betOk, pts: (won ? 100 : 20) + (me.alive ? 30 : 0) + (st.hits || 0) * 15 + (betOk ? 40 : 0),
      shotWolf: !!st.shotWolf, saved: !!st.saved, cupid: me.role === 'cupid' && !!room.lovers, seerFound: me.role === 'seer' && Object.values(me.known || {}).some(Boolean) };
    v.log = room.log;
  }
  return v;
}
function distOf(n) { const c = {}; (DIST[Math.max(6, Math.min(12, n))] || []).forEach(r => { c[r] = (c[r] || 0) + 1; }); return c; }
function push(room) {
  room.lastActive = Date.now();
  for (const p of room.players) if (!p.isBot && p.sid) io.to(p.sid).emit('state', view(room, p));
}

/* ------------------------------------------------------------------ */
/* Bắt đầu ván                                                         */
/* ------------------------------------------------------------------ */
function startGame(room) {
  const seats = Math.max(room.settings.seats, humans(room).length, 6);
  room.players = room.players.filter(p => !p.isBot);
  const used = new Set(room.players.map(p => p.name.toLowerCase()));
  const names = shuffle(BOT_NAMES).filter(n => !used.has(n.toLowerCase()));
  while (room.players.length < seats) {
    const id = room.nextId++;
    room.players.push({ id, name: names.shift() || ('Bot ' + id), color: COLORS[id % COLORS.length], isBot: true, connected: true });
  }
  room.players = shuffle(room.players); // xếp chỗ ngồi ngẫu nhiên
  const roles = shuffle(DIST[Math.min(12, room.players.length)]);
  room.players.forEach((p, i) => Object.assign(p, { role: roles[i], alive: true, revealed: false, done: false, pick: [], sel: [], note: '', known: p.role === 'seer' ? {} : undefined, bet: null, stats: { votes: 0, hits: 0 }, vote: null, vdone: false, readyVote: false, ready: false }));
  room.players.forEach(p => { if (p.role === 'seer') p.known = {}; });
  Object.assign(room, { round: 0, feed: [], wfeed: [], gfeed: [], log: [], sus: {}, botKnown: {}, lovers: null, witch: { save: true, poison: true }, guardLast: null, claim: null, claimDone: false, hunterDone: false, hunterId: null, tally: null, result: null, deaths: [] });
  room.players.forEach(p => { room.sus[p.id] = 0; });
  room.hasWitch = room.players.some(p => p.role === 'witch');
  room.gameNo++;
  phase(room, 'reveal', 20, () => night(room));
}

/* ------------------------------------------------------------------ */
/* Đêm                                                                 */
/* ------------------------------------------------------------------ */
function botWolfTarget(room) {
  const nonW = alive(room).filter(p => p.role !== 'wolf');
  const c = room.claim && room.claim.by != null && P(room, room.claim.by)?.alive && P(room, room.claim.by).role !== 'wolf' ? room.claim.by : null;
  return (c != null && Math.random() < 0.7) ? c : rnd(nonW).id;
}
function topSus(room, list) { if (!list.length) return null; return list.slice().sort((a, b) => (room.sus[b.id] || 0) - (room.sus[a.id] || 0) + (Math.random() - 0.5) * 0.8)[0]; }

function night(room) {
  room.round++;
  room.players.forEach(p => { p.done = false; p.pick = []; p.sel = []; p.note = ''; });
  Object.assign(room, { wfeed: [], wTarget: null, wSuggest: null, witchSave: false, witchPoison: null });
  phase(room, 'night', 30, () => endNight(room));
  const hw = alive(room).filter(p => p.role === 'wolf' && !p.isBot);
  const bw = alive(room).find(p => p.role === 'wolf' && p.isBot);
  if (hw.length && bw) {
    const t = P(room, botWolfTarget(room)); room.wSuggest = t.id;
    later(room, () => { room.wfeed.push({ id: bw.id, msg: `Tấn công ${B(t)} đi, trông nguy hiểm đấy.` }); push(room); }, 2500);
  }
  ghostComment(room);
}
function applyNight(room, p, ids, save) {
  const k = nkind(room, p); const cand = ncand(room, p, k);
  ids = (ids || []).map(Number).filter(id => cand.includes(id));
  if (k === 'cupid') { ids = [...new Set(ids)]; if (ids.length !== 2) return false; }
  else if (k === 'witch') { ids = ids.slice(0, 1); }
  else if (['wolf', 'seer', 'guard', 'cover'].includes(k)) { if (ids.length < 1) return false; ids = ids.slice(0, 1); }
  else return false;
  p.done = true; p.pick = ids; p.sel = ids;
  if (k === 'seer') {
    const t = P(room, ids[0]); p.known[t.id] = t.role === 'wolf';
    p.note = `${esc(t.name)} thuộc ${t.role === 'wolf' ? 'PHE SÓI' : 'PHE DÂN'}`;
    log(room, { t: 'art', k: 'seer' }, `Tiên tri ${B(p)} soi ${B(t)} → ${t.role === 'wolf' ? 'phe Sói' : 'phe Dân'}`);
  }
  if (k === 'cupid') room.lovers = ids.slice();
  if (k === 'witch') {
    if (save && room.witch.save && room.wTarget != null) { room.witchSave = true; room.witch.save = false; }
    if (ids[0] != null && room.witch.poison) { room.witchPoison = ids[0]; room.witch.poison = false; }
  }
  if (k === 'cover') room.sus[ids[0]] = (room.sus[ids[0]] || 0) + 0.3;
  return true;
}
function allActed(room) {
  return alive(room).filter(p => !p.isBot).every(p => { const k = nkind(room, p); return ['ghost', 'wait'].includes(k) || p.done; });
}
function endNight(room) {
  // tự chọn thay người chưa kịp chọn
  for (const p of alive(room).filter(p => !p.isBot && !p.done)) {
    const k = nkind(room, p), c = ncand(room, p, k);
    if (k === 'cupid') applyNight(room, p, shuffle(c).slice(0, 2));
    else if (k === 'wolf') applyNight(room, p, [p.sel && p.sel.length ? p.sel[0] : (c.includes(room.wSuggest) ? room.wSuggest : rnd(c))]);
    else if (['seer', 'guard'].includes(k) && c.length) applyNight(room, p, [rnd(c)]);
  }
  // mục tiêu của Sói: đa số phiếu của Sói người thật, nếu không có thì bot quyết
  const hw = alive(room).filter(p => p.role === 'wolf' && !p.isBot && p.pick.length);
  if (hw.length) {
    const cnt = {}; hw.forEach(p => { cnt[p.pick[0]] = (cnt[p.pick[0]] || 0) + 1; });
    const max = Math.max(...Object.values(cnt));
    room.wTarget = Number(rnd(Object.keys(cnt).filter(k => cnt[k] === max)));
  } else room.wTarget = botWolfTarget(room);
  // Cupid bot
  if (room.round === 1 && !room.lovers) {
    const cu = alive(room).find(p => p.role === 'cupid');
    if (cu) { const two = shuffle(alive(room)).slice(0, 2); room.lovers = [two[0].id, two[1].id]; }
  }
  // Phù thủy bot quyết định ngay
  const wi = alive(room).find(p => p.role === 'witch');
  if (wi && wi.isBot) {
    if (room.witch.save && Math.random() < (room.wTarget === wi.id ? 0.9 : 0.5)) { room.witchSave = true; room.witch.save = false; }
    if (room.witch.poison && room.round >= 2 && Math.random() < 0.35) { const t = topSus(room, alive(room).filter(p => p.id !== wi.id && p.id !== room.wTarget)); if (t) { room.witchPoison = t.id; room.witch.poison = false; } }
  }
  room.players.forEach(p => { p.done = false; if (p.role === 'witch') { p.pick = []; p.sel = []; } });
  if (room.hasWitch) phase(room, 'witch', wi && !wi.isBot ? 25 : 8, () => resolveNight(room));
  else resolveNight(room);
}
function resolveNight(room) {
  const al = alive(room);
  if (room.round === 1 && room.lovers) log(room, { t: 'art', k: 'cupid' }, `Cupid ghép đôi ${B(P(room, room.lovers[0]))} và ${B(P(room, room.lovers[1]))}`);
  const target = room.wTarget;
  if (target != null) log(room, { t: 'art', k: 'wolf' }, `Sói chọn tấn công ${B(P(room, target))}`);
  room.wfeed.forEach(m => log(room, { t: 'av', id: m.id }, `<i>Kênh Sói</i> · ${B(P(room, m.id))}: ${m.msg}`));
  const g = al.find(p => p.role === 'guard'); let prot = null;
  if (g) {
    if (!g.isBot) prot = g.pick[0] ?? null;
    else { const opts = al.filter(p => p.id !== room.guardLast); const c = room.claim && room.claim.by != null && P(room, room.claim.by)?.alive ? room.claim.by : null; prot = (c != null && c !== room.guardLast && Math.random() < 0.5) ? c : rnd(opts).id; }
    if (prot != null) log(room, { t: 'art', k: 'guard' }, `Bảo vệ che chắn cho ${B(P(room, prot))}`);
  }
  room.guardLast = prot;
  const saved = room.witchSave, poison = room.witchPoison;
  const wi = al.find(p => p.role === 'witch');
  if (saved && target != null) { log(room, { t: 'art', k: 'witch' }, `Phù thủy dùng bình cứu cho ${B(P(room, target))}`); if (wi && !wi.isBot && target !== prot) wi.stats.saved = true; }
  if (poison != null) log(room, { t: 'art', k: 'witch' }, `Phù thủy đầu độc ${B(P(room, poison))}`);
  const sr = al.find(p => p.role === 'seer' && p.isBot);
  if (sr) { const u = al.filter(p => p.id !== sr.id && !(p.id in room.botKnown)); if (u.length) { const t = rnd(u); room.botKnown[t.id] = t.role === 'wolf'; log(room, { t: 'art', k: 'seer' }, `Tiên tri soi ${B(t)} → ${t.role === 'wolf' ? 'phe Sói' : 'phe Dân'}`); } }
  const L = [];
  if (target != null && target !== prot && !saved) kill(room, target, 'wolf', L);
  else if (target != null) log(room, { t: 'art', k: 'guard' }, `${B(P(room, target))} thoát chết đêm nay`);
  if (poison != null) kill(room, poison, 'poison', L);
  deathsPhase(room, L, 'night', `Sáng ngày ${room.round}`);
}
function kill(room, id, cause, L) {
  const p = P(room, id); if (!p || !p.alive) return;
  p.alive = false; p.revealed = true; L.push({ id, cause });
  log(room, { t: 'team', k: team(p) }, `${B(p)} ${CAUSE[cause]} · thuộc ${TEAMN[team(p)]}`);
  if (room.lovers && room.lovers.includes(id)) { const o = room.lovers.find(x => x !== id); if (o != null && P(room, o)?.alive) kill(room, o, 'love', L); }
}

/* ------------------------------------------------------------------ */
/* Công bố người bị loại, lời trăng trối, Thợ săn                       */
/* ------------------------------------------------------------------ */
function deathsPhase(room, L, ctx, title) {
  room.deaths = L; room.dctx = ctx; room.dtitle = title;
  phase(room, 'deaths', L.length ? 9 : 7, () => (L.length ? hunterStep(room, L, ctx) : after(room, ctx)));
}
function hunterStep(room, L, ctx) {
  const hd = L.find(d => P(room, d.id).role === 'hunter' && d.cause !== 'poison');
  if (!hd || room.hunterDone) return after(room, ctx);
  room.hunterDone = true; const h = P(room, hd.id);
  if (h.isBot) {
    const pool = alive(room).filter(p => p.role === 'wolf' ? Math.random() < 0.6 : true);
    const tg = topSus(room, pool.length ? pool : alive(room));
    if (!tg) return after(room, ctx);
    const L2 = []; kill(room, tg.id, 'shot', L2); log(room, { t: 'art', k: 'hunter' }, `Thợ săn ${B(h)} bắn ${B(tg)}`);
    return deathsPhase(room, L2, ctx, 'Một phát súng vang lên');
  }
  room.hunterId = h.id; room.hctx = ctx;
  phase(room, 'hunter', 15, () => fire(room, null));
}
function fire(room, id) {
  if (room.phase !== 'hunter') return;
  const h = P(room, room.hunterId), ctx = room.hctx; room.hunterId = null;
  const t = id != null ? P(room, Number(id)) : null;
  if (!t || !t.alive) { log(room, { t: 'art', k: 'hunter' }, `Thợ săn ${B(h)} không bắn ai`); return after(room, ctx); }
  if (t.role === 'wolf') h.stats.shotWolf = true;
  const L2 = []; kill(room, t.id, 'shot', L2); log(room, { t: 'art', k: 'hunter' }, `Thợ săn ${B(h)} bắn ${B(t)}`);
  deathsPhase(room, L2, ctx, 'Một phát súng vang lên');
}
function win(room) { const a = alive(room), w = a.filter(p => p.role === 'wolf').length; if (w === 0) return 'vil'; if (w >= a.length - w) return 'wolf'; return null; }
function after(room, ctx) { const w = win(room); if (w) return end(room, w); if (ctx === 'night') day(room); else night(room); }

/* ------------------------------------------------------------------ */
/* Ngày: thảo luận, bot nói chuyện                                      */
/* ------------------------------------------------------------------ */
function say(room, p, msg) { room.feed.push({ id: p.id, msg }); log(room, { t: 'av', id: p.id }, `${B(p)}: ${msg}`); push(room); }
function typing(room, p, ms, fn) { room.typing = p.id; push(room); later(room, () => { room.typing = null; fn(); }, ms); }
function botSay(room, b) {
  if (!b.alive || room.phase !== 'day') return;
  const a = alive(room), others = a.filter(p => p.id !== b.id); let msg, acc = null;
  const known = Object.keys(room.botKnown).map(Number);
  const kw = b.role === 'seer' ? known.find(id => room.botKnown[id] && P(room, id)?.alive) : undefined;
  if (kw !== undefined && !room.claimDone) { msg = `Tôi là Tiên tri! Đêm qua tôi soi ${B(P(room, kw))}, là SÓI!`; room.sus[kw] += 6; room.claim = { by: b.id, target: kw }; room.claimDone = true; acc = kw; }
  else if (b.role === 'wolf' && room.claim && room.claim.target === b.id && P(room, room.claim.by)) { const y = room.claim.by; msg = `Vô lý! ${B(P(room, y))} mới là Sói giả Tiên tri đấy!`; room.sus[y] += 2; acc = y; }
  else if (b.role === 'seer' && Math.random() < 0.5) { const good = known.filter(id => !room.botKnown[id] && P(room, id)?.alive); if (good.length) { const g = P(room, rnd(good)); msg = `Tôi tin ${B(g)} là người tốt.`; room.sus[g.id] -= 1; } }
  if (!msg) {
    const r = Math.random(); let pool = b.role === 'wolf' ? others.filter(p => p.role !== 'wolf') : others; if (!pool.length) pool = others; const x = rnd(pool);
    if (r < 0.45) { msg = `Tôi nghi ${B(x)} lắm.`; room.sus[x.id] += 1.2; acc = x.id; }
    else if (r < 0.7) { msg = `${B(x)} im lặng từ nãy, đáng ngờ đấy.`; room.sus[x.id] += 0.8; acc = x.id; }
    else if (r < 0.88) msg = rnd(['Tôi là dân thường thôi.', 'Bình tĩnh, đừng vote vội.', 'Bảo vệ đâu rồi, lên tiếng đi.', 'Phù thủy còn bình nào không nhỉ?']);
    else msg = 'Đêm qua tôi ngủ ngon, không biết gì cả.';
  }
  say(room, b, msg);
  if (acc != null && Math.random() < 0.55) emitReact(room, b.id, acc, 'nghi');
}
function botReply(room, x, from) {
  if (!x.alive || !x.isBot || room.phase !== 'day') return;
  typing(room, x, 1300, () => {
    const others = alive(room).filter(p => p.id !== x.id); let pool = x.role === 'wolf' ? others.filter(p => p.role !== 'wolf') : others; if (!pool.length) pool = others;
    const y = rnd(pool.filter(p => p.id !== from) .length ? pool.filter(p => p.id !== from) : pool);
    let m; if (x.role === 'wolf' && y) { m = `Sao lại là tôi? ${B(y)} mới đáng ngờ kìa!`; room.sus[y.id] += 1; }
    else m = rnd(['Oan quá, tôi là dân thật mà!', 'Bằng chứng đâu? Đừng vote bừa nhé.', 'Tôi mà là Sói thì đêm qua đã khác rồi.']);
    say(room, x, m); emitReact(room, x.id, from, rnd(['gian', 'oan']));
  });
}
function analyze(room, p, text) {
  const low = text.toLowerCase();
  const claimSeer = /tiên tri/.test(low);
  const hit = alive(room).filter(x => x.id !== p.id && low.includes(x.name.toLowerCase()));
  if (!hit.length) return;
  const x = hit[0], acc = /sói|nghi|vote|loại|giả|xạo|điêu/.test(low), def = !acc && /tin|tốt|dân|ok/.test(low);
  if (acc) { room.sus[x.id] += claimSeer ? 4 : 2; if (claimSeer && /sói/.test(low)) { room.claim = { by: p.id, target: x.id }; room.claimDone = true; } if (x.isBot && Math.random() < 0.8) later(room, () => botReply(room, x, p.id), 900); }
  else if (def) room.sus[x.id] -= 1;
}
function ghostComment(room) {
  if (!room.players.some(p => !p.isBot && !p.alive)) return;
  const g = room.players.filter(p => !p.alive && p.isBot); if (!g.length) return;
  const x = rnd(g);
  later(room, () => { room.gfeed.push({ id: x.id, msg: rnd(['Hồi hộp thật, không biết ai là Sói nữa.', 'Bị loại sớm tiếc ghê!', 'Mình cược phe Dân, còn bạn?', 'Cả bàn đang tranh cãi căng quá.']) }); push(room); }, 4000);
}
function day(room) {
  room.feed = []; room.typing = null;
  room.players.forEach(p => { p.readyVote = false; });
  Object.keys(room.sus).forEach(k => { room.sus[k] *= 0.6; });
  const a = alive(room);
  phase(room, 'day', Math.min(150, Math.max(60, a.length * 18)), () => vote(room));
  const bots = shuffle(a.filter(p => p.isBot)), k = Math.min(bots.length, 4), span = room.total * 1000;
  for (let i = 0; i < k; i++) later(room, () => typing(room, bots[i], 1300, () => botSay(room, bots[i])), span * (i + 0.5) / (k + 1));
  later(room, () => { const b = rnd(alive(room).filter(p => p.isBot)); if (b) { const t = rnd(alive(room).filter(p => p.id !== b.id)); if (t) emitReact(room, b.id, t.id, rnd(['haha', 'soc', 'nghi'])); } }, span * 0.35);
  ghostComment(room);
}

/* ------------------------------------------------------------------ */
/* Biểu quyết                                                          */
/* ------------------------------------------------------------------ */
function vote(room) {
  room.players.forEach(p => { p.vote = null; p.vdone = false; });
  phase(room, 'vote', 20, () => tally(room));
}
function botVote(room, b) {
  const a = alive(room).filter(x => x.id !== b.id); let pool = a;
  if (room.lovers && room.lovers.includes(b.id)) pool = pool.filter(x => !room.lovers.includes(x.id));
  if (b.role === 'wolf') {
    pool = pool.filter(x => x.role !== 'wolf');
    if (room.claim && room.claim.by != null && room.claim.by !== b.id && P(room, room.claim.by)?.alive && P(room, room.claim.by).role !== 'wolf' && Math.random() < 0.6) return room.claim.by;
  }
  if (b.role === 'seer') { const kw = Object.keys(room.botKnown).map(Number).find(id => room.botKnown[id] && P(room, id)?.alive); if (kw !== undefined) return kw; pool = pool.filter(x => room.botKnown[x.id] !== false); }
  if (!pool.length) pool = a; if (!pool.length) return null;
  const w = pool.map(x => Math.pow(Math.max(0.2, (room.sus[x.id] || 0) + 1), 2) * (0.6 + Math.random() * 0.8) * (x.role === 'wolf' && b.role !== 'wolf' ? 3 : 1));
  let r = Math.random() * w.reduce((s, v) => s + v, 0);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i].id; }
  return pool[pool.length - 1].id;
}
function tally(room) {
  const a = alive(room), votes = {};
  a.forEach(p => { const t = p.isBot ? botVote(room, p) : p.vote; if (t != null && P(room, t)?.alive && t !== p.id) votes[p.id] = t; });
  a.filter(p => !p.isBot && votes[p.id] != null).forEach(p => { p.stats.votes++; if (P(room, votes[p.id]).role === 'wolf') p.stats.hits++; });
  const cnt = {}; Object.values(votes).forEach(t => { cnt[t] = (cnt[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(cnt)); const top = Object.keys(cnt).filter(k => cnt[k] === max).map(Number);
  log(room, { t: 'ic', k: 'vote' }, 'Phiếu bầu: ' + a.map(p => `${esc(p.name)} → ${votes[p.id] != null ? esc(P(room, votes[p.id]).name) : 'trắng'}`).join(' · '));
  const L = []; if (top.length === 1) kill(room, top[0], 'vote', L); else log(room, { t: 'ic', k: 'scale' }, 'Hoà phiếu, không ai bị loại');
  room.tally = { order: a.map(p => p.id), votes, cnt, max, out: L.length ? L[0].id : null, chain: L.length > 1 };
  phase(room, 'tally', 10, () => (L.length ? deathsPhase(room, L, 'vote', `Kết quả ngày ${room.round}`) : after(room, 'vote')));
}

/* ------------------------------------------------------------------ */
/* Kết thúc                                                            */
/* ------------------------------------------------------------------ */
function end(room, w) {
  room.result = { w };
  room.phase = 'end';
  log(room, { t: 'art', k: w === 'wolf' ? 'wolf' : 'house' }, `<b>${w === 'wolf' ? 'Phe Sói' : 'Phe Dân làng'} chiến thắng!</b>`);
  phase(room, 'end', 0, null);
}
function backToLobby(room) {
  clearTimers(room);
  room.players = room.players.filter(p => !p.isBot && p.connected);
  room.players.forEach(p => Object.assign(p, { role: null, alive: true, revealed: false }));
  if (!room.players.find(p => p.id === room.hostId) && room.players[0]) room.hostId = room.players[0].id;
  Object.assign(room, { round: 0, result: null, log: [], feed: [], wfeed: [], gfeed: [] });
  phase(room, 'lobby', 0, null);
}

/* ------------------------------------------------------------------ */
/* Kết nối                                                             */
/* ------------------------------------------------------------------ */
function genCode() { let c; do { c = String(1000 + Math.floor(Math.random() * 9000)); } while (rooms.has(c)); return c; }
function uniqueName(room, name) { let n = name, i = 2; const has = x => room.players.some(p => p.name.toLowerCase() === x.toLowerCase()); while (has(n)) n = `${name} ${i++}`; return n; }

io.on('connection', socket => {
  const ctx = () => { const room = rooms.get(socket.data.code); if (!room) return {}; const me = room.players.find(p => p.id === socket.data.pid && !p.isBot); return { room, me }; };
  const on = (ev, fn) => socket.on(ev, (...args) => { try { fn(...args); } catch (e) { console.error('[socket error]', ev, e); } });
  const bind = (room, p, cb) => {
    p.sid = socket.id; p.connected = true; socket.data.code = room.code; socket.data.pid = p.id;
    socket.join('room:' + room.code); if (cb) cb({ ok: true, code: room.code }); push(room);
  };

  on('create', ({ name, token } = {}, cb) => {
    name = clean(name, 14) || 'Người chơi'; token = clean(token, 64);
    const code = genCode(); const room = newRoom(code); rooms.set(code, room);
    const p = { id: room.nextId++, token, name, color: COLORS[0], isBot: false, alive: true };
    room.players.push(p); room.hostId = p.id; bind(room, p, cb);
  });
  on('join', ({ code, name, token } = {}, cb) => {
    code = clean(code, 6); token = clean(token, 64); const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, err: 'Không tìm thấy phòng ' + code });
    const old = token && room.players.find(p => !p.isBot && p.token === token);
    if (old) return bind(room, old, cb);
    if (room.phase !== 'lobby') return cb && cb({ ok: false, err: 'Ván đang diễn ra, chờ ván sau nhé.' });
    if (humans(room).length >= 12) return cb && cb({ ok: false, err: 'Phòng đã đủ 12 người.' });
    name = uniqueName(room, clean(name, 14) || 'Người chơi');
    const p = { id: room.nextId++, token, name, color: COLORS[room.nextId % COLORS.length], isBot: false, alive: true };
    room.players.push(p); if (humans(room).length > room.settings.seats) room.settings.seats = Math.min(12, humans(room).length);
    bind(room, p, cb);
  });
  on('leave', () => {
    const { room, me } = ctx(); if (!room || !me) return;
    socket.leave('room:' + room.code); socket.data.code = null;
    if (room.phase === 'lobby') { room.players = room.players.filter(p => p !== me); if (room.hostId === me.id && room.players[0]) room.hostId = room.players[0].id; }
    else { me.connected = false; me.sid = null; }
    if (!humans(room).some(p => p.connected)) { clearTimers(room); rooms.delete(room.code); return; }
    push(room);
  });
  on('settings', (s = {}) => {
    const { room, me } = ctx(); if (!room || room.phase !== 'lobby' || me?.id !== room.hostId) return;
    if (s.seats) room.settings.seats = Math.max(6, Math.min(12, Number(s.seats) || 8, 12));
    if (room.settings.seats < humans(room).length) room.settings.seats = Math.min(12, humans(room).length);
    if (s.speed) room.settings.speed = s.speed === 'demo' ? 'demo' : 'real';
    push(room);
  });
  on('start', () => { const { room, me } = ctx(); if (room && room.phase === 'lobby' && me?.id === room.hostId) startGame(room); });
  on('ready', () => { const { room, me } = ctx(); if (!room || room.phase !== 'reveal' || !me) return; me.ready = true; if (humans(room).filter(p => p.connected).every(p => p.ready)) shorten(room, 2); push(room); });
  on('nsel', ({ ids } = {}) => { const { room, me } = ctx(); if (!room || !me || me.done || !['night', 'witch'].includes(room.phase)) return; me.sel = (ids || []).map(Number).slice(0, 2); push(room); });
  on('nconfirm', ({ ids, save } = {}) => {
    const { room, me } = ctx(); if (!room || !me || me.done || !['night', 'witch'].includes(room.phase) || !me.alive) return;
    if (!applyNight(room, me, ids, !!save)) return;
    if (room.phase === 'witch') shorten(room, 3); else if (allActed(room)) shorten(room, 3);
    push(room);
  });
  on('chat', ({ ch, text } = {}) => {
    const { room, me } = ctx(); if (!room || !me) return; text = clean(text, 160); if (!text) return;
    const msg = esc(text);
    if (ch === 'wolf') {
      if (me.role !== 'wolf' || !me.alive || !['night', 'witch'].includes(room.phase)) return;
      room.wfeed.push({ id: me.id, msg }); push(room);
      const mate = alive(room).find(p => p.role === 'wolf' && p.isBot);
      if (mate && Math.random() < 0.7) later(room, () => { room.wfeed.push({ id: mate.id, msg: rnd(['Ok, theo bạn.', 'Chuẩn, làm vậy đi.', 'Được, mai mình đổ cho người khác nhé.']) }); push(room); }, 1500);
    } else if (ch === 'ghost') {
      if (me.alive || room.phase === 'lobby') return;
      room.gfeed.push({ id: me.id, msg }); push(room);
    } else {
      if (!me.alive || !['day', 'vote', 'tally', 'deaths', 'hunter'].includes(room.phase)) return;
      say(room, me, msg); if (room.phase === 'day') analyze(room, me, text);
    }
  });
  on('react', ({ to, k } = {}) => {
    const { room, me } = ctx(); if (!room || !me || !me.alive || !STICKERS.includes(k)) return;
    const t = to != null ? P(room, Number(to)) : null; emitReact(room, me.id, t ? t.id : null, k);
    if (t && t.isBot && t.alive && ['nghi', 'gian'].includes(k)) { room.sus[t.id] += 0.5; if (Math.random() < 0.5) later(room, () => emitReact(room, t.id, me.id, rnd(['oan', 'gian', 'soc'])), 900); }
  });
  on('readyVote', () => {
    const { room, me } = ctx(); if (!room || !me || room.phase !== 'day' || !me.alive) return; me.readyVote = !me.readyVote;
    const hs = alive(room).filter(p => !p.isBot && p.connected); if (hs.length && hs.every(p => p.readyVote)) shorten(room, 3); push(room);
  });
  on('vsel', ({ id } = {}) => { const { room, me } = ctx(); if (!room || !me || room.phase !== 'vote' || !me.alive || me.vdone) return; const t = P(room, Number(id)); if (t && t.alive && t.id !== me.id) { me.vote = t.id; push(room); } });
  on('vconfirm', ({ id } = {}) => {
    const { room, me } = ctx(); if (!room || !me || room.phase !== 'vote' || !me.alive || me.vdone) return;
    const t = P(room, Number(id)); if (!t || !t.alive || t.id === me.id) return; me.vote = t.id; me.vdone = true;
    if (alive(room).filter(p => !p.isBot && p.connected).every(p => p.vdone)) shorten(room, 2); push(room);
  });
  on('shoot', ({ id } = {}) => { const { room, me } = ctx(); if (room && me && room.phase === 'hunter' && room.hunterId === me.id) fire(room, id); });
  on('bet', ({ team: t } = {}) => { const { room, me } = ctx(); if (!room || !me || me.alive || me.bet || !['wolf', 'vil'].includes(t) || room.phase === 'end') return; me.bet = t; log(room, { t: 'ic', k: 'star' }, `${B(me)} cược ${TEAMN[t]} thắng`); push(room); });
  on('skip', () => {
    const { room, me } = ctx(); if (!room || me?.id !== room.hostId) return;
    if (['reveal', 'deaths', 'tally', 'day'].includes(room.phase)) shorten(room, 1);
  });
  on('again', () => { const { room, me } = ctx(); if (room && room.phase === 'end' && me?.id === room.hostId) backToLobby(room); });
  on('disconnect', () => {
    const { room, me } = ctx(); if (!room || !me || me.sid !== socket.id) return;
    me.connected = false; me.sid = null;
    if (room.phase === 'lobby') {
      setTimeout(() => { if (!me.connected && room.phase === 'lobby' && room.players.includes(me)) { room.players = room.players.filter(p => p !== me); if (room.hostId === me.id && room.players[0]) room.hostId = room.players[0].id; push(room); } }, 30000);
    }
    if (room.hostId === me.id) { const h = humans(room).find(p => p.connected); if (h) room.hostId = h.id; }
    push(room);
  });
});

// Dọn phòng không còn ai sau 30 phút
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (!humans(room).some(p => p.connected) && now - room.lastActive > 30 * 60 * 1000) { clearTimers(room); rooms.delete(code); }
}, 5 * 60 * 1000);

server.listen(PORT, () => console.log(`Ma Sói Công Sở đang chạy tại cổng ${PORT}`));
