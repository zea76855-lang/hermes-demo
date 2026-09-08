/* ═══════════════════════════════════════════════════════
   AI 市场运营驾驶舱 · 任务中心（管理视角）
   预警 / 建议弹窗中的「派发任务」写入此处，持久化到 localStorage，
   顶栏角标实时更新；支持站内信 + 邮件提醒模拟、查看来源、标记完成。
   依赖 modal.js 的 openAlert / openAdvice 做「查看来源」跳转。
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var KEY = 'rd_cockpit_tasks_v1';
  var tasks = [];
  var mask, drawer, bodyEl, countEl, reminderEl;

  function load() {
    try { tasks = JSON.parse(localStorage.getItem(KEY) || '[]') || []; }
    catch (e) { tasks = []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch (e) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (e) { return ''; }
  }

  /* ── 任务写入 ── */
  function add(t) {
    var task = {
      id: 'T' + Date.now().toString(36).toUpperCase(),
      kind: t.kind || 'advice',
      sourceId: t.sourceId || '',
      sourceIdx: (typeof t.sourceIdx === 'number') ? t.sourceIdx : -1,
      title: t.title || '未命名任务',
      owner: t.owner || '未指派',
      note: t.note || '',
      due: t.due || '',
      status: 'open',
      createdAt: new Date().toISOString()
    };
    tasks.unshift(task);
    save();
    renderList();
    updateBadge();
    return task;
  }
  function setStatus(id, st) {
    var t = tasks.filter(function (x) { return x.id === id; })[0];
    if (t) { t.status = st; save(); renderList(); updateBadge(); }
  }
  function notify(id) {
    var t = tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (!reminderEl) {
      reminderEl = document.createElement('div');
      reminderEl.className = 'tc-reminder'; reminderEl.id = 'tcReminder';
      document.body.appendChild(reminderEl);
    }
    reminderEl.innerHTML =
      '<span class="tc-r-ico">🔔</span>' +
      '<div class="tc-r-bd"><b>已向 ' + esc(t.owner) + ' 派发任务</b>' +
      '<p>' + esc(t.title) + ' · 时限 ' + esc(t.due) + '</p>' +
      '<small>提醒已触发：站内信 + 邮件（AI 运营助手）</small></div>' +
      '<button class="tc-r-x" aria-label="关闭">×</button>';
    reminderEl.classList.add('on');
    clearTimeout(reminderEl._t);
    reminderEl._t = setTimeout(function () { reminderEl.classList.remove('on'); }, 5200);
    reminderEl.querySelector('.tc-r-x').onclick = function () { reminderEl.classList.remove('on'); };
  }

  /* ── 角标 ── */
  function updateBadge() {
    var b = document.getElementById('taskBadge');
    if (!b) return;
    var open = tasks.filter(function (t) { return t.status !== 'done'; }).length;
    b.textContent = open;
    b.hidden = open === 0;
  }

  /* ── 抽屉 ── */
  function ensureDrawer() {
    if (document.getElementById('tcMask')) return;
    mask = document.createElement('div');
    mask.className = 'tc-mask'; mask.id = 'tcMask';
    mask.innerHTML =
      '<div class="tc-drawer" role="dialog" aria-modal="true">' +
        '<div class="tc-head">' +
          '<h3>任务中心</h3><span class="tc-count" id="tcCount">0</span>' +
          '<button class="tc-x" id="tcX" aria-label="关闭">×</button>' +
        '</div>' +
        '<div class="tc-body" id="tcBody"></div>' +
        '<div class="tc-foot">任务由「AI 运营助手」派发，数据本地留存（演示）。</div>' +
      '</div>';
    document.body.appendChild(mask);
    drawer = mask.querySelector('.tc-drawer');
    bodyEl = mask.querySelector('#tcBody');
    countEl = mask.querySelector('#tcCount');
    mask.addEventListener('click', function (e) { if (e.target === mask) closeCenter(); });
    mask.querySelector('#tcX').addEventListener('click', closeCenter);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mask.classList.contains('on')) closeCenter();
    });
    // 任务项事件委托
    bodyEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-tid]');
      if (!btn) return;
      var id = btn.dataset.tid, act = btn.dataset.act;
      if (act === 'done') setStatus(id, 'done');
      else if (act === 'reopen') setStatus(id, 'open');
      else if (act === 'view') {
        var t = tasks.filter(function (x) { return x.id === id; })[0];
        if (t && t.sourceIdx >= 0 && window.CockpitModal) {
          closeCenter();
          if (t.kind === 'alert') window.CockpitModal.openAlert(t.sourceIdx);
          else window.CockpitModal.openAdvice(t.sourceIdx);
        }
      }
    });
  }

  function renderList() {
    if (!bodyEl) return;
    countEl.textContent = tasks.length;
    updateBadge();
    if (!tasks.length) {
      bodyEl.innerHTML = '<div class="tc-empty">暂无派发任务。<br>在预警 / 建议弹窗中点击「派发任务」即可创建。</div>';
      return;
    }
    bodyEl.innerHTML = tasks.map(function (t) {
      var tag = t.kind === 'alert' ? '预警' : '建议';
      var st = t.status === 'done' ? '<span class="tc-st done">已完成</span>' : '<span class="tc-st open">进行中</span>';
      var foot = t.status === 'done'
        ? '<button class="tc-i-btn ghost" data-tid="' + t.id + '" data-act="reopen">重新打开</button>'
        : '<button class="tc-i-btn primary" data-tid="' + t.id + '" data-act="done">标记完成</button>';
      var view = (t.sourceIdx >= 0)
        ? '<button class="tc-i-btn" data-tid="' + t.id + '" data-act="view">查看来源</button>' : '';
      return '<div class="tc-item ' + (t.status === 'done' ? 'is-done' : '') + '">' +
        '<div class="tc-i-top"><span class="tc-tag ' + t.kind + '">' + tag + '</span>' + st +
        '<b>' + esc(t.title) + '</b></div>' +
        '<div class="tc-i-meta">负责人 <span>' + esc(t.owner) + '</span> · 时限 ' + esc(t.due) +
        ' · ' + fmtTime(t.createdAt) + '</div>' +
        (t.note ? '<div class="tc-i-note">' + esc(t.note).replace(/\n/g, '<br>') + '</div>' : '') +
        '<div class="tc-i-foot">' + foot + view + '</div>' +
      '</div>';
    }).join('');
  }

  function openCenter() {
    ensureDrawer();
    renderList();
    mask.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function closeCenter() {
    if (!mask) return;
    mask.classList.remove('on');
    document.body.style.overflow = '';
  }

  function init() {
    load();
    ensureDrawer();
    updateBadge();
    var btn = document.getElementById('taskCenterBtn');
    if (btn) btn.addEventListener('click', openCenter);
  }

  window.CockpitTasks = {
    add: add, setStatus: setStatus, notify: notify,
    openCenter: openCenter, close: closeCenter, init: init,
    list: function () { return tasks; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
