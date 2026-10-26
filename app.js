/* app.js — 임신 준비 캘린더 UI
 * 보안 원칙: innerHTML/인라인 핸들러 미사용(모든 텍스트는 textContent), 외부 통신 없음,
 * 건강 정보(날짜·항목명·기록)는 로그/에러 화면에 절대 출력하지 않는다. (SEC-02, SEC-03, SEC-06, SEC-12)
 */
(function () {
  'use strict';
  var C = window.PPCore;
  var STORE_KEY = 'ppcal.v1';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* =============== 저장소 (기기 내 저장, 실패 시 메모리로 폴백: FR-30, FR-33) =============== */
  var Store = (function () {
    var mode = 'local', mem = null, ls = null;
    try { ls = window.localStorage; ls.setItem('__ppcal_probe__', '1'); ls.removeItem('__ppcal_probe__'); }
    catch (e) { ls = null; mode = 'memory'; }
    return {
      mode: function () { return mode; },
      read: function () {
        if (ls && mode === 'local') { try { return ls.getItem(STORE_KEY); } catch (e) { mode = 'memory'; } }
        return mem;
      },
      write: function (str) {
        if (ls && mode === 'local') { try { ls.setItem(STORE_KEY, str); return true; } catch (e) { mode = 'memory'; } }
        mem = str; return false;
      },
      clear: function () { mem = null; if (ls) { try { ls.removeItem(STORE_KEY); } catch (e) { /* 무시 */ } } }
    };
  })();

  /* =============== 오류 처리: 사용자에게는 일반 메시지만, 로그에는 코드만 (SEC-03, SEC-06) =============== */
  function reportError(code) {
    try { console.error('ppcal.error', code); } catch (e) { /* 무시 */ }
    var app = document.getElementById('app');
    if (!app || document.getElementById('err-banner')) return;
    var b = document.createElement('div');
    b.id = 'err-banner'; b.className = 'banner err'; b.setAttribute('role', 'alert');
    b.style.margin = '12px 20px 0';
    var t = document.createElement('span'); t.textContent = '문제가 생겼어요. 새로고침한 뒤 다시 시도해 주세요. (오류 코드 ' + code + ')';
    b.appendChild(t); app.insertBefore(b, app.firstChild);
  }
  window.addEventListener('error', function () { reportError('E-RUNTIME'); });
  window.addEventListener('unhandledrejection', function () { reportError('E-ASYNC'); });

  /* =============== 상태 =============== */
  function todayDay() { return C.todayDayFromDate(new Date()); }
  function todayISO() { return C.dayToISO(todayDay()); }

  function loadState() {
    var raw = null, s = Store.read();
    if (s) { try { raw = JSON.parse(s); } catch (e) { raw = null; } }
    return C.sanitizeState(raw, todayDay());
  }

  /* ---- 파트너 공유 링크(#s=...) ----
   * 데이터는 URL 해시에만 담겨 서버로 전송되지 않는다.
   * 링크로 열린 화면(viewOnly)은 읽기 전용이며 어떤 값도 저장소에 쓰지 않는다. */
  function encodeShare(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj)), s = '', i;
    for (i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeShare(b64) {
    try {
      var bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/')), bytes = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (e) { return null; }
  }
  var viewOnly = false, shareMeta = null, shareBad = false;
  var state;
  (function () {
    var hash = window.location.hash || '';
    if (hash.indexOf('#s=') !== 0) { state = loadState(); return; }
    viewOnly = true;
    var m = /^#s=([A-Za-z0-9_-]{1,2000})$/.exec(hash);              // 길이·문자 제한
    var res = m ? C.sanitizeShare(decodeShare(m[1]), todayDay()) : null;
    if (res) { state = res.state; shareMeta = { nick: res.nick, shared: res.shared }; }
    else { state = C.freshState(); shareBad = true; }                  // 잘못된 링크는 거부(fail-closed)
  })();

  var ui = { screen: 'consent', datesMode: 'onboarding', draft: null, month: null, selected: null, addDraft: '', addError: '', storageLost: false };
  var planCache = { key: '', plan: null };
  var sheetEl = null, popupEl = null;

  function save() {
    if (viewOnly) return;   // 공유 화면은 보는 사람의 저장소를 절대 건드리지 않음
    var ok = Store.write(JSON.stringify(state));
    if (!ok && Store.mode() === 'memory') ui.storageLost = true;
  }
  function initUi() {
    var td = todayDay(), p = C.dayToParts(td);
    ui.selected = C.dayToISO(td); ui.month = { y: p.y, m: p.m };
    if (viewOnly) ui.screen = shareBad ? 'shareError' : 'home';
    else ui.screen = !state.consent ? 'consent' : (state.starts.length < 2 ? 'dates' : 'home');
    ui.datesMode = 'onboarding';
    ui.draft = draftFromState();
    if (!viewOnly && Store.mode() === 'memory') ui.storageLost = true;
  }
  function draftFromState() {
    var s = state.starts, e = function (x) { return (x && state.ends[x]) || ''; }, nick = state.nick || '';
    if (s.length === 3) return { nick: nick, a: s[0], aE: e(s[0]), b: s[1], bE: e(s[1]), c: s[2], cE: e(s[2]), third: true };
    if (s.length === 2) return { nick: nick, a: '', aE: '', b: s[0], bE: e(s[0]), c: s[1], cE: e(s[1]), third: false };
    return { nick: nick, a: '', aE: '', b: '', bE: '', c: '', cE: '', third: false };
  }
  function getPlan() {
    if (state.starts.length < 2) return null;
    var key = state.starts.join(',') + '|' + state.starts.map(function (x) { return state.ends[x] || ''; }).join(',');
    if (planCache.key !== key) {
      planCache = { key: key, plan: C.buildPlan(state.starts.map(C.isoToDay), state.starts.map(function (x) { return state.ends[x] ? C.isoToDay(state.ends[x]) : null; })) };
    }
    return planCache.plan;
  }

  /* =============== DOM 헬퍼 (innerHTML 금지) =============== */
  var FORBIDDEN_PROPS = { innerHTML: 1, outerHTML: 1, srcdoc: 1, style: 1 };
  function h(tag, props) {
    var el = document.createElement(tag), i;
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (FORBIDDEN_PROPS[k]) throw new Error('forbidden prop');
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  var ICONS = {
    back: ['M15 5l-7 7 7 7'], next: ['M9 5l7 7-7 7'], check: ['M5 12.5l4.5 4.5L19 7.5'], plus: ['M12 5v14M5 12h14'],
    up: ['M6 14l6-6 6 6'], down: ['M6 10l6 6 6-6'], close: ['M6 6l12 12M18 6L6 18'],
    trash: ['M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'], pencil: ['M4 20l4-1 10-10-3-3L5 16l-1 4z'],
    sliders: ['M4 6h8M18 6h2M4 12h2M12 12h8M4 18h10M20 18h0', 'M12 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M6 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M14 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0']
  };
  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ico'); svg.setAttribute('aria-hidden', 'true');
    ICONS[name].forEach(function (d) { var p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }
  function randomId() {
    var a = new Uint8Array(5); window.crypto.getRandomValues(a);
    return 'c_' + Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /* =============== 토스트 / 다이얼로그 =============== */
  var toastTimer = null;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.className = 'toast show' + (isError ? ' error' : '');
    el.setAttribute('role', isError ? 'alert' : 'status');
    if (el.showPopover) { try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch (e) { /* 무시 */ } }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = 'toast';
      if (el.hidePopover) { try { el.hidePopover(); } catch (e) { /* 무시 */ } }
    }, 2600);
  }
  function openModal(opts) {
    var dlg = h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });
    var actions = h('div', { class: 'actions' });
    (opts.actions || []).forEach(function (a) {
      actions.appendChild(h('button', {
        class: 'btn ' + (a.kind || ''), type: 'button', text: a.label, id: a.id || null,
        onclick: function () { var r = a.onClick ? a.onClick(dlg) : undefined; if (r !== false) dlg.close(); }
      }));
    });
    dlg.appendChild(h('div', { class: 'modal-in' }, h('h2', { id: 'modal-title', text: opts.title }), h('div', { class: 'body' }, opts.body), actions));
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg); dlg.showModal();
    return dlg;
  }
  function para(t) { return h('p', { text: t }); }

  /* =============== 포맷 도우미 =============== */
  function monthLabel() { return ui.month.y + '년 ' + ui.month.m + '월'; }
  function pushState(fn) { fn(); save(); render(); }

  /* =============== 렌더링 (포커스·스크롤 보존) =============== */
  function captureFocus() {
    var a = document.activeElement;
    if (!a || !a.getAttribute) return null;
    var fid = a.getAttribute('data-fid');
    return fid ? { fid: fid, inSheet: !!(sheetEl && sheetEl.contains(a)), inPopup: !!(popupEl && popupEl.contains(a)) } : null;
  }
  function restoreFocus(f, scope) {
    if (!f) return;
    var el = scope.querySelector('[data-fid="' + CSS.escape(f.fid) + '"]');
    if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
  }
  function render(opts) {
    opts = opts || {};
    var f = captureFocus(), sy = window.scrollY, root = document.getElementById('app');
    var errBanner = document.getElementById('err-banner');
    var screens = { consent: consentScreen, dates: datesScreen, items: itemsScreen, home: homeScreen, manage: manageScreen, settings: settingsScreen, shareError: shareErrorScreen };
    var node = screens[ui.screen]();
    root.replaceChildren(node);
    if (errBanner) root.insertBefore(errBanner, root.firstChild);
    if (opts.focusTitle) { var t = root.querySelector('[data-title]'); if (t) { t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true }); } }
    else if (f && !f.inSheet && !f.inPopup) restoreFocus(f, root);
    window.scrollTo(0, opts.top ? 0 : sy);
    if (sheetEl) renderSheet();
    if (popupEl) renderPopup();
  }
  function go(screen, extra) {
    closeSheet(); closePopup();
    ui.screen = screen; if (extra) Object.keys(extra).forEach(function (k) { ui[k] = extra[k]; });
    render({ focusTitle: true, top: true });

    // 👇 화면이 바뀔 때마다 GA4에 어느 화면(screen)인지 전송하는 코드
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', { page_title: screen, page_path: '/' + screen });
    }
  }

  /* =============== 공통 컴포넌트 =============== */
  function topBar(title, onBack, right) {
    return h('div', { class: 'top' },
      onBack ? h('button', { class: 'icon-btn', type: 'button', id: 'btn-back', 'aria-label': '뒤로', onclick: onBack }, icon('back')) : h('span', { class: 'spacer', 'aria-hidden': 'true' }),
      title ? h('h1', { text: title }) : null,
      right || h('span', { class: 'spacer', 'aria-hidden': 'true' }));
  }
  function switchBtn(label, checked, onToggle, fid) {
    return h('button', {
      class: 'switch', type: 'button', role: 'switch', 'aria-checked': checked ? 'true' : 'false', 'aria-label': label,
      'data-fid': fid || null, onclick: onToggle
    });
  }

  /* =============== S0. 안내/동의 =============== */
  function infoRow(mark, title, desc) {
    return h('div', { class: 'info-row' }, h('div', { class: 'badge', 'aria-hidden': 'true', text: mark }), h('div', null, h('h3', { text: title }), h('p', { text: desc })));
  }
  function showPolicy() {
    openModal({
      title: '개인정보 안내',
      body: h('div', { class: 'policy' },
        h('h3', { text: '저장하는 정보' }),
        h('ul', null, h('li', { text: '닉네임, 생리 시작·종료일, 체크 항목과 체크 기록, 관계일·임테기 기록' })),
        h('h3', { text: '저장 위치' }),
        h('ul', null,
          h('li', { text: '위 정보는 이 기기 안에만 저장해요. 서버나 분석 도구로 보내지 않아요.' }),
          h('li', { text: '화면 이동·버튼 클릭 같은 이용 통계만 익명으로 수집해요.' }),
          h('li', { text: '파트너 공유 링크를 만들면 닉네임과 생리 시작·종료일이 링크 안에 담겨요. 서버에는 저장되지 않아요.' })),
        h('h3', { text: '보관과 삭제' }),
        h('ul', null, h('li', { text: '기록은 최근 24개월까지 보관하고, 오래된 기록은 자동으로 지워져요.' }), h('li', { text: '설정에서 언제든 모든 정보를 한 번에 삭제할 수 있어요.' })),
        h('h3', { text: '참고용 서비스예요' }),
        h('ul', null, h('li', { text: '진단·치료·피임 목적으로 쓸 수 없어요. 걱정되는 점은 병원에서 상담해 보세요.' }))),
      actions: [{ label: '확인', kind: 'secondary', id: 'policy-close' }]
    });
  }
  function consentScreen() {
    return h('main', { class: 'screen' },
      topBar(null, null),
      h('img', { class: 'hero-img', src: 'https://babyangel-pi.vercel.app/thumbnail1.png', alt: '생리주기만 입력하면 가임기와 배란일을 알려줘요!' }),
      h('p', { class: 'consent-note', text: '참고용 예측이에요 · 내 기기에만 저장돼요 · 필요한 건강정보만 다뤄요' }),
      h('div', { class: 'footer-actions' },
        h('button', { class: 'btn', type: 'button', id: 'consent-ok', 'data-fid': 'consent-ok', text: '동의하고 시작하기', onclick: function () {
          // 👇 GA 추적 코드 추가
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '동의하고_시작하기' });
          state.consent = true; save(); ui.datesMode = 'onboarding'; go('dates');
        } }),
        h('button', { class: 'link-btn', type: 'button', id: 'consent-policy', text: '자세히 보기', onclick: showPolicy }),
        h('p', { class: 'muted email-contact', text: '문의 prayforyou.official@gmail.com' })
      ));
  }

  /* =============== S1. 닉네임 + 생리 시작일 입력 =============== */
  function datesScreen() {
    var td = todayDay(), max = C.dayToISO(td), d = ui.draft, edit = ui.datesMode === 'edit';
    var derived = h('div', { id: 'dates-derived', 'aria-live': 'polite' });
    var nextBtn = h('button', { class: 'btn', type: 'button', id: 'dates-next', 'data-fid': 'dates-next', disabled: true, text: edit ? '저장하기' : '다음', onclick: onNext });

    function list() {
      var l = [];
      if (d.third && d.a) l.push({ start: d.a, end: d.aE });
      l.push({ start: d.b, end: d.bE }, { start: d.c, end: d.cE });
      return l;
    }
    function update() {
      derived.replaceChildren(); nextBtn.disabled = true;
      var l = list();
      if (l.some(function (x) { return !x.start; })) return;
      var v = C.validatePeriods(l, td);
      if (!v.ok) { derived.appendChild(h('p', { class: 'field-error', role: 'alert', id: 'dates-error', text: v.errors[0] })); return; }
      derived.appendChild(h('p', { class: 'field-ok', id: 'dates-cycle', text: '주기 ' + v.cycleLen + '일로 계산돼요' }));
      if (v.periodLen) derived.appendChild(h('p', { class: 'field-ok', id: 'dates-period', text: '생리 ' + v.periodLen + '일로 계산돼요' }));
      v.warnings.forEach(function (w) { derived.appendChild(h('p', { class: 'field-warn', id: 'dates-warn', text: w })); });
      nextBtn.disabled = !C.cleanNick(d.nick);   // 닉네임은 필수
    }
    function onNext() {
      // 👇 GA 추적 코드 유지됨
      if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: edit ? '생리기간_저장하기' : '생리기간_다음' });
      var l = list(), v = C.validatePeriods(l, td);
      if (!v.ok) { update(); return; }
      if (!C.cleanNick(d.nick)) { update(); return; }
      state.nick = C.cleanNick(d.nick);
      var ends = Object.create(null);
      l.forEach(function (p) { if (p.end) ends[p.start] = p.end; });
      state.starts = v.days.map(C.dayToISO); state.ends = ends; save();
      ui.selected = C.dayToISO(td); var tp = C.dayToParts(td); ui.month = { y: tp.y, m: tp.m };
      if (edit) { toast('저장했어요'); go('home'); }
      else go('items');
    }
    function field(id, label, key, aria) {
      var inp = h('input', { type: 'date', id: id, max: max, min: '2000-01-01', 'aria-label': aria, 'data-fid': id });
      inp.value = d[key] || '';
      inp.addEventListener('input', function () { d[key] = inp.value; update(); });
      return h('label', { class: 'field' }, h('span', { class: 'label', text: label }), inp);
    }
    function group(title, sid, sKey, eid, eKey) {
      return h('div', { class: 'period-group' },
        h('p', { class: 'group-label', text: title }),
        h('div', { class: 'field-pair' }, field(sid, '시작일', sKey, title + ' 시작일'), field(eid, '종료일 (선택)', eKey, title + ' 종료일')));
    }
    var nickInp = h('input', { type: 'text', id: 'in-nick', maxlength: String(C.NICK_MAX), placeholder: '예: 하늘맘', autocomplete: 'nickname', 'aria-label': '닉네임', 'data-fid': 'in-nick' });
    nickInp.value = d.nick || '';
    nickInp.addEventListener('input', function () { d.nick = nickInp.value; update(); });
    var nickField = h('label', { class: 'field' }, h('span', { class: 'label', text: '닉네임 (필수 · 최대 ' + C.NICK_MAX + '자)' }), nickInp);

    var node = h('main', { class: 'screen' },
      topBar(null, function () { if (edit) go('settings'); else { state.consent = false; save(); go('consent'); } }),
      h('h1', { class: 'title', 'data-title': '1', text: '마지막 생리을 알려주세요' }),
      h('p', { class: 'lead', text: '생리를 시작한 날과 끝난 날을 입력해 주세요. 종료일을 모르면 비워 두어도 괜찮아요.' }),

      nickField,
      h('p', { class: 'muted', text: '파트너와 캘린더를 공유할 때 \'닉네임님\'으로 보여요.' }),

      // 👇 입력 순서: 마지막 생리 -> 이전 생리 -> 그 이전 생리
      group('마지막 생리', 'in-c', 'c', 'in-cE', 'cE'),
      group('이전 생리', 'in-b', 'b', 'in-bE', 'bE'),
      d.third ? group('그 이전 생리 (선택)', 'in-a', 'a', 'in-aE', 'aE') : null,

      derived,
      h('button', { class: 'link-btn', type: 'button', id: 'dates-toggle-third', text: d.third ? '더 이전 날짜 추가 안 하기' : '생리 주기 더 추가하기 (선택)', onclick: function () { d.third = !d.third; if (!d.third) { d.a = ''; d.aE = ''; } render(); } }),
      h('p', { class: 'muted', text: '3번의 기간을 입력하면 주기가 불규칙한지도 함께 살펴봐요. 종료일을 입력하면 다음 생리 예정 기간도 보여줘요.' }),
      h('div', { class: 'footer-actions' }, nextBtn));
    update();
    return node;
  }

  /* =============== 체크 항목 편집기 (온보딩 S1-2 / 관리 S4 공용) =============== */
  function findItem(id) { return state.items.filter(function (i) { return i.id === id; })[0]; }
  function setItemEnabled(id, on) {
    var it = findItem(id); if (!it) return;
    var td = todayISO();
    pushState(function () {
      if (on) { if (!it.enabled) { it.from = td; it.prio = C.nextPrio(state.items); } it.enabled = true; it.to = null; it.deleted = false; }
      else { it.enabled = false; it.to = td; }
    });
  }
  function addCustom(raw) {
    var name = C.cleanName(raw);
    if (!name) return '항목 이름을 입력해 주세요.';
    var customs = state.items.filter(function (i) { return !i.tpl && !i.deleted; });
    if (customs.length >= C.CUSTOM_MAX) return '직접 추가는 최대 ' + C.CUSTOM_MAX + '개까지 가능해요.';
    var low = name.toLowerCase();
    if (state.items.some(function (i) { return !i.deleted && i.name.toLowerCase() === low; })) return '이미 있는 항목이에요.';
    state.items.push({ id: randomId(), name: name, group: '직접 추가', tpl: false, enabled: true, from: todayISO(), to: null, deleted: false, prio: C.nextPrio(state.items) });
    save(); return '';
  }
  function movePriority(id, dir) { pushState(function () { C.movePrio(state.items, id, dir); }); }
  function renameCustom(it) {
    var inp = h('input', { class: 'text-input', type: 'text', id: 'rename-input', maxlength: String(C.NAME_MAX), 'aria-label': '항목 이름' });
    inp.value = it.name;
    var err = h('p', { class: 'field-error', role: 'alert', id: 'rename-error' });
    openModal({
      title: '항목 이름 바꾸기', body: [inp, err],
      actions: [
        { label: '저장', id: 'rename-save', onClick: function () {
          var name = C.cleanName(inp.value);
          if (!name) { err.textContent = '항목 이름을 입력해 주세요.'; return false; }
          var low = name.toLowerCase();
          if (state.items.some(function (i) { return i.id !== it.id && !i.deleted && i.name.toLowerCase() === low; })) { err.textContent = '이미 있는 항목이에요.'; return false; }
          it.name = name; save(); render(); toast('이름을 바꿨어요');
        } },
        { label: '취소', kind: 'ghost', id: 'rename-cancel' }]
    });
    inp.focus(); inp.select();
  }
  function deleteCustom(it) {
    openModal({
      title: '\'' + it.name + '\' 항목을 삭제할까요?',
      body: para('지난 체크 기록을 남겨둘지 함께 지울지 골라 주세요.'),
      actions: [
        { label: '항목만 삭제 (기록 유지)', kind: 'secondary', id: 'del-keep', onClick: function () {
          it.deleted = true; it.enabled = false; it.to = todayISO(); save(); render(); toast('항목을 삭제했어요. 지난 기록은 남겨뒀어요');
        } },
        { label: '기록까지 삭제', kind: 'danger', id: 'del-all', onClick: function () {
          state.items = state.items.filter(function (i) { return i.id !== it.id; });
          Object.keys(state.checks).forEach(function (iso) { delete state.checks[iso][it.id]; if (!Object.keys(state.checks[iso]).length) delete state.checks[iso]; });
          save(); render(); toast('항목과 기록을 모두 삭제했어요');
        } },
        { label: '취소', kind: 'ghost', id: 'del-cancel' }]
    });
  }
  function itemsEditor(opts) {
    var wrap = h('div');
    if (opts && opts.priority) {
      wrap.appendChild(h('div', { class: 'list-title', text: '우선순위' }));
      var ranked = C.rankedItems(state.items);
      if (!ranked.length) {
        wrap.appendChild(h('div', { class: 'list' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'desc', id: 'prio-empty', text: '켜 둔 항목이 없어요. 아래에서 챙길 항목을 켜 보세요.' })))));
      } else {
        wrap.appendChild(h('div', { class: 'list', id: 'prio-list' }, ranked.map(function (it, idx) {
          return h('div', { class: 'row', 'data-prio': it.id, 'data-rank': String(idx + 1) },
            h('span', { class: 'rank', 'aria-hidden': 'true', text: String(idx + 1) }),
            h('div', { class: 'grow' }, h('div', { class: 'name', text: it.name }), h('div', { class: 'desc', text: it.group })),
            h('div', { class: 'mini-btns' },
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': it.name + ' 우선순위 올리기', 'data-fid': 'pup-' + it.id, disabled: idx === 0, onclick: function () { movePriority(it.id, -1); } }, icon('up')),
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': it.name + ' 우선순위 내리기', 'data-fid': 'pdn-' + it.id, disabled: idx === ranked.length - 1, onclick: function () { movePriority(it.id, 1); } }, icon('down'))));
        })));
        wrap.appendChild(h('p', { class: 'note', id: 'prio-note', text: '위에 있을수록 먼저 보여요. 체크 화면에도 이 순서대로 나와요.' }));
      }
    }
    ['영양제', '생활'].forEach(function (g) {
      wrap.appendChild(h('div', { class: 'list-title', text: g }));
      wrap.appendChild(h('div', { class: 'list' }, state.items.filter(function (i) { return i.tpl && i.group === g; }).map(function (it) {
        return h('div', { class: 'row' + (it.enabled ? '' : ' is-off'), 'data-item': it.id },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: it.name })),
          switchBtn(it.name + ' 사용', it.enabled, function () { setItemEnabled(it.id, !it.enabled); }, 'sw-' + it.id));
      })));
    });
    var customs = state.items.filter(function (i) { return !i.tpl && !i.deleted; });
    wrap.appendChild(h('div', { class: 'list-title', text: '직접 추가' }));
    if (customs.length) {
      wrap.appendChild(h('div', { class: 'list' }, customs.map(function (it, idx) {
        return h('div', { class: 'row' + (it.enabled ? '' : ' is-off'), 'data-item': it.id },
          switchBtn(it.name + ' 사용', it.enabled, function () { setItemEnabled(it.id, !it.enabled); }, 'sw-' + it.id),
          h('div', { class: 'grow' }, h('div', { class: 'name', text: it.name })),
          h('div', { class: 'mini-btns' },
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': it.name + ' 이름 바꾸기', 'data-fid': 'ren-' + it.id, onclick: function () { renameCustom(it); } }, icon('pencil')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': it.name + ' 삭제', 'data-fid': 'del-' + it.id, onclick: function () { deleteCustom(it); } }, icon('trash'))));
      })));
    }
    var inp = h('input', { class: 'text-input', type: 'text', id: 'add-name', 'data-fid': 'add-name', maxlength: String(C.NAME_MAX), placeholder: '예: 마그네슘, 스트레칭', 'aria-label': '새 항목 이름' });
    inp.value = ui.addDraft;
    function submit() {
      var err = addCustom(inp.value);
      if (err) { ui.addError = err; ui.addDraft = inp.value; render(); return; }
      ui.addError = ''; ui.addDraft = ''; render(); toast('항목을 추가했어요');
    }
    inp.addEventListener('input', function () { ui.addDraft = inp.value; });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    wrap.appendChild(h('div', { class: 'add-row' }, inp, h('button', { class: 'btn secondary', type: 'button', id: 'add-btn', 'data-fid': 'add-btn', onclick: submit }, icon('plus'), '추가')));
    wrap.appendChild(h('p', { class: 'field-error', id: 'add-error', role: 'alert', text: ui.addError || null }));
    return wrap;
  }
  function anyEnabled() { return state.items.some(function (i) { return i.enabled && !i.deleted; }); }

  /* =============== S1-2. 체크 항목 선택 (온보딩) =============== */
  function itemsScreen() {
    return h('main', { class: 'screen' },
      topBar(null, function () { ui.datesMode = 'onboarding'; ui.draft = draftFromState(); go('dates'); }),
      h('h1', { class: 'title', 'data-title': '1', text: '챙기고 싶은 항목을 골라보세요' }),
      h('p', { class: 'lead', text: '나중에 언제든 바꿀 수 있어요. 건너뛰어도 괜찮아요.' }),
      itemsEditor(),
      h('div', { class: 'footer-actions' },
        h('button', { class: 'btn' + (anyEnabled() ? '' : ' secondary'), type: 'button', id: 'items-done', 'data-fid': 'items-done', text: anyEnabled() ? '시작하기' : '건너뛰기', onclick: function () {
          // 👇 GA 추적 코드 추가 (시작하기 / 건너뛰기 둘 다 잡아냄)
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: anyEnabled() ? '항목선택_시작하기' : '항목선택_건너뛰기' });
          go('home');
        } })));
  }

  /* =============== S4. 체크 항목 관리 =============== */
  function manageScreen() {
    return h('main', { class: 'screen' },
      topBar('체크 항목 관리', function () { go('home'); }),
      itemsEditor({ priority: true }));
  }

  /* =============== S5. 설정·데이터 =============== */
  function showHelp() {
    openModal({
      title: '계산 방식과 도움말',
      body: h('div', { class: 'policy' },
        h('h3', { text: '이렇게 계산해요' }),
        h('ul', null,
          h('li', { text: '주기: 입력한 생리 시작일 사이의 일수예요. (3개를 입력하면 최근 두 주기의 평균)' }),
          h('li', { text: '생리: 종료일을 입력하면 평균 기간으로 다음 생리 예정 기간을 보여줘요. (종료일을 모르면 5일로 가정)' }),
          h('li', { text: '배란 예정일: 다음 생리 예정일의 14일 전이에요.' }),
          h('li', { text: '가임기: 배란 예정일 5일 전부터 1일 후까지 7일이에요. 배란 예정일 2일 전~당일이 가장 가능성이 높아요.' }),
          h('li', { text: '얼리임테기: 배란 8일 후부터 해볼 수 있고, 10일 후부터 권장해요. 정확한 검사는 생리 예정일 이후예요.' })),
        h('h3', { text: '알아두세요' }),
        h('ul', null,
          h('li', { text: '배란 시기는 사람마다, 주기마다 달라서 실제와 며칠 차이날 수 있어요.' }),
          h('li', { text: '얼리임테기가 음성이어도 아직 모를 수 있어요. 며칠 뒤 다시 검사해 보세요.' }),
          h('li', { text: '주기가 불규칙하거나, 1년(35세 이상은 6개월) 넘게 임신이 되지 않으면 병원 상담을 권해요.' }))),
      actions: [{ label: '확인', kind: 'secondary', id: 'help-close' }]
    });
  }

  /* ---- 파트너 공유 링크 만들기 ---- */
  function buildShareUrl() {
    // 기록·체크 항목은 담지 않는다: 닉네임, 생리 시작·종료일, 공유한 날짜만
    var payload = { v: 1, n: state.nick, d: todayISO(), s: state.starts, e: state.ends };
    return window.location.href.split('#')[0] + '#s=' + encodeShare(payload);
  }
  function copyShare(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { toast('공유 링크를 복사했어요. 메신저에 붙여넣어 주세요'); },
        function () { toast('복사하지 못했어요. 다시 시도해 주세요', true); });
    } else toast('이 브라우저에서는 복사를 지원하지 않아요', true);
  }
  function shareCalendar() {
    if (!state.nick) {
      toast('먼저 닉네임을 설정해 주세요', true);
      ui.datesMode = 'edit'; ui.draft = draftFromState(); go('dates');
      return;
    }
    if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '설정_캘린더공유' });
    var url = buildShareUrl();
    if (navigator.share) navigator.share({ title: state.nick + '님의 임신 준비 캘린더', url: url }).catch(function () { copyShare(url); });
    else copyShare(url);
  }

  function settingsScreen() {
    var sums = state.starts.map(function (x) { var a = C.mdLabel(C.isoToDay(x)); return state.ends[x] ? a + '~' + C.mdLabel(C.isoToDay(state.ends[x])) : a; }).join(', ');
    return h('main', { class: 'screen' },
      topBar('설정', function () { go('home'); }),
      h('div', { class: 'list' },
        h('button', { class: 'row-btn', type: 'button', id: 'set-dates', 'data-fid': 'set-dates', onclick: function () { ui.datesMode = 'edit'; ui.draft = draftFromState(); go('dates'); } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: '닉네임 · 생리 수정' }), h('div', { class: 'desc', text: (state.nick ? state.nick + ' · ' : '') + sums })), icon('next')),
        h('button', { class: 'row-btn', type: 'button', id: 'set-manage', 'data-fid': 'set-manage', onclick: function () { go('manage'); } },
          h('div', { class: 'grow' }, h('div', { class: 'name', text: '체크 항목 관리' })), icon('next'))),
      h('div', { class: 'list-title', text: '기록' }),
      h('div', { class: 'list' },
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: '관계일 기록 사용' }), h('div', { class: 'desc', text: '날짜마다 관계일을 남길 수 있어요' })),
          switchBtn('관계일 기록 사용', state.settings.sex, function () { pushState(function () { state.settings.sex = !state.settings.sex; }); }, 'sw-sex')),
        h('div', { class: 'row' + (state.settings.sex ? '' : ' is-off') }, h('div', { class: 'grow' }, h('div', { class: 'name', text: '캘린더에 ♥로 표시' }), h('div', { class: 'desc', text: '끄면 눈에 띄지 않는 작은 점으로만 표시돼요' })),
          h('button', { class: 'switch', type: 'button', role: 'switch', id: 'sw-sexmark', 'aria-checked': state.settings.sexMark ? 'true' : 'false', 'aria-label': '캘린더에 ♥로 표시', disabled: !state.settings.sex, 'data-fid': 'sw-sexmark',
            onclick: function () { pushState(function () { state.settings.sexMark = !state.settings.sexMark; }); } })),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 'name', text: '임신 확인 모드' }), h('div', { class: 'desc', text: '가임기·검사 시기 표시를 숨겨요' })),
          switchBtn('임신 확인 모드', state.settings.pregnancy, function () { setPregnancy(!state.settings.pregnancy); }, 'sw-preg'))),
      h('div', { class: 'list-title', text: '안내' }),
      h('div', { class: 'list' },
        h('button', { class: 'row-btn', type: 'button', id: 'set-help', onclick: showHelp }, h('div', { class: 'grow' }, h('div', { class: 'name', text: '계산 방식과 도움말' })), icon('next')),
        h('button', { class: 'row-btn', type: 'button', id: 'set-policy', onclick: showPolicy }, h('div', { class: 'grow' }, h('div', { class: 'name', text: '개인정보 안내' })), icon('next'))),
      h('p', { class: 'note', text: '기록은 최근 24개월까지 보관하고, 오래된 기록은 자동으로 지워져요. 모든 정보는 이 기기 안에만 있어요.' }),

      h('div', { class: 'footer-actions' },
        h('div', { class: 'card' },
          h('h3', { text: '👨‍👩‍👦 파트너에게 캘린더 공유' }),
          h('p', { class: 'muted', text: '닉네임과 생리만 공유돼요. 관계일·임테기·체크 기록은 공유되지 않아요. 링크를 아는 사람은 누구나 볼 수 있으니 파트너에게만 보내 주세요.' }),
          h('button', { class: 'btn secondary', type: 'button', id: 'share-copy', text: '🔗 공유 링크 보내기', onclick: shareCalendar }),
          h('button', { class: 'btn', type: 'button', text: '💬 카카오톡으로 톡 보내기', onclick: function () {
            toast('카카오톡 연동은 준비 중이에요');
          } })
        ),

        // GA 추적 코드가 포함된 데이터 전체 삭제 버튼
        h('button', { class: 'btn danger', type: 'button', id: 'set-delete-all', text: '내 정보 전체 삭제', onclick: function () {
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '설정_데이터전체삭제' });
          confirmDeleteAll();
        } }),
        h('p', { class: 'muted email-contact', text: '문의 prayforyou.official@gmail.com' })
      )
    );
  }
  function setPregnancy(on) { pushState(function () { state.settings.pregnancy = on; }); toast(on ? '임신 확인 모드로 바꿨어요' : '가임기 표시를 다시 켰어요'); }

  function confirmDeleteAll() {
    openModal({
      title: '모든 정보를 삭제할까요?',
      body: para('닉네임, 생리 시작일, 체크 항목과 기록, 설정이 모두 지워지고 되돌릴 수 없어요.'),
      actions: [
        { label: '삭제하기', kind: 'danger', id: 'delete-confirm', onClick: function () {
          Store.clear(); state = C.freshState(); planCache = { key: '', plan: null };
          ui.addDraft = ''; ui.addError = ''; initUi(); ui.storageLost = Store.mode() === 'memory'; go('consent'); toast('모든 정보를 삭제했어요');
        } },
        { label: '취소', kind: 'ghost', id: 'delete-cancel' }]
    });
  }

  /* =============== 체크·기록 동작 =============== */
  function toggleCheck(iso, id) {
    if (C.isoToDay(iso) > todayDay()) return;
    pushState(function () {
      var m = state.checks[iso] || (state.checks[iso] = Object.create(null));
      if (m[id]) delete m[id]; else m[id] = true;
      if (!Object.keys(m).length) delete state.checks[iso];
    });
  }
  function setRecord(iso, key, val) {
    pushState(function () {
      var r = state.records[iso] || (state.records[iso] = {});
      if (key === 'test') { if (r.test === val) delete r.test; else r.test = val; }
      else if (key === 'sex') { if (r.sex) delete r.sex; else r.sex = true; }
      if (!r.sex && !r.test) delete state.records[iso];
    });
  }
  function setTest(iso, val) {
    if (C.isoToDay(iso) > todayDay()) return;
    setRecord(iso, 'test', val);
    var r = state.records[iso];
    if (r && r.test === 'pos') showPositive();
    else if (r && r.test === 'neg') {
      var plan = getPlan(), fc = plan ? plan.cycles.filter(function (c) { return c.predicted; })[0] : null;
      if (!state.settings.pregnancy && fc && C.isoToDay(iso) >= fc.earlyStart) toast('음성이어도 며칠 뒤 다시 검사해 보세요');
    }
  }
  function showPositive() {
    var already = state.settings.pregnancy;
    openModal({
      title: '축하드려요',
      body: [para('임테기 결과가 양성이에요.'), para('정확한 확인을 위해 가까운 병원에서 임신 여부를 확인해 보세요.')],
      actions: [
        already ? null : { label: '임신 확인 모드로 바꾸기', id: 'pos-mode', onClick: function () { setPregnancy(true); } },
        { label: '닫기', kind: already ? '' : 'ghost', id: 'pos-close' }].filter(Boolean)
    });
  }
  function recordPeriod(iso) {
    var res = C.canAddPeriodStart(state.starts, iso, todayDay());
    if (!res.ok) { toast(res.error, true); return; }
    pushState(function () { state.starts = C.addPeriodStart(state.starts, iso); pruneEnds(); });
    var v = C.validateStarts(state.starts, todayDay());
    toast('생리 시작일을 기록했어요. 주기 ' + (v.cycleLen || '') + '일로 다시 계산했어요' + (res.warning ? ' (' + res.warning + ')' : ''));
  }
  function cancelPeriod(iso) {
    if (state.starts.length <= 2 || state.starts[state.starts.length - 1] !== iso) return;
    pushState(function () { state.starts = state.starts.slice(0, -1); pruneEnds(); });
    toast('생리 시작 기록을 취소했어요');
  }
  function pruneEnds() { Object.keys(state.ends).forEach(function (k) { if (state.starts.indexOf(k) < 0) delete state.ends[k]; }); }
  function recordPeriodEnd(iso) {
    var res = C.canSetPeriodEnd(state.starts, iso, todayDay());
    if (!res.ok) { toast(res.error, true); return; }
    pushState(function () { state.ends[res.start] = iso; });
    toast('생리 종료일을 기록했어요 (생리 ' + res.len + '일)' + (res.warning ? ' · ' + res.warning : ''));
  }
  function cancelPeriodEnd(startIso) {
    pushState(function () { delete state.ends[startIso]; });
    toast('생리 종료 기록을 취소했어요');
  }
  function dismissGuide(key) {
    pushState(function () {
      var keys = Object.keys(state.dismissed);
      if (keys.length >= 150) keys.slice(0, 50).forEach(function (k) { delete state.dismissed[k]; });
      state.dismissed[key] = true;
    });
  }
  function selectDate(iso) {
    var p = C.dayToParts(C.isoToDay(iso));
    ui.selected = iso; ui.month = { y: p.y, m: p.m }; render();
  }
  function shiftMonth(delta) {
    var m = ui.month.m + delta, y = ui.month.y;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    if (y < 2000 || y > 2100) return;
    ui.month = { y: y, m: m }; render();
  }

  /* =============== 날짜별 체크리스트 / 기록 블록 (패널·시트 공용) =============== */
  function checklistBlock(iso, pfx) {
    var td = todayDay(), day = C.isoToDay(iso), future = day > td, isToday = day === td;
    var list = C.itemsForDate(state, iso), checks = state.checks[iso] || {}, comp = C.completion(state, iso);
    var sec = h('section', { 'aria-label': '체크리스트', 'data-section': 'checklist' },
      h('div', { class: 'sec-title' },
        h('h3', { text: isToday ? '오늘의 체크' : C.mdLabel(day) + ' 체크' }),
        list.length ? h('span', { class: 'count', 'data-testid': 'count', text: comp.done + ' / ' + comp.total }) : h('span'),
        h('button', { class: 'link-btn', type: 'button', id: pfx + 'manage-link', 'data-fid': pfx + 'manage-link', text: '항목 관리', onclick: function () { go('manage'); } })));
    if (list.length) {
      list.forEach(function (it) {
        var on = !!checks[it.id];
        sec.appendChild(h('button', {
          class: 'chk', type: 'button', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', 'aria-disabled': future ? 'true' : null,
          disabled: future, 'data-item': it.id, 'data-fid': pfx + 'chk-' + it.id, onclick: function () { toggleCheck(iso, it.id); }
        }, h('span', { class: 'box' }, icon('check')), h('span', { class: 'lbl', text: it.name })));
      });
      if (future) sec.appendChild(h('p', { class: 'note', text: '아직 오지 않은 날짜는 체크할 수 없어요.' }));
    } else if (!anyEnabled()) {
      sec.appendChild(h('div', { class: 'empty' }, h('p', { text: '아직 체크 항목이 없어요.' }),
        h('button', { class: 'btn secondary small', type: 'button', id: pfx + 'empty-add', text: '항목 추가하기', onclick: function () { go('manage'); } })));
    } else {
      sec.appendChild(h('div', { class: 'empty' }, h('p', { text: future ? '아직 오지 않은 날짜예요.' : '이 날짜에 해당하는 항목이 없어요.' })));
    }
    return sec;
  }
  function recordsBlock(iso, pfx) {
    var td = todayDay(), day = C.isoToDay(iso), future = day > td, rec = state.records[iso] || {};
    var isStart = state.starts.indexOf(iso) >= 0, last = state.starts[state.starts.length - 1];
    var sec = h('section', { 'aria-label': '기록', 'data-section': 'records' }, h('div', { class: 'sec-title' }, h('h3', { text: '기록' })));
    var chip = function (id, text, pressed, disabled, fn) {
      return h('button', { class: 'chip', type: 'button', id: pfx + id, 'data-fid': pfx + id, 'aria-pressed': pressed ? 'true' : 'false', disabled: disabled, text: text, onclick: fn });
    };
    var ctxStart = null;
    state.starts.forEach(function (x) { if (x <= iso) ctxStart = x; });
    var inRange = !!ctxStart && day - C.isoToDay(ctxStart) <= 13;
    var endIso = inRange ? (state.ends[ctxStart] || null) : null;

    // 관계일 · 생리 시작 · 생리 종료는 한 묶음(한 줄)
    var bundle = h('div', { class: 'chips', id: pfx + 'rec-bundle', role: 'group', 'aria-label': '관계일·생리 기록' });
    if (state.settings.sex) bundle.appendChild(chip('rec-sex', '관계일', rec.sex, future, function () { setRecord(iso, 'sex'); }));
    if (isStart) {
      if (iso === last && state.starts.length > 2) bundle.appendChild(chip('rec-period-cancel', '생리 기록 취소', true, false, function () { cancelPeriod(iso); }));
    } else {
      bundle.appendChild(chip('rec-period', '생리', false, future, function () { recordPeriod(iso); }));
    }
    // 생리 종료 기록 (복구): 이날이 종료일로 기록돼 있으면 '취소', 아니면 '생리 종료'
    if (inRange) {
      if (endIso === iso) bundle.appendChild(chip('rec-period-end-cancel', '생리 종료 취소', true, false, function () { cancelPeriodEnd(ctxStart); }));
      else bundle.appendChild(chip('rec-period-end', '생리 종료', false, future, function () { recordPeriodEnd(iso); }));
    }
    if (bundle.children.length) sec.appendChild(bundle);

    sec.appendChild(h('div', { class: 'rec-label', id: pfx + 'test-label', text: '임테기 결과' }));
    var seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': pfx + 'test-label' });
    [['neg', '음성'], ['pos', '양성'], ['faint', '흐린 선']].forEach(function (o) {
      seg.appendChild(h('button', {
        type: 'button', role: 'radio', 'aria-checked': rec.test === o[0] ? 'true' : 'false', disabled: future,
        id: pfx + 'test-' + o[0], 'data-fid': pfx + 'test-' + o[0], text: o[1], onclick: function () { setTest(iso, o[0]); }
      }));
    });
    sec.appendChild(seg);
    if (future) sec.appendChild(h('p', { class: 'note', text: '아직 오지 않은 날짜는 기록할 수 없어요.' }));
    return sec;
  }

  /* =============== 가임기 곡선 =============== */
  function curveBlock(plan, day) {
    var c = C.nextFertileCycle(plan, day);
    if (!c) return null;
    var inside = day >= c.fertileStart && day <= c.fertileEnd;
    var wrap = h('div', { class: 'curve-wrap', 'data-section': 'curve' },
      h('div', { class: 'cap', id: 'curve-cap', text: (inside ? '이번 가임기 ' : '다음 가임기 ') + C.mdShortWd(c.fertileStart) + ' ~ ' + C.mdShortWd(c.fertileEnd) + (c.predicted ? '' : ' (추정)') }));
    var row = h('div', { class: 'curve', role: 'group', 'aria-label': '가임기 단계별 가능성' });
    C.curve(c).forEach(function (pt) {
      var iso = C.dayToISO(pt.day);
      row.appendChild(h('button', {
        class: 'cv' + (pt.day === day ? ' on' : ''), type: 'button', 'data-date': iso, 'data-level': String(pt.level), 'data-fid': 'cv-' + iso,
        'aria-label': C.mdLabel(pt.day) + ' 가임기 ' + C.LEVEL_LABEL[pt.level] + (pt.offset === 0 ? ', 배란 예정일' : ''), 'aria-pressed': pt.day === day ? 'true' : 'false',
        onclick: function () { selectDate(iso); }
      }, h('span', { class: 'o', 'aria-hidden': 'true', text: pt.offset === 0 ? '◆' : '' }), h('span', { class: 'col h' + pt.level }), h('span', { class: 'd', text: C.dayWd(pt.day) })));
    });
    wrap.appendChild(row);
    return wrap;
  }

  /* =============== S2. 홈 캘린더 =============== */
  function cellLabel(day, info, comp, hasRec, sexMark) {
    var parts = [C.fullLabel(day)];
    if (info) { var s = C.statusText(info); if (s) parts.push(s); }
    if (comp && comp.total) parts.push('체크 ' + comp.total + '개 중 ' + comp.done + '개 완료');
    if (sexMark) parts.push('관계일');
    if (hasRec) parts.push('기록 있음');
    return parts.join(', ');
  }
  function calendar(plan) {
    var td = todayDay(), y = ui.month.y, m = ui.month.m;
    var first = C.isoToDay(y + '-' + C.pad2(m) + '-01'), dim = C.daysInMonth(y, m), lead = C.weekday(first);
    var preg = state.settings.pregnancy;
    var grid = h('div', { class: 'cal', id: 'cal-grid', role: 'group', 'aria-label': monthLabelText() });
    var i;
    for (i = 0; i < lead; i++) grid.appendChild(h('div', { class: 'cell-empty', 'aria-hidden': 'true' }));
    for (i = 0; i < dim; i++) {
      var day = first + i, iso = C.dayToISO(day), info = plan && !preg ? C.dayInfo(plan, day) : null;
      
      // 남편 공유 화면일 때 얼리임테기 정보 강제 삭제
      if (info && viewOnly) {
        info.early = null; 
      }

      var comp = day <= td ? C.completion(state, iso) : { total: 0, done: 0 };
      var isActualStart = state.starts.indexOf(iso) >= 0;
      var rr = state.records[iso];
      var hasRec = !!rr || isActualStart;

      // 관계일: 아내 화면(!viewOnly)이면서 설정이 켜져 있을 때만 ♥ 표시
      var sexMark = !!(rr && rr.sex && state.settings.sex && state.settings.sexMark && !viewOnly);

      var cls = 'cell';
      if (info && info.level) cls += ' lv-' + info.level;
      if (info && info.early === 'rec') cls += ' early-rec';
      if (info && info.early === 'low') cls += ' early-low';
      if (info && info.uncertain) cls += ' uncertain';
      if (info && info.bleed === 'actual') cls += ' bleed';
      else if (info && info.bleed === 'predicted') cls += ' bleed-pred';
      if (day === td) cls += ' is-today';
      if (iso === ui.selected) cls += ' is-selected';
      if (day > td) cls += ' is-future';

      var ev = '';
      if (info && info.isOvulation) ev = '◆';
      else if (isActualStart) ev = '▲';
      else if (info && info.period === 'predicted') ev = '△';

      var attrs = {
        class: cls, type: 'button', 'data-date': iso, 'data-fid': 'cell-' + iso, 'aria-label': cellLabel(day, info, comp, hasRec, sexMark),
        'aria-pressed': iso === ui.selected ? 'true' : 'false', onclick: (function (x) { return function () { selectDate(x); }; })(iso)
      };
      if (info) {
        attrs['data-level'] = String(info.level);
        if (info.isOvulation) attrs['data-ovulation'] = '1';
        if (info.early) attrs['data-early'] = info.early;
        if (info.period) attrs['data-period'] = info.period;
        if (info.bleed) attrs['data-bleed'] = info.bleed;
        if (info.uncertain) attrs['data-uncertain'] = '1';
      } else if (isActualStart) attrs['data-period'] = 'actual';
      if (comp.total) attrs['data-progress'] = comp.done + '/' + comp.total;
      if (hasRec) attrs['data-rec'] = '1';
      if (sexMark) attrs['data-sex'] = '1';

      var cell = h('button', attrs, h('span', { class: 'num', text: String(i + 1) }), ev ? h('span', { class: 'ev', 'aria-hidden': 'true', text: ev }) : null,
        sexMark ? h('span', { class: 'heart', 'aria-hidden': 'true', text: '♥' }) : null,
        comp.total ? h('span', { class: 'bar', 'aria-hidden': 'true' }, h('i')) : null);
      if (comp.total) cell.querySelector('.bar i').style.setProperty('--p', String(comp.done / comp.total));
      grid.appendChild(cell);
    }
    return grid;
  }
  function monthLabelText() { return ui.month.y + '년 ' + ui.month.m + '월 달력'; }

  function legend() {
    if (state.settings.pregnancy) return null;
    var s = function (cls) { return h('i', { class: 'sw ' + cls }); };
    return h('div', { class: 'legend', 'aria-label': '범례', id: 'legend' },
      h('span', null, s('lv3'), '가임기'),
      h('span', null, '◆ 배란일'),
      (!viewOnly ? h('span', null, s('er'), '얼리임테기') : null),
      h('span', null, s('bd'), '생리'),
      h('span', null, '△ 생리 예정'),
      (state.settings.sex && state.settings.sexMark && !viewOnly ? h('span', { id: 'legend-sex' }, '♥ 관계일') : null)
    );
  }

  function panel(plan) {
    var td = todayDay(), iso = ui.selected, day = C.isoToDay(iso), isToday = day === td;
    var preg = state.settings.pregnancy;
    var info = plan && !preg ? C.dayInfo(plan, day) : null;
    var g = plan && !preg ? C.guidance(plan, day, td) : null;

    var shortText = '';
    if (g) {
      shortText = g.title;
    } else if (info) {
      var status = C.statusText(info);
      if (status) shortText = status.split(' · ')[0];
    }
    // 만약의 경우를 대비해 13자 이상이면 자르는 안전장치
    if (shortText.length > 13) shortText = shortText.substring(0, 12) + '…';

    // 날짜 형식을 '10월 22일(목)' 형태로 조합
    var displayDate = C.mdLabel(day) + '(' + C.WEEKDAYS[C.weekday(day)] + ')';

    var el = h('section', { class: 'panel', id: 'day-panel', 'aria-label': displayDate + ' 상세' },
      h('div', { class: 'panel-head' },
        h('div', { class: 'panel-title-wrap' },
          h('h2', { id: 'panel-title' }, displayDate, isToday ? h('span', { class: 'tag tag-today', text: '오늘' }) : null),
          shortText ? h('button', {
            class: 'panel-short-btn',
            type: 'button',
            onclick: openSheet,
            text: shortText + ' >'
          }) : null
        )
      )
    );

    if (plan && !preg) { var cv = curveBlock(plan, day); if (cv) el.appendChild(cv); }

    // 기록(records) 위젯이 체크리스트(checklist)보다 먼저. 파트너 공유 화면(읽기 전용)에서는 둘 다 숨김
    if (!viewOnly) {
      el.appendChild(recordsBlock(iso, ''));
      el.appendChild(checklistBlock(iso, ''));
    }

    return el;
  }
  function homeScreen() {
    var plan = getPlan(), preg = state.settings.pregnancy, td = todayDay();
    var tp = C.dayToParts(td), notToday = ui.selected !== C.dayToISO(td) || ui.month.y !== tp.y || ui.month.m !== tp.m;
    var calCard = h('div', { class: 'cal-card' },
      h('div', { class: 'cal-head' },
        h('button', { class: 'icon-btn', type: 'button', id: 'month-prev', 'data-fid': 'month-prev', 'aria-label': '이전 달', onclick: function () { shiftMonth(-1); } }, icon('back')),
        h('div', { class: 'month' }, h('span', { id: 'month-label', 'aria-live': 'polite', text: monthLabel() }),
          notToday ? h('button', { class: 'today-btn', type: 'button', id: 'btn-today', 'data-fid': 'btn-today', text: '오늘', onclick: function () { initToday(); render(); } }) : null),
        h('button', { class: 'icon-btn', type: 'button', id: 'month-next', 'data-fid': 'month-next', 'aria-label': '다음 달', onclick: function () { shiftMonth(1); } }, icon('next'))),
      h('div', { class: 'weekdays', 'aria-hidden': 'true' }, C.WEEKDAYS.map(function (w) { return h('span', { text: w }); })),
      calendar(plan), legend());

    // 파트너(남편) 공유 화면: 읽기 전용
    if (viewOnly) return h('main', { class: 'screen' }, shareHeader(), shareDueBanner(plan), calCard, panel(plan));

    return h('main', { class: 'screen' },
      h('div', { class: 'top' }, h('h1', { 'data-title': '1', text: '임신 준비 캘린더' }),
        h('button', { class: 'icon-btn', type: 'button', id: 'btn-settings', 'data-fid': 'btn-settings', 'aria-label': '설정', onclick: function () {
          // 👇 GA 추적 코드 추가
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '홈_설정' });
          go('settings');
        } }, icon('sliders'))),
      ui.storageLost ? h('div', { class: 'banner warn', id: 'storage-banner', role: 'status' }, h('span', { text: '이 환경에서는 저장할 수 없어서, 앱을 닫으면 입력한 내용이 사라져요.' })) : null,
      preg ? h('div', { class: 'banner preg', id: 'preg-banner' }, h('span', { text: '임신 확인 모드예요. 가임기·검사 시기 표시를 숨겼어요.' }), h('button', { type: 'button', id: 'preg-off', text: '되돌리기', onclick: function () { setPregnancy(false); } })) : null,
      calCard,
      panel(plan));
  }
  function initToday() {
    var td = todayDay(), p = C.dayToParts(td);
    ui.selected = C.dayToISO(td); ui.month = { y: p.y, m: p.m };
  }

  /* =============== 파트너(남편) 공유 화면 =============== */
  // 타이틀: [닉네임님]과 [남편님]의 임신 준비 캘린더 (26/11/04 버전)  — 이름은 색 구분, 버전은 공유한 날짜
  function shareHeader() {
    return h('div', { class: 'share-head' },
      h('h1', { class: 'share-title', 'data-title': '1' },
        h('span', { class: 'highlight-name', text: shareMeta.nick + '님' }), '과 ',
        h('span', { class: 'highlight-partner', text: '남편님' }), '의 임신 준비 캘린더 ',
        h('span', { class: 'title-version', text: '(' + C.shareVersionLabel(shareMeta.shared) + ' 버전)' })));
  }
  // 공유된 캘린더의 '다음 생리 예정일'이 오늘이거나 지났으면 업데이트가 필요한 상태
  function shareDue(plan) { return !!plan && todayDay() >= plan.nextPeriod; }
  function shareDueBanner(plan) {
    if (!shareDue(plan)) return null;
    return h('div', { class: 'banner warn', id: 'share-due-banner', role: 'status' }, h('span', { text: shareMeta.nick + '님에게 캘린더 업데이트를 요청해주세요' }));
  }
  function showShareDuePopup() {
    openModal({
      title: '캘린더 업데이트가 필요해요',
      body: [para('우리 아기를 만나기 위해서'), para(shareMeta.nick + '님에게 캘린더 업데이트를 요청해주세요!')],
      actions: [{ label: '확인', id: 'share-due-ok' }]
    });
  }
  function shareErrorScreen() {
    return h('main', { class: 'screen' }, topBar(null, null),
      h('h1', { class: 'title', 'data-title': '1', text: '공유 링크를 열 수 없어요' }),
      h('p', { class: 'lead', text: '링크가 잘못됐거나 일부만 복사됐을 수 있어요. 캘린더를 공유한 분께 새 링크를 요청해 주세요.' }));
  }

  /* =============== S3. 날짜 상세 (바텀시트) =============== */
  function levelText(info, plan) {
    var lines = [];
    if (info.level) {
      var o = info.offset, rel = o === 0 ? '배란 예정일' : (o < 0 ? '배란 예정일 ' + (-o) + '일 전' : '배란 예정일 ' + o + '일 후');
      lines.push(rel + '이에요. 이날 관계했을 때 임신 가능성은 가임기 중 \'' + C.LEVEL_LABEL[info.level] + '\' 단계예요.');
    }
    if (info.early) lines.push('배란 ' + info.offset + '일 후예요. 얼리임테기는 ' + (info.early === 'low' ? '해볼 수 있지만 정확도가 낮아요.' : '권장 구간이에요. 음성이면 며칠 뒤 다시 검사해 보세요.'));
    if (info.uncertain) lines.push('주기가 불규칙해서 가임기가 이 근처일 수도 있어요.');
    if (info.period === 'predicted') lines.push('생리 예정일이에요. 이날부터 정확한 검사가 가능해요.');
    if (lines.length) lines.push('배란 시기는 사람마다, 주기마다 달라서 며칠 차이날 수 있어요.');
    return lines;
  }
  function closeSheet() { var d = sheetEl; if (!d) return; sheetEl = null; try { d.close(); } catch (e) { /* 무시 */ } d.remove(); }
  function openSheet() {
    if (sheetEl) return;
    var dlg = h('dialog', { class: 'sheet', 'aria-labelledby': 'sheet-title', id: 'sheet' });
    sheetEl = dlg;
    dlg.addEventListener('close', function () { if (sheetEl === dlg) sheetEl = null; dlg.remove(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closeSheet(); });
    document.body.appendChild(dlg);
    renderSheet();
    dlg.showModal();
  }
  function renderSheet() {
    if (!sheetEl) return;
    var f = captureFocus(), sy = sheetEl.scrollTop;
    var td = todayDay(), iso = ui.selected, day = C.isoToDay(iso), preg = state.settings.pregnancy, plan = getPlan();
    var info = plan && !preg ? C.dayInfo(plan, day) : null, g = plan && !preg ? C.guidance(plan, day, td) : null;
    var inner = h('div', { class: 'sheet-in' },
      h('div', { class: 'sheet-grab', 'aria-hidden': 'true' }),
      h('div', { class: 'sheet-top' },
        h('h2', { id: 'sheet-title', text: C.fullLabel(day) }),
        h('button', { class: 'icon-btn', type: 'button', id: 'sheet-close', 'data-fid': 'sh-close', 'aria-label': '닫기', onclick: closeSheet }, icon('close'))));
    if (g || (info && levelText(info, plan).length)) {
      var ex = h('div', { class: 'explain', id: 'sheet-explain' });
      if (g) ex.appendChild(h('p', null, h('strong', { text: g.title })));
      if (g) ex.appendChild(h('p', { text: g.body }));
      if (info) levelText(info, plan).forEach(function (t) { ex.appendChild(h('p', { text: t })); });
      inner.appendChild(ex);
    }

    // 오늘의 체크리스트만 남기고, 기록(관계일, 생리, 임테기) 블록은 시트에서 제외. 공유 화면에서는 체크리스트도 숨김
    if (!viewOnly) inner.appendChild(checklistBlock(iso, 'sh-'));

    sheetEl.replaceChildren(inner);
    sheetEl.scrollTop = sy;
    if (f && f.inSheet) restoreFocus(f, sheetEl);
  }

  /* =============== 오늘의 체크 팝업 (첫 생리 설정 이후, 앱을 열 때) =============== */
  // 오늘 체크할 항목이 있고 아직 다 하지 않았을 때만 띄운다. '오늘 안 보기'를 누른 날(popupHide)에는 띄우지 않는다.
  function popupDue() {
    var td = todayISO();
    if (state.popupHide && td <= state.popupHide) return false;
    var c = C.completion(state, td);
    return c.total > 0 && c.done < c.total;
  }
  function maybeShowPopup() {
    if (ui.screen === 'home' && state.consent && state.starts.length >= 2 && popupDue()) openPopup();
  }
  function closePopup() { var d = popupEl; if (!d) return; popupEl = null; try { d.close(); } catch (e) { /* 무시 */ } d.remove(); }
  function hidePopupToday() {
    state.popupHide = todayISO(); save();
    closePopup(); render(); toast('오늘은 다시 안 보여드릴게요');
  }
  function openPopup() {
    if (popupEl) return;
    var dlg = h('dialog', { class: 'modal popup', id: 'today-popup', 'aria-labelledby': 'popup-title' });
    popupEl = dlg;
    dlg.addEventListener('close', function () { if (popupEl === dlg) popupEl = null; dlg.remove(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) closePopup(); });
    document.body.appendChild(dlg);
    renderPopup();
    dlg.showModal();
  }
  function renderPopup() {
    if (!popupEl) return;
    var f = captureFocus(), sy = popupEl.scrollTop;
    var td = todayDay(), iso = C.dayToISO(td), list = C.itemsForDate(state, iso), checks = state.checks[iso] || {}, comp = C.completion(state, iso);
    var rows = list.map(function (it) {
      var on = !!checks[it.id];
      return h('button', { class: 'chk', type: 'button', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', 'data-item': it.id, 'data-fid': 'pp-chk-' + it.id, onclick: function () { toggleCheck(iso, it.id); } },
        h('span', { class: 'box' }, icon('check')), h('span', { class: 'lbl', text: it.name }));
    });
    popupEl.replaceChildren(h('div', { class: 'modal-in' },
      h('div', { class: 'popup-head' },
        h('div', null, h('h2', { id: 'popup-title', text: '오늘의 체크' }), h('p', { class: 'status', id: 'popup-sub', text: C.fullLabel(td) })),
        h('span', { class: 'popup-count', id: 'popup-count', text: comp.done + ' / ' + comp.total }),
        h('button', { class: 'icon-btn', type: 'button', id: 'popup-close', 'data-fid': 'pp-close', 'aria-label': '닫기', onclick: function () {
          // 👇 GA 추적 코드 추가 (X버튼)
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '팝업_X닫기' });
          closePopup();
        } }, icon('close'))),
      h('div', { class: 'popup-list' }, rows),
      h('div', { class: 'actions two' },
        h('button', { class: 'btn secondary', type: 'button', id: 'popup-today', text: '오늘 안 보기', onclick: function () {
          // 👇 GA 추적 코드 추가 (오늘 안보기)
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '팝업_오늘안보기' });
          hidePopupToday();
        } }),
        h('button', { class: 'btn', type: 'button', id: 'popup-ok', text: '확인', onclick: function () {
          // 👇 GA 추적 코드 추가 (확인)
          if (typeof window.gtag === 'function') window.gtag('event', 'click_button', { button_name: '팝업_확인' });
          closePopup();
        } })
      )
    ));
    popupEl.scrollTop = sy;
    if (f && f.inPopup) restoreFocus(f, popupEl);
  }

  /* =============== 시작 =============== */
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !sheetEl) render(); });
  initUi();
  render({ focusTitle: false });
  // 파트너 공유 화면: 공유된 캘린더의 다음 생리 예정일이 되면 업데이트 요청 팝업
  if (viewOnly) { if (shareDue(getPlan())) showShareDuePopup(); }
  else maybeShowPopup();
})();
