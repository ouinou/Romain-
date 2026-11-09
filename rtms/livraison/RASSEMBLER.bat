@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Assemblage de l installateur RTMS 2.4.0...
for %%P in (0 1 2 3) do if not exist "RTMS-Setup-2.4.0.exe.part%%P" (echo Il manque le morceau RTMS-Setup-2.4.0.exe.part%%P : telechargez-le dans ce meme dossier. & pause & exit /b 1)
copy /b RTMS-Setup-2.4.0.exe.part0+RTMS-Setup-2.4.0.exe.part1+RTMS-Setup-2.4.0.exe.part2+RTMS-Setup-2.4.0.exe.part3 RTMS-Setup-2.4.0.exe >nul
echo Verification du fichier...
certutil -hashfile RTMS-Setup-2.4.0.exe SHA256 | find /i "8dcfe7312d8608125015b8b893bcfa63cb6e12b3f89c1287b2738d57e37f5b65" >nul
if errorlevel 1 (echo ERREUR : le fichier assemble est incomplet. Retelechargez les 4 morceaux. & pause & exit /b 1)
echo.
echo OK : RTMS-Setup-2.4.0.exe est pret dans ce dossier. Double-cliquez dessus pour installer.
pause
