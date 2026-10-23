Unicode True
SetCompressor /SOLID zlib
RequestExecutionLevel user
ManifestDPIAware True
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
Name "M1racle Note @@VERSION@@"
OutFile "@@OUTFILE@@"
InstallDir "$LOCALAPPDATA\Programs\M1racle Note"
Icon "@@ICON@@"
UninstallIcon "@@ICON@@"
BrandingText "M1racle Note"
VIProductVersion "@@VERSION@@.0"
VIAddVersionKey "ProductName" "M1racle Note"
VIAddVersionKey "FileDescription" "M1racle Note 安装程序"
VIAddVersionKey "FileVersion" "@@VERSION@@"
VIAddVersionKey "ProductVersion" "@@VERSION@@"
VIAddVersionKey "LegalCopyright" "M1racle"
Var InstallMode
Var RegistryRoot
Var ModeDialog
Var RadioCurrent
Var RadioAll
Var InstallStage

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "欢迎使用 M1racle Note 安装程序"
!define MUI_WELCOMEPAGE_TEXT "此向导将引导你完成 M1racle Note 的安装。$\r$\n$\r$\n安装前请先保存文档并关闭正在运行的 M1racle Note。$\r$\n$\r$\n安装和卸载都会保留你的 Markdown 文档与个人设置。"
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchNote
!define MUI_FINISHPAGE_RUN_TEXT "运行 M1racle Note"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!define MUI_FINISHPAGE_SHOWREADME_TEXT "创建桌面快捷方式"
!insertmacro MUI_PAGE_WELCOME
Page custom ModePage ModeLeave
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
@@SIGNING_DIRECTIVES@@

Function SelectMode
  SetRegView 64
  StrCmp $InstallMode "AllUsers" machine user
machine:
  SetShellVarContext all
  StrCpy $RegistryRoot 0x80000002
  StrCpy $INSTDIR "$PROGRAMFILES64\M1racle Note"
  Goto remembered
user:
  SetShellVarContext current
  StrCpy $RegistryRoot 0x80000001
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\M1racle Note"
remembered:
  ReadRegStr $0 SHCTX "Software\M1racle Note" "InstallDir"
  StrCmp $0 "" done
  StrCpy $INSTDIR $0
done:
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "此安装包需要 64 位 Windows。"
    Abort
  ${EndIf}
  StrCpy $InstallMode "CurrentUser"
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/ALLUSERS" $1
  IfErrors current
  UserInfo::GetAccountType
  Pop $0
  StrCmp $0 "Admin" elevated
  MessageBox MB_ICONSTOP "为所有用户安装需要管理员权限。"
  Abort
elevated:
  StrCpy $InstallMode "AllUsers"
current:
  Call SelectMode
FunctionEnd

Function ModePage
  !insertmacro MUI_HEADER_TEXT "选择用户" "选择为哪些用户安装 M1racle Note。"
  nsDialogs::Create 1018
  Pop $ModeDialog
  ${NSD_CreateLabel} 0 0 100% 35u "选择只为自己安装，还是为这台电脑的所有用户安装。$\r$\n只有选择所有用户时才需要管理员权限。"
  Pop $0
  ${NSD_CreateRadioButton} 10u 60u 95% 20u "只为我自己安装（推荐）"
  Pop $RadioCurrent
  ${NSD_CreateRadioButton} 10u 90u 95% 20u "为本机所有用户安装"
  Pop $RadioAll
  StrCmp $InstallMode "AllUsers" check_all
  ${NSD_Check} $RadioCurrent
  Goto show
check_all:
  ${NSD_Check} $RadioAll
show:
  nsDialogs::Show
FunctionEnd

Function ModeLeave
  ${NSD_GetState} $RadioAll $0
  StrCmp $0 ${BST_CHECKED} all current
all:
  UserInfo::GetAccountType
  Pop $0
  StrCmp $0 "Admin" set_all
  ClearErrors
  ExecShell "runas" "$EXEPATH" "/ALLUSERS"
  IfErrors cancelled
  Quit
cancelled:
  MessageBox MB_ICONINFORMATION "未取得管理员权限。你可以选择只为自己安装。"
  Abort
set_all:
  StrCmp $InstallMode "AllUsers" done
  StrCpy $InstallMode "AllUsers"
  Call SelectMode
  Goto done
current:
  StrCmp $InstallMode "CurrentUser" done
  StrCpy $InstallMode "CurrentUser"
  Call SelectMode
done:
FunctionEnd

Function ValidateDirectory
  ; NSIS GetFullPathName returns empty when the directory does not exist yet.
  ; The Windows API normalizes a new installation path without creating it.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r1, p 0) i.r0'
  IntCmp $0 0 unsafe
  IntCmp $0 ${NSIS_MAX_STRLEN} unsafe 0 unsafe
  StrCpy $INSTDIR $1
  StrLen $0 $INSTDIR
  IntCmp $0 3 unsafe unsafe
  StrCmp $INSTDIR "$PROFILE" unsafe
  StrCmp $INSTDIR "$DOCUMENTS" unsafe
  StrCmp $INSTDIR "$DESKTOP" unsafe
  StrCmp $INSTDIR "$APPDATA" unsafe
  StrCmp $INSTDIR "$LOCALAPPDATA" unsafe
  StrCmp $INSTDIR "$PROGRAMFILES64" unsafe
  StrCmp $INSTDIR "$WINDIR" unsafe
  StrCmp $InstallMode "AllUsers" 0 scope_ok
  StrLen $0 "$PROGRAMFILES64\"
  StrCpy $1 $INSTDIR $0
  StrCmp $1 "$PROGRAMFILES64\" scope_ok unsafe
scope_ok:
  ReadINIStr $0 "$INSTDIR\m1racle-install.ini" "Install" "AppId"
  StrCmp $0 "@@APP_GUID@@" existing
  IfFileExists "$INSTDIR\*.*" 0 done
  FindFirst $0 $1 "$INSTDIR\*.*"
loop:
  StrCmp $1 "" empty
  StrCmp $1 "." next
  StrCmp $1 ".." next
  FindClose $0
  MessageBox MB_ICONSTOP "请选择一个空文件夹，或现有的 M1racle Note 安装文件夹。"
  Abort
next:
  FindNext $0 $1
  Goto loop
empty:
  FindClose $0
  Goto done
existing:
  ReadINIStr $0 "$INSTDIR\m1racle-install.ini" "Install" "Mode"
  StrCmp $0 $InstallMode done
  MessageBox MB_ICONSTOP "此目录使用另一种安装用户范围。请选择其他目录，或先卸载原安装。"
  Abort
done:
  Return
unsafe:
  MessageBox MB_ICONSTOP "请为 M1racle Note 选择独立的程序文件夹。"
  Abort
FunctionEnd

!macro PARENT_GUARD PREFIX
Function ${PREFIX}CheckParents
  StrCpy $R3 "$INSTDIR"
loop:
  System::Call 'kernel32::GetFileAttributesW(w "$R3") i.r0'
  IntCmp $0 -1 next
  IntOp $0 $0 & 0x400
  IntCmp $0 0 next
  MessageBox MB_ICONSTOP "操作已停止：安装路径包含链接或重解析点。"
  Abort
next:
  System::Call 'kernel32::GetFullPathNameW(w "$R3\..", i ${NSIS_MAX_STRLEN}, w .r4, p 0) i.r0'
  IntCmp $0 0 invalid
  IntCmp $0 ${NSIS_MAX_STRLEN} invalid 0 invalid
  StrCpy $R4 $4
  StrCmp $R3 $R4 done
  StrCpy $R3 $R4
  Goto loop
done:
  Return
invalid:
  MessageBox MB_ICONSTOP "操作已停止：无法检查安装路径。"
  Abort
FunctionEnd
!macroend
!insertmacro PARENT_GUARD ""
!insertmacro PARENT_GUARD "un."

Function LaunchNote
  ; Let the existing desktop shell launch the app without inheriting installer elevation.
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\M1racle Note.exe"'
FunctionEnd

Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\M1racle Note.lnk" "$INSTDIR\M1racle Note.exe" "" "$INSTDIR\M1racle Note.exe" 0
FunctionEnd

Section "M1racle Note"
  Call ValidateDirectory
  Call CheckParents
@@REPARSE_INSTALL@@
  SetOverwrite on
  StrCpy $InstallStage "创建程序目录"
  ClearErrors
  CreateDirectory "$INSTDIR"
  IfErrors install_failed
  StrCpy $InstallStage "复制程序文件"
  ClearErrors
@@FILES@@
  IfErrors install_failed
  StrCpy $InstallStage "写入卸载程序与安装记录"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  FileOpen $0 "$INSTDIR\m1racle-install.ini" w
  FileWriteUTF16LE /BOM $0 ""
  FileClose $0
  WriteINIStr "$INSTDIR\m1racle-install.ini" "Install" "AppId" "@@APP_GUID@@"
  WriteINIStr "$INSTDIR\m1racle-install.ini" "Install" "Mode" "$InstallMode"
  IfErrors install_failed
  ReadRegStr $R8 SHCTX "Software\Classes\M1racleNote.Markdown\shell\open\command" ""
  ReadRegStr $R9 HKCU "Software\Classes\Applications\M1racle Note.exe\shell\open\command" ""
  ClearErrors
@@INSTALL_ASSOCIATIONS@@
  IfErrors install_failed
  ; Only migrate the legacy current-user entry when its command belongs to Note.
  ReadRegStr $R6 HKCU "Software\Classes\M1racleNote.Markdown\shell\open\command" ""
  StrCmp $R9 "" skip_legacy
  StrCmp $R9 $R8 remove_legacy
  StrCmp $R9 $R6 remove_legacy
  StrCmp $R9 '$\"$INSTDIR\M1racle Note.exe$\" $\"%1$\"' 0 skip_legacy
remove_legacy:
  DeleteRegKey HKCU "Software\Classes\Applications\M1racle Note.exe"
skip_legacy:
  ; A machine install must not be shadowed by our old portable per-user ProgID.
  StrCmp $InstallMode "AllUsers" 0 keep_user
  StrCmp $R6 "" clear_user_openwith
  StrCpy $0 $R6 22 -22
  StrCmp $0 'M1racle Note.exe$\" $\"%1$\"' 0 keep_user
  DeleteRegKey HKCU "Software\Classes\M1racleNote.Markdown"
  DeleteRegKey HKCU "Software\M1racleNote\Capabilities"
  DeleteRegValue HKCU "Software\RegisteredApplications" "M1racle Note"
clear_user_openwith:
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "M1racleNote.Markdown"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "M1racleNote.Markdown"
keep_user:
  ClearErrors
  CreateShortcut "$SMPROGRAMS\M1racle Note.lnk" "$INSTDIR\M1racle Note.exe" "" "$INSTDIR\M1racle Note.exe" 0
  WriteRegStr SHCTX "Software\M1racle Note" "InstallDir" "$INSTDIR"
  WriteRegStr SHCTX "Software\M1racle Note" "Version" "@@VERSION@@"
  WriteRegStr SHCTX "Software\M1racle Note" "AppId" "@@APP_GUID@@"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "DisplayName" "M1racle Note"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "DisplayVersion" "@@VERSION@@"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "Publisher" "M1racle"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "DisplayIcon" "$INSTDIR\M1racle Note.exe"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "NoModify" 1
  WriteRegDWORD SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note" "NoRepair" 1
  IfErrors install_failed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  Goto install_done
install_failed:
  MessageBox MB_ICONSTOP "安装未完成：$InstallStage。$\r$\n目录：$INSTDIR$\r$\n请关闭 M1racle Note 后重试；原文档和设置已保留。"
  Abort
install_done:
SectionEnd

Function un.onInit
  SetRegView 64
  ReadINIStr $InstallMode "$INSTDIR\m1racle-install.ini" "Install" "Mode"
  StrCmp $InstallMode "AllUsers" machine
  StrCmp $InstallMode "CurrentUser" current invalid
machine:
  UserInfo::GetAccountType
  Pop $0
  StrCmp $0 "Admin" elevated
  ExecShell "runas" "$INSTDIR\Uninstall.exe"
  Quit
elevated:
  SetShellVarContext all
  StrLen $0 "$PROGRAMFILES64\"
  StrCpy $1 $INSTDIR $0
  StrCmp $1 "$PROGRAMFILES64\" 0 invalid
  Goto validate
current:
  SetShellVarContext current
validate:
  ReadRegStr $0 SHCTX "Software\M1racle Note" "InstallDir"
  StrCmp $0 $INSTDIR 0 invalid
  ReadINIStr $0 "$INSTDIR\m1racle-install.ini" "Install" "AppId"
  StrCmp $0 "@@APP_GUID@@" done
invalid:
  MessageBox MB_ICONSTOP "卸载已停止：程序目录或安装记录不匹配。文档和设置已保留。"
  Abort
done:
FunctionEnd

Section "Uninstall"
  Call un.CheckParents
@@REPARSE_UNINSTALL@@
@@DELETE_PAYLOAD@@
  Delete "$SMPROGRAMS\M1racle Note.lnk"
  Delete "$DESKTOP\M1racle Note.lnk"
  ReadRegStr $0 SHCTX "Software\Classes\M1racleNote.Markdown\shell\open\command" ""
  StrCmp $0 '$\"$INSTDIR\M1racle Note.exe$\" $\"%1$\"' 0 keep_associations
@@DELETE_ASSOCIATIONS@@
keep_associations:
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\M1racle Note"
  DeleteRegKey SHCTX "Software\M1racle Note"
@@DELETE_FILES@@
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
  Goto uninstall_done
uninstall_failed:
  MessageBox MB_ICONSTOP "卸载未完成：部分程序文件仍在使用或无法删除。请关闭 M1racle Note 后重试。文档和设置已保留。"
  Abort
uninstall_done:
SectionEnd
