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
if not exist "%SRC%\CSXS\manifest.xml" (
  echo  ERROR: no encuentro CSXS\manifest.xml junto a la carpeta install.
  echo  Descomprime el .zip completo ^(clic derecho ^> Extraer todo^) y ejecuta
  echo  este archivo desde la carpeta extraida, no desde dentro del .zip.
  pause
  exit /b 1
)

echo  Activando extensiones sin firmar (PlayerDebugMode)...
for %%v in (9 10 11 12 13 14 15 16) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

if exist "%EXT%\SubFX-Studio" (
  echo  Quitando la version anterior ^(SubFX Studio^)...
  rmdir /s /q "%EXT%\SubFX-Studio"
)

echo  Copiando archivos a:
echo  %DEST%
if exist "%DEST%" rmdir /s /q "%DEST%"
robocopy "%SRC%" "%DEST%" /E /XD .git install docs dist tests scripts node_modules .github /XF *.zxp *.pdf /NFL /NDL /NJH /NJS >nul
if %ERRORLEVEL% GEQ 8 (
  echo  ERROR: no se pudieron copiar los archivos.
  pause
  exit /b 1
)

echo.
echo  Comprobacion:
if exist "%DEST%\index.html" (echo   OK  Panel instalado en %DEST%) else (echo   ERROR  Falta index.html en %DEST%)
reg query "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode 2>nul | find "1" >nul && echo   OK  PlayerDebugMode activado || echo   ERROR  PlayerDebugMode no quedo activado
echo.
echo  Listo. CIERRA Premiere Pro por completo y abrelo de nuevo.
echo  Luego: Ventana ^> Extensiones ^> SubtitleEngine Pro
echo  (en algunas versiones el menu se llama "Extensiones (heredadas)")
echo.
pause
