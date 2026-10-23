@echo off
title RusherAI Chat Server
echo ==============================================
echo Starting RusherAI Chat Server...
echo ==============================================
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
