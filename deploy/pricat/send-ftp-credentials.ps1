#requires -Version 5.1
# Run in Windows PowerShell 5.1; native credential dialog supports clipboard paste.
[CmdletBinding()]
param(
    [string]$KeyFile = (Join-Path $env:USERPROFILE '.ssh\elektrikamarket_vps'),
    [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'),
    [switch]$ReplaceInvalid
)
$ErrorActionPreference = 'Stop'

function ConvertTo-FtpPayload {
    param([Parameter(Mandatory=$true)][System.Management.Automation.PSCredential]$Credential)
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Credential.Password)
        $passwordValue = [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer, $Credential.Password.Length)
        $loginValue = $Credential.UserName
        if ([string]::IsNullOrEmpty($loginValue) -or [string]::IsNullOrEmpty($passwordValue) -or
            $loginValue -match '[\x00-\x1f\x7f]' -or $passwordValue -match '[\x00-\x1f\x7f]') {
            throw 'Invalid credential input (control/clipboard key or empty field). Nothing sent; use the Windows credential dialog.'
        }
        return (@{username=$loginValue;password=$passwordValue} | ConvertTo-Json -Compress)
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer) }
        Remove-Variable passwordValue,loginValue -ErrorAction SilentlyContinue
    }
}

if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Use Windows PowerShell 5.1 (powershell.exe) for the native credential dialog. Nothing sent.' }
$promptPolicy = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\PowerShell\1\ShellIds' -Name ConsolePrompting -ErrorAction SilentlyContinue
if ($promptPolicy -and $promptPolicy.ConsolePrompting) { throw 'Console credential prompting is enabled. Stop; no registry settings or secrets were changed.' }
$sshExecutable = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
if (-not (Test-Path -LiteralPath $sshExecutable -PathType Leaf)) { throw 'Windows OpenSSH client not found.' }
if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { throw 'Existing SSH key not found.' }
if ($KeyFile -match '["\r\n]') { throw 'Invalid key path.' }
$receiver = '/home/shopadmin/elektrikamarket-pricat-inputs/receive-credentials-v2.py'
$common = @('-i', $KeyFile, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'shopadmin@168.113.208.94')
$source = Join-Path $ProjectRoot 'scripts\pricat-update\receive-credentials.py'
$body = [IO.File]::ReadAllText($source).Replace("`r`n", "`n")
$hasher = [Security.Cryptography.SHA256]::Create()
try { $expected = ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)))).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
$actual = & $sshExecutable @common "sha256sum $receiver"
if ($LASTEXITCODE -ne 0 -or ($actual -split '\s+')[0] -ne $expected) { throw 'SSH receiver verification failed. No credentials sent.' }
if (-not $ReplaceInvalid) {
    $ready = & $sshExecutable @common "python3 $receiver --prepare"
    if ($LASTEXITCODE -ne 0 -or $ready -ne 'CREDENTIALS_READY') { throw 'Receiver is not ready or credentials already exist. No overwrite.' }
}
$credential = $null
$process = $null
try {
    $credential = Get-Credential -Message 'FTP supplier credentials. Paste into this Windows dialog; password will not be logged.'
    if ($null -eq $credential) { throw 'Credential entry cancelled; nothing changed.' }
    $payload = ConvertTo-FtpPayload -Credential $credential
    if ($ReplaceInvalid) {
        # Explicit owner action only, after valid new input; preserves the invalid file.
        $archived = & $sshExecutable @common "python3 $receiver --archive-invalid"
        if ($LASTEXITCODE -ne 0 -or $archived -ne 'CREDENTIALS_INVALID_ARCHIVED') { throw 'Existing file is not the known invalid Ctrl+V input. Nothing overwritten.' }
        $ready = & $sshExecutable @common "python3 $receiver --prepare"
        if ($LASTEXITCODE -ne 0 -or $ready -ne 'CREDENTIALS_READY') { throw 'Receiver not ready after archiving. Backup preserved; nothing sent.' }
    }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $sshExecutable
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
    if ($credential) { $credential.Password.Dispose() }
    if ($process) { $process.Dispose() }
    if ($payloadBytes) { [Array]::Clear($payloadBytes, 0, $payloadBytes.Length) }
    Remove-Variable payload,payloadBytes,credential -ErrorAction SilentlyContinue
}
