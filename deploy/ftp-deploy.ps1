param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDirectory,
    [string]$HostName = $(if ($env:FTP_HOST) { $env:FTP_HOST } else { 'vs584.mirohost.net' }),
    [int]$Port = $(if ($env:FTP_PORT) { [int]$env:FTP_PORT } else { 21 }),
    [string]$RemotePath = $(if ($env:FTP_REMOTE_PATH) { $env:FTP_REMOTE_PATH } else { '/' }),
    [switch]$PlainFtp
)

$ErrorActionPreference = 'Stop'
$username = $env:FTP_USERNAME
$password = $env:FTP_PASSWORD
if (-not $username -or -not $password) {
    throw 'Set FTP_USERNAME and FTP_PASSWORD in the process environment.'
}

$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$credential = New-Object System.Net.NetworkCredential($username, $password)
$ssl = -not $PlainFtp

function New-FtpRequest([string]$uri, [string]$method) {
    $request = [System.Net.FtpWebRequest]::Create($uri)
    $request.Method = $method
    $request.Credentials = $credential
    $request.EnableSsl = $ssl
    $request.UseBinary = $true
    $request.KeepAlive = $false
    return $request
}

function Ensure-FtpDirectory([string]$relativeDirectory) {
    if ([string]::IsNullOrWhiteSpace($relativeDirectory)) { return }
    $segments = $relativeDirectory.Replace('\', '/').Split('/', [System.StringSplitOptions]::RemoveEmptyEntries)
    $current = $RemotePath.TrimEnd('/')
    foreach ($segment in $segments) {
        $current += '/' + [uri]::EscapeDataString($segment)
        $uri = "ftp://${HostName}:${Port}${current}"
        try {
            $request = New-FtpRequest $uri ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
            $response = $request.GetResponse()
            $response.Close()
        }
        catch [System.Net.WebException] {
            $response = $_.Exception.Response
            if ($response) { $response.Close() }
        }
    }
}

function Test-ExcludedPath([string]$normalized) {
    if ($normalized -match '(^|/)\.env(?:\..*)?$' -and $normalized -notmatch '(^|/)\.env\.example$') { return $true }
    if ($normalized -match '(^|/)(\.git|\.runtime|node_modules|\.next|\.wrangler|dist|frontend|tests|tools|postman|docs|deploy)(/|$)') { return $true }
    if ($normalized -match '(^|/)database/queries/') { return $true }
    if ($normalized -match '(^|/)storage/uploads/(?!\.gitkeep$).+') { return $true }
    if ($normalized -match '(^|/)storage/logs/(?!\.gitkeep$).+') { return $true }
    if ($normalized -match '(^|/)README\.md$|(^|/)\.git(?:ignore|attributes)$') { return $true }
    return $false
}

Get-ChildItem -LiteralPath $source -Recurse -Force -File | ForEach-Object {
    $relative = $_.FullName.Substring($source.Length).TrimStart('\', '/')
    $normalized = $relative.Replace('\', '/')
    if (Test-ExcludedPath $normalized) { return }

    $relativeDirectory = Split-Path -Parent $relative
    Ensure-FtpDirectory $relativeDirectory
    $remoteFile = (($RemotePath.TrimEnd('/') + '/' + $normalized).Split('/') | ForEach-Object {
        if ($_ -eq '') { '' } else { [uri]::EscapeDataString($_) }
    }) -join '/'
    $uri = "ftp://${HostName}:${Port}${remoteFile}"
    $request = New-FtpRequest $uri ([System.Net.WebRequestMethods+Ftp]::UploadFile)
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $request.ContentLength = $bytes.Length
    $stream = $request.GetRequestStream()
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Close() }
    $response = $request.GetResponse()
    $response.Close()
    Write-Output "Uploaded $normalized"
}
