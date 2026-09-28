@echo off
set "EXT=%APPDATA%\Adobe\CEP\extensions"
if exist "%EXT%\SubtitleEngine-Pro" rmdir /s /q "%EXT%\SubtitleEngine-Pro"
if exist "%EXT%\SubFX-Studio" rmdir /s /q "%EXT%\SubFX-Studio"
echo SubtitleEngine Pro se ha desinstalado.
pause
