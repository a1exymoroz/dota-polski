# Dota → Polski 🇵🇱

Учу польский столько же, сколько играю в Доту. Минута доты = минута польского.

- Матчи подтягиваются сами из [OpenDota](https://www.opendota.com) каждые 15 минут.
- Таймер «Старт/Стоп» для занятий польским (не сбрасывается, если закрыть приложение).
- Долг, серия дней 🔥, ручное добавление доты, удаление ошибочных записей.
- Push: после новых матчей, вечером (20:00 по Варшаве), если долг не закрыт, и предупреждение, если долг больше `DEBT_LIMIT`.

Стек: Cloudflare Worker (фронт + API + cron) + D1 (SQLite) + PWA. Бесплатный тариф Cloudflare.

## Подготовка

1. В Доте: *Настройки → Сообщество → «Открыть доступ к данным матчей»* (иначе OpenDota не видит матчи).
2. Свой Steam32 ID — число в URL профиля на opendota.com.
3. Аккаунт Cloudflare (бесплатный).

## Деплой

```bash
npm install
npx wrangler login
npx wrangler d1 create dota-polski        # вставь database_id в wrangler.toml
npx wrangler d1 execute dota-polski --remote --file schema.sql
npx @pushforge/builder vapid              # публичный ключ -> VAPID_PUBLIC в public/app.js
npx wrangler secret put API_TOKEN         # любой длинный случайный пароль
npx wrangler secret put STEAM_ID
npx wrangler secret put VAPID_PRIVATE     # приватный JWK из команды vapid, одной строкой
npx wrangler deploy
```

При первом запуске cron подтянет матчи за последние 2 дня — они сразу попадут в долг.

## Установка на iPhone (iOS 16.4+)

1. Открой URL воркера в **Safari** → «Поделиться» → «На экран „Домой“».
2. Открой приложение **с иконки**, введи `API_TOKEN`.
3. Нажми «🔔 уведомления» → разреши. Придёт тестовое уведомление.

## Локально

```bash
cp .dev.vars.example .dev.vars   # заполни значения
npx wrangler d1 execute dota-polski --local --file schema.sql
npx wrangler dev --test-scheduled  # http://localhost:8787, cron: /__scheduled
npm test
```

На Windows при очень длинном пути к папке локальный D1 падает с `SQLITE_CANTOPEN` — положи проект в короткий путь.
