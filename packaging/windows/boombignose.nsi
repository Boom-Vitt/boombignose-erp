; Unsigned installer for the BoomBigNose window.
; The landing page explains SmartScreen (More info, then Run anyway)
; and Smart App Control. This script does not claim those prompts are absent.
; The file it installs is the Wails window, not the harness command.

Unicode true
Name "BoomBigNose"
SetShellVarContext current
OutFile "BoomBigNose-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\BoomBigNose"
RequestExecutionLevel user
Page directory
Page instfiles

Section "BoomBigNose"
  SetOutPath $INSTDIR
  File /oname=BoomBigNose.exe "boombignose-desktop.exe"
  CreateShortcut "$SMPROGRAMS\BoomBigNose.lnk" "$INSTDIR\BoomBigNose.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\BoomBigNose.exe"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\BoomBigNose.lnk"
  RMDir "$INSTDIR"
SectionEnd
