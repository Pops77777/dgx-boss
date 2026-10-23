@echo off
title Push DGx Boss to GitHub
cd /d "%~dp0"
echo ==============================================
echo Pushing DGx Boss to https://github.com/Pops77777/dgx-boss
echo ==============================================
git branch -M main
git push -u origin main
echo.
echo ==============================================
echo Done! Press any key to close.
echo ==============================================
pause
