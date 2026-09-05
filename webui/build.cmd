@echo off
setlocal
set NODE_OPTIONS=--jitless
cd /d "%~dp0"
node build.cjs
echo EXIT=%ERRORLEVEL%
