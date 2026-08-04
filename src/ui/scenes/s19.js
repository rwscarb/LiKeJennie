// ─────────────────────────────────────────────────────────────────────────────
//  SCENE 19 — 3I/ATLAS
//
//  Third interstellar object. Discovered Jul 1 2025.
//  e = 6.14135  q = 1.36 AU  i = 175.12°  ω = 128.02°  v∞ = 58 km/s
//
//  Framework convergences:
//   · 3I designation  → 3 ∈ {3,6,9} complement set
//   · ω = 128.02°     → K = 128, the framework kernel constant
//   · i = 175.12°     → retrograde = complement direction
//   · e = 6.14        → 6 ∈ {3,6,9}
//   · v∞ = 58 km/s   → 5+8 = 13 (Fibonacci); 5,8 ∈ orbit {1,2,4,8,7,5}
// ─────────────────────────────────────────────────────────────────────────────
import * as d3 from 'd3';
import { R } from './shared.js';

// ── Palette (jennie21 standard) ───────────────────────────────────────────────
const CC  = '#00e5ff';   // complement / 3I trajectory
const CY  = '#ffe600';   // fibonacci / periapsis / K annotation
const CO  = '#ff9800';   // orbit / Mars
const CG  = '#00ff88';   // orbit green / discovery marker
const CP  = '#c060ff';   // purple / framework annotation
const DIM = '#1a2a2a';

// ── Orbital mechanics ─────────────────────────────────────────────────────────
const E          = 6.14135;
const Q_AU       = 1.36;
const L_AU       = Q_AU * (1 + E);          // semi-latus rectum ≈ 9.71 AU
const THETA_INF  = Math.acos(-1 / E);       // asymptote half-angle ≈ 1.734 rad

// ω = 128.02° in radians; retrograde orbit projected to ecliptic plane.
// Flip by π so the inbound leg enters from upper-right / Galactic Center direction.
const OMEGA     = (128.02 * Math.PI) / 180;
const PERI_ANG  = OMEGA + Math.PI;

function orbitXY(theta) {
  const r = L_AU / (1 + E * Math.cos(theta));
  const xo = r * Math.cos(theta);
  const yo = r * Math.sin(theta);
  const c = Math.cos(PERI_ANG), s = Math.sin(PERI_ANG);
  return [xo * c - (-yo) * s, xo * s + (-yo) * c];
}

// Build trajectory point array from -THETA_INF to +THETA_INF, clipped at 4 AU
function buildTraj(clip = 4.0, n = 1200) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const th = -THETA_INF + (2 * THETA_INF * i) / n;
    const [x, y] = orbitXY(th);
    if (Math.hypot(x, y) < clip) pts.push({ th, x, y });
  }
  return pts;
}

// ── Key events ────────────────────────────────────────────────────────────────
const EVENTS = [
  {
    theta: -THETA_INF * 0.85,
    label: 'Discovery',
    sub:   'Jul 1, 2025 · ATLAS-Chile (W68)',
    color: CG,
    r:     6,
  },
  {
    theta: (() => {
      // Find theta where r ≈ 0.194 AU from Mars orbit (1.524 AU) on inbound leg.
      // Approximate: theta where orbit is near 1.5 AU on inbound side.
      for (let t = -THETA_INF + 0.1; t < 0; t += 0.002) {
        const [x, y] = orbitXY(t);
        if (Math.hypot(x, y) < 1.65 && Math.hypot(x, y) > 1.45) return t;
      }
      return -0.5;
    })(),
    label: 'Mars flyby',
    sub:   'Oct 3, 2025 · 0.194 AU',
    color: CO,
    r:     5,
  },
  {
    theta: 0,
    label: 'Perihelion  ·  ω = 128.02° = K',
    sub:   'Oct 29, 2025 · 1.36 AU',
    color: CY,
    r:     7,
    highlight: true,
  },
];

// ── Scene entry ───────────────────────────────────────────────────────────────
export function buildS19() {
  const canvas    = R.canvas;
  const container = canvas.parentElement;   // .canvaswrap (position:relative)

  // disposeScene() guards on R.scene; set a sentinel so teardown fires on nav-away.
  R.scene = {};   // dummy — no Three.js in this scene

  // Full-cover SVG overlay
  const svg = d3.select(container)
    .append('svg')
    .attr('id', 's19-svg')
    .style('position', 'absolute')
    .style('inset', '0')
    .style('width', '100%')
    .style('height', '100%')
    .style('z-index', '6')
    .style('background', '#040810')
    .style('cursor', 'default');

  let W = container.clientWidth  || 960;
  let H = container.clientHeight || 480;
  svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

  // AU → pixel scale; center slightly left of middle to leave room for legend
  const AU  = Math.min(W, H) * 0.195;
  const CX  = W * 0.48;
  const CY  = H * 0.52;
  const scX = x => CX + x * AU;
  const scY = y => CY - y * AU;   // y-flip

  // ── Defs: glow filter ────────────────────────────────────────────────────
  const defs = svg.append('defs');

  function defGlow(id, stdDev) {
    const f = defs.append('filter').attr('id', id)
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    f.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', stdDev)
      .attr('result', 'blur');
    const merge = f.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');
  }

  defGlow('glow-traj', 6);
  defGlow('glow-sun',  14);
  defGlow('glow-peri', 8);

  // Radial gradient for sun
  const sunGrad = defs.append('radialGradient').attr('id', 'sun-grad');
  sunGrad.append('stop').attr('offset', '0%').attr('stop-color', '#fff8d0');
  sunGrad.append('stop').attr('offset', '40%').attr('stop-color', '#ffd060');
  sunGrad.append('stop').attr('offset', '100%').attr('stop-color', '#ff900000').attr('stop-opacity', 0);

  // ── Starfield ────────────────────────────────────────────────────────────
  const starSeed = d3.randomLcg(137);
  const starData = d3.range(320).map(() => ({
    x: starSeed() * W,
    y: starSeed() * H,
    r: starSeed() < 0.75 ? 0.6 : (starSeed() < 0.9 ? 1.1 : 1.6),
    a: 0.12 + starSeed() * 0.45,
  }));
  svg.append('g').attr('class', 'stars').selectAll('circle')
    .data(starData).join('circle')
    .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r)
    .attr('fill', 'white').attr('opacity', d => d.a);

  // ── Planet orbits ────────────────────────────────────────────────────────
  const PLANETS = [
    { r: 0.387, color: '#806030', alpha: 0.3, name: 'Mercury' },
    { r: 0.723, color: '#a09040', alpha: 0.3, name: 'Venus'   },
    { r: 1.000, color: '#3070c0', alpha: 0.5, name: 'Earth'   },
    { r: 1.524, color: '#c05030', alpha: 0.5, name: 'Mars'    },
  ];

  const arcGen = d3.line()
    .x(d => scX(d[0])).y(d => scY(d[1]))
    .curve(d3.curveLinearClosed);

  const orbitG = svg.append('g').attr('class', 'orbits');
  PLANETS.forEach(p => {
    const pts = d3.range(361).map(i => {
      const a = (i * Math.PI * 2) / 360;
      return [p.r * Math.cos(a), p.r * Math.sin(a)];
    });
    orbitG.append('path')
      .datum(pts).attr('d', arcGen)
      .attr('fill', 'none').attr('stroke', p.color)
      .attr('stroke-width', 1).attr('opacity', p.alpha)
      .attr('stroke-dasharray', p.r < 0.8 ? '3 4' : null);
  });

  // Planet dots — animated; initial angles ≈ ecliptic longitude Jul 1 2025.
  // Orbital periods (days): Mercury 88, Venus 225, Earth 365.25, Mars 687.
  // Animation ANIM_DURATION ms represents DAYS_SPAN real days.
  const DAYS_SPAN  = 185;   // Jul 1 → late Dec 2025 (3I's close-approach window)
  const PLANET_META = [
    { r: 0.387, period: 88,     ang0: 2.09,  size: 2.5, label: null     }, // Mercury
    { r: 0.723, period: 225,    ang0: 1.57,  size: 2.5, label: null     }, // Venus
    { r: 1.000, period: 365.25, ang0: 4.71,  size: 3.5, label: 'Earth'  }, // Earth (~280° Jul 1 2025)
    { r: 1.524, period: 687,    ang0: 2.97,  size: 3.5, label: 'Mars'   }, // Mars (~170° Jul 1 2025)
  ];
  const planetColors = ['#806030','#a09040','#3070c0','#c05030'];

  const planetDots = PLANET_META.map((p, i) => {
    const dot = svg.append('circle')
      .attr('r', p.size).attr('fill', planetColors[i]).attr('opacity', 0.9);
    // static label positioned at initial angle
    if (p.label) {
      const ix = scX(p.r * Math.cos(p.ang0)), iy = scY(p.r * Math.sin(p.ang0));
      svg.append('text').attr('x', ix + 6).attr('y', iy - 4)
        .attr('class', `planet-lbl-${i}`)
        .text(p.label).attr('fill', planetColors[i]).attr('font-size', 9)
        .attr('font-family', 'monospace').attr('opacity', 0.75);
    }
    return dot;
  });

  // ── 3I/ATLAS trajectory ──────────────────────────────────────────────────
  const traj    = buildTraj();
  const inbound = traj.filter(d => d.th <= 0);
  const outbound= traj.filter(d => d.th >= 0);

  const lineGen = d3.line().x(d => scX(d.x)).y(d => scY(d.y));

  const trajG = svg.append('g').attr('class', 'trajectory');

  // Soft glow pass (wide, dim)
  trajG.append('path').datum(traj).attr('d', lineGen)
    .attr('fill', 'none').attr('stroke', CC)
    .attr('stroke-width', 14).attr('opacity', 0.06)
    .attr('stroke-linecap', 'round').attr('filter', 'url(#glow-traj)');

  // Inbound: dashed approach
  trajG.append('path').datum(inbound).attr('d', lineGen)
    .attr('fill', 'none').attr('stroke', CC)
    .attr('stroke-width', 1.8).attr('opacity', 0.55)
    .attr('stroke-dasharray', '10 7').attr('stroke-linecap', 'round');

  // Outbound: solid
  trajG.append('path').datum(outbound).attr('d', lineGen)
    .attr('fill', 'none').attr('stroke', CC)
    .attr('stroke-width', 2.5).attr('opacity', 0.88)
    .attr('stroke-linecap', 'round').attr('filter', 'url(#glow-traj)');

  // Bright near-periapsis highlight
  const near = [...inbound.slice(-20), ...outbound.slice(0, 20)];
  trajG.append('path').datum(near).attr('d', lineGen)
    .attr('fill', 'none').attr('stroke', '#d0f4ff')
    .attr('stroke-width', 3).attr('opacity', 1.0)
    .attr('stroke-linecap', 'round');

  // Motion arrows
  function addArrow(pts, idx, color) {
    if (idx + 4 >= pts.length || idx < 0) return;
    const x0 = scX(pts[idx].x), y0 = scY(pts[idx].y);
    const x1 = scX(pts[idx+4].x), y1 = scY(pts[idx+4].y);
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const sz = 10;
    const tip = [x1, y1];
    const l = [x1 - sz*Math.cos(ang-0.4), y1 - sz*Math.sin(ang-0.4)];
    const r = [x1 - sz*Math.cos(ang+0.4), y1 - sz*Math.sin(ang+0.4)];
    trajG.append('polygon')
      .attr('points', `${tip[0]},${tip[1]} ${l[0]},${l[1]} ${r[0]},${r[1]}`)
      .attr('fill', color).attr('opacity', 0.8);
  }
  addArrow(inbound, 8, CC);
  addArrow(outbound, 12, '#a0d4f0');

  // ── Origin label (Sagittarius) — anchored below-left of entry point ────────
  if (inbound.length > 6) {
    // Use a point further along the inbound leg so the label falls away from
    // the top-right corner where the framework panel lives.
    const refIdx = Math.min(20, Math.floor(inbound.length * 0.15));
    const ox = scX(inbound[refIdx].x), oy = scY(inbound[refIdx].y);
    const lx = ox - 170, ly = oy + 14;   // place label below-left of entry
    svg.append('line').attr('x1', ox).attr('y1', oy)
      .attr('x2', lx + 160).attr('y2', ly - 4)
      .attr('stroke', '#303660').attr('stroke-width', 1);
    const og = svg.append('g');
    og.append('rect').attr('x', lx - 4).attr('y', ly - 4)
      .attr('width', 172).attr('height', 52).attr('rx', 3)
      .attr('fill', '#050a14').attr('stroke', '#1e2448').attr('stroke-width', 1);
    og.append('text').attr('x', lx + 4).attr('y', ly + 12)
      .text('from Galactic Center').attr('fill', '#6870b8').attr('font-size', 9).attr('font-family','monospace');
    og.append('text').attr('x', lx + 4).attr('y', ly + 26)
      .text('Sagittarius · 7–14 Gyr').attr('fill', '#505090').attr('font-size', 8.5).attr('font-family','monospace');
    og.append('text').attr('x', lx + 4).attr('y', ly + 39)
      .text('thick disk origin').attr('fill', '#404070').attr('font-size', 8).attr('font-family','monospace');
  }

  // ── Sun ──────────────────────────────────────────────────────────────────
  svg.append('circle').attr('cx', scX(0)).attr('cy', scY(0))
    .attr('r', AU * 0.16).attr('fill', 'url(#sun-grad)')
    .attr('filter', 'url(#glow-sun)');
  svg.append('circle').attr('cx', scX(0)).attr('cy', scY(0))
    .attr('r', 5).attr('fill', '#fff8d0');

  // ── Event markers + tooltips ─────────────────────────────────────────────
  const tooltip = d3.select(container).append('div')
    .attr('id', 's19-tip')
    .style('position', 'absolute')
    .style('pointer-events', 'none')
    .style('background', 'rgba(4,8,20,0.92)')
    .style('border', '1px solid rgba(255,255,255,0.12)')
    .style('border-radius', '4px')
    .style('padding', '8px 12px')
    .style('font-family', 'monospace')
    .style('font-size', '11px')
    .style('color', '#c0d4e8')
    .style('white-space', 'nowrap')
    .style('z-index', '20')
    .style('opacity', '0')
    .style('transition', 'opacity 0.15s');

  // Resolve event screen coords
  EVENTS.forEach(ev => {
    const [ex, ey] = orbitXY(ev.theta);
    const sx = scX(ex), sy = scY(ey);
    ev._sx = sx; ev._sy = sy;

    // Glow ring for highlight events
    if (ev.highlight) {
      svg.append('circle').attr('cx', sx).attr('cy', sy)
        .attr('r', ev.r + 5).attr('fill', 'none')
        .attr('stroke', ev.color).attr('stroke-width', 1).attr('opacity', 0.3)
        .attr('filter', 'url(#glow-peri)');
    }

    // Marker circle
    const marker = svg.append('circle')
      .attr('cx', sx).attr('cy', sy)
      .attr('r', ev.r)
      .attr('fill', 'none')
      .attr('stroke', ev.color)
      .attr('stroke-width', ev.highlight ? 2 : 1.5)
      .attr('opacity', 0.9)
      .style('cursor', 'pointer');

    svg.append('circle').attr('cx', sx).attr('cy', sy)
      .attr('r', 2.5).attr('fill', ev.color).attr('opacity', 0.9);

    // Inline label
    const lx = sx + ev.r + 8;
    const ly = sy - ev.r - 4;
    const lg = svg.append('g');
    lg.append('text').attr('x', lx).attr('y', ly)
      .text(ev.label)
      .attr('fill', ev.color).attr('font-size', ev.highlight ? 10.5 : 9.5)
      .attr('font-family', 'monospace').attr('font-weight', ev.highlight ? 'bold' : 'normal');
    lg.append('text').attr('x', lx).attr('y', ly + 13)
      .text(ev.sub)
      .attr('fill', ev.color).attr('font-size', 8.5).attr('font-family', 'monospace')
      .attr('opacity', 0.7);

    // Hover zone (larger hit area)
    svg.append('circle').attr('cx', sx).attr('cy', sy)
      .attr('r', ev.r + 10).attr('fill', 'transparent').style('cursor', 'pointer')
      .on('mouseenter', function(e) {
        marker.attr('stroke-width', (ev.highlight ? 3 : 2.5)).attr('opacity', 1);
        tooltip
          .style('opacity', '1')
          .style('left', (e.offsetX + 16) + 'px')
          .style('top',  (e.offsetY - 12) + 'px')
          .html(`<span style="color:${ev.color};font-weight:bold">${ev.label}</span><br>${ev.sub}`);
      })
      .on('mousemove', function(e) {
        tooltip.style('left', (e.offsetX + 16) + 'px').style('top', (e.offsetY - 12) + 'px');
      })
      .on('mouseleave', function() {
        marker.attr('stroke-width', ev.highlight ? 2 : 1.5).attr('opacity', 0.9);
        tooltip.style('opacity', '0');
      });
  });

  // ── Animated comet ───────────────────────────────────────────────────────
  let animId = null;
  const ANIM_DURATION = 9000;   // ms for one full traversal
  let startT = null;

  const cometDot = svg.append('circle')
    .attr('r', 4).attr('fill', '#d8f0ff').attr('opacity', 0.95)
    .attr('filter', 'url(#glow-traj)');

  // Comet tail (last 8 positions)
  const TAIL_LEN = 10;
  const tailPts  = [];
  const tailPath = svg.append('path')
    .attr('fill', 'none').attr('stroke', CC).attr('stroke-width', 2)
    .attr('stroke-linecap', 'round').attr('opacity', 0.5);

  const trajAll = buildTraj(4.0, 600);
  const trajN   = trajAll.length;

  function animStep(ts) {
    if (!startT) startT = ts;
    const elapsed = (ts - startT) % ANIM_DURATION;
    const pct     = elapsed / ANIM_DURATION;
    const idx     = Math.floor(pct * (trajN - 1));
    const pt      = trajAll[idx];
    if (!pt) { animId = requestAnimationFrame(animStep); return; }

    // Comet position
    const cx = scX(pt.x), cy = scY(pt.y);
    cometDot.attr('cx', cx).attr('cy', cy);

    tailPts.push([cx, cy]);
    if (tailPts.length > TAIL_LEN) tailPts.shift();
    if (tailPts.length > 1) tailPath.attr('d', d3.line()(tailPts));

    // Planets: pct fraction of DAYS_SPAN real days elapsed
    const days = pct * DAYS_SPAN;
    PLANET_META.forEach((p, i) => {
      const angVel = (2 * Math.PI) / p.period;   // rad/day
      const ang    = p.ang0 + angVel * days;
      const px = scX(p.r * Math.cos(ang)), py = scY(p.r * Math.sin(ang));
      planetDots[i].attr('cx', px).attr('cy', py);
      // Drift the label with its planet if it has one
      if (p.label) {
        svg.select(`.planet-lbl-${i}`)
          .attr('x', px + 6).attr('y', py - 4);
      }
    });

    animId = requestAnimationFrame(animStep);
  }
  animId = requestAnimationFrame(animStep);

  // ── Framework panel ──────────────────────────────────────────────────────
  const FW_X = W - 272, FW_Y = H - 168;
  const FW_W = 256, FW_H = 150;
  const fwG  = svg.append('g').attr('class', 'framework');
  fwG.append('rect').attr('x', FW_X).attr('y', FW_Y)
    .attr('width', FW_W).attr('height', FW_H).attr('rx', 4)
    .attr('fill', 'rgba(4,8,20,0.85)').attr('stroke', 'rgba(255,255,255,0.07)');

  fwG.append('text').attr('x', FW_X + 10).attr('y', FW_Y + 20)
    .text('FRAMEWORK').attr('fill', '#4060a0').attr('font-size', 9)
    .attr('font-family', 'monospace').attr('letter-spacing', '0.1em');

  const fwRows = [
    { key: '3I  ',       val: '3 ∈ {3,6,9}  complement', color: CP },
    { key: 'e = 6.14  ', val: '6 ∈ {3,6,9}',            color: CP },
    { key: 'i = 175°  ', val: 'retrograde = complement', color: '#8090b8' },
    { key: 'v∞ 58 km/s', val: '5+8=13 Fib · 5,8 ∈ orbit', color: '#8090b8' },
    { key: 'ω = 128.02°', val: 'K = 128 kernel constant', color: CY },
  ];
  fwRows.forEach((row, i) => {
    const ry = FW_Y + 38 + i * 22;
    fwG.append('text').attr('x', FW_X + 10).attr('y', ry)
      .text(row.key).attr('fill', row.color).attr('font-size', 9)
      .attr('font-family', 'monospace').attr('font-style', 'italic');
    fwG.append('text').attr('x', FW_X + 110).attr('y', ry)
      .text(row.val).attr('fill', '#9ab0c8').attr('font-size', 8.5)
      .attr('font-family', 'monospace');
  });

  // ── Scale bar ────────────────────────────────────────────────────────────
  const SB_X = 22, SB_Y = H - 28;
  svg.append('line').attr('x1', SB_X).attr('y1', SB_Y)
    .attr('x2', SB_X + AU).attr('y2', SB_Y)
    .attr('stroke', '#404040').attr('stroke-width', 1);
  svg.append('line').attr('x1', SB_X).attr('y1', SB_Y - 5)
    .attr('x2', SB_X).attr('y2', SB_Y + 5).attr('stroke', '#404040').attr('stroke-width', 1);
  svg.append('line').attr('x1', SB_X + AU).attr('y1', SB_Y - 5)
    .attr('x2', SB_X + AU).attr('y2', SB_Y + 5).attr('stroke', '#404040').attr('stroke-width', 1);
  svg.append('text').attr('x', SB_X + AU / 2).attr('y', SB_Y - 8)
    .text('1 AU').attr('text-anchor', 'middle')
    .attr('fill', '#404040').attr('font-size', 8.5).attr('font-family', 'monospace');

  // ── Retrograde indicator ─────────────────────────────────────────────────
  svg.append('text').attr('x', 14).attr('y', 20)
    .text('↻ retrograde  (i = 175.12°)')
    .attr('fill', '#2a6080').attr('font-size', 9).attr('font-family', 'monospace');

  // ── Overlay text ─────────────────────────────────────────────────────────
  R.ov.innerHTML =
    `<div style="color:#00e5ff;letter-spacing:.1em;font-weight:bold">19 · 3I/ATLAS</div>` +
    `<div style="color:#2a5a70;margin-top:3px;font-size:8px">third interstellar object</div>` +
    `<div style="color:#1a4050;font-size:7.5px;margin-top:1px">e = 6.141 · v∞ = 58 km/s</div>` +
    `<div style="color:#1a4050;font-size:7.5px">ω = 128.02° = K</div>`;

  // ── Resize observer ──────────────────────────────────────────────────────
  const ro = new ResizeObserver(() => {
    const nW = container.clientWidth, nH = container.clientHeight;
    svg.attr('viewBox', `0 0 ${nW} ${nH}`);
  });
  ro.observe(container);

  // ── Teardown ─────────────────────────────────────────────────────────────
  R.teardown = () => {
    cancelAnimationFrame(animId);
    ro.disconnect();
    svg.remove();
    tooltip.remove();
    tailPts.length = 0;
  };
}
