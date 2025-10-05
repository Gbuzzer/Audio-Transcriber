# Script to create an executable for Audio Transcriber
# This creates a self-contained executable BAT and a desktop shortcut to launch the app

$exeContent = @'
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
'@

# Write the batch content to a new executable batch file
$batPath = Join-Path (Get-Location) "AudioTranscriber.bat"
$exeContent | Out-File -FilePath $batPath -Encoding ASCII

# Create a desktop shortcut to the BAT for easy launch
try {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Audio Transcriber.lnk"
  $WshShell = New-Object -ComObject WScript.Shell
  $shortcut = $WshShell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $batPath
  $shortcut.WorkingDirectory = (Get-Location).Path
  $shortcut.WindowStyle = 1  # Normal window
  $shortcut.Description = "Launch the Audio Transcriber (localhost:3000)"
  # Optionally set an icon if available, else use default
  # $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll, 167"
  $shortcut.Save()
  Write-Host "Created desktop shortcut: $shortcutPath" -ForegroundColor Green
} catch {
  Write-Host "Could not create desktop shortcut automatically: $_" -ForegroundColor Yellow
}

Write-Host "Created AudioTranscriber.bat at $batPath" -ForegroundColor Green
Write-Host "You can double-click the desktop shortcut or run the BAT to start the app." -ForegroundColor Yellow
