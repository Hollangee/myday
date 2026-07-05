/* 나의 하루 — vanilla JS + localStorage, 빌드 없음 */
'use strict';

// ---------- state ----------
const LS = 'myday-v1';
const state = Object.assign(
  { tasks: [], notes: '', apiKey: '', pomoDone: 0, sessions: [], updatedAt: 0, gistToken: '', gistId: '' },
  JSON.parse(localStorage.getItem(LS) || '{}')
);
const save = () => { state.updatedAt = Date.now(); localStorage.setItem(LS, JSON.stringify(state)); schedulePush(); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- dates ----------
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => addDays(d, -((d.getDay() + 6) % 7));
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

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
  const t = today();
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
}

// ---------- 24시간 활동 타임라인 ----------
// dataviz 검증 팔레트 (고정 순서 배정, 순환 금지 — 9번째 작업부터는 회색)
const PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
function renderTimeline() {
  const weekDates = [...Array(7)].map((_, i) => ymd(addDays(weekStart, i)));
  const ses = state.sessions
    .filter(s => weekDates.includes(ymd(new Date(s.start))))
    .sort((a, b) => a.start - b.start);
  const order = [];
  ses.forEach(s => { if (!order.includes(s.title)) order.push(s.title); });
  const colorOf = i => i < PALETTE.length ? PALETTE[i] : '#898781';
  const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  document.querySelectorAll('.track[data-date]').forEach(track => {
    const daySes = ses.filter(s => ymd(new Date(s.start)) === track.dataset.date);
    let html = '';
    for (let h = 6; h < 24; h += 6) html += `<div class="htick" style="top:${h / 24 * 100}%"></div>`;
    daySes.forEach(s => {
      const d = new Date(s.start);
      const startMin = d.getHours() * 60 + d.getMinutes();
      // ponytail: 25분은 24h 트랙에서 1.7%라 너무 얇음 — 최소 2.5% 보정(시각 판독용, 툴팁이 정확한 시간)
      html += `<div class="hseg" style="top:${startMin / 1440 * 100}%;height:${Math.max(s.min / 1440 * 100, 2.5)}%;background:${colorOf(order.indexOf(s.title))}" title="${hhmm(s.start)}~${hhmm(s.start + s.min * 60000)} ${esc(s.title)}"></div>`;
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
  const focusBtn = task.status !== 'done' && task.status !== 'skipped' && task.date === today()
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
    document.getElementById('pomoTask').value = id;
    clearInterval(pomo.timer);
    pomo.mode = 'work'; pomo.left = WORK;
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
const WORK = 25 * 60, BREAK = 5 * 60;
let pomo = { mode: 'work', left: WORK, timer: null };

function pomoRender() {
  const m = String(Math.floor(pomo.left / 60)).padStart(2, '0');
  const s = String(pomo.left % 60).padStart(2, '0');
  document.getElementById('pomoTime').textContent = `${m}:${s}`;
  document.getElementById('pomoMode').textContent = pomo.mode === 'work' ? '집중 25분' : '휴식 5분';
  document.getElementById('pomoStart').textContent = pomo.timer ? '일시정지' : '시작';
  document.getElementById('pomoCount').textContent = `오늘까지 완료한 포모도로: ${state.pomoDone}회`;
}
function pomoTick() {
  if (--pomo.left > 0) { pomoRender(); return; }
  clearInterval(pomo.timer); pomo.timer = null;
  beep();
  if (pomo.mode === 'work') {
    state.pomoDone++;
    const sel = document.getElementById('pomoTask').value;
    const task = state.tasks.find(x => x.id === sel);
    if (task) task.pomos = (task.pomos || 0) + 1;
    state.sessions.push({ start: Date.now() - WORK * 1000, min: 25, title: task ? task.title : '집중' });
    save();
    pomo.mode = 'break'; pomo.left = BREAK;
    renderBoard();
  } else {
    pomo.mode = 'work'; pomo.left = WORK;
  }
  pomoRender();
}
document.getElementById('pomoStart').onclick = () => {
  if (pomo.timer) { clearInterval(pomo.timer); pomo.timer = null; }
  else pomo.timer = setInterval(pomoTick, 1000);
  pomoRender();
};
document.getElementById('pomoReset').onclick = () => {
  clearInterval(pomo.timer); pomo.timer = null;
  pomo.left = pomo.mode === 'work' ? WORK : BREAK;
  pomoRender();
};
function renderPomoTasks() {
  const sel = document.getElementById('pomoTask');
  const cur = sel.value;
  sel.innerHTML = '<option value="">집중할 오늘 할 일 선택 (선택)</option>' +
    state.tasks.filter(x => x.date === today() && x.status === 'todo')
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
const SYNC_KEYS = ['tasks', 'notes', 'pomoDone', 'sessions', 'updatedAt']; // API 키·토큰은 기기별 보관(동기화 제외)
const ghHeaders = () => ({ 'Authorization': 'Bearer ' + state.gistToken, 'Accept': 'application/vnd.github+json' });
let pushT = null;
function schedulePush() {
  if (!state.gistToken || !state.gistId) return;
  clearTimeout(pushT);
  pushT = setTimeout(syncPush, 3000);
}
async function syncPush() {
  try {
    const payload = JSON.stringify(Object.fromEntries(SYNC_KEYS.map(k => [k, state[k]])));
    await fetch('https://api.github.com/gists/' + state.gistId, {
      method: 'PATCH', headers: ghHeaders(),
      body: JSON.stringify({ files: { 'myday.json': { content: payload } } }),
    });
  } catch (e) { console.warn('동기화 업로드 실패', e); }
}
async function syncPull() {
  if (!state.gistToken || !state.gistId) return;
  try {
    const res = await fetch('https://api.github.com/gists/' + state.gistId, { headers: ghHeaders() });
    if (!res.ok) return;
    const remote = JSON.parse((await res.json()).files['myday.json'].content || '{}');
    if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
      SYNC_KEYS.forEach(k => { if (k in remote) state[k] = remote[k]; });
      localStorage.setItem(LS, JSON.stringify(state)); // save() 사용 금지: updatedAt이 갱신돼 원격보다 새 것으로 둔갑
      notesEl.value = state.notes;
      renderBoard();
    }
  } catch (e) { console.warn('동기화 다운로드 실패', e); }
}
document.getElementById('syncBtn').onclick = async () => {
  const tk = prompt('GitHub 개인 토큰을 입력하세요 (gist 권한 필요, 이 브라우저에만 저장):', state.gistToken || '');
  if (tk === null) return;
  state.gistToken = tk.trim();
  if (!state.gistToken) { state.gistId = ''; save(); alert('동기화를 해제했습니다.'); return; }
  const id = prompt('다른 기기와 연동하려면 그 기기에 표시된 Gist ID를 붙여넣으세요.\n처음 설정이면 빈칸으로 두세요 (새로 만듭니다):', state.gistId || '');
  if (id === null) return;
  if (id.trim()) {
    state.gistId = id.trim(); save();
    await syncPull();
    alert('연동 완료! 원격 데이터를 가져왔습니다.');
  } else {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST', headers: ghHeaders(),
      body: JSON.stringify({ description: '나의 하루 동기화 데이터', public: false, files: { 'myday.json': { content: '{}' } } }),
    });
    if (!res.ok) { alert('Gist 생성 실패 (' + res.status + '): 토큰의 gist 권한을 확인하세요.'); return; }
    state.gistId = (await res.json()).id;
    save(); syncPush();
    alert('동기화 시작!\n다른 기기의 ☁ 동기화 설정에서 아래 Gist ID를 입력하세요:\n\n' + state.gistId);
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
if (rolloverTasks(state.tasks, today())) save();
pomoRender();
renderBoard();
syncPull();
