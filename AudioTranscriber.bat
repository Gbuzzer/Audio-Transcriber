@echo off
title Audio Transcriber
color 0A
cls
echo.
echo ========================================
echo        Audio Transcriber Launcher       
echo ========================================
echo.
echo This app runs locally on your computer.
echo - Requires Node.js 18+ and npm 8+
echo - Requires a .env file with OPENAI_API_KEY and PIN_CODE
echo - App URL: http://localhost:3000
echo.
echo If this is your first run:
echo  1) Ensure ".env" exists in the app folder with:
echo     OPENAI_API_KEY=your_openai_api_key_here
echo     PIN_CODE=0411
echo  2) Dependencies will be installed automatically.
echo.
echo Press Ctrl+C at any time in this window to stop the server.
echo ----------------------------------------
echo.

cd /d "c:\Users\georg\.CascadeProjects\AudioTranscriber"

if not exist "server.js" (
    echo ERROR: Audio Transcriber files not found!
    echo Expected at: c:\Users\georg\.CascadeProjects\AudioTranscriber
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    echo WARNING: .env not found.
    echo Create a .env file with OPENAI_API_KEY and PIN_CODE before use.
    echo.
)

if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo.
        echo ERROR: npm install failed. Make sure Node.js is installed.
        echo Download: https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
    echo.
)

echo Starting server...
echo A browser window will open at http://localhost:3000 after startup.
start "" http://localhost:3000

REM Prefer package script in case it changes
npm start

if errorlevel 1 (
    echo.
    echo ERROR: Failed to start the server.
    echo Make sure Node.js is installed and your OPENAI_API_KEY is valid.
    echo.
    pause
)
