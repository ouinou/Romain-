; FINEXA PHARMA : setup Windows « tout inclus » (serveur, interface, Node.js, PostgreSQL privé).
; Construit par installateur/construire.sh :  makensis -DVERSION=… -DETAPE=… -DSORTIE=… finexa-pharma.nsi
; Tous les identifiants techniques (dossiers, services, clé de registre, tâches planifiées) sont propres à PHARMA :
; FINEXA ERP et FINEXA PHARMA peuvent cohabiter sur le même serveur sans se toucher.
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!define NOM "FINEXA PHARMA"
!define EDITEUR "Incubateur Technologique de l'Innovation (ITI)"
!define CLE_DESINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\FinexaPharma"
!define SERVICE_APP "FinexaPharma-Serveur"
!define SERVICE_PG "FinexaPharma-Base"

Name "${NOM} ${VERSION}"
OutFile "${SORTIE}\FINEXA-PHARMA-Setup-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\FinexaPharma"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
BrandingText "${NOM} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1036 "ProductName" "${NOM}"
VIAddVersionKey /LANG=1036 "CompanyName" "${EDITEUR}"
VIAddVersionKey /LANG=1036 "FileDescription" "Installation de ${NOM}"
VIAddVersionKey /LANG=1036 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1036 "LegalCopyright" "Voir LICENCES.txt"

Var DONNEES
Var ADRESSE
Var OPT_DEMO
Var LANCEUR

!define MUI_ABORTWARNING
!define MUI_ICON "${ETAPE}\finexa-pharma.ico"
!define MUI_UNICON "${ETAPE}\finexa-pharma.ico"
!define MUI_WELCOMEPAGE_TITLE "Installation de ${NOM}"
!define MUI_WELCOMEPAGE_TEXT "Ce programme installe ${NOM} sur ce poste, qui deviendra le serveur de la pharmacie :$\r$\n$\r$\n  • le logiciel et son interface web ;$\r$\n  • une base de données PostgreSQL privée ;$\r$\n  • les services Windows, le certificat HTTPS et les sauvegardes du soir.$\r$\n$\r$\nLes autres postes n'installent rien : ils utilisent un navigateur.$\r$\n$\r$\nChoisissez un poste allumé pendant les heures de travail, avec une adresse IP fixe sur le réseau local."
!define MUI_FINISHPAGE_TITLE "${NOM} est installé"
!define MUI_FINISHPAGE_TEXT "Le serveur fonctionne. Le logiciel s'ouvre dans sa propre fenêtre.$\r$\n$\r$\nInstallation normale : créez la pharmacie et son administrateur à la première ouverture.$\r$\nAvec les données de démonstration : connectez-vous avec les comptes indiqués dans « Comptes de démonstration » (menu Démarrer).$\r$\n$\r$\nAutres postes : n'installez rien. Créez chaque compte dans « Utilisateurs » et imprimez la fiche d'accès affichée (adresse du serveur et code d'invitation)."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Ouvrir ${NOM} maintenant"
!define MUI_FINISHPAGE_RUN_FUNCTION OuvrirLogiciel
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${ETAPE}\LICENCES.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${NOM} demande une version 64 bits de Windows."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "${NOM} demande Windows 10, Windows 11 ou Windows Server 2016 (ou plus récent)."
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext all
  StrCpy $DONNEES "$APPDATA\FinexaPharma"
  ; Mise à jour : on reprend le dossier de la première installation.
  ReadRegStr $0 HKLM "${CLE_DESINSTALL}" "InstallLocation"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${ElseIfNot} ${Silent}
    ; Première installation sur ce poste : FINEXA PHARMA ne s'installe que sur le serveur de la pharmacie.
    ; Un poste de travail qui l'installerait aurait sa propre base, vide, séparée de celle des collègues.
    MessageBox MB_YESNO|MB_ICONQUESTION "Ce poste doit-il devenir le SERVEUR de la pharmacie ?$\r$\n$\r$\nLe serveur est l'ordinateur unique qui garde les données de tous les utilisateurs. Il reste allumé pendant les heures de travail.$\r$\n$\r$\nOui : installer le serveur sur ce poste.$\r$\nNon : ce poste est un poste de travail (comptoir, caisse, réserve...)." IDYES serveur
    MessageBox MB_ICONINFORMATION "Rien à installer sur un poste de travail.$\r$\n$\r$\n1. L'administrateur crée votre compte sur le serveur et vous remet une fiche d'accès.$\r$\n2. Sur ce poste, ouvrez Edge ou Chrome à l'adresse du serveur indiquée sur la fiche (exemple : https://NOM-DU-SERVEUR:8444).$\r$\n3. Choisissez « J'ai reçu un code d'invitation ».$\r$\n$\r$\nAucune base de données n'a été créée sur ce poste."
    Abort
    serveur:
  ${EndIf}
FunctionEnd

Function OuvrirLogiciel
  ${If} $LANCEUR != ""
    Exec '"$LANCEUR" --app=$ADRESSE'
  ${Else}
    ExecShell "open" "$ADRESSE"
  ${EndIf}
FunctionEnd

Section "FINEXA PHARMA (obligatoire)" SecPrincipale
  SectionIn RO
  SetShellVarContext all
  SetRegView 64

  ; Mise à jour : arrêter les services pour pouvoir remplacer les fichiers en cours d'utilisation.
  DetailPrint "Arrêt des services (s'ils existent déjà)…"
  nsExec::ExecToLog 'sc.exe stop ${SERVICE_APP}'
  Sleep 3000
  nsExec::ExecToLog 'sc.exe stop ${SERVICE_PG}'
  Sleep 4000

  DetailPrint "Composants Microsoft Visual C++ (nécessaires à PostgreSQL)…"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${ETAPE}\runtime\vc_redist.x64.exe"
  ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart' $0
  ; 0 = installé, 1638 = version plus récente déjà présente, 3010 = redémarrage conseillé.
  ${If} $0 != 0
  ${AndIf} $0 != 1638
  ${AndIf} $0 != 3010
    MessageBox MB_ICONSTOP "L'installation des composants Visual C++ a échoué (code $0)."
    Abort
  ${EndIf}

  DetailPrint "Copie des fichiers…"
  SetOutPath "$INSTDIR"
  File "${ETAPE}\LICENCES.txt"
  File "${ETAPE}\finexa-pharma.ico"
  File /r "${ETAPE}\serveur"
  File /r "${ETAPE}\interface"
  File /r "${ETAPE}\outils"
  File /r "${ETAPE}\docs"
  SetOutPath "$INSTDIR\runtime"
  File /r "${ETAPE}\runtime\node"
  File /r "${ETAPE}\runtime\pgsql"
  File "${ETAPE}\runtime\WinSW-x64.exe"

  DetailPrint "Configuration (base de données, certificat, services, sauvegardes)…"
  CreateDirectory "$DONNEES\journaux"
  Call OptionDemo
  nsExec::ExecToLog '"$INSTDIR\runtime\node\node.exe" "$INSTDIR\outils\configurer.mjs" --app "$INSTDIR" --donnees "$DONNEES" $OPT_DEMO'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "La configuration a échoué (code $0).$\r$\nDétails : $DONNEES\journaux\installation.log$\r$\n$\r$\nAucune donnée n'a été supprimée. Corrigez le problème indiqué puis relancez le setup."
    Abort
  ${EndIf}

  ; Adresse du logiciel (le port est choisi pendant la configuration).
  FileOpen $1 "$DONNEES\adresse.txt" r
  FileRead $1 $ADRESSE
  FileClose $1
  StrCpy $ADRESSE $ADRESSE -1
  WriteINIStr "$INSTDIR\${NOM}.url" "InternetShortcut" "URL" "$ADRESSE"
  WriteINIStr "$INSTDIR\${NOM}.url" "InternetShortcut" "IconFile" "$INSTDIR\finexa-pharma.ico"
  WriteINIStr "$INSTDIR\${NOM}.url" "InternetShortcut" "IconIndex" "0"

  ; Ouverture dans une fenêtre d'application (sans barre d'adresse ni onglets) avec Microsoft Edge,
  ; présent sur Windows 10 et 11. Sans Edge : le navigateur par défaut.
  StrCpy $LANCEUR ""
  ${If} ${FileExists} "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
    StrCpy $LANCEUR "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe"
  ${ElseIf} ${FileExists} "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
    StrCpy $LANCEUR "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe"
  ${EndIf}
  CreateDirectory "$SMPROGRAMS\${NOM}"
  ${If} $LANCEUR != ""
    CreateShortCut "$SMPROGRAMS\${NOM}\${NOM}.lnk" "$LANCEUR" "--app=$ADRESSE" "$INSTDIR\finexa-pharma.ico" 0 SW_SHOWMAXIMIZED "" "${NOM}"
    CreateShortCut "$DESKTOP\${NOM}.lnk" "$LANCEUR" "--app=$ADRESSE" "$INSTDIR\finexa-pharma.ico" 0 SW_SHOWMAXIMIZED "" "${NOM}"
    CreateShortCut "$SMPROGRAMS\${NOM}\${NOM} (dans le navigateur).lnk" "$INSTDIR\${NOM}.url"
  ${Else}
    CreateShortCut "$SMPROGRAMS\${NOM}\${NOM}.lnk" "$INSTDIR\${NOM}.url"
    CreateShortCut "$DESKTOP\${NOM}.lnk" "$INSTDIR\${NOM}.url"
  ${EndIf}
  ${If} ${FileExists} "$DONNEES\DEMONSTRATION.txt"
    CreateShortCut "$SMPROGRAMS\${NOM}\Comptes de démonstration.lnk" "$DONNEES\DEMONSTRATION.txt"
  ${EndIf}
  CreateShortCut "$SMPROGRAMS\${NOM}\Brancher un autre poste.lnk" "$INSTDIR\docs\INSTALLATION-SETUP.txt"
  CreateShortCut "$SMPROGRAMS\${NOM}\Dossier des sauvegardes.lnk" "$DONNEES\sauvegardes"
  CreateShortCut "$SMPROGRAMS\${NOM}\Certificat pour les autres postes.lnk" "$DONNEES\certificats"
  CreateShortCut "$SMPROGRAMS\${NOM}\Guide d'utilisation.lnk" "$INSTDIR\docs\GUIDE-UTILISATION.txt"
  CreateShortCut "$SMPROGRAMS\${NOM}\Désinstaller.lnk" "$INSTDIR\Desinstaller.exe"

  WriteUninstaller "$INSTDIR\Desinstaller.exe"
  WriteRegStr HKLM "${CLE_DESINSTALL}" "DisplayName" "${NOM}"
  WriteRegStr HKLM "${CLE_DESINSTALL}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${CLE_DESINSTALL}" "Publisher" "${EDITEUR}"
  WriteRegStr HKLM "${CLE_DESINSTALL}" "DisplayIcon" "$INSTDIR\finexa-pharma.ico"
  WriteRegStr HKLM "${CLE_DESINSTALL}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${CLE_DESINSTALL}" "UninstallString" '"$INSTDIR\Desinstaller.exe"'
  WriteRegDWORD HKLM "${CLE_DESINSTALL}" "NoModify" 1
  WriteRegDWORD HKLM "${CLE_DESINSTALL}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKLM "${CLE_DESINSTALL}" "EstimatedSize" $0
SectionEnd

Section /o "Données de démonstration (évaluation)" SecDemo
  ; Rien à faire ici : la section principale lit ce choix (OptionDemo) et le transmet à la configuration.
SectionEnd

LangString DESC_SecPrincipale ${LANG_FRENCH} "Le logiciel, sa base de données privée, les services Windows et les sauvegardes."
LangString DESC_SecDemo ${LANG_FRENCH} "Ajoute une pharmacie FICTIVE, avec des produits, des lots et des mouvements de stock, pour essayer le logiciel. Son mot de passe est connu : ne cochez pas cette case sur l'installation qui recevra vos vraies données."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecPrincipale} $(DESC_SecPrincipale)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDemo} $(DESC_SecDemo)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function OptionDemo
  StrCpy $OPT_DEMO ""
  ${If} ${SectionIsSelected} ${SecDemo}
    StrCpy $OPT_DEMO "--demo"
  ${EndIf}
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
  StrCpy $DONNEES "$APPDATA\FinexaPharma"
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  SetRegView 64
  StrCpy $1 ""
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Supprimer aussi les DONNÉES de la pharmacie (base, sauvegardes, configuration) ?$\r$\n$\r$\nRépondez NON pour les conserver (recommandé) : une réinstallation les retrouvera.$\r$\nRépondez OUI seulement si une sauvegarde a été copiée ailleurs." IDNO garder
    MessageBox MB_YESNO|MB_ICONSTOP|MB_DEFBUTTON2 "Confirmez : la base de la pharmacie et ses sauvegardes sur ce poste seront DÉFINITIVEMENT effacées." IDNO garder
    StrCpy $1 "--supprimer-donnees"
  garder:
  nsExec::ExecToLog '"$INSTDIR\runtime\node\node.exe" "$INSTDIR\outils\configurer.mjs" --app "$INSTDIR" --donnees "$DONNEES" --desinstaller $1'
  Delete "$DESKTOP\${NOM}.lnk"
  RMDir /r "$SMPROGRAMS\${NOM}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${CLE_DESINSTALL}"
SectionEnd
