`main.py`                    backend: FastAPI, каталог EKT, поиск, OpenAI, проверка выбора
`rontend/`                   интерфейс чата (раздаётся backend'ом)
  `index.html, styles.css`   разметка и стили
  `app.js`                   логика чата, карточек и окон
  `ui-model.js`              форматирование и валидация данных
  `i18n.js, locales.js`      RU / ҚАЗ / EN
  `api.js, viewport.js`      формирование запроса, мобильный viewport
  `server.mjs`               альтернативный dev-сервер с прокси
  `tests/`                   тесты node:test
  `README.md`                подробности по интерфейсу
`.env.example`               шаблон переменных окружения
`SECURITY.md`                работа с секретами
`.githooks/, scripts/`       pre-commit проверка против коммита .env
`pres/`                      презентация проекта
`dump_katalog.py`            черновой скрипт выгрузки каталога (не используется, без авторизации)
`catalog.json`               не используется (содержит ответ API «Unauthorized»)
