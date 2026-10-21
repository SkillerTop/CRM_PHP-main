# Local AI setup for RTX 5080

The CRM runs both conference input features locally:

- speech: Faster-Whisper `large-v3-turbo`, CUDA, FP16;
- business cards: PaddleOCR PP-OCRv5, GPU, Ukrainian/East-Slavic model (Ukrainian, Russian, and English).

Python 3.11 is recommended. Use separate virtual environments so PaddlePaddle and CTranslate2 can be upgraded independently.

## Current portable deployment package

The full package now includes `backend/.env`, `frontend/.env*` and the downloaded
model weights under `backend/ai/models`. The current backend configuration uses
project-relative paths, CUDA and FP16:

```dotenv
WHISPER_PYTHON_BIN=../.runtime/whisper
WHISPER_MODEL=./ai/models/faster-whisper-large-v3-turbo
WHISPER_MODEL_DIR=ai/models/whisper-cache
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
OCR_PYTHON_BIN=../.runtime/ocr
OCR_MODEL_DIR=ai/models/paddleocr
OCR_DEVICE=gpu
```

Python paths can name a venv directory: PHP selects `Scripts/python.exe` on Windows
or `bin/python` on Linux. After extracting the package run `python deploy/setup-ai.py`
to create native environments inside the project and verify GPU inference through
PHP. See `deploy/DEPLOY_WITH_MODELS.md`. GPU drivers and CUDA libraries are target
machine prerequisites. The historical CPU test below does not certify GPU access.

## Windows workstation

Install a current NVIDIA driver, CUDA 12 runtime libraries and cuDNN 9. Ensure their DLL directories are present in the service account's `PATH`.

```powershell
py -3.11 -m venv .runtime/whisper
.runtime/whisper/Scripts/python.exe -m pip install --upgrade pip
.runtime/whisper/Scripts/python.exe -m pip install -r backend/ai/requirements-speech.txt

py -3.11 -m venv .runtime/ocr
.runtime/ocr/Scripts/python.exe -m pip install --upgrade pip
```

For an NVIDIA 50-series GPU on Windows, install the official stable CUDA 12.9 build, then install the OCR package:

```powershell
.runtime/ocr/Scripts/python.exe -m pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu129/
.runtime/ocr/Scripts/python.exe -m pip install -r backend/ai/requirements-ocr.txt
```

If the NVIDIA driver is unavailable to the PHP service account, the OCR runner automatically falls back to CPU instead of returning a service error. After the driver becomes visible, `OCR_DEVICE=gpu` starts using the GPU without changing the application code.

Configure `backend/.env` with paths relative to the backend directory:

```dotenv
WHISPER_PYTHON_BIN=../.runtime/whisper
WHISPER_SCRIPT=ai/faster_whisper_transcribe.py
WHISPER_MODEL=./ai/models/faster-whisper-large-v3-turbo
WHISPER_MODEL_DIR=ai/models/whisper-cache
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
WHISPER_BEAM_SIZE=5
WHISPER_LANGUAGE=auto
WHISPER_INITIAL_PROMPT=
WHISPER_TIMEOUT_SECONDS=180

OCR_PYTHON_BIN=../.runtime/ocr
OCR_PADDLE_SCRIPT=ai/paddleocr_business_card.py
OCR_LANGUAGE=uk
OCR_DEVICE=gpu
OCR_MODEL_DIR=ai/models/paddleocr
OCR_TIMEOUT_SECONDS=180
```

## Preload and verify before a conference

The full package already includes model files. Run both commands from the project root, replacing the sample files with a short recording and a business-card image:

```powershell
.runtime/whisper/Scripts/python.exe backend/ai/faster_whisper_transcribe.py --input sample.webm --model backend/ai/models/faster-whisper-large-v3-turbo --cache-dir backend/ai/models/whisper-cache --device cuda --compute-type float16 --beam-size 5
.runtime/ocr/Scripts/python.exe backend/ai/paddleocr_business_card.py --input card.jpg --language uk --device gpu --model-dir backend/ai/models/paddleocr
```

Both commands must print a single JSON object. After that, test the CRM microphone button and **Scan / upload card** from the same Windows account that runs PHP. Model directories must remain writable by that account.

## Local Faster-Whisper preparation without a visible GPU

Use the existing project speech environment when CUDA is unavailable. Keep the
converted model in a separate directory from the OpenAI Whisper `.pt` files:

```powershell
.runtime/whisper/Scripts/python.exe -m pip install -r backend/ai/requirements-speech.txt
.runtime/whisper/Scripts/python.exe -c "from faster_whisper.utils import download_model; download_model('large-v3-turbo', output_dir='backend/ai/models/faster-whisper-large-v3-turbo')"
```

Set `WHISPER_PYTHON_BIN=../.runtime/whisper` and
`WHISPER_MODEL=./ai/models/faster-whisper-large-v3-turbo` in `backend/.env`.
Set `WHISPER_DEVICE=cpu` and `WHISPER_COMPUTE_TYPE=int8`. Using the model directory
directly avoids a model download during transcription. The directory must contain
`model.bin`, `config.json`, `tokenizer.json`, and `vocabulary.json`.

Verify recognition with an actual recording:

```powershell
.runtime/whisper/Scripts/python.exe backend/ai/faster_whisper_transcribe.py --input sample.webm --model backend/ai/models/faster-whisper-large-v3-turbo --cache-dir backend/ai/models/whisper-cache --device cpu --compute-type int8 --beam-size 5
```

Installation alone does not enable the microphone controls in CRM. The full
deployment ZIP includes model weights under `backend/ai/models`; local Python
environments are recreated for the target OS using `deploy/setup-ai.py`.

Local verification on 2026-10-20: Faster-Whisper 1.2.1, CTranslate2 4.8.3,
and PyAV 18.1.0 successfully transcribed an existing WebM/Opus recording through
PHP `ProcessRunner` with `HF_HUB_OFFLINE=1`, CPU/int8, and no stderr output.
The request completed in 46.66 seconds and detected Russian. The downloaded
`large-v3-turbo` weights contain 1,617,884,929 bytes; SHA-256
`e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da`
matches the download metadata. No CUDA devices were visible to CTranslate2.
The speech requirements cap PyAV below 19 because Faster-Whisper 1.2.1 uses an
`av.open` argument removed in PyAV 19.

## Operational notes

- Audio and card images are processed locally and removed from temporary storage after the request.
- The RTX 5080 handles inference. The Ryzen CPU and 128 GB RAM provide ample preprocessing and model-cache capacity.
- Set `WHISPER_INITIAL_PROMPT` to recurring company names and industry terminology if conference vocabulary is often misrecognized.
- If PaddleOCR reports a GPU compatibility error on Windows, verify that the installed wheel is specifically the official NVIDIA 50-series build matching the Python version.
