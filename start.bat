@echo off
setlocal
title free_note
cd /d "%~dp0"

echo ============================
echo   free_note - Local Notes
echo ============================

if exist ".venv\Scripts\python.exe" goto check_dependencies

echo Creating Python virtual environment...
py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if errorlevel 1 goto try_python
py -3 -m venv .venv
if errorlevel 1 goto failed
goto check_dependencies

:try_python
python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1
if errorlevel 1 (
    echo Please install Python 3.10 or newer and enable PATH support.
    goto failed
)
python -m venv .venv
if errorlevel 1 goto failed

:check_dependencies
".venv\Scripts\python.exe" -c "import flask, cryptography" >nul 2>&1
if not errorlevel 1 goto run_app
echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed

:run_app
echo Opening http://127.0.0.1:8765
echo Press Ctrl+C or close this window to stop the app.
".venv\Scripts\python.exe" app.py %*
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo Startup failed. See the error above, then try again.
pause
exit /b 1
