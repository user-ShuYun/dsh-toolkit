param()
$ErrorActionPreference = 'Continue'
Set-Location 'D:\deepseek'
$log = 'D:\deepseek\logs\maintain.log'
New-Item -ItemType Directory -Force -Path 'D:\deepseek\logs' | Out-Null
$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
Add-Content -Path $log -Value "`n===== $stamp =====" -Encoding UTF8
& 'D:\Node\node.exe' 'D:\deepseek\tools\maintain.mjs' *>&1 | Out-File -FilePath $log -Append -Encoding utf8
exit $LASTEXITCODE
