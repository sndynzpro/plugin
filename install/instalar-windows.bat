@echo off
setlocal
title Instalador de SubtitleEngine Pro
set "SRC=%~dp0.."
set "EXT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXT%\SubtitleEngine-Pro"

echo.
echo  ==========================================
echo    SubtitleEngine Pro para Adobe Premiere Pro
echo  ==========================================
echo.
echo  Activando extensiones sin firmar (PlayerDebugMode)...
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

if exist "%EXT%\SubFX-Studio" (
  echo  Quitando la version anterior ^(SubFX Studio^)...
  rmdir /s /q "%EXT%\SubFX-Studio"
)

echo  Copiando archivos a:
echo  %DEST%
if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%" "%DEST%" /E /XD .git install docs node_modules /XF *.zxp *.pdf /NFL /NDL /NJH /NJS >nul
if %ERRORLEVEL% GEQ 8 (
  echo  ERROR: no se pudieron copiar los archivos.
  pause
  exit /b 1
)

echo.
echo  Listo. Reinicia Premiere Pro y abre:
echo  Ventana ^> Extensiones ^> SubtitleEngine Pro
echo.
pause
