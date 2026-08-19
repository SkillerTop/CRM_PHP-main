param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Output = (Join-Path $PSScriptRoot 'client-data-crm-backend.zip')
)

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$staging = Join-Path $env:TEMP ('crm-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

try {
    $excludedDirectories = @('.git', '.tmp', 'deploy/package')
    $excludedFiles = @('.env', 'storage/logs/app.log', 'storage/logs/mail.log', 'deploy/client-data-crm-backend.zip')
    Get-ChildItem -LiteralPath $project -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($project.Length).TrimStart('\', '/')
        $normalized = $relative.Replace('\', '/')
        $skipDirectory = $false
        foreach ($directory in $excludedDirectories) {
            if ($normalized -eq $directory -or $normalized.StartsWith($directory + '/')) {
                $skipDirectory = $true
                break
            }
        }
        if ($skipDirectory -or $excludedFiles -contains $normalized -or $normalized.StartsWith('storage/uploads/')) {
            return
        }
        $destination = Join-Path $staging $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination
    }
    if (Test-Path -LiteralPath $Output) {
        Remove-Item -LiteralPath $Output -Force
    }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $Output -CompressionLevel Optimal
    Write-Output $Output
}
finally {
    if (Test-Path -LiteralPath $staging) {
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
