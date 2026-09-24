@echo off
set "DEST=%APPDATA%\Adobe\CEP\extensions\SubFX-Studio"
if exist "%DEST%" rmdir /s /q "%DEST%"
echo SubFX Studio se ha desinstalado.
pause
