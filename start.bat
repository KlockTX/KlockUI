@echo off
rem KlockUI launcher (Windows). Starts the ComfyUI engine if needed, then the UI.
rem Portable: expects ComfyUI to sit next to this folder. Override with KLOCK_COMFY_DIR.
setlocal
set "APP=%~dp0"
if defined KLOCK_COMFY_DIR (
  set "ENGINE=%KLOCK_COMFY_DIR%"
) else (
  for %%I in ("%~dp0..\ComfyUI") do set "ENGINE=%%~fI"
)
set "PY=%ENGINE%\venv\Scripts\python.exe"

if not exist "%ENGINE%\main.py" (
  echo ComfyUI not found at: %ENGINE%
  echo Put ComfyUI next to KlockUI, or set KLOCK_COMFY_DIR to its path.
  echo See install.md for the full setup.
  pause
  exit /b 1
)
if not exist "%PY%" (
  echo Python venv missing: %PY%
  echo Run the install steps in install.md first.
  pause
  exit /b 1
)

netstat -ano | findstr ":8188" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo Starting ComfyUI engine, first launch may take 15-30 seconds...
  start "ComfyEngine" /min /D "%ENGINE%" "%ENGINE%\run_comfy.bat"
)

netstat -ano | findstr ":7861" | findstr "LISTENING" >nul
if errorlevel 1 (
  echo Starting KlockUI server...
  start "KlockUI" /min "%PY%w" "%APP%server.py"
)

powershell -NoProfile -Command "$u='http://127.0.0.1:7861/'; $ok=$false; for($i=0;$i -lt 60;$i++){ try{ (Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 2) | Out-Null; $ok=$true; break } catch { Start-Sleep -Milliseconds 800 } }; if (-not $ok) { Write-Host 'KlockUI server failed to start. Check server.log.'; Read-Host 'Press Enter to exit'; exit 1 }; if (-not $env:SIMPLEGEN_NO_BROWSER) { Start-Process $u }"
endlocal
