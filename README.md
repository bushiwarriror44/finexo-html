# CloudMine - техническая спецификация

## 1) Назначение системы

CloudMine - веб-платформа облачного майнинга с внутренним USDT-балансом.  
Пользователь пополняет баланс в USDT (TRON), после подтверждения транзакции в блокчейне получает виртуальный баланс в приложении и использует его для покупки майнинг-пакетов/хешрейта.

Ключевой принцип: on-chain средства хранятся на проектном кошельке, а в приложении ведется внутренний учет пользовательских балансов через ledger.

## 2) Технологический стек

### Frontend
- React + Vite
- React Router
- i18n (RU/EN)
- API взаимодействие через `fetch`-клиент (`src/api/client.js`)

### Backend
- Flask (Blueprint-based API)
- SQLAlchemy + Flask-Migrate
- Flask-CORS, CSRF, Socket.IO
- Фоновый worker для проверки пополнений и ежедневных начислений

### Инфраструктура данных
- Основные сущности в `backend/models.py`
- Внутренний учет баланса через `UserBalanceLedger`
- Очередь и статусы проверки пополнений через `TopUpTransaction`

## 3) Архитектура модулей

### Пользовательские платежи (top-ups)
- Маршруты: `backend/routes/wallet_routes.py`
- Верификация: `backend/services/wallet_verifier.py`
- Провайдер блокчейна: `backend/services/providers/tron_provider.py`
- Фоновая обработка: `backend/worker.py`

### Админ-управление платежами
- Маршруты: `backend/routes/admin_api_routes.py`
- Настройка API-ключа/URL провайдера и кошельков
- Ручной retry top-up из админки

### Майнинг-домен
- Планы/контракты/начисления: `MiningPlan`, `MiningContract`, `MiningAccrual`
- Покупка пакетов и списание внутреннего баланса: `backend/services/mining_service.py`
- Дневные начисления: `backend/services/mining_engine.py`

## 4) Модель баланса и бухгалтерия

Баланс пользователя не равен on-chain кошельку пользователя. Он рассчитывается как агрегат записей в `UserBalanceLedger`.

Типовые проводки:
- `credit` - зачисление после подтверждения пополнения.
- `debit` - списание (например, покупка пакета).
- `withdrawal_hold` / `withdrawal_release` / `withdrawal_finalize` - этапы вывода.

Идемпотентность пополнений защищена unique-ограничением:
- `uq_ledger_topup_entry_type` (`topup_id`, `entry_type`).

## 5) Реализованный USDT-only flow (TRON)

Начиная с текущей версии, модуль пополнения работает по модели:
- Единственный поддерживаемый актив: `USDT`
- Единственная сеть: `TRX` (TRON)

### Изменения в API-границах

В `wallet_routes.py`:
- отклонение top-up, если выбран кошелек не `USDT/TRX`;
- валидация формата `txHash` (64 hex символа для TRON tx id);
- явные коды ошибок: `UNSUPPORTED_ASSET`, `UNSUPPORTED_NETWORK`, `INVALID_TX_HASH`.

В `admin_api_routes.py`:
- админ не может создать кошелек, кроме `USDT` + `TRX`.

### Изменения в верификаторе

В `wallet_verifier.py`:
- fail-closed проверка пары `asset/network` (`USDT` + `TRX`);
- обязательное наличие `toAddress` и `amount` от провайдера;
- проверка `amount >= requested amount`;
- проверка минимального числа подтверждений:
  - переменная окружения `TOPUP_MIN_CONFIRMATIONS_TRX` (по умолчанию `1`).

### Изменения в TRON-провайдере

В `tron_provider.py`:
- дополнительно читаются transaction events (`/v1/transactions/{txHash}/events`);
- извлекаются `toAddress` и `value` из TRC20 Transfer-события;
- amount нормализуется по 6 decimals (USDT TRON);
- контракт USDT можно переопределить через `TRON_USDT_CONTRACT`
  (по умолчанию mainnet `TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj`).

## 6) Автоматическое пополнение (автозачисление)

## 6.1 Бизнес-логика
1. Пользователь нажимает кнопку пополнения (в кабинете).
2. Видит единственный метод: USDT (TRON) и адрес проектного кошелька.
3. Отправляет USDT на этот адрес во внешнем кошельке.
4. В кабинете указывает tx hash и сумму.
5. Система автоматически мониторит блокчейн через TronGrid API.
6. После подтверждения on-chain транзакции и проверок:
   - создается `credit` в `UserBalanceLedger`;
   - средства доступны внутри приложения для покупки мощностей/пакетов.

Важно: это внутренний (виртуальный) баланс приложения, а не custodial sub-wallet пользователя.

## 6.2 Технический pipeline
- Создание top-up: `POST /api/wallet/topup`
- Статус `verification_status = queued`
- Worker (`backend/worker.py`) забирает queued/failed top-ups и запускает `process_topup()`
- `verify_transaction()` вызывает Tron provider
- При успехе `settle_topup()` создает ledger credit
- UI обновляет статусы через polling (`DashboardTopupsPage`)

## 6.3 Роли
- Пользователь: инициирует top-up и подает tx hash.
- Администратор: задает wallet address и TronGrid API URL/key в админ-панели.
- Сервис: проверяет блокчейн и выполняет автозачисление во внутренний баланс.

## 7) UI-спецификация пополнения

Обновленный пользовательский UX:
- в модальном окне пополнения фиксирован метод `USDT / TRX`;
- если кошелек админом не настроен, показ ошибки и блок submit;
- в подсказках указано, что нужен корректный TRON tx hash.

Ключевые файлы:
- `src/pages/dashboard/DashboardTopupsPage.jsx`
- `src/components/dashboard/TopupModal.jsx`

## 8) Основные API эндпоинты

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### Top-up
- `GET /api/wallet/addresses`
- `POST /api/wallet/topup`
- `GET /api/wallet/topups`
- `POST /api/wallet/topup/<id>/process-now`

### Mining
- `GET /api/user/mining/plans`
- `POST /api/user/mining/contracts`
- `GET /api/user/mining/contracts`
- `GET /api/user/mining/accruals`

### Admin
- `GET/POST /admin/api/credentials`
- `GET/POST/PATCH /admin/api/wallets`
- `GET /admin/api/topups`
- `POST /admin/api/topups/<id>/retry`

## 9) Конфигурация окружения (ключевое)

- `TOPUP_MIN_CONFIRMATIONS_TRX` - минимум подтверждений для зачета.
- `TRON_USDT_CONTRACT` - TRC20 контракт USDT (override при необходимости).
- `TOPUP_WORKER_POLL_SECONDS` - интервал polling worker.
- `TOPUP_RUNNING_TIMEOUT_SECONDS` - порог requeue "зависших" verification.
- `MINING_ACCRUALS_ENABLED` - включение движка ежедневных начислений.

Для продакшена рекомендуется:
- хранить API key только в зашифрованном виде (в проекте уже используется encrypted column);
- ограничить доступ к админке;
- логировать и алертить dead-letter top-ups.

## 10) Тестирование

Базовые smoke/интеграционные тесты находятся в:
- `backend/tests/test_smoke.py`

Покрываются сценарии:
- регистрация/авторизация;
- top-up replay guard;
- double-credit guard;
- amount mismatch;
- withdrawal lifecycle;
- mining purchase/accrual idempotency;
- USDT/TRX ограничения и проверки tx hash/provider данных.

## 11) Запуск локально

### Frontend
```bash
npm install
npm run dev
```

### Backend (пример)
```bash
cd backend
pip install -r requirements.txt
python app.py
```

### Worker
```bash
cd backend
python worker.py
```

## 12) Дисклеймер

Cloud mining и доходность должны описываться как оценочные/сценарные значения без обещаний гарантированного ROI. Эта политика должна сохраняться в UI, маркетинговых блоках и пользовательской документации.
