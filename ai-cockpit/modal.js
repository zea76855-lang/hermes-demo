/* ═══════════════════════════════════════════════════════
   AI 市场运营驾驶舱 · 详情弹窗
   点击指标卡 / 异常 / 场景 / 建议 / 根因链 / 表格行等样式块，
   弹出“详情”卡片。移动端底部抽屉，桌面居中卡片。
   依赖 app.js 暴露的 window.CockpitData（只读）。
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function CD() { return window.CockpitData; }
  function has() { return !!window.CockpitData; }
  function esc(s) { return has() ? CD().esc(s) : String(s == null ? '' : s); }
  function fmtVal(m, v) { return CD().fmtVal(m, v); }
  function fmtDelta(d) { return CD().fmtDelta(d); }
  function evalM(m) { return CD().evalM(m); }
  function clamp(v, a, b) { return CD().clamp(v, a, b); }

  /* ── 弹窗 DOM（首次使用时创建）── */
  var mask, sheet, titleEl, bodyEl, footEl, copyBtn, toastEl, toastT;
  function ensureDom() {
    if (mask) return;
    mask = document.createElement('div');
    mask.className = 'dm-mask'; mask.id = 'dmMask';
    mask.innerHTML =
      '<div class="dm-sheet" id="dmSheet" role="dialog" aria-modal="true">' +
        '<div class="dm-head"><div class="dm-title" id="dmTitle"></div>' +
        '<button class="dm-x" id="dmX" aria-label="关闭">×</button></div>' +
        '<div class="dm-body" id="dmBody"></div>' +
        '<div class="dm-foot" id="dmFoot"></div>' +
      '</div>';
    document.body.appendChild(mask);
    titleEl = mask.querySelector('#dmTitle');
    bodyEl = mask.querySelector('#dmBody');
    footEl = mask.querySelector('#dmFoot');
    sheet = mask.querySelector('#dmSheet');

    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });
    mask.querySelector('#dmX').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mask.classList.contains('on')) closeModal();
    });
  }

  function openModal(title, html, opts) {
    ensureDom();
    opts = opts || {};
    var copyText = typeof opts === 'string' ? opts : (opts.copyText || '');
    var actions = (opts && opts.actions) || [];
    titleEl.innerHTML = title;
    bodyEl.innerHTML = html;
    bodyEl.scrollTop = 0;
    var foot = '';
    if (copyText) foot += '<button class="dm-copy" id="dmCopy">复制详情</button>';
    actions.forEach(function (a, i) {
      foot += '<button class="dm-act ' + (a.cls || '') + '" data-i="' + i + '">' + esc(a.label) + '</button>';
    });
    footEl.innerHTML = foot;
    copyBtn = footEl.querySelector('#dmCopy');
    if (copyBtn) {
      copyBtn.dataset.txt = copyText;
      copyBtn.addEventListener('click', function () { copyText(copyBtn.dataset.txt || ''); });
    }
    footEl.querySelectorAll('.dm-act').forEach(function (btn) {
      var a = actions[+btn.dataset.i];
      if (a && a.onClick) btn.addEventListener('click', a.onClick);
    });
    mask.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    if (!mask) return;
    mask.classList.remove('on');
    document.body.style.overflow = '';
  }
  function copyText(txt) {
    var done = function () { showToast('已复制详情'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(done, fallback);
      } else { fallback(); }
    } catch (e) { fallback(); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); done();
      } catch (e2) { showToast('复制失败'); }
    }
  }
  function showToast(msg) {
    ensureDom();
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'dm-toast'; toastEl.id = 'dmToast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 1600);
  }

  /* ── 内容构造辅助 ── */
  function pill(cls, txt) { return '<span class="pill ' + cls + '">' + esc(txt) + '</span>'; }
  function row(k, v) { return '<div class="dm-row"><span class="dm-k">' + esc(k) + '</span><span class="dm-v">' + v + '</span></div>'; }
  function sec(title, html) { return '<div class="dm-sec"><h5>' + esc(title) + '</h5>' + html + '</div>'; }
  function ul(items) { return '<ul class="dm-ul">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
  function ol(items) { return '<ol class="dm-ol">' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>'; }
  function note(html) { return '<div class="dm-note">' + html + '</div>'; }
  function deltaSpan(d) {
    var good = d >= 0;
    return '<span class="' + (good ? 'dm-up' : 'dm-down') + '">' + fmtDelta(d) + '</span>';
  }
  function stPill(st) {
    if (st === 'alert') return pill('alert', '预警');
    if (st === 'watch') return pill('watch', '关注');
    return pill('ok', '正常');
  }
  function prioPill(prio) {
    var c = prio && prio[1] === '0' ? 'p0' : prio && prio[1] === '1' ? 'p1' : 'p2';
    return pill(c, prio);
  }

  /* ── 各类型详情 ── */
  function openMetric(mid) {
    if (!has()) return;
    var m = CD().BY_ID[mid]; if (!m) return;
    var r = evalM(m);
    var good = m.higherBetter ? r.delta >= 0 : r.delta < 0;
    var stTxt = r.st === 'alert' ? '预警' : r.st === 'watch' ? '关注' : '正常';
    var dir = m.higherBetter ? '越高越好' : '越低越好';
    var tg = m.target ? m.target * (m.scale ? CD().PDAYS[CD().STATE.period] / CD().FDAYS[m.freq] : 1) : null;
    var p = tg ? clamp((m.higherBetter ? r.v / tg : tg / Math.max(r.v, 0.01)) * 100, 0, 999) : null;

    var title = '<span class="dm-title-t">' + esc(m.name) + '</span>';
    var top = prioPill(m.prio) + ' ' + stPill(r.st);
    var hero = '<div class="dm-hero"><b>' + fmtVal(m, r.v) + '</b>' +
      '<span class="' + (good ? 'dm-up' : 'dm-down') + '">' + fmtDelta(r.delta) + '</span></div>';
    var kv = row('模块', esc(m.module)) + row('监控场景', esc(m.scene)) +
      row('优先级', esc(m.prio)) + row('频率', esc(m.freq)) + row('口径方向', dir) +
      (tg ? row('目标值', fmtVal(m, tg)) : '') +
      (p != null ? row('目标达成率', '<b style="color:' + (p >= 95 ? 'var(--green)' : p >= 85 ? 'var(--amber)' : 'var(--red)') + '">' + p.toFixed(0) + '%</b>') : '') +
      row('数据来源', esc(m.source));
    var desc = sec('指标定义', '<p class="dm-p">' + esc(m.desc) + '</p>');
    var fml = sec('计算口径', '<p class="dm-code">' + esc(m.formula) + '</p>');
    var ai = sec('AI 监控与动作',
      row('分析场景', esc(m.aiScene)) + row('触发条件', esc(m.trigger)) +
      row('下钻维度', esc(m.drill)) +
      note('<b>AI 建议动作 · </b>' + esc(m.aiAction)));

    var copy = '【指标】' + m.name + '\n当前值：' + fmtVal(m, r.v) + '\n环比：' + fmtDelta(r.delta) +
      '\n状态：' + stTxt + '\n优先级：' + m.prio + '\n目标值：' + (tg ? fmtVal(m, tg) : '—') +
      '\n触发条件：' + m.trigger + '\nAI 建议动作：' + m.aiAction;

    openModal(title, '<div class="dm-top">' + top + '</div>' + hero + kv + desc + fml + ai, copy);
  }

  function openAlert(i) {
    if (!has()) return;
    var a = CD().AL[i]; if (!a) return;
    var lv = { alert: ['预警', 'alert'], watch: ['关注', 'watch'], info: ['机会', 'ok'] }[a.level] || ['关注', 'watch'];
    var title = '<span class="dm-title-t">' + esc(a.metric) + '</span>';
    var top = pill(lv[1], lv[0]);
    var kv = row('偏离', deltaSpan(a.dev)) + row('发生时间', esc(a.ago) + ' 分钟前') +
      row('监控场景', esc(a.scene)) + row('异常阈值', esc(a.thresh)) +
      row('下钻维度', esc(a.drill)) + row('负责人', esc(a.owner));
    var body = sec('异常描述', '<p class="dm-p">' + esc(a.msg) + '</p>');
    var act = sec('AI 建议动作', note('<b>AI 建议动作 · </b>' + esc(a.action)));
    var copy = '【异常】' + a.metric + '\n级别：' + lv[0] + '\n偏离：' + fmtDelta(a.dev) +
      '\n场景：' + a.scene + '\n阈值：' + a.thresh + '\n下钻：' + a.drill +
      '\n负责人：' + a.owner + '\n建议动作：' + a.action;
    var acts = [{ label: '派发任务', cls: 'dm-primary', onClick: function () { openDispatch('alert', i); } }];
    openModal(title, '<div class="dm-top">' + top + '</div>' + kv + body + act, { copyText: copy, actions: acts });
  }

  function openScene(id) {
    if (!has()) return;
    var sc = CD().S.filter(function (s) { return s.id === id; })[0]; if (!sc) return;
    var st = CD().sceneStat(sc);
    var hc = st.lv === 'alert' ? 'var(--red)' : st.lv === 'watch' ? 'var(--amber)' : 'var(--green)';
    var title = '<span class="dm-title-t">' + esc(sc.name) + '</span>';
    var top = pill('pri', sc.platform) + ' ' + (sc.phase === '一期' ? pill('ok', '一期·在线') : pill('p2', sc.phase)) + ' ' +
      '<span class="dm-health" style="color:' + hc + '">健康度 ' + st.health + '</span>';
    var chain = sc.chain.split(/→|->/).map(function (n) {
      return '<span class="dm-chip">' + esc(n.trim()) + '</span>';
    }).join('<span class="dm-arrow">→</span>');
    var kv = row('核心指标', esc(sc.coreMetrics)) + row('异常阈值', esc(sc.threshold)) +
      row('下钻逻辑', esc(sc.drillLogic)) +
      (sc.funnel ? row('关联漏斗', esc(CD().D.funnels[sc.funnel].name)) : '') +
      row('巡检频率', esc(sc.interval)) + row('指标数', esc(sc.checks) + ' 项');
    var q = sec('核心问题', '<p class="dm-p">' + esc(sc.question) + '</p>');
    var c = sec('监控链路', '<div class="dm-chain">' + chain + '</div>');
    var mlist = st.ms.slice(0, 40).map(function (m) {
      var r = CD().mval(m, CD().STATE.period), stt = CD().statusOf(m, r.delta);
      var g = m.higherBetter ? r.delta >= 0 : r.delta < 0;
      return row(esc(m.name), fmtVal(m, r.v) + ' ' + deltaSpan(r.delta));
    }).join('');
    var ms = sec('关联指标实时状态（' + st.n + ' 项）', mlist);
    var copy = '【场景】' + sc.name + '\n平台：' + sc.platform + '\n阶段：' + sc.phase +
      '\n健康度：' + st.health + '\n核心问题：' + sc.question + '\n阈值：' + sc.threshold +
      '\n下钻逻辑：' + sc.drillLogic;
    openModal(title, '<div class="dm-top">' + top + '</div>' + q + c + kv + ms, copy);
  }

  function openAdvice(i) {
    if (!has()) return;
    var a = CD().AD[i]; if (!a) return;
    var title = '<span class="dm-title-t">' + esc(a.title) + '</span>';
    var top = prioPill(a.rank);
    var kv = row('监控场景', esc(a.scene)) + row('负责人', esc(a.owner)) +
      row('处理时限', esc(a.eta)) + row('下钻维度', esc(a.drill));
    var sum = sec('问题摘要', '<p class="dm-p">' + esc(a.summary) + '</p>');
    var cause = sec('AI 归因分析', ul(a.cause.map(function (c) { return esc(c); })));
    var acts = sec('建议动作', ol(a.actions.map(function (c) { return esc(c); })));
    var imp = sec('预期影响', note('<b>预期影响 · </b>' + esc(a.impact)));
    var rel = sec('关联指标', a.metricIds.map(function (id) {
      var m = CD().BY_ID['m' + String(id).padStart(3, '0')]; return m ? esc(m.name) : id;
    }).join(' · '));
    var copy = '【建议】' + a.title + '\n优先级：' + a.rank + '\n场景：' + a.scene +
      '\n负责人：' + a.owner + '\n时限：' + a.eta + '\n摘要：' + a.summary +
      '\n动作：\n' + a.actions.map(function (c, k) { return (k + 1) + '. ' + c; }).join('\n') +
      '\n预期影响：' + a.impact;
    var adActs = [{ label: '派发任务', cls: 'dm-primary', onClick: function () { openDispatch('advice', i); } }];
    openModal(title, '<div class="dm-top">' + top + '</div>' + kv + sum + cause + acts + imp + rel, { copyText: copy, actions: adActs });
  }

  function openDeep(i) {
    if (!has()) return;
    var d = CD().D.deep[i]; if (!d) return;
    var title = '<span class="dm-title-t">' + esc(d.title) + '</span>';
    var top = '<span class="dm-root">根因 · ' + esc(d.root) + '</span>';
    var chain = sec('根因链', d.chain.map(function (c) {
      return row(esc(c.node), esc(c.detail) + ' ' + deltaSpan(c.w));
    }).join(''));
    var concl = sec('AI 结论', note('<b>AI 结论 · </b>' + esc(d.conclusion)));
    var copy = '【根因链】' + d.title + '\n根因：' + d.root + '\n' +
      d.chain.map(function (c) { return '- ' + c.node + '：' + c.detail + ' ' + fmtDelta(c.w); }).join('\n') +
      '\n结论：' + d.conclusion;
    openModal(title, '<div class="dm-top">' + top + '</div>' + chain + concl, copy);
  }

  function openChannel(ci) {
    if (!has()) return;
    var c = CD().D.channels[ci]; if (!c) return;
    var sc = CD().PDAYS[CD().STATE.period] / 7;
    var sessions = c.sessions * sc, reg = c.reg * sc, inq = c.inq * sc,
      deal = c.deal * sc, cost = c.cost * sc;
    var conv = c.sessions ? c.deal / c.sessions * 100 : 0;
    var title = '<span class="dm-title-t">' + esc(c.name) + '</span>';
    var kv = row('Sessions', CD().abbr(sessions)) + row('注册', Math.round(reg)) +
      row('询价', Math.round(inq)) + row('成交', Math.round(deal)) +
      row('成交率', conv.toFixed(2) + '%') + row('花费', cost ? '¥' + CD().abbr(cost) : '—') +
      row('ROI', c.roi ? c.roi.toFixed(1) + 'x' : '—') +
      row('CAC', c.cac ? '¥' + CD().abbr(c.cac) : '—') +
      row('公司级占比', c.corp.toFixed(1) + '%') +
      row('环比', deltaSpan(c.drift));
    var copy = '【渠道】' + c.name + '\nSessions：' + CD().abbr(sessions) + '\n注册：' + Math.round(reg) +
      '\n询价：' + Math.round(inq) + '\n成交：' + Math.round(deal) + '\n成交率：' + conv.toFixed(2) + '%' +
      '\nROI：' + (c.roi ? c.roi.toFixed(1) + 'x' : '—') + '\nCAC：' + (c.cac ? '¥' + CD().abbr(c.cac) : '—') +
      '\n环比：' + fmtDelta(c.drift);
    openModal(title, kv, copy);
  }

  /* ── 顶部三板块明细（预警 / 关注 / P0 建议）── */
  function drillTo(filterBtnSel, zoneSel) {
    var btn = document.querySelector(filterBtnSel);
    if (btn) btn.click();
    var z = document.querySelector(zoneSel);
    if (z && z.scrollIntoView) z.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function openHeroStat(type) {
    if (!has()) return;
    if (type === 'alert' || type === 'watch') {
      var st = type;
      var items = CD().visibleMetrics().map(function (m) { return CD().evalM(m); })
        .filter(function (r) { return r.st === st; })
        .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); })
        .slice(0, 40);
      var title = type === 'alert' ? '预警明细 · ' + items.length + ' 项' : '关注明细 · ' + items.length + ' 项';
      var list = items.length ? items.map(function (r) {
        var c = r.st === 'alert' ? 'var(--red)' : 'var(--amber)';
        return '<div class="dm-item" data-mid="' + r.m.id + '"><span class="dm-in">' + esc(r.m.name) +
          '</span><span class="dm-iv">' + fmtVal(r.m, r.v) + '</span>' +
          '<span class="dm-id" style="color:' + c + '">' + fmtDelta(r.delta) + '</span></div>';
      }).join('') : '<div class="dm-empty">当前筛选下暂无' + (type === 'alert' ? '预警' : '关注') + '指标</div>';
      var copy = '【' + (type === 'alert' ? '预警' : '关注') + '明细】共 ' + items.length + ' 项\n' +
        items.slice(0, 15).map(function (r) { return '- ' + r.m.name + ' ' + fmtDelta(r.delta); }).join('\n');
      var acts = [{ label: '下钻到异常流', cls: 'dm-primary', onClick: function () { closeModal(); drillTo('#alertSeg button[data-k="' + type + '"]', '#zone-b'); } }];
      openModal(title,
        '<div class="dm-top">' + (type === 'alert' ? pill('alert', '预警') : pill('watch', '关注')) +
        ' <span class="dm-hint">点击条目查看指标详情</span></div>' +
        '<div class="dm-list">' + list + '</div>', { copyText: copy, actions: acts });
    } else {
      var p0 = CD().AD.filter(function (a) { return a.rank === 'P0'; });
      var html = p0.length ? p0.map(function (a, i) {
        return '<div class="dm-item" data-adv="' + i + '"><span class="dm-in">' + esc(a.title) +
          '</span><span class="dm-iv" style="color:var(--tx3)">' + esc(a.owner) + '</span>' +
          '<span class="dm-id" style="color:var(--red)">P0</span></div>';
      }).join('') : '<div class="dm-empty">暂无 P0 建议</div>';
      var c2 = '【P0 建议明细】共 ' + p0.length + ' 条\n' + p0.map(function (a) { return '- ' + a.title + ' · ' + a.owner; }).join('\n');
      openModal('P0 建议明细 · ' + p0.length + ' 条',
        '<div class="dm-top">' + pill('p0', 'P0 核心') + ' <span class="dm-hint">点击条目查看建议详情</span></div>' +
        '<div class="dm-list">' + html + '</div>', {
          copyText: c2,
          actions: [{ label: '下钻到建议面板', cls: 'dm-primary', onClick: function () { closeModal(); drillTo('#advSeg button[data-k="P0"]', '#zone-c'); } }]
        });
    }
  }

  /* ── 派发任务（管理视角）── */
  function uniqueOwners() {
    var set = {};
    CD().AL.concat(CD().AD).forEach(function (x) { if (x.owner) set[x.owner] = 1; });
    ['市场运营', '增长团队', '投放负责人', '报价运营', '客户成功', '平台产品', '数据团队', 'AI 造物', '平台技术'].forEach(function (o) { set[o] = 1; });
    return Object.keys(set);
  }
  function openDispatch(kind, idx) {
    if (!has() || !window.CockpitTasks) return;
    var a = kind === 'alert' ? CD().AL[idx] : CD().AD[idx];
    if (!a) return;
    var label = kind === 'alert' ? (a.metric || '异常') : (a.title || '建议');
    var owners = uniqueOwners();
    var ownerOpts = owners.map(function (o) {
      return '<option' + (o === a.owner ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    var note = kind === 'alert'
      ? '【预警】' + a.metric + '：' + a.msg + '\nAI 建议动作：' + a.action
      : '【' + a.rank + ' 建议】' + a.title + '：' + a.summary;
    var due = kind === 'alert' ? '24 小时内' : (a.eta || '本周内');
    var body = '<div class="ds-head">派发对象 · <b>' + esc(label) + '</b></div>' +
      '<div class="ds-row"><label>指派给</label><select id="dsOwner" class="ds-sel">' + ownerOpts + '</select></div>' +
      '<div class="ds-row"><label>任务说明</label><textarea id="dsNote" class="ds-ta">' + esc(note) + '</textarea></div>' +
      '<div class="ds-row"><label>处理时限</label><input id="dsDue" class="ds-inp" value="' + esc(due) + '"></div>' +
      '<div class="ds-tip">提交后将由「AI 运营助手」以站内信 + 邮件向负责人发送提醒，并记入任务中心。</div>';
    openModal('派发任务', body, {
      copyText: '',
      actions: [{ label: '确认派发', cls: 'dm-primary', onClick: function () { doDispatch(kind, idx, a); } }]
    });
  }
  function doDispatch(kind, idx, a) {
    var owner = (document.querySelector('#dsOwner') || {}).value || a.owner;
    var note = (document.querySelector('#dsNote') || {}).value || '';
    var due = (document.querySelector('#dsDue') || {}).value || '';
    var task = window.CockpitTasks.add({
      kind: kind, sourceId: a.id || ('R' + idx), sourceIdx: idx,
      title: kind === 'alert' ? (a.metric || '异常') : (a.title || '建议'),
      owner: owner, note: note, due: due
    });
    if (window.CockpitTasks) window.CockpitTasks.notify(task.id);
    openModal('已派发',
      '<div class="ds-done"><span class="ds-check">✓</span><div><b>任务已派发给 ' + esc(owner) + '</b>' +
      '<p>提醒已通过「AI 运营助手」触发（站内信 + 邮件）。任务已写入任务中心，可在顶栏「任务中心」跟踪进度。</p></div></div>',
      { copyText: '', actions: [
        { label: '查看任务中心', cls: 'dm-primary', onClick: function () { closeModal(); if (window.CockpitTasks) window.CockpitTasks.openCenter(); } },
        { label: '继续', cls: '', onClick: function () { closeModal(); } }
      ] });
  }

  /* ── 全局点击委托（仅绑定 app.js 未处理的块）── */
  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target, b;
      if ((b = t.closest('.kpi[data-mid]'))) { openMetric(b.dataset.mid); return; }
      if ((b = t.closest('#metricTbl tbody tr[data-mid]'))) { openMetric(b.dataset.mid); return; }
      if ((b = t.closest('.sd-m[data-mid]'))) { openMetric(b.dataset.mid); return; }
      if ((b = t.closest('#channelTbl tbody tr[data-ci]'))) { openChannel(+b.dataset.ci); return; }
      if ((b = t.closest('.sc[data-id]'))) { openScene(b.dataset.id); return; }
      /* 弹窗内的明细列表条目 */
      if ((b = t.closest('.dm-item[data-mid]'))) { openMetric(b.dataset.mid); return; }
      if ((b = t.closest('.dm-item[data-adv]'))) { openAdvice(+b.dataset.adv); return; }
    });
  }

  window.CockpitModal = {
    openMetric: openMetric, openAlert: openAlert, openScene: openScene,
    openAdvice: openAdvice, openDeep: openDeep, openChannel: openChannel,
    openHeroStat: openHeroStat, openDispatch: openDispatch,
    close: closeModal
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else { bind(); }
})();
