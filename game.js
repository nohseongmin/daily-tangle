"use strict";

/* ============================================================
   TANGLE — 데일리 매듭풀기(Planarity/untangle).
   노드를 끌어 어떤 두 선도 겹치지 않게 만든다.
   퍼즐은 "겹침 없는 해가 존재함이 보장된" 평면 그래프에서 생성 → 반드시 풀린다.
   바닐라 JS + Canvas 2D. 백엔드 0. 날짜 시드로 전원 같은 문제(Wordle식).
   ============================================================ */

/* ---------- Tunables (no magic numbers scattered in logic) ---------- */
const UINT32 = 0x100000000;
const NODE_COUNT = 10;
const MAX_DEGREE = 4;             // 한 노드에 붙는 최대 간선 수
const EDGE_FACTOR = 1.7;          // 목표 간선 수 = round(EDGE_FACTOR * NODE_COUNT)
const NODE_R = 13;                // 노드 반지름(px, 내부 좌표계)
const GRAB_R = NODE_R * 1.8;      // 이 반경 안을 누르면 노드를 집는다
const MARGIN = 34;                // 노드 배치 여백
const SOL_MIN_DIST = 66;          // 해(solution) 배치 최소 간격
const SCRAMBLE_MIN_DIST = 40;     // 스크램블 시작 배치 최소 간격
const PLACE_TRIES = 400;          // 배치 rejection 샘플 시도 상한
const EPOCH_UTC = Date.UTC(2026, 0, 1); // 데일리 기준일 (2026-01-01)
const DAY_MS = 86400000;
const SEED_MIX = 2654435761;      // Knuth 승수 — 인접 날짜 시드를 잘 흩뿌림

/* ---------- Sound (procedural WebAudio, no assets) ---------- */
const SFX = (() => {
  let ctx = null;
  let muted = localStorage.getItem("tangle_muted") === "1";
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  function blip(freq, dur, type, vol, slide) {
    if (muted || document.hidden) return;
    try {
      const c = ac();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), c.currentTime + dur);
      g.gain.setValueAtTime(vol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur);
    } catch { /* audio unavailable: stay silent */ }
  }
  return {
    unlock() { if (!muted) try { ac(); } catch {} },
    grab() { blip(300, 0.05, "sine", 0.07, 1.3); },
    drop() { blip(220, 0.05, "sine", 0.06, 0.9); },
    clear() { blip(720, 0.06, "triangle", 0.08, 1.2); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.16, "triangle", 0.15, 1), i * 100)); },
    toggle() { muted = !muted; localStorage.setItem("tangle_muted", muted ? "1" : "0"); return muted; },
    get muted() { return muted; },
  };
})();
document.addEventListener("pointerdown", () => SFX.unlock(), { once: true });

/* ---------- Seeded RNG (mulberry32) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

/* ---------- Geometry ---------- */
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

// 세 점 방향(외적 부호)
function orient(ax, ay, bx, by, cx, cy) {
  return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

// 두 선분이 '진짜로' 교차하는가 (끝점 공유는 호출부에서 제외). 접점/공선은 무시.
function segsCross(p1, p2, p3, p4) {
  const d1 = orient(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
  const d2 = orient(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
  const d3 = orient(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const d4 = orient(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
         ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/* ---------- DOM ---------- */
const el = (id) => document.getElementById(id);
const canvas = el("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

/* ---------- Puzzle generation (guaranteed solvable) ---------- */
function placePoints(rng, n, minDist) {
  const pts = [];
  let minD2 = minDist * minDist;
  for (let i = 0; i < n; i++) {
    let placed = null;
    for (let t = 0; t < PLACE_TRIES; t++) {
      const p = {
        x: MARGIN + rng() * (W - 2 * MARGIN),
        y: MARGIN + rng() * (H - 2 * MARGIN),
      };
      if (pts.every((q) => dist2(p, q) >= minD2)) { placed = p; break; }
    }
    if (!placed) { minD2 *= 0.8; i--; continue; } // 너무 빡빡하면 간격 완화 후 재시도
    pts.push(placed);
  }
  return pts;
}

// solution 좌표에서 서로 안 겹치는 간선만 추가 → 평면 그래프(겹침 0 해가 존재).
function buildPlanarEdges(sol, rng) {
  const n = sol.length;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) pairs.push([i, j, dist2(sol[i], sol[j])]);
  }
  // 짧은 간선부터 (덜 겹친다) + 약간의 셔플로 매일 다른 모양
  pairs.sort((p, q) => p[2] - q[2]);
  const target = Math.round(EDGE_FACTOR * n);
  const edges = [];
  const deg = new Array(n).fill(0);
  const wouldCross = (a, b) => edges.some(([c, d]) => {
    if (a === c || a === d || b === c || b === d) return false; // 인접 간선은 제외
    return segsCross(sol[a], sol[b], sol[c], sol[d]);
  });
  for (const [a, b] of pairs) {
    if (edges.length >= target) break;
    if (deg[a] >= MAX_DEGREE || deg[b] >= MAX_DEGREE) continue;
    if (rng() < 0.08) continue; // 다양성: 가끔 짧은 간선을 건너뛰어 모양을 흔든다
    if (wouldCross(a, b)) continue;
    edges.push([a, b]); deg[a] += 1; deg[b] += 1;
  }
  return edges;
}

function generatePuzzle(seed) {
  const rng = mulberry32(seed >>> 0);
  const sol = placePoints(rng, NODE_COUNT, SOL_MIN_DIST);
  const edges = buildPlanarEdges(sol, rng);
  const pos = placePoints(rng, NODE_COUNT, SCRAMBLE_MIN_DIST); // 엉킨 시작 배치
  // sol = 겹침 0 해가 존재함을 보장하는 원본 평면 배치(검증·향후 힌트용, 렌더엔 미사용)
  return { pos, edges, sol };
}

/* ---------- Crossing evaluation ---------- */
// 현재 배치에서 겹치는 간선 인덱스 집합 + 교차쌍 수
function evalCrossings(pos, edges) {
  const bad = new Set();
  let pairs = 0;
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segsCross(pos[a], pos[b], pos[c], pos[d])) { bad.add(i); bad.add(j); pairs += 1; }
    }
  }
  return { bad, pairs };
}

/* ---------- Game state ---------- */
const state = {
  puzzle: null,
  seed: 0,
  daily: true,
  puzzleNo: 0,
  crossPairs: 0,
  badEdges: new Set(),
  moves: 0,
  dragIndex: -1,
  dragMoved: false,
  startedAt: 0,
  clockTimer: null,
  solved: false,
};

/* ---------- Config (validated) ---------- */
function todayNumber() {
  return Math.floor((Date.now() - EPOCH_UTC) / DAY_MS);
}
function readConfig() {
  const raw = new URLSearchParams(location.search).get("seed");
  const n = parseInt(raw, 10);
  if (Number.isFinite(n)) return { daily: false, seed: n >>> 0, puzzleNo: n >>> 0 };
  const day = todayNumber();
  return { daily: true, seed: (day * SEED_MIX) >>> 0, puzzleNo: day };
}

/* ---------- Pointer → canvas coords ---------- */
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (W / r.width),
    y: (e.clientY - r.top) * (H / r.height),
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- Render ---------- */
function render() {
  ctx.clearRect(0, 0, W, H);
  const { pos, edges } = state.puzzle;

  // edges — 겹치면 빨강, 아니면 초록
  ctx.lineCap = "round";
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i];
    const crossing = state.badEdges.has(i);
    ctx.strokeStyle = crossing ? "#f2637a" : "rgba(94,224,160,0.85)";
    ctx.lineWidth = crossing ? 3.2 : 2.6;
    ctx.beginPath();
    ctx.moveTo(pos[a].x, pos[a].y);
    ctx.lineTo(pos[b].x, pos[b].y);
    ctx.stroke();
  }

  // nodes
  for (let i = 0; i < pos.length; i++) {
    const dragging = i === state.dragIndex;
    ctx.beginPath();
    ctx.arc(pos[i].x, pos[i].y, NODE_R, 0, Math.PI * 2);
    ctx.fillStyle = dragging ? "#ffe08a" : "#ffd166";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#0a0c11";
    ctx.stroke();
  }
}

/* ---------- Round flow ---------- */
function recompute() {
  const r = evalCrossings(state.puzzle.pos, state.puzzle.edges);
  const prevPairs = state.crossPairs;
  state.badEdges = r.bad;
  state.crossPairs = r.pairs;
  el("crossings").textContent = String(r.pairs);
  el("crossings").style.color = r.pairs === 0 ? "var(--clear)" : "var(--cross)";
  if (r.pairs === 0 && !state.solved) win();
  else if (r.pairs < prevPairs) SFX.clear();
}

function startRound(cfg) {
  state.puzzle = generatePuzzle(cfg.seed);
  state.seed = cfg.seed;
  state.daily = cfg.daily;
  state.puzzleNo = cfg.puzzleNo;
  state.moves = 0;
  state.dragIndex = -1;
  state.solved = false;
  state.startedAt = 0;
  clearInterval(state.clockTimer);
  state.clockTimer = null;

  el("puzzleNo").textContent = cfg.daily ? "#" + cfg.puzzleNo : "연습";
  el("moves").textContent = "0";
  el("clock").textContent = "0:00";
  el("win").classList.add("hidden");
  recompute();
  render();
  syncUrl();
}

function clockText() {
  const s = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function startClockIfNeeded() {
  if (state.startedAt) return;
  state.startedAt = Date.now();
  state.clockTimer = setInterval(() => { el("clock").textContent = clockText(); }, 1000);
}

function win() {
  state.solved = true;
  clearInterval(state.clockTimer);
  SFX.win();
  const label = state.daily ? "매듭 #" + state.puzzleNo : "연습판 seed " + state.seed;
  el("winStats").textContent = `${label} · ${state.moves}수 · ${clockText()}`;
  el("win").classList.remove("hidden");
}

function syncUrl() {
  const q = state.daily ? "" : "?seed=" + state.seed;
  history.replaceState(null, "", location.pathname + q);
}

/* ---------- Share ---------- */
async function share() {
  const head = state.daily ? `🪢 TANGLE #${state.puzzleNo}` : `🪢 TANGLE 연습(seed ${state.seed})`;
  const text = `${head} — ${state.moves}수 · ${clockText()} 클리어!\n${location.origin}${location.pathname}${state.daily ? "" : "?seed=" + state.seed}`;
  try {
    await navigator.clipboard.writeText(text);
    toast("결과 복사됨! 친구에게 붙여넣어 대결 🔗");
  } catch {
    toast("복사 실패 — 주소를 직접 공유하세요");
  }
}

let toastTimer = null;
function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ---------- Input ---------- */
function nodeAt(p) {
  let best = -1, bestD = GRAB_R * GRAB_R;
  const pos = state.puzzle.pos;
  for (let i = 0; i < pos.length; i++) {
    const d = dist2(p, pos[i]);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

canvas.addEventListener("pointerdown", (e) => {
  if (state.solved) return;
  const p = toCanvas(e);
  const i = nodeAt(p);
  if (i < 0) return;
  state.dragIndex = i;
  state.dragMoved = false;
  SFX.grab();
  render();
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (state.dragIndex < 0) return;
  const p = toCanvas(e);
  state.puzzle.pos[state.dragIndex] = {
    x: clamp(p.x, NODE_R, W - NODE_R),
    y: clamp(p.y, NODE_R, H - NODE_R),
  };
  state.dragMoved = true;
  startClockIfNeeded();
  recompute();
  render();
});
function endDrag() {
  if (state.dragIndex < 0) return;
  if (state.dragMoved) {
    state.moves += 1;
    el("moves").textContent = String(state.moves);
    SFX.drop();
  }
  state.dragIndex = -1;
  render();
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

el("btnReset").addEventListener("click", () => startRound({ daily: state.daily, seed: state.seed, puzzleNo: state.puzzleNo }));
function practice() { startRound({ daily: false, seed: (Math.random() * UINT32) >>> 0, puzzleNo: 0 }); }
el("btnPractice").addEventListener("click", practice);
el("btnPractice2").addEventListener("click", practice);
el("btnShare").addEventListener("click", share);

const muteBtn = el("btnMute");
muteBtn.textContent = SFX.muted ? "🔇" : "🔊";
muteBtn.addEventListener("click", () => { muteBtn.textContent = SFX.toggle() ? "🔇" : "🔊"; });

/* ---------- Boot ---------- */
startRound(readConfig());
