const VAPID_PUBLIC = 'BOpBY_D00eLGGo2rS2TiXCgyU1c7gTtfx9Fw7piREdBV_h1GiJTieBsI-SkHKmoeOU1N_Jhfq4vmXx-F-G5aF1k';
const $ = id => document.getElementById(id);
let status = null, tick = null;

const showLogin = on => { $('login').hidden = !on; $('app').hidden = on; };

async function api(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (r.status === 401) {
    localStorage.removeItem('token');
    showLogin(true);
    throw new Error('Неверный пароль');
  }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

// non-breaking spaces keep "1 ч 18 мин" on one line
const fmt = m => {
  const r = Math.round(Math.abs(m)), h = Math.floor(r / 60), min = r % 60;
  return [h && `${h} ч`, (min || !h) && `${min} мин`].filter(Boolean).join(' ');
};
const clock = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':'); // taste-skill-ignore: a clock
const days = n => `${n} ${{ one: 'день', few: 'дня' }[new Intl.PluralRules('ru').select(n)] ?? 'дней'}`;
const dateFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const X_ICON = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

function render() {
  const s = status;
  $('debt').textContent = s.debt > 0.5 ? fmt(s.debt) : s.debt < -0.5 ? `Запас ${fmt(s.debt)}` : 'Долга нет';
  $('debt').classList.toggle('clear', s.debt <= 0.5);
  $('block').textContent = `Долг больше ${fmt(s.debtLimit)} — сначала польский, потом катка`;
  $('block').hidden = !(s.debt > s.debtLimit);
  $('dotaToday').textContent = fmt(s.dotaToday);
  $('studyToday').textContent = fmt(s.studyToday);
  $('streak').textContent = days(s.streak);
  const since = new Date(s.startTs * 1000).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
  $('total').textContent = `С ${since}: дота ${fmt(s.dotaTotal)}, польский ${fmt(s.studyTotal)}`;

  // the track is as long as the Dota played; Polish fills it at the true ratio
  const ratio = s.dotaTotal ? Math.min(1, s.studyTotal / s.dotaTotal) : 0;
  $('trackFill').style.width = `${ratio * 100}%`;
  $('trackLabel').textContent = `${fmt(Math.min(s.studyTotal, s.dotaTotal))} из ${fmt(s.dotaTotal)}`;

  // timer runs from the server-stored start, so closing the app doesn't reset it
  clearInterval(tick);
  const running = !!s.timerStart;
  $('timer').textContent = running ? 'Закончить занятие' : 'Начать польский';
  $('timer').classList.toggle('running', running);
  $('elapsed').hidden = !running;
  if (running) {
    const update = () => ($('elapsed').textContent = clock(Math.max(0, Math.floor(Date.now() / 1000) - s.timerStart)));
    update();
    tick = setInterval(update, 1000);
  }

  $('empty').hidden = s.recent.length > 0;
  $('recent').replaceChildren(...s.recent.map(e => {
    const li = document.createElement('li');
    const study = e.kind === 'study';
    li.innerHTML = `<div class="what"><b></b><small class="num"></small></div><span class="amount num"></span><button class="del" type="button" aria-label="Удалить запись">${X_ICON}</button>`;
    li.querySelector('b').textContent = study ? 'Польский' : e.match_id ? 'Матч' : 'Дота вручную';
    li.querySelector('small').textContent = dateFmt.format(e.start_ts * 1000);
    const amount = li.querySelector('.amount');
    amount.textContent = `${study ? '−' : '+'}${fmt(e.minutes)}`;
    amount.classList.toggle('study', study);
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
// fetched from the phone: its own IP has OpenDota quota, Cloudflare's shared IPs often don't
async function syncFromPhone() {
  const { steamId, syncDays } = status ?? (await api('/api/status'));
  const r = await fetch(`https://api.opendota.com/api/players/${steamId}/matches?date=${syncDays}`);
  if (!r.ok) throw new Error(`OpenDota ${r.status}`);
  await api('/api/matches', 'POST', await r.json());
}

$('sync').onclick = () => act(syncFromPhone);
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
// OpenDota being down shouldn't block the screen
const openSync = () => localStorage.getItem('token') && act(() => syncFromPhone().catch(() => {}));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && openSync());
$('login').onsubmit = e => {
  e.preventDefault();
  localStorage.setItem('token', $('tokenInput').value.trim());
  showLogin(false);
  openSync();
};
showLogin(!localStorage.getItem('token'));
openSync();
