#requires -Version 5.1
# Offline tests: no dialog, SSH, files with real credentials or network calls.
param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'))
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot 'deploy\pricat\send-ftp-credentials.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'Sender parse failed'}
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'ConvertTo-FtpPayload'},$true)
if(-not $definition){throw 'Payload function missing'}
. ([ScriptBlock]::Create($definition.Extent.Text))
$values=@('synthetic plain','quote " slash \ dollar $ backtick ` + % & ! ; ()',"  synthetic outer spaces  ",([string][char]0x0422+[char]0x0435+[char]0x0441+[char]0x0442),([char]::ConvertFromUtf32(0x1F642)))
$roundTrips=0;$rejected=0
foreach($value in $values){
    $secure=ConvertTo-SecureString $value -AsPlainText -Force
    $credential=New-Object Management.Automation.PSCredential('fixture-user',$secure)
    try{
        $payload=ConvertTo-FtpPayload -Credential $credential
        $decoded=[Text.Encoding]::UTF8.GetString([Text.Encoding]::UTF8.GetBytes($payload)) | ConvertFrom-Json
        if($decoded.username -cne 'fixture-user' -or $decoded.password -cne $value){throw 'Synthetic UTF-8 payload changed'}
        $roundTrips++
    }finally{$secure.Dispose()}
}
foreach($code in ((0..31)+@(127))){
    foreach($field in @('username','password')){
        $userValue='fixture-user';$passValue='fixture-only'
        if($field -eq 'username'){$userValue+=''+[char]$code}else{$passValue+=''+[char]$code}
        $secure=ConvertTo-SecureString $passValue -AsPlainText -Force
        $credential=New-Object Management.Automation.PSCredential($userValue,$secure)
        $blocked=$false
        try{
            try{$null=ConvertTo-FtpPayload -Credential $credential}
            catch{if($_.Exception.Message -like 'Invalid credential input*'){$blocked=$true}else{throw}}
            if(-not $blocked){throw 'Control character accepted'}
            $rejected++
        }finally{$secure.Dispose()}
    }
}
Write-Output ('POWERSHELL_CREDENTIAL_TESTS_PASS roundTrips='+$roundTrips+' rejectedControls='+$rejected)
