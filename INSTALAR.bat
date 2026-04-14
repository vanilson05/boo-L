@echo off
echo.
echo ========================================
echo   Bot L Farias - Instalacao automatica
echo ========================================
echo.

echo [1/3] Removendo node_modules antigo...
if exist node_modules (
    rmdir /s /q node_modules
    echo     OK
) else (
    echo     Nao encontrado, pulando...
)

echo [2/3] Removendo package-lock.json...
if exist package-lock.json (
    del /q package-lock.json
    echo     OK
) else (
    echo     Nao encontrado, pulando...
)

echo [3/3] Instalando dependencias...
npm install
if %errorlevel% neq 0 (
    echo.
    echo ERRO na instalacao!
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Instalacao concluida!
echo.
echo  Proximos passos:
echo  1. Renomeie .env.exemplo para .env
echo  2. Abra o .env e cole sua chave:
echo     ANTHROPIC_API_KEY=sk-ant-...
echo  3. No terminal rode:
echo     node index.js
echo ========================================
echo.
pause
