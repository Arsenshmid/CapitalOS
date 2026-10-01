@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
	"$root = (Get-Location).Path;" ^
	"$out = Join-Path $root 'all_files.txt';" ^
	"$skip = '\\(node_modules|\.git|dist|coverage)\\';" ^
	"$files = Get-ChildItem -LiteralPath $root -File -Recurse | Where-Object { $_.FullName -ne $out -and $_.FullName -notmatch $skip -and $_.Extension -match '^\.(ts|tsx|js|jsx|json|html|css|md|txt|yml|yaml|xml|svg|bat|ps1|sh|toml|ini)$' } | Sort-Object FullName;" ^
	"$content = foreach ($file in $files) { '==================== ' + $file.FullName.Substring($root.Length + 1) + ' ===================='; Get-Content -LiteralPath $file.FullName; '' };" ^
	"Set-Content -LiteralPath $out -Value $content -Encoding UTF8"

if errorlevel 1 exit /b 1
echo Created all_files.txt