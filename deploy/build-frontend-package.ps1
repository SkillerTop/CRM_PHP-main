param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Output = (Join-Path $PSScriptRoot 'client-data-crm-frontend.zip')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontend = Join-Path $project 'frontend'
$packageJson = Join-Path $frontend 'package.json'
if (-not (Test-Path -LiteralPath $packageJson)) {
    throw "Frontend package was not found under $frontend."
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

$outputPath = [System.IO.Path]::GetFullPath($Output)
$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
if (Test-Path -LiteralPath $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $dist,
    $outputPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

Write-Output $outputPath
