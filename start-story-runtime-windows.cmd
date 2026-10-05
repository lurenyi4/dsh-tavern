@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ^>=24.19.0 is required. Install it from the official Node.js source. 1>&2
  exit /b 1
)
rem No automatic install, download, browser launch, or security-policy change.
node "%~dp0world-runtime\cli.mjs" %*
exit /b %errorlevel%
