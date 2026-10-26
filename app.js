}
return sec;
}
  function recordsBlock(iso, pfx) {
function recordsBlock(iso, pfx) {
var td = todayDay(), day = C.isoToDay(iso), future = day > td, rec = state.records[iso] || {};
var isStart = state.starts.indexOf(iso) >= 0, last = state.starts[state.starts.length - 1];
var sec = h('section', { 'aria-label': '기록', 'data-section': 'records' }, h('div', { class: 'sec-title' }, h('h3', { text: '기록' })));
@@ -1200,28 +1200,34 @@

// 관계일 · 생리 시작 · 생리 종료는 한 묶음(한 줄)
var bundle = h('div', { class: 'chips', id: pfx + 'rec-bundle', role: 'group', 'aria-label': '관계일·생리 기록' });
    
    // 👇 아내 화면일 때만 관계일 기록 버튼이 보이도록 수정
    if (state.settings.sex && !viewOnly) bundle.appendChild(chip('rec-sex', '관계일', rec.sex, future, function () { setRecord(iso, 'sex'); }));
    
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
    
    // 👇 아내 화면일 때만 관계일 기록 버튼이 보이도록 수정
    if (state.settings.sex && !viewOnly) bundle.appendChild(chip('rec-sex', '관계일', rec.sex, future, function () { setRecord(iso, 'sex'); }));

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
@@ -1264,9 +1270,7 @@
if (info && viewOnly) {
info.early = null; 
}

      var comp = day <= td ? C.completion(state, iso) : { total: 0, done: 0 };
      var isActualStart = state.starts.indexOf(iso) >= 0;
      
// ... (아래 기존 코드 유지) ...
var comp = day <= td ? C.completion(state, iso) : { total: 0, done: 0 };
var isActualStart = state.starts.indexOf(iso) >= 0;
@@ -1324,6 +1328,7 @@ function legend() {
return h('div', { class: 'legend', 'aria-label': '범례', id: 'legend' },
h('span', null, s('lv3'), '가임기'),
h('span', null, '◆ 배란일'),
      h('span', null, '♥ 관계일'),
// 👇 남편 뷰가 아닐 때만 얼리임테기 범례 표시
(!viewOnly ? h('span', null, s('er'), '얼리임테기') : null),
h('span', null, s('bd'), '생리'),
