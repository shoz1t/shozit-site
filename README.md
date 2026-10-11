# Shozit Developments: сайт и лаунчер

Сайт студии (RU/EN), страницы игр Rigged и Deep Roll, новости и лаунчер на Tauri для Windows и Linux.

## Что где лежит

```
site/            сам сайт: HTML, CSS, JS, картинки, шрифты, видео. Его публикуют на GitHub Pages
  i18n/          тексты сайта на русском и английском (ru.json, en.json)
  version.json   версии и ссылки на архивы игр: из него берут данные и кнопки «Скачать», и лаунчер
  news.json      новости: их читают и сайт, и лаунчер
  site.json      адрес сайта (для превью в Telegram и Discord, sitemap)
launcher/        лаунчер (Tauri)
  ui/            интерфейс лаунчера
  src-tauri/     программная часть на Rust: скачивание, проверка хэша, установка, запуск
tools/           вспомогательные скрипты (описаны ниже)
design/logo/     логотип студии в SVG и страница для просмотра
.github/workflows/   автоматическая выкладка сайта и сборка лаунчера
assets/          ваши исходники игр. В репозиторий не попадают (см. .gitignore)
test-builds/     архивы игр для релизов. Тоже не попадают в репозиторий
MANUAL_TODO.md   что нужно заполнить руками
```

Нужны Node.js 20+ (для скриптов), Rust и Git (для лаунчера). Всё это уже стоит на этом компьютере.

## 1. Как выложить сайт на GitHub Pages

Один раз:
1. На github.com войди в аккаунт **shoz1t**, нажми **New repository**. Имя: `shozit-site`, тип **Public**, галочки «Add README» и прочие не ставь.
2. В папке проекта выполни (команды можно попросить выполнить меня):
   ```bash
   git init -b main
   git add .
   git commit -m "Сайт и лаунчер Shozit"
   git remote add origin https://github.com/shoz1t/shozit-site.git
   git push -u origin main
   ```
   При первой отправке откроется окно входа в GitHub, войди там.
3. В репозитории открой **Settings → Pages**. В поле **Source** выбери **GitHub Actions**.
4. Открой вкладку **Actions**: должен появиться запуск «Выкладка сайта на GitHub Pages». Через минуту сайт будет по адресу `https://shoz1t.github.io/shozit-site/`.
5. Если сначала используешь этот адрес, а не свой домен, поменяй `siteUrl` в `site/site.json` на него и выполни `node tools/sync-site.mjs`.

Дальше любое изменение в папке `site/` выкладывается само: сделал `git add . && git commit -m "..." && git push`, и через минуту сайт обновился.

## 2. Как подключить домен shozit.ru

1. Купи домен и открой настройки DNS у регистратора.
2. Добавь четыре записи типа **A** для имени `@` (корень домена) на адреса GitHub Pages:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
3. Добавь запись **CNAME** для имени `www` со значением `shoz1t.github.io`.
4. Создай файл `site/CNAME` с одной строкой `shozit.ru` и отправь изменения (`git push`).
5. В **Settings → Pages** в поле **Custom domain** впиши `shozit.ru`, дождись проверки DNS (до нескольких часов) и поставь галочку **Enforce HTTPS**.
6. Проверь, что в `site/site.json` стоит `"siteUrl": "https://shozit.ru"`, выполни `node tools/sync-site.mjs` и отправь изменения. После этого превью ссылок в Telegram и Discord начнут показывать картинки.

Лаунчер ходит за `version.json` и `news.json` сначала на `shozit.ru`, а если там пусто, на `shoz1t.github.io/shozit-site`. Поэтому он заработает и до покупки домена.

## 3. Как выпустить релиз игры

Каждая игра лежит в **своём** репозитории (`shoz1t/rigged`, `shoz1t/deep-roll`): там только релизы, исходники хранить не обязательно.

1. Экспортируй игру из Godot отдельно для Windows и для Linux в две папки. В каждой должен лежать исполняемый файл (`RIGGED.exe` и `RIGGED.x86_64`, `DeepRoll.exe` и `DeepRoll.x86_64`) и все файлы рядом с ним (`.pck`, лицензии).
2. Запусти скрипт, он сам сделает архивы, посчитает хэши и обновит `site/version.json`:
   ```bash
   node tools/release.mjs game rigged 0.2.0 "D:\builds\rigged\windows" "D:\builds\rigged\linux"
   ```
   Архивы появятся в `test-builds/`: `RIGGED-v0.2.0-windows.zip` и `RIGGED-v0.2.0-linux.zip`.
3. На GitHub в репозитории игры открой **Releases → Draft a new release**, тег `v0.2.0`, прикрепи оба архива и нажми **Publish release**. Имена файлов должны остаться как есть, иначе ссылки в `version.json` не заработают.
4. Отправь сайт (`git add site/version.json`, `git commit`, `git push`). Кнопки «Скачать» на сайте и проверка обновлений в лаунчере начнут показывать новую версию.

Архивы больше нескольких сотен мегабайт в обычный репозиторий класть нельзя, но в релизы можно (до 2 ГБ на файл).

## 4. Как собрать и выпустить лаунчер

**Проверка у себя на компьютере (Windows):**
```bash
cd launcher
npm install
npm run dev          # запустить лаунчер для проверки
npm run build:exe    # собрать exe без установщика (launcher/src-tauri/target/release/shozit-launcher.exe)
```
Интерфейс можно посмотреть и в обычном браузере с заглушкой (`npm run preview`, адрес `http://localhost:5177/`, параметры `?installed=1`, `?offline=1`, `?fail=net`, `?fail=hash`, `?linux=1`).

**Релиз для всех (Windows и Linux через GitHub Actions):**
1. Увеличь версию в `launcher/src-tauri/tauri.conf.json` и `launcher/src-tauri/Cargo.toml` (одинаково) и отправь изменения.
2. Создай тег и отправь его:
   ```bash
   git tag launcher-v0.1.0
   git push origin launcher-v0.1.0
   ```
3. В **Actions** запустится «Сборка лаунчера»: сначала тесты (докачка, проверка хэша, защита распаковки), потом сборка. Через 10–15 минут в **Releases** появятся `ShozitLauncher-v0.1.0-windows-setup.exe`, `...-windows-portable.zip`, `...-linux.AppImage`, `...-linux.deb` и файлы с хэшами.
4. Скачай оба нужных файла (установщик Windows и AppImage) и запиши ссылки и хэши на сайт:
   ```bash
   node tools/release.mjs launcher 0.1.0 "ShozitLauncher-v0.1.0-windows-setup.exe" "ShozitLauncher-v0.1.0-linux.AppImage"
   ```
   Затем `git add site/version.json`, `git commit`, `git push`. Лаунчеры у игроков покажут «Вышла новая версия».

**Настройки лаунчера** (кнопка «Настройки» в заголовке, панель выезжает справа, закрывается крестиком, Esc или кликом вне панели): общая или отдельная папка установки для каждой игры (с проверкой записи и свободного места и вопросом «перенести или оставить» при смене папки), автообновление игр и проверка обновлений лаунчера, что делать после запуска игры (оставить, свернуть, закрыть), язык, проверка файлов игры по хэшам с восстановлением, открыть папку, удалить игру, отключение анимаций и фонового видео для слабых компьютеров, версия и журнал ошибок. Настройки лежат в `settings.json` в папке конфигурации приложения (Windows: `%APPDATA%\ru.shozit.launcher`, Linux: `~/.config/ru.shozit.launcher`), журнал в `logs/launcher.log` рядом с данными приложения. Автоустановка самого лаунчера не делается: он только сообщает о новой версии и открывает страницу загрузки.

**Как лаунчер ставит игру.** Читает `version.json` с сайта, выбирает сборку под текущую систему, качает архив с GitHub Releases в `.part`-файл с докачкой после обрыва сети, сверяет SHA-256 (повреждённый файл удаляет и качает заново один раз), распаковывает во временную папку и только потом заменяет старую версию. В Linux выдаёт файлу право на запуск. Пока в `version.json` пустой `sha256`, установка отказывается работать.

**Особенности окна без рамки.** В Windows размер меняется за края, как обычно. В Linux у окна без системной рамки нет своих границ, поэтому интерфейс рисует невидимые ручки по краям и вызывает системное изменение размера (работает и в X11, и в Wayland). Тень вместо большой CSS-тени заменена тонкой рамкой в 1 пиксель: тяжёлые тени и blur тормозят WebKitGTK. Если в Linux окно пустое или чёрное (бывает на NVIDIA и Wayland), запусти с `WEBKIT_DISABLE_DMABUF_RENDERER=1` (лаунчер ставит это сам; вернуть: `SHOZIT_KEEP_DMABUF=1`).

Для запуска AppImage в Linux: `chmod +x ShozitLauncher-*.AppImage && ./ShozitLauncher-*.AppImage`. Видео-фон требует кодека VP9 в GStreamer (пакет `gstreamer1.0-plugins-good`); без него просто не покажется.

## 5. Полезные команды

| Команда | Что делает |
|---|---|
| `node tools/serve.mjs site 5175` | показать сайт локально на `http://localhost:5175/` |
| `node tools/sync-site.mjs` | вписать русские тексты в HTML, проверить перевод, обновить sitemap и robots |
| `node tools/release.mjs ...` | подготовить релиз игры или лаунчера (см. выше) |
| `node tools/prepare-images.mjs` | пересобрать скриншоты сайта из `assets/` (нужен ffmpeg) |
| `node tools/make-logo.mjs` | пересобрать логотип в `design/logo/` |
| `node tools/make-textures.mjs` | пересобрать текстуры зерна, пятен и царапин |

Тексты сайта лежат в `site/i18n/ru.json` и `en.json`. После правки выполни `node tools/sync-site.mjs`.

## 6. Лицензии

- Шрифты IBM Plex, Victor Mono и Tiny5 свободные (SIL OFL), тексты лицензий лежат в `site/assets/fonts/licenses/`.
- Музыка в старом тизере Rigged («Nightfall», Scott Buckley, CC BY 4.0) требует подписи автора в описании видео.

Список того, что нужно заполнить руками, лежит в [MANUAL_TODO.md](MANUAL_TODO.md).
