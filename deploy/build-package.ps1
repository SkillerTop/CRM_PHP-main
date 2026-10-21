param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Output = (Join-Path $PSScriptRoot 'client-data-crm-backend.zip'),
    [string]$PackageLabel = 'CRM GPU deployment with bundled models'
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$backend = Join-Path $project 'backend'
$frontend = Join-Path $project 'frontend'
$frontController = Join-Path $project 'deploy/mirohost-public/index.php'
$modelRoot = Join-Path $backend 'ai/models'
$requiredModels = @(
    'faster-whisper-large-v3-turbo/model.bin',
    'faster-whisper-large-v3-turbo/config.json',
    'faster-whisper-large-v3-turbo/tokenizer.json',
    'faster-whisper-large-v3-turbo/vocabulary.json'
)
foreach ($model in @('PP-LCNet_x1_0_doc_ori', 'UVDoc', 'PP-LCNet_x1_0_textline_ori', 'PP-OCRv5_server_det', 'eslav_PP-OCRv5_mobile_rec')) {
    foreach ($file in @('inference.json', 'inference.yml', 'inference.pdiparams')) {
        $requiredModels += "paddleocr/official_models/$model/$file"
    }
}
foreach ($required in @('backend/public/index.php', 'backend/.env', 'frontend/package.json', 'frontend/.env', 'deploy/mirohost-public/index.php', 'deploy/setup-ai.py', 'deploy/check-ai.php')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project $required) -PathType Leaf)) { throw "Missing package input: $required" }
}
foreach ($model in $requiredModels) {
    $path = Join-Path $modelRoot $model
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
        throw "Missing or empty bundled model: $model"
    }
}

Push-Location $frontend
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
}
finally { Pop-Location }
$dist = Join-Path $frontend 'dist'
foreach ($required in @('index.html', '.htaccess', 'assets')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $required))) { throw "Missing frontend output: $required" }
}

$stagingParent = [IO.Path]::GetFullPath((Join-Path $project '.tmp'))
$staging = Join-Path $stagingParent ('crm-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
$outputPath = [IO.Path]::GetFullPath($Output)
$partial = $outputPath + '.partial'
try {
    # Include the primary backend .env and bundled weights. Exclude environment
    # backups, machine-specific venvs, user uploads, logs and transient caches.
    foreach ($entry in Get-ChildItem -LiteralPath $backend -Force) {
        if ($entry.Name -in @('.runtime', '.tmp')) { continue }
        $files = if ($entry.PSIsContainer) { Get-ChildItem -LiteralPath $entry.FullName -Recurse -Force -File } else { @($entry) }
        foreach ($file in $files) {
            $relative = $file.FullName.Substring($backend.Length).TrimStart([char[]]'\/').Replace('\', '/')
            if ($relative -match '(^|/)\.env(?:$|[.\s_-])' -and $relative -notin @('.env', '.env.example')) { continue }
            if ($relative -match '(^|/)(__pycache__|\.cache|huggingface|whisper-cache)/' -or $relative -match '\.(pyc|lock)$') { continue }
            if ($relative -in @('database/queries/postman-verification.sql', 'src/Service/README.md')) { continue }
            if ($relative.StartsWith('storage/tmp/')) { continue }
            if (($relative.StartsWith('storage/uploads/') -or $relative.StartsWith('storage/logs/')) -and -not $relative.EndsWith('/.gitkeep')) { continue }
            $destination = Join-Path $staging ('backend/' + $relative)
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination
        }
    }
    # Frontend environment files stay outside the public document root.
    $frontendConfig = Join-Path $staging 'frontend'
    New-Item -ItemType Directory -Force -Path $frontendConfig | Out-Null
    Get-ChildItem -LiteralPath $frontend -Force -File | Where-Object { $_.Name -match '^\.env(?:\.[a-zA-Z0-9_-]+)*$' } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $frontendConfig $_.Name)
    }
    $public = Join-Path $staging 'backend/public'
    Get-ChildItem -LiteralPath $dist -Recurse -Force -File | ForEach-Object {
        $relative = $_.FullName.Substring($dist.Length).TrimStart([char[]]'\/')
        if ($_.Name -like '.env*') { throw 'Environment files must not be placed in public output.' }
        $destination = Join-Path $public $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    }
    Copy-Item -LiteralPath $frontController -Destination (Join-Path $public 'index.php') -Force
    $deploy = Join-Path $staging 'deploy'
    New-Item -ItemType Directory -Force -Path $deploy | Out-Null
    foreach ($name in @('setup-ai.py', 'check-ai.php', 'DEPLOY_WITH_MODELS.md')) {
        Copy-Item -LiteralPath (Join-Path $project "deploy/$name") -Destination (Join-Path $deploy $name)
    }
    $manifest = @(Get-ChildItem -LiteralPath (Join-Path $staging 'backend/ai/models') -Recurse -File | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($staging.Length + 1).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    ConvertTo-Json -InputObject $manifest -Depth 4 | Set-Content -LiteralPath (Join-Path $staging 'AI-MODELS.json') -Encoding utf8
    @(
        "Package: $PackageLabel"
        "Built (UTC): $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss'))"
        'Includes backend/.env, frontend/.env* and local AI model weights.'
        'DocumentRoot: backend/public. Run deploy/setup-ai.py on the target OS, then deploy/check-ai.php.'
    ) | Set-Content -LiteralPath (Join-Path $staging 'PACKAGE-INFO.txt') -Encoding utf8

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null
    if (Test-Path -LiteralPath $partial) { throw "Incomplete archive already exists: $partial" }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # ZipFile includes dotfiles and supports large files/ZIP64.
    [IO.Compression.ZipFile]::CreateFromDirectory($staging, $partial, [IO.Compression.CompressionLevel]::Fastest, $false)
    $zip = [IO.Compression.ZipFile]::OpenRead($partial)
    try {
        foreach ($required in @('backend/.env', 'frontend/.env', 'AI-MODELS.json') + @($manifest | ForEach-Object { $_.path })) {
            if ($null -eq $zip.GetEntry($required)) { throw "Archive verification failed: $required" }
        }
        foreach ($item in $manifest) {
            if ($zip.GetEntry($item.path).Length -ne $item.bytes) { throw "Archive model size mismatch: $($item.path)" }
        }
    }
    finally { $zip.Dispose() }
    Move-Item -LiteralPath $partial -Destination $outputPath -Force
    Write-Output $outputPath
}
finally {
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    if (-not $resolvedStaging.StartsWith($stagingParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to remove staging outside the project temporary directory.'
    }
    if (Test-Path -LiteralPath $resolvedStaging) { Remove-Item -LiteralPath $resolvedStaging -Recurse -Force }
}
