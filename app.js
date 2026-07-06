/* 나의 하루 — vanilla JS + localStorage, 빌드 없음 */
'use strict';

// ---------- state ----------
const LS = 'myday-v1';
const state = Object.assign(
  { tasks: [], events: [], notes: '', apiKey: '', pomoDone: 0, sessions: [], updatedAt: 0, gistToken: '', gistId: '', workMin: 25, breakMin: 5, dayStart: '00:00', dayEnd: '00:00' },
  JSON.parse(localStorage.getItem(LS) || '{}')
);
const save = () => { state.updatedAt = Date.now(); localStorage.setItem(LS, JSON.stringify(state)); schedulePush(); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- dates ----------
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());   // 달력상 오늘(월 달력·미니달력용)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

// ---------- 논리적 하루 (하루 시작~끝 시간 기준, 자정 넘김 지원) ----------
const timeMin = d => d.getHours() * 60 + d.getMinutes();
const hm2min = s => { const [h, m] = (s || '00:00').split(':').map(Number); return h * 60 + m; };
function dayBounds() {
  const start = hm2min(state.dayStart), end = hm2min(state.dayEnd);
  const crosses = end <= start;                       // 끝<=시작 이면 자정을 넘김(예: 09:00~02:00, 기본 00:00~00:00=24h)
  const len = (crosses ? 1440 - start + end : end - start) || 1440;
  return { start, end, crosses, len };
}
// 어떤 시각이 속한 '논리적 날짜' — 자정 넘김 하루면 끝 시간 전까지는 전날로 귀속
function logicalDate(t) {
  const b = dayBounds(), d = new Date(t);
  if (b.crosses && timeMin(d) < b.end) return ymd(addDays(d, -1));
  return ymd(d);
}
const logicalToday = () => logicalDate(new Date());
// 시각(타임스탬프)의 트랙 내 위치 비율(0~1) — 하루 시작 기준 경과분 / 하루 길이
function dayPosFrac(t) {
  const b = dayBounds();
  const off = ((timeMin(new Date(t)) - b.start) % 1440 + 1440) % 1440;
  return Math.min(1, Math.max(0, off / b.len));
}

let weekStart = monday(new Date());
let calBase = new Date(); calBase.setDate(1);

// ---------- rollover: 지난 미완료(할 일·진행중·딜레이) → 오늘로 자동 이월 ----------
// ponytail: 며칠 만에 열어도 연쇄 복사되지 않게 carried 플래그로 원본당 한 번만 오늘로 이월
const CARRY = ['todo', 'doing', 'delayed'];
function rolloverTasks(tasks, t) {
  let changed = false;
  for (const task of [...tasks]) {
    if (task.date < t && !task.carried && CARRY.includes(task.status)) {
      task.carried = true;
      tasks.push({ id: uid(), title: task.title, date: t, status: 'todo', order: nextOrder(tasks, t), pomos: 0 });
      changed = true;
    }
  }
  return changed;
}
function nextOrder(tasks, date) {
  return tasks.filter(x => x.date === date).reduce((m, x) => Math.max(m, x.order), -1) + 1;
}

// ---------- board ----------
const board = document.getElementById('board');
const isMobile = () => window.innerWidth <= 900;
// 데스크톱↔모바일 전환 시 접힘 상태 재계산 (디바운스)
let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(renderBoard, 200); });

function renderBoard() {
  const t = logicalToday();   // 하루 시작/끝 기준 '오늘'
  document.getElementById('weekRange').textContent =
    `${weekStart.getMonth() + 1}.${weekStart.getDate()} ~ ${addDays(weekStart, 6).getMonth() + 1}.${addDays(weekStart, 6).getDate()}`;
  board.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    const ds = ymd(d);
    const col = document.createElement('div');
    col.className = 'day' + (ds === t ? ' today' : '');
    if (isMobile() && ds !== t) col.classList.add('collapsed');  // 모바일: 오늘만 펼치고 나머지 접기
    col.innerHTML = `<div class="dayHead"><span>${DAYS[i]}<span class="date">${d.getMonth() + 1}/${d.getDate()}</span></span><span class="hd-right">${ds === t ? '<span class="todayTag">오늘</span>' : ''}<span class="chev">▾</span></span></div>`;
    col.querySelector('.dayHead').addEventListener('click', () => { if (isMobile()) col.classList.toggle('collapsed'); });
    const ul = document.createElement('ul');
    ul.className = 'cards';
    ul.dataset.date = ds;
    state.tasks.filter(x => x.date === ds).sort((a, b) => a.order - b.order)
      .forEach(task => ul.appendChild(cardEl(task)));
    ul.addEventListener('dragover', onDragOver);
    col.appendChild(ul);
    col.appendChild(addForm(ds));
    const tl = document.createElement('div');
    tl.className = 'tlDay';
    tl.innerHTML = `<div class="tlCount" data-count="${ds}"></div>
      <div class="tlRow">
        <div class="tlHours"><span>0시</span><span>12시</span><span>24시</span></div>
        <div class="track" data-date="${ds}"></div>
      </div>`;
    col.appendChild(tl);
    board.appendChild(col);
  }
  renderPomoTasks();
  renderCal();
  renderTimeline();
  renderSchedule();
}

// ---------- 24시간 활동 타임라인 ----------
// dataviz 검증 팔레트 (고정 순서 배정, 순환 금지 — 9번째 작업부터는 회색)
const PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
function renderTimeline() {
  const b = dayBounds();
  const weekDates = [...Array(7)].map((_, i) => ymd(addDays(weekStart, i)));
  // 세션은 '논리적 날짜'로 귀속 (자정 넘김 하루면 끝 시간 전 새벽은 전날로)
  const ses = state.sessions
    .filter(s => weekDates.includes(logicalDate(s.start)))
    .sort((a, b) => a.start - b.start);
  const order = [];
  ses.forEach(s => { if (!order.includes(s.title)) order.push(s.title); });
  const colorOf = i => i < PALETTE.length ? PALETTE[i] : '#898781';
  const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  // 하루 시작/중간/끝 라벨
  const lbl = min => `${Math.floor(((min % 1440) + 1440) % 1440 / 60)}시`;
  const hoursHtml = `<span>${lbl(b.start)}</span><span>${lbl(b.start + b.len / 2)}</span><span>${b.len >= 1440 ? '24시' : lbl(b.start + b.len)}</span>`;
  document.querySelectorAll('.tlHours').forEach(h => h.innerHTML = hoursHtml);
  document.querySelectorAll('.track[data-date]').forEach(track => {
    const daySes = ses.filter(s => logicalDate(s.start) === track.dataset.date);
    let html = '';
    for (const p of [25, 50, 75]) html += `<div class="htick" style="top:${p}%"></div>`;
    daySes.forEach(s => {
      // ponytail: 짧은 구간은 얇으니 최소 2.5% 보정(정확한 시간은 툴팁)
      const top = dayPosFrac(s.start) * 100;
      const hgt = Math.max(s.min / b.len * 100, 2.5);
      html += `<div class="hseg" style="top:${top}%;height:${Math.min(hgt, 100 - top)}%;background:${colorOf(order.indexOf(s.title))}" title="${hhmm(s.start)}~${hhmm(s.start + s.min * 60000)} ${esc(s.title)}"></div>`;
    });
    track.innerHTML = html;
    const cnt = document.querySelector(`.tlCount[data-count="${track.dataset.date}"]`);
    if (cnt) cnt.textContent = daySes.length ? `🍅 집중 ${daySes.length}회` : '';
  });
  document.getElementById('tlLegend').innerHTML = ses.length
    ? order.map((title, i) => `<span><i style="background:${colorOf(i)}"></i>${esc(title)}</span>`).join('')
    : '<span id="tlEmpty">포모도로를 완료하면 각 날짜 아래 세로 막대에 기록됩니다. 할 일을 클릭해 나오는 🍅 버튼으로 시작하세요.</span>';
}

// 버튼: [상태값, 아이콘, 설명] — 같은 상태 다시 누르면 '할 일'로 되돌림(onAct에서 토글)
const ACTS = [
  ['doing', '◐', '진행중'],
  ['done', '✓', '완료'],
  ['delay', '⏭', '딜레이(미루기)'],
  ['skip', '✕', '안 함'],
  ['del', '🗑', '삭제'],
];

function cardEl(task) {
  const li = document.createElement('li');
  li.className = 'card ' + (task.status !== 'todo' ? task.status : '');
  li.draggable = true;
  li.dataset.id = task.id;
  const marks = [];
  if (task.carried) marks.push('<span class="mk" title="다음날로 이월됨">↪</span>');
  if (task.pomos) marks.push(`<span class="mk" title="완료한 포모도로">🍅${task.pomos}</span>`);
  const focusBtn = task.status !== 'done' && task.status !== 'skipped' && task.date === logicalToday()
    ? `<button data-act="focus" title="이 할 일로 포모도로 시작">🍅</button>` : '';
  const actBtns = ACTS.map(([a, ic, t]) => {
    const active = (a === 'delay' ? 'delayed' : a) === task.status;
    return `<button data-act="${a}" class="${active ? 'on' : ''}" title="${t}${active ? ' 해제' : ''}">${ic}</button>`;
  }).join('');
  li.innerHTML = `<span class="title" title="${esc(task.title)}">${esc(task.title)}</span>${marks.join('')}
    <div class="acts">${focusBtn}${actBtns}</div>`;
  li.addEventListener('dragstart', e => { li.classList.add('dragging'); e.dataTransfer.setData('text/plain', task.id); });
  li.addEventListener('dragend', onDragEnd);
  li.querySelectorAll('button').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); onAct(task.id, b.dataset.act); }));
  // 카드 클릭 → 액션 버튼 펼치기/접기 (버튼 클릭은 위에서 전파 차단)
  li.addEventListener('click', () => li.classList.toggle('expanded'));
  return li;
}

// ---------- 일정 달력 (주간 보드 아래 월 달력) ----------
let schedBase = new Date(); schedBase.setDate(1);
function renderSchedule() {
  document.getElementById('schedTitle').textContent = `${schedBase.getFullYear()}년 ${schedBase.getMonth() + 1}월`;
  const start = monday(new Date(schedBase));
  const t = today();
  const byDate = {};
  state.events.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  let html = '<div class="scRow scHead">' + DAYS.map(d => `<div class="scHd">${d}</div>`).join('') + '</div>';
  for (let w = 0; w < 6; w++) {
    html += '<div class="scRow">';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const ds = ymd(d);
      const other = d.getMonth() !== schedBase.getMonth();
      const evs = (byDate[ds] || []).sort((a, b) => a.time.localeCompare(b.time));
      const chips = evs.slice(0, 3).map(e =>
        `<div class="scChip" data-id="${e.id}" title="클릭해서 삭제: ${esc(e.time)} ${esc(e.title)}"><b>${e.time}</b> ${esc(e.title)}</div>`).join('');
      const more = evs.length > 3 ? `<div class="scMore">+${evs.length - 3}개 더</div>` : '';
      html += `<div class="scCell${other ? ' other' : ''}${ds === t ? ' today' : ''}" data-date="${ds}"><div class="scNum">${d.getDate()}</div>${chips}${more}</div>`;
    }
    html += '</div>';
  }
  const grid = document.getElementById('schedGrid');
  grid.innerHTML = html;
  grid.querySelectorAll('.scChip').forEach(c => c.addEventListener('click', ev => {
    ev.stopPropagation();
    if (confirm('이 일정을 삭제할까요?')) { state.events = state.events.filter(x => x.id !== c.dataset.id); save(); renderSchedule(); }
  }));
  grid.querySelectorAll('.scCell').forEach(cell => cell.addEventListener('click', () => {
    document.getElementById('schedDate').value = cell.dataset.date;
    document.getElementById('schedTitleInput').focus();
  }));
}
function addScheduleEvent() {
  const date = document.getElementById('schedDate').value;
  const time = document.getElementById('schedTime').value || '09:00';
  const ti = document.getElementById('schedTitleInput');
  const title = ti.value.trim();
  if (!date) { document.getElementById('schedDate').focus(); return; }
  if (!title) { ti.focus(); return; }
  state.events.push({ id: uid(), date, time, title });
  ti.value = ''; save(); renderSchedule();
}
document.getElementById('schedAddBtn').addEventListener('click', addScheduleEvent);
document.getElementById('schedTitleInput').addEventListener('keydown', e => { if (e.key === 'Enter') addScheduleEvent(); });
document.getElementById('schedPrev').onclick = () => { schedBase.setMonth(schedBase.getMonth() - 1); renderSchedule(); };
document.getElementById('schedNext').onclick = () => { schedBase.setMonth(schedBase.getMonth() + 1); renderSchedule(); };
document.getElementById('schedToday').onclick = () => { schedBase = new Date(); schedBase.setDate(1); renderSchedule(); };

function addForm(date) {
  const div = document.createElement('div');
  div.className = 'addTask';
  div.innerHTML = `<input placeholder="+ 할 일 추가" maxlength="100"><button>＋</button>`;
  const input = div.querySelector('input');
  const add = () => {
    const title = input.value.trim();
    if (!title) return;
    state.tasks.push({ id: uid(), title, date, status: 'todo', order: nextOrder(state.tasks, date), pomos: 0 });
    save(); renderBoard();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  div.querySelector('button').addEventListener('click', add);
  return div;
}

function onAct(id, act) {
  const task = state.tasks.find(x => x.id === id);
  if (!task) return;
  if (act === 'focus') {
    commitSegment();                 // 진행 중이던 집중 구간 기록
    document.getElementById('pomoTask').value = id;
    clearInterval(pomo.timer);
    pomo.mode = 'work'; pomo.left = workSec();
    pomo.segStart = Date.now();
    pomo.timer = setInterval(pomoTick, 1000);
    pomoRender();
    document.getElementById('pomoTime').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (act === 'del') state.tasks = state.tasks.filter(x => x.id !== id);
  if (act === 'done') task.status = task.status === 'done' ? 'todo' : 'done';
  if (act === 'doing') task.status = task.status === 'doing' ? 'todo' : 'doing';
  if (act === 'delay') task.status = task.status === 'delayed' ? 'todo' : 'delayed';
  if (act === 'skip') task.status = task.status === 'skipped' ? 'todo' : 'skipped';
  save(); renderBoard();
}

// ---------- drag & drop: 날짜 이동 + 우선순위(순서) 변경 ----------
function onDragOver(e) {
  e.preventDefault();
  const ul = e.currentTarget;
  const dragging = document.querySelector('.card.dragging');
  if (!dragging) return;
  const after = [...ul.querySelectorAll('.card:not(.dragging)')]
    .find(el => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
  after ? ul.insertBefore(dragging, after) : ul.appendChild(dragging);
}
function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  // DOM 순서를 그대로 state에 반영
  document.querySelectorAll('.cards').forEach(ul => {
    [...ul.children].forEach((li, i) => {
      const task = state.tasks.find(x => x.id === li.dataset.id);
      if (task) { task.date = ul.dataset.date; task.order = i; }
    });
  });
  save(); renderBoard();
}

// ---------- week nav ----------
document.getElementById('prevW').onclick = () => { weekStart = addDays(weekStart, -7); renderBoard(); };
document.getElementById('nextW').onclick = () => { weekStart = addDays(weekStart, 7); renderBoard(); };
document.getElementById('todayW').onclick = () => { weekStart = monday(new Date()); renderBoard(); };

// ---------- mini calendar ----------
function renderCal() {
  document.getElementById('calTitle').textContent = `${calBase.getFullYear()}년 ${calBase.getMonth() + 1}월`;
  const first = new Date(calBase);
  const start = monday(first);
  const t = today();
  const dates = new Set(state.tasks.map(x => x.date));
  let html = '<table><tr>' + DAYS.map(d => `<th>${d}</th>`).join('') + '</tr>';
  for (let w = 0; w < 6; w++) {
    html += '<tr>';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, w * 7 + i);
      const ds = ymd(d);
      const cls = [d.getMonth() !== calBase.getMonth() ? 'other' : '', ds === t ? 'today' : ''].join(' ');
      html += `<td class="${cls}" data-date="${ds}">${d.getDate()}${dates.has(ds) ? '<span class="dot"></span>' : ''}</td>`;
    }
    html += '</tr>';
  }
  document.getElementById('cal').innerHTML = html + '</table>';
  document.querySelectorAll('#cal td').forEach(td =>
    td.addEventListener('click', () => { weekStart = monday(new Date(td.dataset.date + 'T00:00')); renderBoard(); }));
}
document.getElementById('calPrev').onclick = () => { calBase.setMonth(calBase.getMonth() - 1); renderCal(); };
document.getElementById('calNext').onclick = () => { calBase.setMonth(calBase.getMonth() + 1); renderCal(); };

// ---------- notes ----------
const notesEl = document.getElementById('notes');
notesEl.value = state.notes;
notesEl.addEventListener('input', () => { state.notes = notesEl.value; save(); });

// ---------- pomodoro ----------
const workSec = () => (state.workMin || 25) * 60;   // 설정값 기반(기본 25/5분)
const breakSec = () => (state.breakMin || 5) * 60;
let pomo = { mode: 'work', left: workSec(), timer: null, segStart: null };

// 실제로 집중한 구간을 타임라인에 기록 (일시정지·리셋·완료 시점 모두)
function commitSegment() {
  if (pomo.mode !== 'work' || !pomo.segStart) return;
  const sec = Math.round((Date.now() - pomo.segStart) / 1000);
  pomo.segStart = null;
  if (sec < 30) return;   // 30초 미만은 노이즈라 제외
  const sel = document.getElementById('pomoTask').value;
  const task = state.tasks.find(x => x.id === sel);
  state.sessions.push({ start: Date.now() - sec * 1000, min: Math.max(1, Math.round(sec / 60)), title: task ? task.title : '집중' });
  save(); renderTimeline();
}

function pomoRender() {
  const m = String(Math.floor(pomo.left / 60)).padStart(2, '0');
  const s = String(pomo.left % 60).padStart(2, '0');
  document.getElementById('pomoTime').textContent = `${m}:${s}`;
  document.getElementById('pomoMode').textContent = pomo.mode === 'work' ? `집중 ${state.workMin || 25}분` : `휴식 ${state.breakMin || 5}분`;
  document.getElementById('pomoStart').textContent = pomo.timer ? '일시정지' : '시작';
  document.getElementById('pomoCount').textContent = `오늘까지 완료한 포모도로: ${state.pomoDone}회`;
}
function pomoTick() {
  if (--pomo.left > 0) { pomoRender(); return; }
  clearInterval(pomo.timer); pomo.timer = null;
  beep();
  if (pomo.mode === 'work') {
    commitSegment();                 // 완료된 집중 구간 기록
    state.pomoDone++;
    const sel = document.getElementById('pomoTask').value;
    const task = state.tasks.find(x => x.id === sel);
    if (task) { task.pomos = (task.pomos || 0) + 1; save(); }
    pomo.mode = 'break'; pomo.left = breakSec();
    renderBoard();
  } else {
    pomo.mode = 'work'; pomo.left = workSec();
  }
  pomoRender();
}
document.getElementById('pomoStart').onclick = () => {
  if (pomo.timer) { commitSegment(); clearInterval(pomo.timer); pomo.timer = null; }   // 일시정지 → 기록
  else { if (pomo.mode === 'work') pomo.segStart = Date.now(); pomo.timer = setInterval(pomoTick, 1000); }
  pomoRender();
};
document.getElementById('pomoReset').onclick = () => {
  commitSegment();                   // 리셋 → 그때까지 기록
  clearInterval(pomo.timer); pomo.timer = null;
  pomo.left = pomo.mode === 'work' ? workSec() : breakSec();
  pomoRender();
};
// 타이머 시간 설정
function applyPomoSettings() {
  const w = Math.min(90, Math.max(1, parseInt(document.getElementById('workMin').value, 10) || 25));
  const b = Math.min(60, Math.max(1, parseInt(document.getElementById('breakMin').value, 10) || 5));
  state.workMin = w; state.breakMin = b; save();
  if (!pomo.timer) { pomo.left = pomo.mode === 'work' ? workSec() : breakSec(); }  // 실행 중이 아니면 즉시 반영
  pomoRender();
}
document.getElementById('workMin').addEventListener('change', applyPomoSettings);
document.getElementById('breakMin').addEventListener('change', applyPomoSettings);
// 하루 시작/끝 시간 설정 → 타임라인·오늘 기준 갱신
function applyDaySettings() {
  state.dayStart = document.getElementById('dayStart').value || '00:00';
  state.dayEnd = document.getElementById('dayEnd').value || '00:00';
  save(); renderBoard();
}
document.getElementById('dayStart').addEventListener('change', applyDaySettings);
document.getElementById('dayEnd').addEventListener('change', applyDaySettings);
function renderPomoTasks() {
  const sel = document.getElementById('pomoTask');
  const cur = sel.value;
  sel.innerHTML = '<option value="">집중할 오늘 할 일 선택 (선택)</option>' +
    state.tasks.filter(x => x.date === logicalToday() && x.status === 'todo')
      .map(x => `<option value="${x.id}">${esc(x.title)}</option>`).join('');
  sel.value = cur;
}
function beep() {
  try {
    const c = new (window.AudioContext || window.webkitAudioContext)();
    const o = c.createOscillator();
    o.connect(c.destination); o.frequency.value = 880;
    o.start(); o.stop(c.currentTime + 0.5);
  } catch (e) { /* 소리 실패는 무시 */ }
}

// ---------- AI: 목표 → 할 일 분해 (Groq, 브라우저 직접 호출 · 무료 · 카드 불필요) ----------
const GROQ_MODEL = 'llama-3.3-70b-versatile';
document.getElementById('keyBtn').onclick = () => {
  const k = prompt('Groq API 키를 입력하세요 (무료: console.groq.com/keys — gsk_… · 이 브라우저에만 저장됩니다):', state.apiKey || '');
  if (k !== null) { state.apiKey = k.trim(); save(); }
};

document.getElementById('aiBtn').onclick = async () => {
  const goal = document.getElementById('goalInput').value.trim();
  const msg = document.getElementById('aiMsg');
  if (!goal) { msg.textContent = '목표를 먼저 입력하세요.'; return; }
  if (!state.apiKey) { msg.textContent = '우측 상단 🔑 버튼으로 Groq API 키를 먼저 넣으세요 (무료).'; return; }
  const btn = document.getElementById('aiBtn');
  btn.disabled = true; msg.textContent = 'AI가 목표를 분석 중...';
  try {
    const reqBody = JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.4,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: '너는 요청된 JSON 형식만 정확히 출력한다. 설명·코드블록 없이 JSON만.' },
        { role: 'user', content:
          `다음 목표를 달성하기 위해 필요한 구체적인 할 일 목록을 만들어줘. 오늘(day_offset=0)부터 6일 뒤(day_offset=6)까지 일주일 안에 현실적으로 배치해. 각 할 일 제목은 한국어로 짧고 실행 가능하게. 3~10개.\n목표: ${goal}\n\n다음 형식의 JSON만 출력: {"tasks":[{"title":"<할 일>","day_offset":<0~6 정수>}]}` },
      ],
    });
    const send = () => fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + state.apiKey },
      body: reqBody,
    });
    let res = await send();
    if (res.status === 429) {
      // 분당 한도면 retry-after만큼(최대 30초) 자동 재시도
      const wait = Math.min(30, parseInt(res.headers.get('retry-after') || '0', 10) || 20);
      msg.textContent = `무료 한도 도달 — ${wait}초 후 자동 재시도합니다…`;
      await new Promise(r => setTimeout(r, wait * 1000));
      res = await send();
      if (res.status === 429) throw new Error('Groq 무료 사용량 한도(429)를 초과했습니다. 잠시 후 다시 시도하세요.');
    }
    if (!res.ok) throw new Error(`API 오류 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('응답이 비어 있습니다');
    const tasks = JSON.parse(text).tasks || [];
    const base = new Date();
    tasks.forEach(x => {
      const off = Math.min(6, Math.max(0, x.day_offset | 0));  // 0~6 범위 보정
      const date = ymd(addDays(base, off));
      state.tasks.push({ id: uid(), title: String(x.title).slice(0, 100), date, status: 'todo', order: nextOrder(state.tasks, date), pomos: 0 });
    });
    save();
    weekStart = monday(new Date());
    renderBoard();
    msg.textContent = `✅ ${tasks.length}개의 할 일을 추가했습니다.`;
    document.getElementById('goalInput').value = '';
  } catch (err) {
    msg.textContent = '❌ ' + err.message;
  } finally {
    btn.disabled = false;
  }
};

// ---------- 동기화 (GitHub Gist) ----------
// ponytail: last-write-wins 전체 덮어쓰기 — 1인용이라 충돌 병합은 필요해지면 추가
const SYNC_KEYS = ['tasks', 'events', 'notes', 'pomoDone', 'sessions', 'updatedAt', 'workMin', 'breakMin', 'dayStart', 'dayEnd']; // API 키·토큰은 기기별 보관(동기화 제외)
const ghHeaders = () => ({ 'Authorization': 'Bearer ' + state.gistToken, 'Accept': 'application/vnd.github+json' });
const nowHM = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
// 상태 표시: off/busy/ok/err
function setSync(kind, detail) {
  const el = document.getElementById('syncState');
  if (!el) return;
  const label = { off: '⚪ 동기화 꺼짐', busy: '🔄 동기화 중…', ok: '✅ 동기화됨', err: '⚠️ 동기화 오류' }[kind] || '';
  el.className = 'syncState' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
  const gid = state.gistId ? ` (Gist …${state.gistId.slice(-6)})` : '';
  el.textContent = label + (detail ? ` · ${detail}` : '') + (kind === 'off' ? '' : gid);
  el.title = (state.gistId ? '이 기기 Gist ID: ' + state.gistId + '\n다른 기기도 같은 ID여야 합니다.\n' : '') + '클릭하면 지금 동기화';
}
// HTTP 상태 → 사람이 읽는 사유
const syncReason = code =>
  code === 401 ? '토큰 무효/만료' :
  code === 403 ? '권한 부족(gist 스코프?)' :
  code === 404 ? 'Gist 없음(ID 확인)' :
  code === 422 ? '요청 형식 오류' : `HTTP ${code}`;
let pushT = null;
function schedulePush() {
  if (!state.gistToken || !state.gistId) return;
  clearTimeout(pushT);
  pushT = setTimeout(syncPush, 3000);
}
async function syncPush() {
  if (!state.gistToken || !state.gistId) return;
  setSync('busy', '업로드');
  try {
    const payload = JSON.stringify(Object.fromEntries(SYNC_KEYS.map(k => [k, state[k]])));
    const res = await fetch('https://api.github.com/gists/' + state.gistId, {
      method: 'PATCH', headers: ghHeaders(),
      body: JSON.stringify({ files: { 'myday.json': { content: payload } } }),
    });
    if (!res.ok) { setSync('err', syncReason(res.status)); console.warn('업로드 실패', res.status, await res.text().catch(() => '')); return; }
    setSync('ok', nowHM());
  } catch (e) { setSync('err', '네트워크'); console.warn('업로드 예외', e); }
}
// 의미 있는 데이터가 있는지 (빈 원격으로 로컬을 덮어쓰지 않기 위함)
const hasData = s => !!(s && ((s.tasks && s.tasks.length) || (s.events && s.events.length) || (s.sessions && s.sessions.length) || (s.notes && s.notes.trim())));
function adoptRemote(remote) {
  SYNC_KEYS.forEach(k => { if (k in remote) state[k] = remote[k]; });
  localStorage.setItem(LS, JSON.stringify(state)); // save() 금지: updatedAt 재갱신 방지
  notesEl.value = state.notes;
  document.getElementById('workMin').value = state.workMin || 25;
  document.getElementById('breakMin').value = state.breakMin || 5;
  document.getElementById('dayStart').value = state.dayStart || '00:00';
  document.getElementById('dayEnd').value = state.dayEnd || '00:00';
  renderBoard();
}
async function fetchRemote() {
  const res = await fetch('https://api.github.com/gists/' + state.gistId, { headers: ghHeaders() });
  if (!res.ok) return { ok: false, status: res.status };
  const file = (await res.json()).files?.['myday.json'];
  return { ok: true, remote: JSON.parse((file && file.content) || '{}') };
}
async function syncPull() {
  if (!state.gistToken || !state.gistId) { setSync('off'); return; }
  setSync('busy', '확인');
  try {
    const r = await fetchRemote();
    if (!r.ok) { setSync('err', syncReason(r.status)); console.warn('다운로드 실패', r.status); return; }
    const remote = r.remote;
    if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
      // 안전장치: 원격이 비었는데 로컬에 데이터가 있으면 덮어쓰지 않고 로컬을 올림(유실 방지·자가복구)
      if (!hasData(remote) && hasData(state)) { await syncPush(); return; }
      adoptRemote(remote);
    }
    setSync('ok', nowHM());
  } catch (e) { setSync('err', '네트워크'); console.warn('다운로드 예외', e); }
}
// 연동(다른 기기의 Gist ID로): 양쪽 데이터를 비교해 안전하게 처리
async function syncConnect() {
  setSync('busy', '확인');
  try {
    const r = await fetchRemote();
    if (!r.ok) { setSync('err', syncReason(r.status)); alert('연동 실패: ' + syncReason(r.status)); return; }
    const remote = r.remote;
    if (!hasData(remote)) { await syncPush(); alert('원격이 비어 있어 이 기기 데이터를 올렸습니다.'); return; }
    if (!hasData(state)) { adoptRemote(remote); setSync('ok', nowHM()); alert('원격 데이터를 가져왔습니다.'); return; }
    const takeRemote = confirm('양쪽 모두 데이터가 있습니다.\n\n[확인] 원격 데이터로 이 기기를 덮어씀\n[취소] 이 기기 데이터를 원격에 올림');
    if (takeRemote) { adoptRemote(remote); setSync('ok', nowHM()); alert('원격 데이터를 가져왔습니다.'); }
    else { await syncPush(); alert('이 기기 데이터를 원격에 올렸습니다.'); }
  } catch (e) { setSync('err', '네트워크'); alert('연동 중 오류: ' + e.message); }
}
// 상태 클릭 → 지금 동기화(내려받고 올리기)
document.getElementById('syncState').addEventListener('click', async () => {
  if (!state.gistToken || !state.gistId) { alert('먼저 ☁ 동기화를 설정하세요.'); return; }
  await syncPull(); await syncPush();
});
document.getElementById('syncBtn').onclick = async () => {
  const tk = prompt('GitHub 개인 토큰(이 브라우저에만 저장)\n※ 반드시 "classic" 토큰 + gist 스코프여야 합니다. 파인그레인드 토큰은 Gist에 안 됩니다.\ngithub.com/settings/tokens → Generate new token (classic) → gist 체크', state.gistToken || '');
  if (tk === null) return;
  state.gistToken = tk.trim();
  if (!state.gistToken) { state.gistId = ''; save(); setSync('off'); alert('동기화를 해제했습니다.'); return; }
  const id = prompt('다른 기기와 연동하려면 그 기기에 표시된 Gist ID를 붙여넣으세요.\n처음 설정이면 빈칸으로 두세요 (새로 만듭니다):', state.gistId || '');
  if (id === null) return;
  if (id.trim()) {
    state.gistId = id.trim(); save();
    await syncConnect();  // 안전 연동: 빈 원격이 로컬을 덮어쓰지 않음
  } else {
    setSync('busy', 'Gist 생성');
    try {
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST', headers: ghHeaders(),
        body: JSON.stringify({ description: '나의 하루 동기화 데이터', public: false, files: { 'myday.json': { content: '{}' } } }),
      });
      if (!res.ok) { setSync('err', syncReason(res.status)); alert('Gist 생성 실패 (' + syncReason(res.status) + ')\n토큰이 classic + gist 스코프인지 확인하세요.'); return; }
      state.gistId = (await res.json()).id;
      save(); await syncPush();
      alert('동기화 시작!\n다른 기기의 ☁ 동기화 설정에서 아래 Gist ID를 입력하세요:\n\n' + state.gistId);
    } catch (e) { setSync('err', '네트워크'); alert('Gist 생성 중 네트워크 오류: ' + e.message); }
  }
};

// ---------- util ----------
function esc(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- self test (브라우저 콘솔에서 runSelfTest() 실행) ----------
function runSelfTest() {
  const tasks = [
    { id: 'a', title: '할일', date: '2000-01-01', status: 'todo', order: 0 },
    { id: 'b', title: '끝난일', date: '2000-01-01', status: 'done', order: 1 },
    { id: 'c', title: '진행중', date: '2000-01-01', status: 'doing', order: 2 },
    { id: 'd', title: '딜레이', date: '2000-01-01', status: 'delayed', order: 3 },
    { id: 'e', title: '안한일', date: '2000-01-01', status: 'skipped', order: 4 },
  ];
  const t = today();
  console.assert(rolloverTasks(tasks, t) === true, 'rollover가 변경을 감지해야 함');
  console.assert(tasks.find(x => x.id === 'a').carried === true, '지난 todo는 carried 표시');
  console.assert(tasks.find(x => x.id === 'c').carried === true, '진행중도 이월');
  console.assert(tasks.find(x => x.id === 'd').carried === true, '딜레이도 이월');
  console.assert(!tasks.find(x => x.id === 'b').carried, '완료는 이월 안 함');
  console.assert(!tasks.find(x => x.id === 'e').carried, '안 함은 이월 안 함');
  const copies = tasks.filter(x => x.date === t && x.status === 'todo');
  console.assert(copies.length === 3 && copies.every(x => !x.carried), '미완료 3건이 오늘 todo로 복사');
  console.assert(rolloverTasks(tasks, t) === false, '두 번째 실행은 변경이 없어야 함');
  console.assert(nextOrder(tasks, t) === 3, 'nextOrder는 max+1');
  console.log('✅ self test 통과');
}

// ---------- init ----------
document.getElementById('workMin').value = state.workMin || 25;
document.getElementById('breakMin').value = state.breakMin || 5;
document.getElementById('dayStart').value = state.dayStart || '00:00';
document.getElementById('dayEnd').value = state.dayEnd || '00:00';
document.getElementById('schedDate').value = today();
pomoRender();
renderBoard();
// 순서 중요: 먼저 원격을 가져와 채택(다른 기기 데이터) → 그 다음에 이월/저장.
// (이월이 먼저면 updatedAt이 '지금'으로 갱신돼 원격이 항상 옛것으로 판정되어 안 가져옴)
setSync(state.gistToken && state.gistId ? 'busy' : 'off');
(async () => {
  await syncPull();
  if (rolloverTasks(state.tasks, logicalToday())) { save(); renderBoard(); }
})();
