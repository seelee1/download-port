@echo off
chcp 65001 >nul
cd /d "%~dp0"
python native\install.py --uninstall
pause
