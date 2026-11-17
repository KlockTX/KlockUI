' Hidden launcher for KlockUI (ASCII only on purpose).
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set procEnv = CreateObject("WScript.Shell").Environment("PROCESS")
procEnv("SIMPLEGEN_NO_BROWSER") = "1"
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = base
shell.Run """" & base & "\start.bat""", 0, False
