@echo off
setlocal
title DSH Toolbox

echo === DSH toolbox ===
echo.

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 9222 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [1/3] Edge CDP 9222 already running
) else (
  echo [1/3] starting Edge on 9222 ...
  set "EDGE="
  if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  if not defined EDGE if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "EDGE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  if defined EDGE (
    start "" "%EDGE%" --remote-debugging-port=9222 --user-data-dir=D:\deepseek\edge-cgpt https://chatgpt.com/
    timeout /t 8 >nul
  ) else (
    echo     Edge not found, start it manually
  )
)

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3099 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [2/3] GPT console 3099 already running
) else (
  echo [2/3] starting GPT console on 3099 ...
  start "" /min "D:\Node\node.exe" --use-system-ca "D:\deepseek\tools\gpt-console.mjs" 3099
  timeout /t 3 >nul
)

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3100 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [3/3] Browser console 3100 already running
) else (
  echo [3/4] starting Browser console on 3100 ...
  start "" /min "D:\Node\node.exe" --use-system-ca "D:\deepseek\tools\browser-console.mjs" 3100
  timeout /t 3 >nul
)

powershell -NoProfile -Command "if (Test-NetConnection -ComputerName 127.0.0.1 -Port 3101 -InformationLevel Quiet -WarningAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel%==0 (
  echo [4/4] Launcher 3101 already running
) else (
  echo [4/4] starting Launcher on 3101 ...
  start "" /min "D:\Node\node.exe" --use-system-ca "D:\deepseek\tools\launcher.mjs" 3101
  timeout /t 2 >nul
)

echo.
echo === ready ===
echo   Launcher (button) : http://127.0.0.1:3101
echo   Browser console   : http://127.0.0.1:3100   (video summary / shot / click / read)
echo   GPT console       : http://127.0.0.1:3099   (send prompt / image)
echo.
start "" http://127.0.0.1:3101
if /i not "%~1"=="/nopause" pause
