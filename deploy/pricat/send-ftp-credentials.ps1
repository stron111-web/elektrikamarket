#requires -Version 5.1
# Run interactively. No secret files are created on Windows.
[CmdletBinding()]
param(
    [string]$KeyFile = (Join-Path $env:USERPROFILE '.ssh\elektrikamarket_vps'),
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..')
)
$ErrorActionPreference = 'Stop'
$sshExecutable = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $sshExecutable -PathType Leaf)) { throw 'Windows OpenSSH client not found.' }
if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { throw 'Existing SSH key not found.' }
if ($KeyFile -match '["\r\n]') { throw 'Invalid key path.' }
$receiver = '/home/shopadmin/elektrikamarket-pricat-inputs/receive-credentials.py'
$common = @('-i', $KeyFile, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'shopadmin@168.113.208.94')

# Verify the public receiver before collecting any credentials.
$source = Join-Path $ProjectRoot 'scripts\pricat-update\receive-credentials.py'
$body = [IO.File]::ReadAllText($source).Replace("`r`n", "`n")
$hasher = [Security.Cryptography.SHA256]::Create()
try { $expected = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)))).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
$actual = & $sshExecutable @common "sha256sum $receiver"
if ($LASTEXITCODE -ne 0 -or ($actual -split '\s+')[0] -ne $expected) { throw 'SSH receiver verification failed. No credentials sent.' }
$ready = & $sshExecutable @common "python3 $receiver --prepare"
if ($LASTEXITCODE -ne 0 -or $ready -ne 'CREDENTIALS_READY') { throw 'Receiver is not ready or credentials already exist. No overwrite.' }

$loginSecret = Read-Host 'FTP username (hidden)' -AsSecureString
$passwordSecret = Read-Host 'FTP password (hidden)' -AsSecureString
$loginPointer = [IntPtr]::Zero
$passwordPointer = [IntPtr]::Zero
$process = $null
try {
    $loginPointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($loginSecret)
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($passwordSecret)
    $loginValue = [Runtime.InteropServices.Marshal]::PtrToStringUni($loginPointer)
    $passwordValue = [Runtime.InteropServices.Marshal]::PtrToStringUni($passwordPointer)
    $payload = @{ username = $loginValue; password = $passwordValue } | ConvertTo-Json -Compress
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $sshExecutable
    # All arguments are public constants/key path; the secret goes to stdin only.
    $start.Arguments = '-i "' + $KeyFile + '" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 shopadmin@168.113.208.94 python3 ' + $receiver
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    # Write UTF-8 bytes directly: Windows PowerShell 5.1/.NET Framework does not
    # expose ProcessStartInfo.StandardInputEncoding.
    $payloadBytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $process.StandardInput.BaseStream.Write($payloadBytes, 0, $payloadBytes.Length)
    $process.StandardInput.BaseStream.Flush()
    $process.StandardInput.BaseStream.Close()
    $process.WaitForExit()
    $answer = $stdout.GetAwaiter().GetResult().Trim()
    [void]$stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0 -or $answer -ne 'CREDENTIALS_SAVED') { throw 'Credential transfer failed. Values were not logged; do not retry blindly.' }
    Write-Host 'Credentials saved on VPS (0600). No FTP login, import or schedule was started.'
}
finally {
    if ($loginPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($loginPointer) }
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($passwordPointer) }
    $loginSecret.Dispose()
    $passwordSecret.Dispose()
    if ($process) { $process.Dispose() }
    if ($payloadBytes) { [Array]::Clear($payloadBytes, 0, $payloadBytes.Length) }
    Remove-Variable payload,payloadBytes,loginValue,passwordValue -ErrorAction SilentlyContinue
}
