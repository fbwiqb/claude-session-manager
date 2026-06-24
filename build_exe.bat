@echo off
chcp 65001 >nul
cd /d "%~dp0"
python -m pip install pyinstaller
python -m PyInstaller --onefile --name 세션매니저 --add-data "web;web" --hidden-import csm.paths --hidden-import csm.indexer --hidden-import csm.transcript --hidden-import csm.store --hidden-import csm.cleanup --hidden-import csm.server session_manager.py
echo.
echo 빌드 완료: dist\세션매니저.exe
