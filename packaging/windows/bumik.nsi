; Unsigned installer for the Bumik harness command.
; The landing page explains SmartScreen (More info, then Run anyway)
; and Smart App Control. This script does not claim those prompts are absent.

Unicode true
Name "Bumik Node ERP harness AI"
OutFile "BumikNodeERP-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\BumikNodeERP"
RequestExecutionLevel user
Page directory
Page instfiles

Section "Bumik"
  SetOutPath $INSTDIR
  File "bumik.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\bumik.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
