; Unsigned installer for the BoomBigNose window.
; The landing page explains SmartScreen (More info, then Run anyway)
; and Smart App Control. This script does not claim those prompts are absent.
; The installer copies the Wails window and, beside it, bundle\ (Node, server.js, Postgres).

Unicode true
; The portable tree is large. Leave it uncompressed so the CI pack step
; does not spend the job on LZMA. The installer is therefore large.
SetCompress off
Name "BoomBigNose"
OutFile "BoomBigNose-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\BoomBigNose"
RequestExecutionLevel user
Page directory
Page instfiles

Section "BoomBigNose"
  SetShellVarContext current
  SetOutPath $INSTDIR
  File /oname=BoomBigNose.exe "boombignose-desktop.exe"
  SetOutPath "$INSTDIR\bundle"
  File /r "bundle\*.*"
  CreateShortcut "$SMPROGRAMS\BoomBigNose.lnk" "$INSTDIR\BoomBigNose.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$INSTDIR\BoomBigNose.exe"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\BoomBigNose.lnk"
  RMDir /r "$INSTDIR\bundle"
  RMDir "$INSTDIR"
SectionEnd
