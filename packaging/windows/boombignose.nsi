; Unsigned installer for the BoomBigNose harness command.
; The landing page explains SmartScreen (More info, then Run anyway)
; and Smart App Control. This script does not claim those prompts are absent.

Unicode true
Name "BoomBigNose"
OutFile "BoomBigNose-windows-x64-setup.exe"
InstallDir "$LOCALAPPDATA\BoomBigNose"
RequestExecutionLevel user
Page directory
Page instfiles

Section "BoomBigNose"
  SetOutPath $INSTDIR
  File "boombignose.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\boombignose.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
