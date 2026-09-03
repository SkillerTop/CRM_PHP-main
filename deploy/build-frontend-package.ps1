param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Output = (Join-Path $PSScriptRoot 'client-data-crm-frontend.zip'),
    [string]$PublicOutput = (Join-Path $PSScriptRoot 'client-data-crm-public.zip')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontend = Join-Path $project 'frontend'
$packageJson = Join-Path $frontend 'package.json'
$frontController = Join-Path $project 'deploy\mirohost-public\index.php'
if (-not (Test-Path -LiteralPath $packageJson)) {
    throw "Frontend package was not found under $frontend."
}
if (-not (Test-Path -LiteralPath $frontController)) {
    throw "Mirohost public front controller was not found under $frontController."
}

Push-Location $frontend
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

$dist = Join-Path $frontend 'dist'
foreach ($required in @('index.html', '.htaccess', 'assets')) {
    if (-not (Test-Path -LiteralPath (Join-Path $dist $required))) {
        throw "Required frontend artifact is missing: $required"
    }
}

$staging = Join-Path $env:TEMP ('crm-frontend-package-' + [guid]::NewGuid().ToString('N'))
$public = Join-Path $staging 'backend\public'
New-Item -ItemType Directory -Path $public -Force | Out-Null

try {
    Get-ChildItem -LiteralPath $dist -Recurse -Force -File | ForEach-Object {
        $relative = $_.FullName.Substring($dist.Length).TrimStart('\', '/')
        $destination = Join-Path $public $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    }
    # nginx hosting can forward every route, including static files, to PHP.
    # This controller serves the SPA/static assets and delegates /api/*.
    Copy-Item -LiteralPath $frontController -Destination (Join-Path $public 'index.php') -Force

    $outputPath = [System.IO.Path]::GetFullPath($Output)
    $outputDirectory = Split-Path -Parent $outputPath
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $staging,
        $outputPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    # This second archive is intentionally flat. Extract it while already in
    # the live backend/public directory to avoid backend/public duplication.
    $publicOutputPath = [System.IO.Path]::GetFullPath($PublicOutput)
    $publicOutputDirectory = Split-Path -Parent $publicOutputPath
    New-Item -ItemType Directory -Force -Path $publicOutputDirectory | Out-Null
    if (Test-Path -LiteralPath $publicOutputPath) {
        Remove-Item -LiteralPath $publicOutputPath -Force
    }
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $public,
        $publicOutputPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Write-Output $outputPath
    Write-Output $publicOutputPath
}
finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
