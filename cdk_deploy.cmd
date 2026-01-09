@echo off
setlocal

rem Always run from the folder where this script lives
cd /d "%~dp0"

rem ---- 1) Activate virtualenv ----
call .venv\Scripts\activate.bat

rem AWS profile name (change if needed)
set PROFILE=neuroaws
set AWS_PROFILE=%PROFILE%
set AWS_SDK_LOAD_CONFIG=1

echo.
echo === Checking AWS SSO session for profile %PROFILE% ===

rem ---- 2) Check if SSO session is valid ----
aws sts get-caller-identity --profile %PROFILE% >nul 2>&1

if errorlevel 1 (
    echo Not logged in. Running "aws sso login --profile %PROFILE%" ...
    aws sso login --profile %PROFILE%
    if errorlevel 1 (
        echo.
        echo AWS SSO login failed. Exiting.
        exit /b 1
    )
) else (
    echo Already logged in with profile %PROFILE%.
)

echo.
echo === Running CDK deploy ===

rem ---- 3) Run CDK deploy ----
cdk deploy --all --require-approval never --profile %PROFILE%
set EXITCODE=%ERRORLEVEL%

rem optional: deactivate venv at the end
deactivate >nul 2>&1

endlocal & exit /b %EXITCODE%
