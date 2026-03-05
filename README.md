# Time Tracker — split 1-to-1

Это **тот же самый** `index.html`, который ты прислал, только разнесён по файлам **без изменения логики**:

- `index.html` — разметка
- `assets/styles.css` — CSS (вырезан из `<style>`)
- `js/app.js` — JS (вырезан из inline `<script>`)
- Supabase CDN подключение остаётся в `index.html` и идёт **до** `js/app.js` (как раньше)

## Запуск локально
Из-за ограничений браузера проще запускать через локальный сервер.

### VS Code
Расширение **Live Server** → Open with Live Server.

### Python
```bash
cd time-tracker-1to1
python -m http.server 8000
```
Открой: http://localhost:8000
