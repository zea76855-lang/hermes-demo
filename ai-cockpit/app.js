/* AI 市场运营驾驶舱 · 应用逻辑 v2（原生 JS，无外部依赖） */
(function () {
  'use strict';
  var D = window.DASHBOARD_DATA;
  var M = D.metrics, S = D.scenes, AL = D.alerts, AD = D.advices;
  var BY_ID = {}; M.forEach(function (m) { BY_ID[m.id] = m; });

  /* ───────── 1. 基础工具 ───────── */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rnd(seed) { return mulberry32(hash(String(seed)))(); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function goSel(sel) {
    var el = document.querySelector(sel);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function abbr(v) {
    var a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (a >= 1e4) return (v / 1e4).toFixed(1) + '万';
    if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
    if (a >= 100) return String(Math.round(v));
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(a >= 1 ? 1 : 2);
  }
  function fmtVal(m, v) {
    if (m.kind === 'pct' || m.kind === 'share') return v.toFixed(1) + '%';
    if (m.kind === 'ratio') return v.toFixed(2) + 'x';
    if (m.kind === 'dur') return v.toFixed(1) + (m.unit || '');
    if (m.kind === 'score') return v.toFixed(1) + (m.unit || '');
    if (m.unit === '¥') return '¥' + abbr(v);
    return abbr(v) + (m.unit || '');
  }
  function fmtDelta(d) { return (d >= 0 ? '+' : '') + d.toFixed(1) + '%'; }

  /* ───────── 2. 状态 ───────── */
  var STATE = {
    period: 'day', platform: 'all', tabA: 'overview',
    trendGroup: 0, funnelKey: 'cloudFull', funnelLevel: 'L1',
    profileKey: 'region', alertFilter: 'all', adviceFilter: 'all',
    prioFilter: 'all', search: '', sceneId: null, salt: 0,
    chSort: { k: 'sessions', dir: -1 }
  };
  var PDAYS = { day: 1, week: 7, month: 30 };
  var FDAYS = { '日': 1, '周': 7, '月': 30 };
  var PN = { day: '日', week: '周', month: '月' };

  var C = {
    pri: '#2f5fe0', pri2: '#6c8cf5', purple: '#7352ff', teal: '#0e9bb5',
    amber: '#d97706', red: '#d92d20', green: '#059669', gray: '#93a1b5'
  };

  /* ───────── 3. 数值引擎 ───────── */
  function mval(m, period) {
    var k = m.id + '|' + period + '|' + STATE.salt;
    var scale = m.scale ? PDAYS[period] / FDAYS[m.freq] : 1;
    var jit = 1 + (rnd(k) - 0.5) * 0.05;
    var v = m.base * scale * jit;
    var d = m.drift + (rnd(k + 'd') - 0.5) * 1.6;
    return { v: v, prev: v / (1 + d / 100), delta: d };
  }
  function statusOf(m, delta) {
    var bad = m.higherBetter ? delta < 0 : delta > 0;
    var a = Math.abs(delta);
    if (!bad) return 'ok';
    if (a >= m.alert) return 'alert';
    if (a >= m.watch) return 'watch';
    return 'ok';
  }
  function evalM(m) {
    var r = mval(m, STATE.period);
    r.st = statusOf(m, r.delta);
    r.m = m;
    return r;
  }
  function pass(m) { return STATE.platform === 'all' || m.platform === STATE.platform; }
  function visibleMetrics() { return M.filter(pass); }

  function genSeries(m, n) {
    var cur = mval(m, STATE.period), out = [], i, k;
    var r = rnd(m.id + 's' + STATE.period + STATE.salt);
    for (i = 0; i < n; i++) {
      k = n - 1 - i;
      var base = cur.v / Math.pow(1 + cur.delta / 100, k / (n - 1));
      var seas = 1 + Math.sin((i / 7) * Math.PI * 2 + r * 6.28) * 0.035;
      var noise = 1 + (rnd(m.id + i + STATE.period + STATE.salt) - 0.5) * 0.045;
      out.push(base * seas * noise);
    }
    return out;
  }
  function periodLabels(n) {
    var out = [], d = new Date(2026, 8, 8), i, t;
    for (i = n - 1; i >= 0; i--) {
      t = new Date(d.getTime() - i * PDAYS[STATE.period] * 864e5);
      out.push(STATE.period === 'month'
        ? (t.getMonth() + 1) + '月'
        : (t.getMonth() + 1) + '/' + t.getDate());
    }
    return out;
  }

  /* ───────── 4. 图表（原生 SVG） ───────── */
  function W(el) { return Math.max(320, (el.clientWidth || 640)); }

  function tipFor(el) {
    var t = el.querySelector('.tt');
    if (!t) { t = document.createElement('div'); t.className = 'tt'; el.appendChild(t); }
    return t;
  }
  function bindTip(el, hit, fn) {
    var t = tipFor(el.closest('.chart') || el);
    hit.addEventListener('mousemove', function (e) {
      var b = hit.getBoundingClientRect(), x = e.clientX - b.left;
      var o = fn(x, b);
      if (!o) { t.classList.remove('on'); return; }
      t.innerHTML = o.html;
      t.classList.add('on');
      var pb = t.parentNode.getBoundingClientRect();
      t.style.left = clamp(o.x - 60, 0, pb.width - t.offsetWidth - 4) + 'px';
      t.style.top = Math.max(0, o.y - t.offsetHeight - 12) + 'px';
    });
    hit.addEventListener('mouseleave', function () { t.classList.remove('on'); });
  }

  function sparkline(vals, up, w, h) {
    w = w || 120; h = h || 34;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rg = mx - mn || 1;
    var pts = vals.map(function (v, i) {
      return [i / (vals.length - 1) * w, h - 3 - (v - mn) / rg * (h - 8)];
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var c = up ? C.green : C.red;
    var id = 'g' + Math.random().toString(36).slice(2, 8);
    return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + c + '" stop-opacity=".18"/><stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + d + ' L ' + w + ' ' + h + ' L 0 ' + h + ' Z" fill="url(#' + id + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  function lineChart(el, series, labels) {
    var w = W(el), h = 252, pl = 58, pr = 14, pt = 14, pb = 26;
    var all = []; series.forEach(function (s) { all = all.concat(s.data); });
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    var pad = (mx - mn) * 0.16 || 1; mn -= pad; mx += pad;
    if (mn > 0 && mn < (mx - mn) * 0.5) mn = 0;
    var iw = w - pl - pr, ih = h - pt - pb, n = labels.length;
    var X = function (i) { return pl + (n === 1 ? iw / 2 : i / (n - 1) * iw); };
    var Y = function (v) { return pt + ih - (v - mn) / (mx - mn) * ih; };
    var g = '', i;
    for (i = 0; i <= 4; i++) {
      var yv = mn + (mx - mn) * i / 4, y = Y(yv);
      g += '<line x1="' + pl + '" y1="' + y.toFixed(1) + '" x2="' + (w - pr) + '" y2="' + y.toFixed(1) + '" stroke="#eef1f7" stroke-width="1"/>' +
        '<text x="' + (pl - 8) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="10" fill="#93a1b5" text-anchor="end">' + abbr(yv) + '</text>';
    }
    var xl = '', step = Math.ceil(n / 8);
    for (i = 0; i < n; i += step) {
      xl += '<text x="' + X(i).toFixed(1) + '" y="' + (h - 8) + '" font-size="10" fill="#93a1b5" text-anchor="middle">' + labels[i] + '</text>';
    }
    var paths = '';
    series.forEach(function (s) {
      var d = s.data.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
      paths += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
      paths += '<circle cx="' + X(n - 1).toFixed(1) + '" cy="' + Y(s.data[n - 1]).toFixed(1) + '" r="3.2" fill="#fff" stroke="' + s.color + '" stroke-width="2"/>';
    });
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '">' + g + xl + paths +
      '<line id="cx" x1="0" y1="' + pt + '" x2="0" y2="' + (pt + ih) + '" stroke="' + C.pri + '" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>' +
      '<rect id="hit" x="' + pl + '" y="' + pt + '" width="' + iw + '" height="' + ih + '" fill="transparent"/></svg>';
    var svg = el.querySelector('svg'), cx = svg.querySelector('#cx'), hit = svg.querySelector('#hit');
    var dots = series.map(function (s) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '3.6'); c.setAttribute('fill', s.color);
      c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', '2'); c.setAttribute('opacity', '0');
      svg.appendChild(c); return c;
    });
    bindTip(el, hit, function (x) {
      var idx = clamp(Math.round((x - pl) / iw * (n - 1)), 0, n - 1);
      var px = X(idx); cx.setAttribute('x1', px); cx.setAttribute('x2', px); cx.setAttribute('opacity', '.5');
      var html = '<div class="k">' + labels[idx] + '</div>';
      series.forEach(function (s, si) {
        dots[si].setAttribute('opacity', '1');
        dots[si].setAttribute('cx', px); dots[si].setAttribute('cy', Y(s.data[idx]));
        html += '<div><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:' + s.color + ';margin-right:5px"></span>' + s.name + ' <b>' + s.fmt(s.data[idx]) + '</b></div>';
      });
      var top = Math.min.apply(null, series.map(function (s) { return Y(s.data[idx]); }));
      return { html: html, x: px, y: top };
    });
  }

  function donut(el, items, centerLabel) {
    var w = W(el), h = 214, cx = w / 2, cy = h / 2 + 2, r = Math.min(w, h) / 2 - 24, ir = r * 0.63;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var a0 = -Math.PI / 2, out = '';
    items.forEach(function (it) {
      var a1 = a0 + it.value / total * Math.PI * 2, big = (a1 - a0) > Math.PI ? 1 : 0;
      if (a1 - a0 >= 6.282) {
        out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((r + ir) / 2) + '" fill="none" stroke="' + it.color + '" stroke-width="' + (r - ir) + '"/>';
      } else {
        var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        var xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
        var xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0);
        out += '<path d="M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1) +
          ' L' + xi1.toFixed(1) + ' ' + yi1.toFixed(1) + ' A' + ir + ' ' + ir + ' 0 ' + big + ' 0 ' + xi0.toFixed(1) + ' ' + yi0.toFixed(1) + ' Z" fill="' + it.color + '"/>';
      }
      a0 = a1;
    });
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '">' + out +
      '<text x="' + cx + '" y="' + (cy - 3) + '" font-size="19" font-weight="750" fill="#101a30" text-anchor="middle">' + abbr(total) + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 15) + '" font-size="10.5" fill="#93a1b5" text-anchor="middle">' + esc(centerLabel || '') + '</text></svg>';
  }

  function xyChart(el, labels, series) {
    var w = W(el), h = 236, pl = 48, pr = 46, pt = 16, pb = 30;
    var iw = w - pl - pr, ih = h - pt - pb, n = labels.length;
    function range(axis) {
      var a = []; series.forEach(function (s) { if ((s.axis || 'l') === axis) a = a.concat(s.data); });
      var mn = Math.min.apply(null, a), mx = Math.max.apply(null, a);
      if (mn > 0) mn = 0;
      return [mn, mx * 1.12 || 1];
    }
    var RL = range('l'), RR = range('r');
    var Yl = function (v) { return pt + ih - (v - RL[0]) / (RL[1] - RL[0] || 1) * ih; };
    var Yr = function (v) { return pt + ih - (v - RR[0]) / (RR[1] - RR[0] || 1) * ih; };
    var step = iw / n, bw = Math.min(26, step * 0.44);
    var g = '', i;
    for (i = 0; i <= 4; i++) {
      var y = pt + ih - ih * i / 4;
      g += '<line x1="' + pl + '" y1="' + y.toFixed(1) + '" x2="' + (w - pr) + '" y2="' + y.toFixed(1) + '" stroke="#eef1f7"/>' +
        '<text x="' + (pl - 7) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="10" fill="#93a1b5" text-anchor="end">' + abbr(RL[0] + (RL[1] - RL[0]) * i / 4) + '</text>';
      if (series.some(function (s) { return s.axis === 'r'; }))
        g += '<text x="' + (w - pr + 7) + '" y="' + (y + 3.5).toFixed(1) + '" font-size="10" fill="' + C.amber + '" text-anchor="start">' + abbr(RR[0] + (RR[1] - RR[0]) * i / 4) + '</text>';
    }
    var body = '', xl = '';
    labels.forEach(function (lb, i) {
      var cx = pl + step * i + step / 2;
      series.forEach(function (s) {
        if (s.type === 'line') return;
        var y = (s.axis === 'r' ? Yr : Yl)(s.data[i]);
        body += '<rect x="' + (cx - bw * 0.55).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, (pt + ih - y)).toFixed(1) + '" rx="3" fill="' + s.color + '" opacity=".88"/>';
      });
      xl += '<text x="' + cx.toFixed(1) + '" y="' + (h - 10) + '" font-size="9.5" fill="#93a1b5" text-anchor="middle">' + esc(lb) + '</text>';
    });
    series.forEach(function (s) {
      if (s.type !== 'line') return;
      var d = s.data.map(function (v, i) { return (i ? 'L' : 'M') + (pl + step * i + step / 2).toFixed(1) + ' ' + (s.axis === 'r' ? Yr : Yl)(v).toFixed(1); }).join(' ');
      body += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round"/>';
      s.data.forEach(function (v, i) {
        body += '<circle cx="' + (pl + step * i + step / 2).toFixed(1) + '" cy="' + (s.axis === 'r' ? Yr : Yl)(v).toFixed(1) + '" r="3.2" fill="#fff" stroke="' + s.color + '" stroke-width="2"/>';
      });
    });
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '">' + g + body + xl + '</svg>';
  }

  function hBars(el, items) {
    var w = W(el), h = Math.max(150, items.length * 32 + 10), pl = 88, pr = 66;
    var mx = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); })) || 1;
    var rowH = h / items.length, bh = Math.min(20, rowH * 0.55), out = '';
    items.forEach(function (it, i) {
      var y = i * rowH + rowH / 2;
      var bw = Math.abs(it.value) / mx * (w - pl - pr);
      out += '<text x="' + (pl - 8) + '" y="' + (y + 4) + '" font-size="11" fill="#5b6b85" text-anchor="end">' + esc(it.label) + '</text>' +
        '<rect x="' + pl + '" y="' + (y - bh / 2) + '" width="' + (w - pl - pr) + '" height="' + bh + '" rx="5" fill="#f0f3f8"/>' +
        '<rect x="' + pl + '" y="' + (y - bh / 2) + '" width="' + Math.max(3, bw).toFixed(1) + '" height="' + bh + '" rx="5" fill="' + it.color + '"/>' +
        '<text x="' + (w - pr + 8) + '" y="' + (y + 4) + '" font-size="11" font-weight="700" fill="#101a30">' + it.text + '</text>';
    });
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '">' + out + '</svg>';
  }

  function ring(pct, color, size) {
    size = size || 44;
    var r = size / 2 - 4, c = 2 * Math.PI * r, off = c * (1 - clamp(pct, 0, 100) / 100);
    return '<svg class="sc-ring" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#eef1f7" stroke-width="4"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="' + size / 2 + '" y="' + (size / 2 + 4) + '" font-size="' + (size > 60 ? 20 : 12) + '" font-weight="800" fill="' + color + '" text-anchor="middle">' + Math.round(pct) + '</text></svg>';
  }

  /* ───────── 5. 场景 ↔ 指标 ───────── */
  function sceneMetrics(sc) {
    var ids = [], parts = String(sc.metricRange || '').split(/[、,]/);
    parts.forEach(function (p) {
      p = p.trim(); if (!p) return;
      var mm = p.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (mm) { for (var i = +mm[1]; i <= +mm[2]; i++) ids.push(i); }
      else if (/^\d+$/.test(p)) ids.push(+p);
    });
    return ids.map(function (i) { return BY_ID['m' + String(i).padStart(3, '0')]; }).filter(Boolean).filter(pass);
  }
  function sceneStat(sc) {
    var ms = sceneMetrics(sc), a = 0, w = 0, o = 0;
    ms.forEach(function (m) { var s = statusOf(m, mval(m, STATE.period).delta); (s === 'alert' ? a++ : s === 'watch' ? w++ : o++); });
    var E = a + w * 0.4;
    var health = clamp(Math.round(100 - E * 8), 25, 100);
    return { n: ms.length, a: a, w: w, o: o, E: E, health: health, lv: (E >= 5 ? 'alert' : E >= 1.5 ? 'watch' : 'ok'), ms: ms };
  }

  /* ───────── 6. 全局扫描结果 ───────── */
  function scan() {
    var all = visibleMetrics(), a = 0, w = 0, worst = null, best = null;
    all.forEach(function (m) {
      if (m.rule) return;
      var r = mval(m, STATE.period), st = statusOf(m, r.delta);
      var impact = Math.abs(r.delta) * (m.prio === 'P0 核心' ? 1.6 : m.prio === 'P1 诊断' ? 1 : .6) * (m.scale ? 1 : .8);
      if (st === 'alert') { a++; if (!worst || impact > worst.i) worst = { m: m, d: r.delta, i: impact }; }
      else if (st === 'watch') w++;
      if (r.delta > 0 && m.higherBetter && m.prio.indexOf('P0') === 0 && (!best || impact > best.i)) best = { m: m, d: r.delta, i: impact };
    });
    // 健康分 = 异常密度映射（预警权重 1.65×，关注 0.62×）
    var den = Math.max(1, all.length);
    var health = clamp(Math.round(100 - (a / den) * 165 - (w / den) * 62), 30, 100);
    return { n: all.length, a: a, w: w, worst: worst, best: best, health: health };
  }

  /* ───────── 7. HERO ───────── */
  function renderHero(res) {
    var h = res.health;
    var col = h >= 85 ? C.green : h >= 65 ? C.amber : C.red;
    $('#heroRing').innerHTML = ring(h, col, 84);

    var head;
    if (res.a === 0 && res.w === 0) head = '整体运行健康，未监测到异常波动';
    else if (res.a >= 3) head = '监测到 <span class="r">' + res.a + ' 项预警</span>，' + (res.worst ? esc(res.worst.m.name) : '') + ' 为首要风险';
    else if (res.a > 0) head = '存在 <span class="r">' + res.a + ' 项预警</span>与 ' + res.w + ' 项关注，需优先处置';
    else head = '整体平稳，有 ' + res.w + ' 项指标需持续关注';

    var sub = 'AI 已扫描 <b>' + res.n + '</b> 项指标 / <b>' + S.length + '</b> 个监控场景。';
    if (res.worst) sub += '最显著异常：<b>' + esc(res.worst.m.name) + '</b> <span class="r">' + fmtDelta(res.worst.d) + '</span>（' + esc(res.worst.m.scene) + '）；';
    if (res.best) sub += '最大机会：<b>' + esc(res.best.m.name) + '</b> <span class="g">' + fmtDelta(res.best.d) + '</span>；';
    sub += '已生成 <b>' + AD.length + '</b> 条智能建议，其中 <b>' + AD.filter(function (x) { return x.rank === 'P0'; }).length + '</b> 条 P0 需本周内处理。';

    $('#heroHead').innerHTML = head;
    $('#heroSub').innerHTML = sub;
    $('#heroStats').innerHTML =
      '<div class="hs red click" data-hs="alert" title="点击查看预警明细"><b>' + res.a + '</b><span>预警</span></div>' +
      '<div class="hs amber click" data-hs="watch" title="点击查看关注明细"><b>' + res.w + '</b><span>关注</span></div>' +
      '<div class="hs pri click" data-hs="p0" title="点击查看 P0 建议明细"><b>' + AD.filter(function (x) { return x.rank === 'P0'; }).length + '</b><span>P0 建议</span></div>';
    $('#heroTime').textContent = PN[STATE.period] + '周期 · ' + new Date().toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  /* ───────── 8. Zone 01 ───────── */
  var KPI_IDS = [1, 58, 97, 46, 19, 76];
  var TREND_GROUPS = [
    { name: '流量基盘', ids: [1, 4, 6, 8] },
    { name: '转化效率', ids: [58, 46, 64, 73] },
    { name: '经营与成本', ids: [97, 96, 21] },
    { name: '留存与活跃', ids: [76, 78, 81] }
  ];
  var TCOLORS = [C.pri, C.purple, C.teal, C.amber];
  var PCOLORS = [C.pri, C.purple, C.teal, C.green, C.amber, C.red];

  function renderKPI() {
    $('#kpiGrid').innerHTML = KPI_IDS.map(function (id) {
      var m = BY_ID['m' + String(id).padStart(3, '0')], r = evalM(m);
      var good = m.higherBetter ? r.delta >= 0 : r.delta < 0;
      var cls = r.st === 'ok' ? (Math.abs(r.delta) < 2 ? 'flat' : (good ? 'up-good' : 'down-good')) : (good ? 'up-good' : 'down-bad');
      // 目标值需与当前值同周期口径：可累加型指标按频率缩放
      var goal = '';
      if (m.target) {
        var tg = m.target * (m.scale ? PDAYS[STATE.period] / FDAYS[m.freq] : 1);
        var p = clamp((m.higherBetter ? r.v / tg : tg / Math.max(r.v, 0.01)) * 100, 0, 999);
        var gc = p >= 95 ? 'var(--green)' : p >= 85 ? 'var(--amber)' : 'var(--red)';
        goal = '<div class="kpi-goal">目标 ' + fmtVal(m, tg) + ' · 达成 <b style="color:' + gc + '">' + p.toFixed(0) + '%</b></div>';
      }
      return '<div class="kpi st-' + r.st + '" data-mid="' + m.id + '">' +
        '<div class="kpi-name" title="' + esc(m.name) + '">' + esc(m.name) + '</div>' +
        '<div class="kpi-val">' + fmtVal(m, r.v) + '</div>' +
        '<div class="kpi-meta"><span class="delta ' + cls + '">' + fmtDelta(r.delta) + '</span>' +
        '<span class="pill ' + (r.st === 'alert' ? 'alert' : r.st === 'watch' ? 'watch' : 'ok') + '">' +
        (r.st === 'alert' ? '预警' : r.st === 'watch' ? '关注' : '正常') + '</span>' +
        '<span class="kpi-goal">' + PN[STATE.period] + '环比</span></div>' +
        '<div class="kpi-spark">' + sparkline(genSeries(m, 24), good) + '</div>' + goal + '</div>';
    }).join('');
  }

  function renderTrend() {
    var seg = $('#trendSeg');
    if (!seg.dataset.init) {
      seg.innerHTML = TREND_GROUPS.map(function (g, i) {
        return '<button data-i="' + i + '" class="' + (i === 0 ? 'on' : '') + '">' + g.name + '</button>';
      }).join(''); seg.dataset.init = '1';
    }
    var g = TREND_GROUPS[STATE.trendGroup], n = 30, labels = periodLabels(n);
    var series = g.ids.map(function (id, i) {
      var m = BY_ID['m' + String(id).padStart(3, '0')];
      return { name: m.name, color: TCOLORS[i % 4], data: genSeries(m, n), fmt: function (v) { return fmtVal(m, v); } };
    });
    lineChart($('#trendChart'), series, labels);
    $('#trendLegend').innerHTML = series.map(function (s) {
      return '<span class="lg"><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>';
    }).join('');
  }

  /* ───────── 9. Zone 02 · 监控 ───────── */
  function renderMonitor(res) {
    var stats = S.map(function (s) { return { s: s, st: sceneStat(s) }; });
    var active = stats.filter(function (x) { return x.s.phase === '一期'; });
    var phase2 = stats.filter(function (x) { return x.s.phase !== '一期'; });
    var ta = 0, tw = 0, tm = 0;
    stats.forEach(function (x) { ta += x.st.a; tw += x.st.w; tm += x.st.n; });
    var now = new Date().toLocaleTimeString('zh-CN', { hour12: false });

    $('#mbActive').textContent = active.length + ' 个场景在线巡检';
    $('#engineMeta').textContent = active.length + ' 场景 / ' + tm + ' 指标 · 异常 ' + (ta + tw) + ' 项 · 最近扫描 ' + now;
    $('#zoneBStat').innerHTML = '<span class="zs">在线场景<b>' + active.length + '</b></span>' +
      '<span class="zs red">预警<b>' + ta + '</b></span>' +
      '<span class="zs amber">关注<b>' + tw + '</b></span>' +
      '<span class="zs">二期<b>' + phase2.length + '</b></span>';

    // 场景健康度 · 紧凑行列表（按健康分升序 = 问题优先）
    var rows = active.slice().sort(function (x, y) { return x.st.health - y.st.health; });
    $('#sceneList').innerHTML = rows.map(function (x) {
      var s = x.s, st = x.st;
      var c = st.lv === 'alert' ? C.red : st.lv === 'watch' ? C.amber : C.green;
      return '<div class="sc' + (STATE.sceneId === s.id ? ' sel' : '') + '" data-id="' + s.id + '">' +
        '<div class="sc-t"><b>' + esc(s.name) + '</b><span>' + esc(s.platform) + ' · ' + esc(s.interval) + '</span></div>' +
        '<div class="sc-r"><span class="sc-bar"><i style="width:' + st.health + '%;background:' + c + '"></i></span>' +
        '<span class="sc-n" style="color:' + c + '">' + st.health + '</span></div></div>';
    }).join('');

    $('#phase2Row').innerHTML = phase2.map(function (x) {
      return '<span class="p2-chip' + (STATE.sceneId === x.s.id ? ' sel' : '') + '" data-id="' + x.s.id + '" title="' + esc(x.s.question) + '">' +
        esc(x.s.name) + '</span>';
    }).join('');
  }

  var LVT = { alert: ['预警', C.red], watch: ['关注', C.amber], info: ['机会', C.green] };
  function renderAlerts() {
    var seg = $('#alertSeg');
    if (!seg.dataset.init) {
      seg.innerHTML = [['all', '全部'], ['alert', '预警'], ['watch', '关注'], ['info', '机会']].map(function (x) {
        return '<button data-k="' + x[0] + '" class="' + (x[0] === 'all' ? 'on' : '') + '">' + x[1] + '</button>';
      }).join(''); seg.dataset.init = '1';
    }
    var f = STATE.alertFilter;
    var rows = AL.filter(function (a) { return f === 'all' || a.level === f; });
    if (!rows.length) {
      $('#alertStream').innerHTML = '<div style="padding:34px;text-align:center;color:var(--tx3);font-size:12px">该分类下暂无异常</div>';
      return;
    }
    $('#alertStream').innerHTML = rows.map(function (a, i) {
      var lv = LVT[a.level] || LVT.watch;
      return '<div class="al lv-' + a.level + (i < 2 ? ' open' : '') + '" data-ai="' + i + '"><i></i><div class="al-b">' +
        '<div class="al-t"><b>' + esc(a.metric) + '</b>' +
        '<span class="pill ' + a.level + '">' + lv[0] + '</span>' +
        '<span class="chip ' + (a.dev < 0 ? 'r' : 'g') + '">偏离 ' + fmtDelta(a.dev) + '</span>' +
        '<span class="al-arw">›</span>' +
        '<span class="al-tm">' + a.ago + ' 分钟前</span></div>' +
        '<div class="al-msg">' + esc(a.msg) + '</div>' +
        '<div class="al-meta"><span class="chip b">' + esc(a.scene) + '</span>' +
        '<span class="chip">阈值 ' + esc(a.thresh) + '</span>' +
        '<span class="chip">下钻 ' + esc(a.drill) + '</span>' +
        '<span class="chip">' + esc(a.owner) + '</span></div>' +
        '<div class="al-act"><b>AI 建议动作 · </b>' + esc(a.action) + '</div>' +
        '</div></div>';
    }).join('');
  }

  function renderSceneDetail() {
    var sc = S.filter(function (s) { return s.id === STATE.sceneId; })[0] || S[0];
    STATE.sceneId = sc.id;
    var st = sceneStat(sc);
    $('#sceneDetailTitle').textContent = sc.name;
    $('#sceneDetailHint').textContent = sc.platform + ' · ' + sc.phase + ' · 指标 ' + (sc.metricRange || '—') + ' · 健康度 ' + st.health;
    var h = '<div class="sd-q"><b>核心问题 · </b>' + esc(sc.question) + '</div>' +
      '<div class="sd-sec"><h5>监控链路</h5><div class="sd-chain">' +
      esc(sc.chain).split(/→|->/).map(function (n) { return '<span class="n">' + esc(n.trim()) + '</span>'; }).join('<span class="a">→</span>') +
      '</div></div>' +
      '<div class="sd-sec"><h5>核心指标 / 异常阈值 / 下钻逻辑</h5><div class="sd-kv">' +
      '<span class="k">核心指标</span><span class="v">' + esc(sc.coreMetrics) + '</span>' +
      '<span class="k">异常阈值</span><span class="v" style="color:var(--red)">' + esc(sc.threshold) + '</span>' +
      '<span class="k">下钻逻辑</span><span class="v">' + esc(sc.drillLogic || '—') + '</span>' +
      (sc.funnel ? '<span class="k">关联漏斗</span><span class="v"><a href="#" data-goto="funnel:' + sc.funnel + '" style="color:var(--pri)">在下钻区查看 ' + esc(D.funnels[sc.funnel].name) + ' →</a></span>' : '') +
      '</div></div>' +
      '<div class="sd-sec"><h5>关联指标实时状态（' + st.n + ' 项）</h5><div class="sd-metrics">' +
      st.ms.slice(0, 40).map(function (m) {
        var r = mval(m, STATE.period), stt = statusOf(m, r.delta);
        var good = m.higherBetter ? r.delta >= 0 : r.delta < 0;
        var c = stt === 'alert' ? C.red : stt === 'watch' ? C.amber : (good ? C.green : C.gray);
        return '<div class="sd-m" data-mid="' + m.id + '"><span class="n" title="' + esc(m.name) + '">' + esc(m.name) + '</span>' +
          '<span class="v">' + fmtVal(m, r.v) + '</span>' +
          '<span class="d" style="color:' + c + '">' + fmtDelta(r.delta) + '</span></div>';
      }).join('') + '</div></div>';
    $('#sceneDetail').innerHTML = h;
  }

  /* ───────── 10. Zone 03 · 建议 ───────── */
  function renderAdvice() {
    var seg = $('#advSeg');
    if (!seg.dataset.init) {
      seg.innerHTML = [['all', '全部'], ['P0', 'P0'], ['P1', 'P1'], ['P2', 'P2']].map(function (x) {
        return '<button data-k="' + x[0] + '" class="' + (x[0] === 'all' ? 'on' : '') + '">' + x[1] + '</button>';
      }).join(''); seg.dataset.init = '1';
    }
    var f = STATE.adviceFilter;
    var rows = AD.filter(function (a) { return f === 'all' || a.rank === f; });
    if (!rows.length) {
      $('#adviceList').innerHTML = '<div style="padding:34px;text-align:center;color:var(--tx3);font-size:12px">该优先级下暂无建议</div>';
    } else {
      $('#adviceList').innerHTML = rows.map(function (a, i) {
        return '<div class="adv rank-' + a.rank + (i === 0 ? ' open' : '') + '" data-advid="' + i + '">' +
          '<div class="adv-h"><span class="adv-rk">' + a.rank + '</span>' +
          '<span class="adv-tt">' + esc(a.title) + '</span><span class="adv-ar">›</span></div>' +
          '<div class="adv-sub"><span class="chip b">' + esc(a.scene) + '</span>' +
          '<span class="chip">负责人 ' + esc(a.owner) + '</span>' +
          '<span class="chip">' + esc(a.eta) + '内</span>' +
          '<span class="chip">下钻 ' + esc(a.drill) + '</span></div>' +
          '<div class="adv-body">' +
          '<div class="adv-sec"><h6>问题摘要</h6><p>' + esc(a.summary) + '</p></div>' +
          '<div class="adv-sec"><h6>AI 归因分析</h6><ul>' + a.cause.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="adv-sec"><h6>建议动作</h6><ul>' + a.actions.map(function (c, k) { return '<li><b>' + (k + 1) + '.</b> ' + esc(c) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="adv-imp"><b>预期影响 · </b>' + esc(a.impact) + '</div>' +
          '<div style="margin-top:9px;font-size:10.5px;color:var(--tx4)">关联指标：' +
          a.metricIds.map(function (id) { var m = BY_ID['m' + String(id).padStart(3, '0')]; return m ? esc(m.name) : id; }).join(' · ') + '</div>' +
          '</div></div>';
      }).join('');
    }
    $('#zoneCStat').innerHTML = '<span class="zs">建议<b>' + AD.length + '</b></span>' +
      '<span class="zs red">P0<b>' + AD.filter(function (a) { return a.rank === 'P0'; }).length + '</b></span>' +
      '<span class="zs amber">P1<b>' + AD.filter(function (a) { return a.rank === 'P1'; }).length + '</b></span>' +
      '<span class="zs">深度分析<b>' + D.deep.length + '</b></span>';
  }

  function renderDeep() {
    $('#deepList').innerHTML = D.deep.map(function (d, i) {
      var mx = Math.max.apply(null, d.chain.map(function (c) { return Math.abs(c.w); })) || 1;
      return '<div class="dp' + (i === 0 ? ' open' : '') + '" data-dpid="' + i + '">' +
        '<div class="dp-h"><b>' + esc(d.title) + '</b><span class="rt">' + esc(d.root) + '</span><span class="ar">›</span></div>' +
        '<div class="dp-b"><div class="dp-chain">' + d.chain.map(function (c) {
          return '<div class="dp-n"><span class="nn">' + esc(c.node) + '</span><span class="nb">' +
            '<span class="nbar"><i style="width:' + (Math.abs(c.w) / mx * 100).toFixed(0) + '%"></i></span>' +
            '<span class="nd">' + esc(c.detail) + ' · ' + fmtDelta(c.w) + '</span></span></div>';
        }).join('') + '</div><div class="dp-concl"><b>AI 结论 · </b>' + esc(d.conclusion) + '</div></div></div>';
    }).join('');
  }

  /* ───────── 11. Zone 04 · 下钻 ───────── */
  function renderTraffic() {
    var items = [
      { m: BY_ID.m001, c: C.pri }, { m: BY_ID.m004, c: C.purple }, { m: BY_ID.m006, c: C.teal }
    ].map(function (o) { return { label: o.m.name.replace('（独立访客）', ''), value: mval(o.m, STATE.period).v, color: o.c }; });
    donut($('#trafficDonut'), items, 'UV 合计 · ' + PN[STATE.period]);
    $('#trafficLegend').innerHTML = items.map(function (it) {
      return '<span class="lg"><i style="background:' + it.color + '"></i>' + esc(it.label) + ' <b style="margin-left:4px;color:var(--ink)">' + abbr(it.value) + '</b></span>';
    }).join('');
  }

  function renderModules() {
    var mods = {};
    visibleMetrics().forEach(function (m) {
      var k = m.module; if (!mods[k]) mods[k] = { n: 0, a: 0, w: 0 };
      var st = statusOf(m, mval(m, STATE.period).delta);
      mods[k].n++; if (st === 'alert') mods[k].a++; else if (st === 'watch') mods[k].w++;
    });
    var rows = Object.keys(mods).map(function (k) {
      var o = mods[k], sc = clamp(100 - o.a * 18 - o.w * 8, 18, 100);
      return { k: k, sc: sc, o: o };
    }).sort(function (a, b) { return a.sc - b.sc; });
    $('#moduleBars').innerHTML = rows.map(function (r) {
      var c = r.sc < 55 ? C.red : r.sc < 75 ? C.amber : C.green;
      return '<div class="bar-row"><span class="bn" title="' + esc(r.k) + '">' + esc(r.k) + '</span>' +
        '<span class="bar-track"><i style="width:' + r.sc + '%;background:' + c + '"></i></span>' +
        '<span class="bv" style="color:' + c + '">' + r.sc + ' <small>' + r.o.a + '警 ' + r.o.w + '关</small></span></div>';
    }).join('');
  }

  function renderProfile() {
    donut($('#profileChart'), D.profiles[STATE.profileKey].map(function (it, i) {
      return { label: it.k, value: it.v, color: PCOLORS[i % PCOLORS.length] };
    }), '占比构成');
  }

  function renderFunnel() {
    var f = D.funnels[STATE.funnelKey];
    var lvs = Object.keys(f.levels);
    if (lvs.indexOf(STATE.funnelLevel) < 0) STATE.funnelLevel = lvs[0];
    var lv = f.levels[STATE.funnelLevel];
    $('#funnelSeg').innerHTML = Object.keys(D.funnels).map(function (k) {
      return '<button data-k="' + k + '" class="' + (k === STATE.funnelKey ? 'on' : '') + '">' +
        D.funnels[k].name.replace(/（.*?）/g, '') + '</button>';
    }).join('') + '<span style="width:10px"></span>' +
      lvs.map(function (l) { return '<button data-l="' + l + '" class="' + (l === STATE.funnelLevel ? 'on' : '') + '">' + l + '</button>'; }).join('');
    $('#funnelTitle').textContent = f.name;
    $('#funnelLevel').innerHTML = '<b>' + esc(lv.label) + '</b><span class="tip">' + esc(lv.tip) + '</span>';
    var top = lv.nodes[0].value;
    var isAttr = lv.mode === 'attribution';
    var sum = lv.nodes.reduce(function (a, b) { return a + b.value; }, 0);
    $('#funnelBody').innerHTML = lv.nodes.map(function (nd, i) {
      var v = nd.value, pct = isAttr ? v / sum * 100 : v / top * 100;
      var conv = i === 0 ? null : v / lv.nodes[i - 1].value * 100;
      var bad = isAttr ? (nd.drift != null && nd.drift > 0) : (nd.drift != null && nd.drift < 0);
      var c = isAttr ? [C.red, C.amber, C.purple, C.teal, C.gray][i % 5]
        : (i === 0 ? C.pri : (conv > 60 ? '#4466f0' : conv > 35 ? C.purple : '#9a8cf7'));
      return '<div class="fn">' +
        '<div class="fn-n">' + esc(nd.name) + '</div>' +
        '<div class="fn-b"><div class="fn-bar" style="width:' + Math.max(12, pct).toFixed(1) + '%;background:' + c + '">' + abbr(v) + '</div></div>' +
        '<div class="fn-c">' + (conv == null ? '<span style="color:var(--tx3);font-size:11px">' + (isAttr ? '占比' : '入口') + '</span>'
          : '<b>' + (isAttr ? pct.toFixed(1) : conv.toFixed(1)) + '%</b><span class="fn-d" style="color:' + (bad ? C.red : C.green) + '">' + fmtDelta(nd.drift || 0) + '</span>') + '</div></div>';
    }).join('');
    $('#funnelBranches').innerHTML = (f.branches || []).map(function (b) {
      return '<div class="br"><h4>' + esc(b.name) + '</h4>' + b.items.map(function (it, i) {
        return '<div class="br-item"><span class="l">' + esc(it.label) + '</span>' +
          '<span class="br-track"><i style="width:' + clamp(it.pct / 50 * 100, 4, 100) + '%;background:' + PCOLORS[i % 6] + '"></i></span>' +
          '<span class="v">' + it.pct.toFixed(1) + '% <span style="font-size:10px;color:' + (it.drift < 0 ? C.red : C.green) + '">' + fmtDelta(it.drift) + '</span></span></div>';
      }).join('') + '</div>';
    }).join('');
  }

  function renderChannel() {
    var sc = PDAYS[STATE.period] / 7;
    var rows = D.channels.map(function (c) {
      return {
        c: c, sessions: c.sessions * sc, reg: c.reg * sc, inq: c.inq * sc,
        deal: c.deal * sc, cost: c.cost * sc, roi: c.roi || 0, cac: c.cac || 0,
        conv: c.sessions ? c.deal / c.sessions * 100 : 0, drift: c.drift
      };
    });
    var k = STATE.chSort.k, dir = STATE.chSort.dir;
    rows.sort(function (a, b) { return (a[k] - b[k]) * dir; });
    var head = [['name', '渠道'], ['sessions', 'Sessions'], ['reg', '注册'], ['inq', '询价'], ['deal', '成交'],
    ['conv', '成交率'], ['cost', '花费'], ['roi', 'ROI'], ['cac', 'CAC'], ['drift', '环比']];
    var h = '<thead><tr>' + head.map(function (x) {
      return '<th class="sortable' + (k === x[0] ? ' on' : '') + '" data-k="' + x[0] + '"' +
        (k === x[0] ? ' style="color:var(--pri)"' : '') + '>' + x[1] + (k === x[0] ? (dir < 0 ? ' ↓' : ' ↑') : '') + '</th>';
    }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r, ci) {
      h += '<tr data-ci="' + ci + '"><td class="nm">' + esc(r.c.name) + '<span class="sub">公司级占比 ' + r.c.corp.toFixed(1) + '%</span></td>' +
        '<td class="num">' + abbr(r.sessions) + '</td><td class="num">' + Math.round(r.reg) + '</td>' +
        '<td class="num">' + Math.round(r.inq) + '</td><td class="num">' + Math.round(r.deal) + '</td>' +
        '<td class="num">' + r.conv.toFixed(2) + '%</td>' +
        '<td class="num">' + (r.cost ? '¥' + abbr(r.cost) : '—') + '</td>' +
        '<td class="num" style="color:' + (r.roi >= 3 ? 'var(--green)' : r.roi && r.roi < 2 ? 'var(--red)' : 'var(--tx)') + '">' + (r.roi ? r.roi.toFixed(1) + 'x' : '—') + '</td>' +
        '<td class="num">' + (r.cac ? '¥' + abbr(r.cac) : '—') + '</td>' +
        '<td class="num" style="color:' + (r.drift < 0 ? 'var(--red)' : 'var(--green)') + '">' + fmtDelta(r.drift) + '</td></tr>';
    });
    $('#channelTbl').innerHTML = h + '</tbody>';

    var paid = rows.filter(function (r) { return r.roi > 0; });
    xyChart($('#roiChart'), paid.map(function (r) { return r.c.name.replace(' Search', ''); }),
      [{ type: 'bar', name: 'ROI', color: C.pri, data: paid.map(function (r) { return r.roi; }) },
      { type: 'line', name: 'CAC(¥)', color: C.amber, axis: 'r', data: paid.map(function (r) { return r.cac; }) }]);

    var items = rows.map(function (r, i) { return { label: r.c.name, value: r.sessions, color: PCOLORS[i % 6] }; });
    donut($('#chDonut'), items, 'Sessions 合计');
    $('#chLegend').innerHTML = items.map(function (it) {
      return '<span class="lg"><i style="background:' + it.color + '"></i>' + esc(it.label) + '</span>';
    }).join('');
  }

  function renderPeople() {
    var avg = D.personnel.sales.reduce(function (a, b) { return a + b.conv; }, 0) / D.personnel.sales.length;
    var items = D.personnel.sales.map(function (s) {
      var ratio = s.conv / avg;
      return {
        label: s.name, value: s.conv,
        color: ratio < 0.7 ? C.red : ratio < 1 ? C.amber : C.green,
        text: s.conv.toFixed(1) + '% ' + (s.drift >= 0 ? '↑' : '↓')
      };
    }).sort(function (a, b) { return a.value - b.value; });
    hBars($('#salesChart'), items);
    var eng = D.personnel.engineers;
    xyChart($('#engChart'), eng.map(function (e) { return e.name.replace('工程 · ', ''); }),
      [{ type: 'bar', name: '承接量', color: C.pri, data: eng.map(function (e) { return e.load; }) },
      { type: 'line', name: '响应时长(h)', color: C.amber, axis: 'r', data: eng.map(function (e) { return e.hours; }) }]);

    var h = '<thead><tr><th>角色</th><th>人员</th><th class="num">承接/询价</th><th class="num">成交</th>' +
      '<th class="num">转化率 / 完成率</th><th class="num">响应时长</th><th class="num">环比</th><th>状态</th></tr></thead><tbody>';
    D.personnel.sales.forEach(function (s) {
      var r = s.conv / avg;
      var st = r < 0.7 ? '<span class="pill alert">低于均值70%</span>' : r < 0.9 ? '<span class="pill watch">低于均值</span>' : '<span class="pill ok">达标</span>';
      h += '<tr><td>业务员</td><td class="nm">' + esc(s.name) + '</td><td class="num">' + s.inquiry + '</td><td class="num">' + s.deal + '</td>' +
        '<td class="num">' + s.conv.toFixed(1) + '%</td><td class="num">—</td>' +
        '<td class="num" style="color:' + (s.drift < 0 ? 'var(--red)' : 'var(--green)') + '">' + fmtDelta(s.drift) + '</td><td>' + st + '</td></tr>';
    });
    var mh = eng.reduce(function (a, b) { return a + b.hours; }, 0) / eng.length;
    eng.forEach(function (e) {
      var st = e.hours > mh * 1.3 ? '<span class="pill alert">响应偏慢</span>' : e.load > 180 ? '<span class="pill watch">负载过高</span>' : '<span class="pill ok">健康</span>';
      h += '<tr><td>工程师</td><td class="nm">' + esc(e.name) + '</td><td class="num">' + e.load + '</td><td class="num">' + e.done + '</td>' +
        '<td class="num">' + e.rate.toFixed(1) + '%</td><td class="num">' + e.hours.toFixed(1) + 'h</td>' +
        '<td class="num" style="color:' + (e.drift < 0 ? 'var(--green)' : 'var(--red)') + '">' + fmtDelta(e.drift) + '</td><td>' + st + '</td></tr>';
    });
    $('#peopleTbl').innerHTML = h + '</tbody>';
  }

  function renderTable() {
    var q = STATE.search.trim().toLowerCase();
    var rows = M.filter(function (m) {
      if (!pass(m)) return false;
      if (STATE.prioFilter !== 'all' && m.prio !== STATE.prioFilter) return false;
      if (!q) return true;
      return (m.name + m.module + m.scene + m.aiScene + m.no).toLowerCase().indexOf(q) >= 0;
    });
    var h = '<thead><tr><th>序号</th><th>指标</th><th>模块</th><th class="num">当前值</th><th class="num">环比</th>' +
      '<th>状态</th><th>优先级</th><th>频率</th><th>AI 分析场景 / 触发条件</th><th>AI 建议动作</th></tr></thead><tbody>';
    rows.forEach(function (m) {
      var r = evalM(m);
      var good = m.higherBetter ? r.delta >= 0 : r.delta < 0;
      h += '<tr data-mid="' + m.id + '"><td>' + m.no + '</td>' +
        '<td class="nm">' + esc(m.name) + '<span class="sub">' + esc(m.desc) + '</span></td>' +
        '<td>' + esc(m.module) + '<span class="sub">' + esc(m.scene) + '</span></td>' +
        '<td class="num">' + fmtVal(m, r.v) + '</td>' +
        '<td class="num" style="color:' + (good ? 'var(--green)' : 'var(--red)') + '">' + fmtDelta(r.delta) + '</td>' +
        '<td><span class="pill ' + (r.st === 'alert' ? 'alert' : r.st === 'watch' ? 'watch' : 'ok') + '">' +
        (r.st === 'alert' ? '预警' : r.st === 'watch' ? '关注' : '正常') + '</span></td>' +
        '<td><span class="pill ' + (m.prio[1] === '0' ? 'p0' : m.prio[1] === '1' ? 'p1' : 'p2') + '">' + esc(m.prio) + '</span></td>' +
        '<td>' + esc(m.freq) + '</td>' +
        '<td><b style="font-size:11.5px;color:var(--tx)">' + esc(m.aiScene) + '</b><span class="sub">触发：' + esc(m.trigger) + '</span></td>' +
        '<td class="act">' + esc(m.aiAction) + '<span class="sub">下钻：' + esc(m.drill) + '</span></td></tr>';
    });
    $('#metricTbl').innerHTML = h + (rows.length ? '</tbody>'
      : '</tbody><tr><td colspan="10" style="text-align:center;color:var(--tx3);padding:26px">无匹配指标</td></tr>');
  }

  /* ───────── 12. 渲染调度 ───────── */
  function renderTabA() {
    $$('#tabsA button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === STATE.tabA); });
    ['overview', 'funnel', 'channel', 'people', 'table'].forEach(function (t) {
      var p = $('#pane-' + t);
      if (p) p.classList.toggle('hide', t !== STATE.tabA);
    });
    if (STATE.tabA === 'overview') { renderTraffic(); renderModules(); renderProfile(); }
    if (STATE.tabA === 'funnel') renderFunnel();
    if (STATE.tabA === 'channel') renderChannel();
    if (STATE.tabA === 'people') renderPeople();
    if (STATE.tabA === 'table') renderTable();
  }

  function renderAll() {
    var res = scan();
    renderHero(res);
    $('#zoneAStat').innerHTML = '<span class="zs">指标<b>' + res.n + '</b></span>' +
      '<span class="zs">周期<b>' + PN[STATE.period] + '</b></span>' +
      '<span class="zs">平台<b>' + (STATE.platform === 'all' ? '全部' : STATE.platform) + '</b></span>' +
      '<span class="zs red">预警<b>' + res.a + '</b></span>' +
      '<span class="zs amber">关注<b>' + res.w + '</b></span>';
    renderKPI(); renderTrend(); renderTabA();
    renderMonitor(res); renderAlerts(); renderSceneDetail();
    renderAdvice(); renderDeep();
    $('#footMeta').textContent = '数据源：' + D.meta.source + ' · 共 ' + D.meta.metricCount +
      ' 项指标 / ' + D.meta.sceneCount + ' 个场景 · 构建于 ' + D.meta.builtAt + ' · 本页为演示数据（虚拟生成），口径与阈值取自需求表原文';
  }

  /* ───────── 13. 事件（委托） ───────── */
  document.addEventListener('click', function (e) {
    var t = e.target, b;
    if ((b = t.closest('#periodSeg button'))) {
      $$('#periodSeg button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); STATE.period = b.dataset.p; renderAll(); return;
    }
    if ((b = t.closest('#tabsA button'))) { STATE.tabA = b.dataset.t; renderTabA(); return; }
    if ((b = t.closest('#trendSeg button'))) {
      STATE.trendGroup = +b.dataset.i;
      $$('#trendSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderTrend(); return;
    }
    if ((b = t.closest('#profileSeg button'))) {
      STATE.profileKey = b.dataset.k;
      $$('#profileSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderProfile(); return;
    }
    if ((b = t.closest('#funnelSeg button'))) {
      if (b.dataset.k) {
        STATE.funnelKey = b.dataset.k;
        $$('#funnelSeg button[data-k]').forEach(function (x) { x.classList.toggle('on', x === b); });
      } else {
        STATE.funnelLevel = b.dataset.l;
        $$('#funnelSeg button[data-l]').forEach(function (x) { x.classList.toggle('on', x === b); });
      }
      renderFunnel(); return;
    }
    if ((b = t.closest('#alertSeg button'))) {
      STATE.alertFilter = b.dataset.k;
      $$('#alertSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderAlerts(); return;
    }
    if ((b = t.closest('#advSeg button'))) {
      STATE.adviceFilter = b.dataset.k;
      $$('#advSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderAdvice(); return;
    }
    if ((b = t.closest('#prioSeg button'))) {
      STATE.prioFilter = b.dataset.k;
      $$('#prioSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderTable(); return;
    }
    if ((b = t.closest('.sc, .p2-chip'))) {
      STATE.sceneId = b.dataset.id;
      $$('.sc, .p2-chip').forEach(function (x) { x.classList.toggle('sel', x === b); });
      renderSceneDetail();
      var card = $('#sceneDetail').closest('.card');
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if ((b = t.closest('.hs[data-hs]'))) { window.CockpitModal && window.CockpitModal.openHeroStat(b.dataset.hs); return; }
    if ((b = t.closest('[data-drill-customer]'))) {
      var dp = window.CockpitData ? window.CockpitData.STATE.platform : 'all';
      var dpd = window.CockpitData ? window.CockpitData.STATE.period : 'day';
      window.location.href = 'customer-cockpit.html?platform=' + encodeURIComponent(dp) + '&period=' + encodeURIComponent(dpd);
      return;
    }
    if ((b = t.closest('.al'))) { window.CockpitModal && window.CockpitModal.openAlert(+b.dataset.ai); return; }
    if ((b = t.closest('.adv'))) { window.CockpitModal && window.CockpitModal.openAdvice(+b.dataset.advid); return; }
    if ((b = t.closest('.dp'))) { window.CockpitModal && window.CockpitModal.openDeep(+b.dataset.dpid); return; }
    if ((b = t.closest('#channelTbl th.sortable'))) {
      var k = b.dataset.k;
      if (STATE.chSort.k === k) STATE.chSort.dir *= -1; else { STATE.chSort.k = k; STATE.chSort.dir = -1; }
      renderChannel(); return;
    }
    if ((b = t.closest('#refreshBtn'))) {
      STATE.salt++; renderAll();
      var svg = b.querySelector('svg');
      if (svg) {
        svg.style.transition = 'transform .6s cubic-bezier(.2,.8,.2,1)';
        svg.style.transform = 'rotate(360deg)';
        setTimeout(function () { svg.style.transform = ''; }, 620);
      }
      return;
    }
    if ((b = t.closest('[data-goto]'))) {
      e.preventDefault();
      var g = b.dataset.goto.split(':');
      STATE.tabA = 'funnel'; STATE.funnelKey = g[1];
      renderTabA(); goSel('#zone-d');
      setTimeout(renderFunnel, 60);
      return;
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'metricSearch') { STATE.search = e.target.value; renderTable(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'platformSel') { STATE.platform = e.target.value; renderAll(); }
  });
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(renderTabA, 220); });

  function tickClock() {
    var el = $('#clock');
    if (el) el.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
  }
  tickClock();
  setInterval(tickClock, 1000);

  renderAll();

  /* 暴露给 modal.js 的只读数据/计算 API */
  window.CockpitData = {
    D: D, M: M, S: S, AL: AL, AD: AD, BY_ID: BY_ID,
    evalM: evalM, statusOf: statusOf, sceneStat: sceneStat,
    fmtVal: fmtVal, fmtDelta: fmtDelta, abbr: abbr, esc: esc,
    STATE: STATE, PDAYS: PDAYS, FDAYS: FDAYS, mval: mval, clamp: clamp,
    visibleMetrics: visibleMetrics, pass: pass
  };
})();
