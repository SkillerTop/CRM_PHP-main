# Deployment with bundled AI models

Extract the entire archive into one application directory. Keep its structure:

```text
backend/.env
backend/ai/models/faster-whisper-large-v3-turbo/
backend/ai/models/paddleocr/official_models/
backend/public/                         <- web server DocumentRoot
frontend/.env                          <- build settings, outside DocumentRoot
deploy/setup-ai.py
deploy/check-ai.php
AI-MODELS.json
```

The archive includes the requested environment files and downloaded model weights.
Treat the archive as private: the environment files contain deployment credentials.
Only `backend/public` is served by the web server. Review database/mail/URL settings
for the destination in `backend/.env`; packaged values are copied from the build machine.
Vite environment settings apply when building the frontend, not after extraction.

Install Python 3.11 or 3.12, PHP, an appropriate NVIDIA driver, CUDA 12 cuBLAS and
cuDNN 9 on the target machine. The default PaddlePaddle wheel uses CUDA 12.9;
its required driver/runtime must be available. Then run from the project directory:

```text
python deploy/setup-ai.py
```

Use `python3` on Linux if that is the installed command. Use `--php /path/to/php`
if PHP is not on PATH. The setup verifies every model checksum and creates
`.runtime/whisper` and `.runtime/ocr` inside the project for the target OS. It downloads
Python packages, but it does not download the bundled model weights. Windows venvs
are not copied to Linux or another machine. Do not reuse a copied venv.

The final check performs actual inference through PHP on the configured devices;
it fails when CUDA/GPU is configured but unavailable. Run it as the PHP service
account, with the same environment, to verify service access:

```text
php deploy/check-ai.php
```

Verify only the bundled files without installing packages:

```text
python deploy/setup-ai.py --verify-only
```

All configured filesystem paths are relative to `backend`, independently of the
current working directory. A Python venv directory resolves to `Scripts/python.exe`
on Windows and `bin/python` on Linux. Faster-Whisper uses CUDA/float16. Model files
stay inside `backend/ai/models` and require no manual transfer to external folders.
The runtime account must have read access to weights and write access to temporary
storage and model-cache directories. GPU readiness still depends on the target
machine; the build machine did not expose a CUDA device.

Microphone controls are enabled in company descriptions, task descriptions and
new task comments. Business-card OCR is enabled in the contact creation form.
Use HTTPS (or localhost) and allow microphone access in the browser. Run the GPU
check before using these controls on the target server.
