Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, ParentProcessId, CreationDate,
    @{ n = 'Cmd'; e = { ($_.CommandLine ?? '').Substring(0, [Math]::Min(150, ($_.CommandLine ?? '').Length)) } } |
  Sort-Object CreationDate |
  Format-Table -AutoSize | Out-String -Width 260
