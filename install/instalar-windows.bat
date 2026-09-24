@echo off
setlocal
title Instalador de SubFX Studio
set "SRC=%~dp0.."
set "DEST=%APPDATA%\Adobe\CEP\extensions\SubFX-Studio"

echo.
echo  ==========================================
echo    SubFX Studio para Adobe Premiere Pro
echo  ==========================================
echo.
echo  Activando extensiones sin firmar (PlayerDebugMode)...
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo  Copiando archivos a:
echo  %DEST%
if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%" "%DEST%" /E /XD .git install node_modules /XF *.zxp /NFL /NDL /NJH /NJS >nul
if %ERRORLEVEL% GEQ 8 (
  echo  ERROR: no se pudieron copiar los archivos.
  pause
  exit /b 1
)

echo.
echo  Listo. Reinicia Premiere Pro y abre:
echo  Ventana ^> Extensiones ^> SubFX Studio
echo.
pause
