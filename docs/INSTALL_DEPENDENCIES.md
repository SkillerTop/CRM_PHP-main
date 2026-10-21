# Зависимости проекта и установка

Актуальный для этой рабочей копии список **каждого установленного npm-пакета,
Python-пакета и PHP-модуля с точной версией** находится в
[`DEPENDENCY_INVENTORY.md`](DEPENDENCY_INVENTORY.md). Ниже указано, зачем нужны
основные компоненты и как собрать рабочее окружение. Снимок сделан
21 октября 2026 года. Не копируйте `.runtime` или `node_modules` между ОС:
создавайте их заново на целевой машине.

## Что используется

| Слой | Зависимости и назначение |
| --- | --- |
| Frontend | Node.js `>=22.13` (здесь `24.18.0`), npm (здесь `11.16.0`), React и React DOM `19.2.6` для интерфейса; `nspell` `2.1.5` и словари `dictionary-en` `4.0.0`, `dictionary-ru` `3.0.0`, `dictionary-uk` `4.0.0` для проверки текста. |
| Сборка frontend | Vite `8.0.13`, `@vitejs/plugin-react` `6.0.2`, TypeScript `5.9.3`, типы Node/React, ESLint `9.39.4`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `globals`. Они перечислены в `frontend/package.json`; 175 фактически установленных пакетов и транзитивных зависимостей — в инвентаризации, а 207 записей lock-файла (включая пакеты для других платформ) — в `frontend/package-lock.json`. |
| PHP backend | PHP `8.3` (здесь `8.3.33`), `pdo_mysql`, `mbstring`, `json`, `openssl`, `fileinfo`; для перевода используется `curl` либо разрешённый `allow_url_fopen`. Код загружает классы через `backend/src/autoload.php`; Composer-пакетов в проекте нет. |
| База и HTTP | MySQL `8.0+` с InnoDB (локально установлен `8.0.46`, Docker-образ `8.4`); веб-сервер Apache `2.4` либо локальный встроенный сервер PHP. Production-конфигурация Apache требует модули из `README.md`; в Docker включены `rewrite` и `headers`. |
| Распознавание речи | Python `3.11/3.12` (текущее окружение `3.12`), `faster-whisper` `1.2.1`, `ctranslate2` `4.8.3`, `av`/PyAV `18.1.0`, модель `large-v3-turbo`. `av` декодирует аудио, поэтому отдельный FFmpeg для этого пути не требуется. В текущем окружении также есть `openai-whisper` и PyTorch для предусмотренного кодом резервного пути; они не входят в обязательный `requirements-speech.txt`. |
| OCR | Отдельное Python-окружение с `paddlepaddle-gpu` `3.2.1`, `paddleocr` `3.7.0`, `paddlex` `3.7.2`, OpenCV, NumPy, Pillow и пятью локальными весами PP-OCRv5. Транзитивные NVIDIA CUDA-библиотеки перечислены в инвентаризации. |
| GPU | NVIDIA-драйвер и доступные процессу PHP библиотеки CUDA 12/cuBLAS и cuDNN 9. Настройки проекта: `WHISPER_DEVICE=cuda`, `WHISPER_COMPUTE_TYPE=float16`, `OCR_DEVICE=gpu`. Они не меняются на CPU при установке. |
| Фоновые задачи | Планировщик раз в 15 минут запускает напоминания и очистку. Для отправки почты нужен SMTP-сервер либо настроенный PHP `mail()`; `MAIL_TRANSPORT=log` подходит для разработки. |
| Дополнительные службы | Перевод использует внешний HTTP API `api.mymemory.translated.net`, если `TRANSLATION_ENDPOINT` не задан. Скрипты резервного копирования требуют `age`, `flock`, `mysqldump`, `tar`, `gzip`, `sha256sum`; это не зависимости основного запуска CRM. |

Прямые npm-зависимости (версии фактической установки):

| Пакеты | Назначение |
| --- | --- |
| `react@19.2.6`, `react-dom@19.2.6` | Компоненты и отрисовка интерфейса. |
| `nspell@2.1.5`, `dictionary-en@4.0.0`, `dictionary-ru@3.0.0`, `dictionary-uk@4.0.0` | Проверка орфографии на трёх языках. |
| `vite@8.0.13`, `@vitejs/plugin-react@6.0.2` | Dev-сервер и production-сборка React. |
| `typescript@5.9.3`, `@types/node@22.19.19`, `@types/react@19.2.14`, `@types/react-dom@19.2.3` | Проверка типов при разработке и сборке. |
| `eslint@9.39.4`, `@eslint/js@9.39.4`, `typescript-eslint@8.59.3`, `eslint-plugin-react-hooks@7.1.1`, `globals@14.0.0` | Статический анализ кода. |

Docker-образ напрямую устанавливает системные пакеты `apache2`,
`libapache2-mod-php8.3`, `php8.3-cli`, `php8.3-mysql`, `php8.3-mbstring`,
`php8.3-curl`, `php8.3-xml`, `php8.3-zip`, `python3`, `python3-venv`,
`ca-certificates`, `curl`, `libgomp1`, `libglib2.0-0`, `libgl1`.
Последние три нужны нативным библиотекам OCR/OpenCV. Базовые образы:
`node:22-bookworm` для сборки frontend,
`nvidia/cuda:12.9.1-cudnn-runtime-ubuntu24.04` для приложения и `mysql:8.4`
для базы данных. Их собственные системные зависимости определяются образами.

`backend/ai/models` содержит веса, а не Python-библиотеки. Папка
`faster-whisper-large-v3-turbo` содержит `model.bin`, `config.json`,
`tokenizer.json`, `vocabulary.json`. В
`paddleocr/official_models` нужны `PP-LCNet_x1_0_doc_ori`, `UVDoc`,
`PP-LCNet_x1_0_textline_ori`, `PP-OCRv5_server_det` и
`eslav_PP-OCRv5_mobile_rec`. Веса исключены из Git; они уже лежат в этой
рабочей копии и входят в полный приватный архив развёртывания.

## Установка на Windows без Docker

Команды выполняются из корня репозитория в PowerShell. Установите Node.js
`>=22.13`, PHP `8.3` x64 NTS с перечисленными расширениями, MySQL `8.0+`,
Python `3.11` или `3.12` и NVIDIA-драйвер. Для работы на GPU нужны CUDA 12
cuBLAS и cuDNN 9, доступные той же учётной записи, от которой запущен PHP.
Для PaddlePaddle на NVIDIA 50-й серии используется пакет CUDA 12.9.
Если PHP установлен отдельно, распакуйте его в `.runtime/php` либо замените
во всех командах ниже `.runtime/php/php.exe` на `php` из `PATH`. В `php.ini`
включите `extension=mbstring`, `extension=pdo_mysql`, `extension=openssl` и
`extension=fileinfo`; `json` входит в PHP 8.3. Проверьте набор командой
`php -m`. Установите службу MySQL, создайте отдельные базу и пользователя CRM
с правами на неё и внесите их в `backend/.env` (`DB_HOST`, `DB_PORT`,
`DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`).

### 1. Frontend

```powershell
Set-Location frontend
npm ci
npm run build
npm run lint
Set-Location ..
```

`npm ci` устанавливает версии из `package-lock.json`, не меняя lock-файл.
Для разработки скопируйте `frontend/.env.example` в `frontend/.env.local` и
запустите `npm run dev` в каталоге `frontend`.

### 2. Две независимые Python-среды

Для новой установки используйте доступный `py -3.12` или замените его на
`py -3.11`. Если каталоги `.runtime/whisper` и `.runtime/ocr` уже существуют,
не создавайте их поверх работающей установки.

```powershell
py -3.12 -m venv .runtime/whisper
.runtime/whisper/Scripts/python.exe -m pip install --upgrade pip
.runtime/whisper/Scripts/python.exe -m pip install -r backend/ai/requirements-speech.txt

py -3.12 -m venv .runtime/ocr
.runtime/ocr/Scripts/python.exe -m pip install --upgrade pip
.runtime/ocr/Scripts/python.exe -m pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
.runtime/ocr/Scripts/python.exe -m pip install -r backend/ai/requirements-ocr.txt

.runtime/whisper/Scripts/python.exe -m pip check
.runtime/ocr/Scripts/python.exe -m pip check
```

`requirements-speech.txt` допускает `faster-whisper>=1.2,<2` и
`av>=11,<19`; `requirements-ocr.txt` — `paddleocr>=3.3,<4`. Поэтому новая
установка может выбрать версии новее текущего снимка. Для точного состава
установленных сейчас окружений смотрите инвентаризацию. Среды намеренно
разделены, чтобы зависимости CTranslate2 и PaddlePaddle не смешивались.

### 3. Модели и конфигурация

Скопируйте полный каталог `backend/ai/models` из приватного deployment-пакета
или уже подготовленной установки в ту же структуру. Простой Git checkout
весов не содержит. Скрипт `deploy/setup-ai.py` работает **после распаковки
полного архива**, потому что проверяет приложенный `AI-MODELS.json`; в обычном
checkout этого файла нет.

В `backend/.env` задайте доступ к MySQL, URL приложения и пути к окружениям:

```dotenv
WHISPER_PYTHON_BIN=../.runtime/whisper
WHISPER_SCRIPT=ai/faster_whisper_transcribe.py
WHISPER_MODEL=./ai/models/faster-whisper-large-v3-turbo
WHISPER_MODEL_DIR=ai/models/whisper-cache
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
WHISPER_LANGUAGE=auto
OCR_PYTHON_BIN=../.runtime/ocr
OCR_PADDLE_SCRIPT=ai/paddleocr_business_card.py
OCR_MODEL_DIR=ai/models/paddleocr
OCR_DEVICE=gpu
OCR_LANGUAGE=uk
```

Выполните проверки от той же учётной записи, что обслуживает PHP:

```powershell
.runtime/php/php.exe backend/bin/console config:check
.runtime/php/php.exe backend/bin/console migrate
.runtime/php/php.exe deploy/check-ai.php
```

Последняя команда выполняет **реальный инференс** обеих моделей на устройствах
из `.env`. Для новой базы создайте администратора командой
`php backend/bin/console create-admin` после установки `ADMIN_EMAIL` и
`ADMIN_PASSWORD`. Существующую базу и учётную запись не переинициализируйте.

Для локального сервера PHP используйте команду из `docs/RUN_AND_TEST.md`.
Локальный `APP_URL` должен совпадать с фактическим URL в браузере. В рабочем
окружении нужен HTTPS, корректные `SESSION_SECURE` и параметры SMTP.

## Установка через Docker

В этом варианте PHP, Apache, Node для сборки frontend, оба Python-окружения,
CUDA/cuDNN и MySQL устанавливаются из `Dockerfile` и `compose.yaml`. На хосте
нужны Docker Engine/Compose, NVIDIA-драйвер, GPU passthrough и сами файлы
моделей в `backend/ai/models`; хостовые `.runtime` и `node_modules` не
используются. Требование к GPU в Compose остаётся обязательным.

```powershell
Copy-Item .env.docker.example .env.docker
# Замените в .env.docker три значения-заглушки на уникальные секреты.
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up --build -d db app
docker compose --env-file .env.docker exec app php bin/console migrate
docker compose --env-file .env.docker up -d scheduler
docker compose --env-file .env.docker exec -u www-data app php /var/www/deploy/check-ai.php
```

Если `.env.docker` уже создан и настроен, не перезаписывайте его примером.
Подробности по HTTPS, хранилищам и первому запуску — в `deploy/DOCKER.md`.

## Как проверить состав установки

```powershell
node --version
npm --version
npm --prefix frontend ls --all
.runtime/php/php.exe --version
.runtime/php/php.exe -m
.runtime/whisper/Scripts/python.exe -m pip list
.runtime/ocr/Scripts/python.exe -m pip list
.runtime/whisper/Scripts/python.exe -m pip check
.runtime/ocr/Scripts/python.exe -m pip check
```

Полезные первичные источники: [npm ci](https://docs.npmjs.com/cli/commands/npm-ci/),
[Faster-Whisper GPU requirements](https://github.com/SYSTRAN/faster-whisper#gpu),
[PaddleOCR для NVIDIA Blackwell](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PaddleOCR-VL-NVIDIA-Blackwell.md),
[GPU в Docker Compose](https://docs.docker.com/compose/how-tos/gpu-support/).
