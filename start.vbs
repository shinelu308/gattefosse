' 静默启动Node.js HTTP服务器（无窗口，无输出）
CreateObject("Wscript.Shell").Run "node """ & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\server.js""", 0, False
