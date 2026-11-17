@echo off
echo Stopping KlockUI server on port 7861...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :7861 ^| findstr LISTENING') do taskkill /PID %%a /F /T

echo Stopping local prompt engine on port 7865...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :7865 ^| findstr LISTENING') do taskkill /PID %%a /F /T


echo Done. The ComfyUI engine on 8188 is left running.
