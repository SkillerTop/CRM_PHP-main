param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Output = (Join-Path $PSScriptRoot 'client-data-crm-backend.zip')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$backend = Join-Path $project 'backend'
if (-not (Test-Path -LiteralPath (Join-Path $backend 'public\index.php'))) {
    throw "Backend entry point was not found under $backend."
}

$staging = Join-Path $env:TEMP ('crm-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    # This archive is the PHP runtime package. Frontend deployment is handled by
    # its own Vinext/hosting pipeline and is intentionally not mixed into it.
    Get-ChildItem -LiteralPath $backend -Recurse -Force -File | ForEach-Object {
        $relativeToBackend = $_.FullName.Substring($backend.Length).TrimStart('\', '/')
        $normalized = $relativeToBackend.Replace('\', '/')
        $skip = $false

        if ($normalized -match '(^|/)\.env(?:\..*)?$' -and $normalized -notmatch '(^|/)\.env\.example$') { $skip = $true }
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

    if (Test-Path -LiteralPath $Output) { Remove-Item -LiteralPath $Output -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $Output -CompressionLevel Optimal
    Write-Output $Output
}
finally {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
