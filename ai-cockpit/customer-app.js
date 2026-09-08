/* ═══════════════════════════════════════════════════════
   客户分析驾驶舱 · 渲染引擎
   独立页面，复用 DASHBOARD_DATA（data.js）。
   读取 URL ?platform & ?period，与主驾驶舱数据联动（平台 / 周期上下文）。
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var D = window.DASHBOARD_DATA;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function abbr(n) {
    n = +n || 0;
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(1) + '亿';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + '万';
    return String(Math.round(n));
  }
  function deltaSpan(d) {
    var good = d >= 0;
    return '<span class="' + (good ? 'up' : 'down') + '">' + (good ? '▲' : '▼') + Math.abs(d).toFixed(1) + '%</span>';
  }

  /* 链接参数（数据联动） */
  var q = {};
  location.search.replace(/[?&]+([^=&]+)=([^&]*)/g, function (_, k, v) { q[k] = decodeURIComponent(v); });
  var platform = q.platform || 'all';
  var period = q.period || 'day';
  var PN = { day: '日', week: '周', month: '月' };

  function profiles() { return D.profiles; }
  function personnel() { return D.personnel; }
  function funnel() { return D.funnels.newCustomer; }

  /* ── 顶部上下文 ── */
  function renderHead() {
    $('#ctxChip').innerHTML = '联动上下文 · 平台 <b>' + (platform === 'all' ? '全部' : esc(platform)) +
      '</b> · 周期 <b>' + (PN[period] || period) + '</b>';
  }

  /* ── HERO 客户健康概览 ── */
  function renderHero() {
    var p = profiles();
    var scale = p.scale;
    var aTier = scale.filter(function (x) { return x.k.indexOf('A') === 0; })[0];
    var f = funnel();
    var nodes = f.levels.L1.nodes;
    var top = nodes[0].value, bottom = nodes[nodes.length - 1].value;
    var conv = top ? (bottom / top * 100) : 0;
    var sales = personnel().sales;
    var totalDeal = sales.reduce(function (s, x) { return s + x.deal; }, 0);
    var stats =
      card('高价值客户占比 (A类)', (aTier ? aTier.v.toFixed(1) : '—') + '%', '客户结构健康度基准') +
      card('新客整体转化率', conv.toFixed(2) + '%', '访客 → 下单') +
      card('业务团队成交', totalDeal + ' 单', '本期累计') +
      card('监控客户指标', D.metrics.filter(function (m) { return m.name.indexOf('客户') >= 0 || (m.module || '').indexOf('客户') >= 0; }).length + ' 项', '含留存 / LTV / 分层');
    $('#cHero').innerHTML = stats;
    function card(t, v, s) {
      return '<div class="ckpi"><b>' + v + '</b><span>' + esc(t) + '</span><i>' + esc(s) + '</i></div>';
    }
  }

  /* ── 客户结构与画像（环形图，4 维度切换）── */
  var PDIM = [
    { k: 'region', name: '地区分布' },
    { k: 'industry', name: '行业分布' },
    { k: 'process', name: '加工需求' },
    { k: 'scale', name: '客户规模' }
  ];
  var curDim = 'region';
  function renderProfile() {
    var arr = profiles()[curDim] || [];
    var total = arr.reduce(function (s, x) { return s + x.v; }, 0) || 1;
    var cols = ['#3b6ef5', '#7c5cff', '#1ec8a5', '#ffb020', '#ff5d6c', '#56b3ff'];
    var cx = 90, cy = 90, r = 66, sw = 26, C = 2 * Math.PI * r, acc = 0, arcs = '';
    arr.forEach(function (d, i) {
      var len = d.v / total * C;
      var rot = acc / C * 360 - 90;
      arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + cols[i % cols.length] +
        '" stroke-width="' + sw + '" stroke-dasharray="' + len + ' ' + (C - len) + '" transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')"/>';
      acc += len;
    });
    var legend = arr.map(function (d, i) {
      return '<div class="lg"><i style="background:' + cols[i % cols.length] + '"></i><span>' + esc(d.k) +
        '</span><b>' + d.v.toFixed(1) + '%</b></div>';
    }).join('');
    $('#profileChart').innerHTML =
      '<svg viewBox="0 0 180 180" width="180" height="180">' + arcs +
      '<text x="90" y="86" text-anchor="middle" class="dc-t1">' + arr.length + '</text>' +
      '<text x="90" y="104" text-anchor="middle" class="dc-t2">细分维度</text></svg>';
    $('#profileLegend').innerHTML = legend;
  }
  function renderProfileSeg() {
    var seg = $('#profileSeg');
    seg.innerHTML = PDIM.map(function (d) {
      return '<button data-k="' + d.k + '" class="' + (d.k === curDim ? 'on' : '') + '">' + d.name + '</button>';
    }).join('');
    seg.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      curDim = b.dataset.k; renderProfile(); renderProfileSeg();
    };
  }

  /* ── 客户价值分层（A/B/C 横向条形）── */
  function renderTiers() {
    var arr = profiles().scale;
    var max = Math.max.apply(null, arr.map(function (x) { return x.v; })) || 1;
    var cols = { 'A': '#3b6ef5', 'B': '#7c5cff', 'C': '#9aa3b2' };
    var html = arr.map(function (d) {
      var c = cols[d.k.charAt(0)] || '#3b6ef5';
      return '<div class="hrow"><span class="hl">' + esc(d.k) + '</span>' +
        '<div class="hbar"><i style="width:' + (d.v / max * 100) + '%;background:' + c + '"></i></div>' +
        '<span class="hv">' + d.v.toFixed(1) + '%</span></div>';
    }).join('');
    $('#tierChart').innerHTML = html;
  }

  /* ── 新客转化漏斗 ── */
  function renderFunnel() {
    var f = funnel();
    var nodes = f.levels.L1.nodes;
    var max = nodes[0].value || 1;
    var html = nodes.map(function (n, i) {
      var w = 30 + (n.value / max) * 70;
      var prev = i ? nodes[i - 1].value : n.value;
      var cr = i ? (n.value / prev * 100).toFixed(1) + '%' : '100%';
      return '<div class="fn"><div class="fn-bar" style="width:' + w.toFixed(1) + '%">' +
        '<span class="fn-name">' + esc(n.name) + '</span>' +
        '<span class="fn-val">' + abbr(n.value) + ' ' + deltaSpan(n.drift) + '</span></div>' +
        (i ? '<div class="fn-cr">↓ 转化率 ' + cr + '</div>' : '') + '</div>';
    }).join('');
    $('#funnel').innerHTML = html;
    $('#funnelTitle').textContent = f.name;
  }

  /* ── 人员效能 ── */
  function renderPeople() {
    var s = personnel().sales;
    var max = Math.max.apply(null, s.map(function (x) { return x.conv; })) || 1;
    var shtml = s.map(function (x) {
      var warn = x.conv < max * 0.7;
      return '<div class="hrow"><span class="hl">' + esc(x.name) + '</span>' +
        '<div class="hbar"><i style="width:' + (x.conv / max * 100) + '%;background:' + (warn ? '#ff5d6c' : '#1ec8a5') + '"></i></div>' +
        '<span class="hv">' + x.conv.toFixed(1) + '% ' + deltaSpan(x.drift) + '</span></div>';
    }).join('');
    $('#salesChart').innerHTML = shtml;

    var e = personnel().engineers;
    var emax = Math.max.apply(null, e.map(function (x) { return x.rate; })) || 1;
    var ehtml = e.map(function (x) {
      return '<div class="hrow"><span class="hl">' + esc(x.name) + '</span>' +
        '<div class="hbar"><i style="width:' + (x.rate / emax * 100) + '%;background:#3b6ef5"></i></div>' +
        '<span class="hv">完成率 ' + x.rate.toFixed(1) + '% · ' + x.hours.toFixed(1) + 'h ' + deltaSpan(x.drift) + '</span></div>';
    }).join('');
    $('#engChart').innerHTML = ehtml;
  }

  /* ── 客户风险明细（与客户相关指标，按平台过滤）── */
  function renderRisk() {
    var rows = D.metrics.filter(function (m) {
      var hit = m.name.indexOf('客户') >= 0 || (m.module || '').indexOf('客户') >= 0 || (m.scene || '').indexOf('客户') >= 0;
      if (!hit) return false;
      if (platform !== 'all' && m.platform && m.platform !== '全部') {
        return m.platform === platform || m.platform.indexOf(platform) >= 0;
      }
      return true;
    });
    if (!rows.length) rows = D.metrics.filter(function (m) { return m.name.indexOf('客户') >= 0; });
    var html = '<table class="tbl"><thead><tr><th>指标</th><th>模块</th><th>当前值</th><th>环比</th><th>状态</th></tr></thead><tbody>' +
      rows.map(function (m) {
        var d = m.drift;
        var st = m.rule ? 'normal' : (Math.abs(d) >= (m.alert || 15) ? 'alert' : Math.abs(d) >= (m.watch || 8) ? 'watch' : 'normal');
        var stTxt = st === 'alert' ? '预警' : st === 'watch' ? '关注' : '正常';
        var val = (m.base ? abbr(m.base * (1 + d / 100)) : abbr(m.base)) ;
        return '<tr><td>' + esc(m.name) + '</td><td>' + esc(m.module) + '</td><td>' + val + '</td>' +
          '<td>' + deltaSpan(d) + '</td><td><span class="pill ' + st + '">' + stTxt + '</span></td></tr>';
      }).join('') + '</tbody></table>';
    $('#riskTbl').innerHTML = html;
  }

  /* ── 启动 ── */
  function renderAll() {
    renderHead(); renderHero(); renderProfileSeg(); renderProfile();
    renderTiers(); renderFunnel(); renderPeople(); renderRisk();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderAll);
  else renderAll();
})();
