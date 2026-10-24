const VAPID_PUBLIC = 'BOpBY_D00eLGGo2rS2TiXCgyU1c7gTtfx9Fw7piREdBV_h1GiJTieBsI-SkHKmoeOU1N_Jhfq4vmXx-F-G5aF1k';
const $ = id => document.getElementById(id);
let status = null, tick = null;

function token() {
  let t = localStorage.getItem('token');
  if (!t) {
    t = (prompt('API-токен (из wrangler secret API_TOKEN):') || '').trim();
    if (t) localStorage.setItem('token', t);
  }
  return t;
}

async function api(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (r.status === 401) localStorage.removeItem('token');
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

const fmt = m => {
  const r = Math.round(Math.abs(m)), h = Math.floor(r / 60);
  return (h ? `${h} ч ` : '') + `${r % 60} мин`;
};
const clock = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');

function render() {
  const s = status;
  $('debt').textContent = s.debt > 0 ? fmt(s.debt) : s.debt < 0 ? `+${fmt(s.debt)} запас` : '0 ✅';
  $('debt').className = s.debt <= 0 ? 'ok' : '';
  $('block').hidden = !(s.debt > s.debtLimit);
  $('dotaToday').textContent = Math.round(s.dotaToday);
  $('studyToday').textContent = Math.round(s.studyToday);
  $('streak').textContent = s.streak;

  // timer runs from the server-stored start, so closing the app doesn't reset it
  clearInterval(tick);
  const running = !!s.timerStart;
  $('timer').textContent = running ? 'Стоп' : 'Старт';
  $('timer').classList.toggle('running', running);
  $('elapsed').hidden = !running;
  if (running) {
    const update = () => ($('elapsed').textContent = clock(Math.max(0, Math.floor(Date.now() / 1000) - s.timerStart)));
    update();
    tick = setInterval(update, 1000);
  }

  $('recent').replaceChildren(...s.recent.map(e => {
    const li = document.createElement('li');
    const when = new Date(e.start_ts * 1000).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    li.innerHTML = `<span>${e.kind === 'dota' ? '⚔️' : '🇵🇱'}</span><span></span><span class="when">${when}</span><button aria-label="Удалить">✕</button>`;
    li.children[1].textContent = fmt(e.minutes) + (e.note ? ` (${e.note})` : '');
    li.querySelector('button').onclick = () => confirm('Удалить запись?') && act(() => api(`/api/entries/${e.id}`, 'DELETE'));
    return li;
  }));
}

async function act(fn) {
  $('error').hidden = true;
  try {
    if (fn) await fn();
    status = await api('/api/status');
    render();
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  }
}

$('timer').onclick = () => act(() => api(status?.timerStart ? '/api/timer/stop' : '/api/timer/start', 'POST'));
$('sync').onclick = () => act(() => api('/api/sync', 'POST'));
$('manual').onclick = () => {
  const minutes = Number(prompt('Сколько минут играл?'));
  if (minutes) act(() => api('/api/dota/manual', 'POST', { minutes }));
};
$('push').onclick = () => act(async () => {
  // iOS: works only when opened from the home-screen icon (iOS 16.4+)
  if (!('PushManager' in window)) throw new Error('Push недоступен: добавь приложение на экран «Домой» и открой с иконки');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Уведомления запрещены');
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(VAPID_PUBLIC.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api('/api/push/subscribe', 'POST', sub.toJSON());
  await api('/api/push/test', 'POST');
});

navigator.serviceWorker?.register('/sw.js');
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && act());
act(() => api('/api/sync', 'POST').catch(() => {})); // OpenDota being down shouldn't block the screen
