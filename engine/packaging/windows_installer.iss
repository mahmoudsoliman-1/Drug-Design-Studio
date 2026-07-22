; Inno Setup script for Drug Design Studio (packages the PyInstaller onedir build).
#define MyAppName "Drug Design Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Prof. Mahmoud E. Soliman, UKZN"
#define MyAppExeName "DrugDesignStudio.exe"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Drug Design Studio
DefaultGroupName=Drug Design Studio
DisableProgramGroupPage=yes
; paths below are relative to engine/ (parent of this script's packaging/ dir)
SourceDir=..
OutputDir=dist_installer
OutputBaseFilename=DrugDesignStudio-Setup
SetupIconFile=packaging\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "dist_pkg\DrugDesignStudio\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Drug Design Studio"; Filename: "{app}\{#MyAppExeName}"
Name: "{commondesktop}\Drug Design Studio"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch Drug Design Studio"; Flags: nowait postinstall skipifsilent
