; =====================================================================
; Installateur Windows de RAHA TRANSPORT RTMS (NSIS 3, interface Modern UI 2)
; Installation pour l'utilisateur courant : aucun droit administrateur requis.
; Construit par scripts/build-installer.js à partir de dist/win-unpacked.
; =====================================================================
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !error "VERSION non définie"
!endif
!define APPNAME "RAHA TRANSPORT RTMS"
!define EXENAME "RAHA TRANSPORT RTMS.exe"
!define PUBLISHER "RAHA TRANSPORT"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\cm.rahatransport.rtms"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\${PUBLISHER}\RTMS" "InstallDir"
BrandingText "RAHA TRANSPORT — RTMS ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1036 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de RAHA TRANSPORT Management System"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "© RAHA TRANSPORT"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!define MUI_ICON "${BUILDDIR}\icon.ico"
!define MUI_UNICON "${BUILDDIR}\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${INSTDIR_RES}\welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${INSTDIR_RES}\welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${INSTDIR_RES}\header.bmp"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Installation de RAHA TRANSPORT RTMS"
!define MUI_WELCOMEPAGE_TEXT "Cet assistant installe le logiciel de gestion RAHA TRANSPORT (transport, transit, import-export, commerce, facturation) sur ce poste.$\r$\n$\r$\nAu premier lancement, saisissez l’adresse du serveur RTMS de l’entreprise, ou ouvrez la démonstration.$\r$\n$\r$\nAucun droit administrateur n’est nécessaire."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXENAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer RAHA TRANSPORT RTMS"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Section "RTMS" SecMain
  SetShellVarContext current
  ; Arrête une instance ouverte avant la mise à jour des fichiers
  nsExec::Exec 'taskkill /IM "${EXENAME}" /F'
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*.*"
  WriteUninstaller "$INSTDIR\Desinstaller RTMS.exe"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Désinstaller ${APPNAME}.lnk" "$INSTDIR\Desinstaller RTMS.exe"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXENAME}" "" "$INSTDIR\${EXENAME}" 0
  WriteRegStr HKCU "Software\${PUBLISHER}\RTMS" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXENAME},0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Desinstaller RTMS.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::Exec 'taskkill /IM "${EXENAME}" /F'
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${PUBLISHER}\RTMS"
  ; Les réglages du poste (adresse du serveur, taille de fenêtre) restent dans
  ; %APPDATA%\RAHA TRANSPORT RTMS : ils servent si le logiciel est réinstallé.
SectionEnd
