param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Output = (Join-Path $PSScriptRoot 'client-data-crm-backend.zip')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$backend = Join-Path $project 'backend'
$frontend = Join-Path $project 'frontend'
$frontController = Join-Path $project 'deploy\mirohost-public\index.php'
if (-not (Test-Path -LiteralPath (Join-Path $backend 'public\index.php'))) {
    throw "Backend entry point was not found under $backend."
}
if (-not (Test-Path -LiteralPath (Join-Path $frontend 'package.json'))) {
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

$staging = Join-Path $env:TEMP ('crm-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    # Copy the private PHP application first. Runtime secrets and user data stay
    # on the server and are intentionally excluded.
    Get-ChildItem -LiteralPath $backend -Recurse -Force -File | ForEach-Object {
        $relativeToBackend = $_.FullName.Substring($backend.Length).TrimStart('\', '/')
        $normalized = $relativeToBackend.Replace('\', '/')
        $skip = $false

        if ($normalized -match '(^|/)\.env(?:$|[\.\s_-])' -and $normalized -notmatch '(^|/)\.env\.example$') { $skip = $true }
        if ($normalized -eq 'database/queries/postman-verification.sql') { $skip = $true }
        if ($normalized -eq 'src/Service/README.md') { $skip = $true }
        if ($normalized.StartsWith('.runtime/') -or $normalized.StartsWith('.tmp/')) { $skip = $true }
        if ($normalized -match '^storage/\..+\.lock$') { $skip = $true }
        if ($normalized.StartsWith('storage/uploads/') -and $normalized -ne 'storage/uploads/.gitkeep') { $skip = $true }
        if ($normalized.StartsWith('storage/logs/') -and $normalized -ne 'storage/logs/.gitkeep') { $skip = $true }
        if ($skip) { return }

        $destination = Join-Path $staging ('backend\' + $relativeToBackend)
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination
    }

    # The production document root is backend/public. Merge the Vite output
    # there and install the nginx-compatible SPA/API front controller.
    $public = Join-Path $staging 'backend\public'
    Get-ChildItem -LiteralPath $dist -Recurse -Force -File | ForEach-Object {
        $relative = $_.FullName.Substring($dist.Length).TrimStart('\', '/')
        $destination = Join-Path $public $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    }
    Copy-Item -LiteralPath $frontController -Destination (Join-Path $public 'index.php') -Force

    if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $Output -CompressionLevel Optimal
    Write-Output $Output
}
finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
