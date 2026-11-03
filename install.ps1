#
# Antigravity Proxy 一键安装脚本 (Windows PowerShell)
#
# 用法:
#   irm https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.ps1 | iex
#
# 或指定安装目录:
#   $env:INSTALL_DIR="C:\antigravity"; irm https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.ps1 | iex
#
# 或指定版本:
#   $env:VERSION="v1.0.0"; irm https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.ps1 | iex
#

$ErrorActionPreference = "Stop"

# 配置
$Repo = "Kazuki-0147/Antigravity-Proxy"
$BinaryName = "antigravity-proxy"
$Target = "win-x64"
$DefaultInstallDir = (Get-Location).Path

# 从环境变量读取配置
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { $DefaultInstallDir }
$Version = if ($env:VERSION) { $env:VERSION } else { "latest" }

function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Blue }
function Write-Success { param($Message) Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn { param($Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red; exit 1 }

# 获取下载 URL
function Get-DownloadUrl {
    param($Ver)

    $filename = "$BinaryName-$Target.zip"

    if ($Ver -eq "latest") {
        return "https://github.com/$Repo/releases/latest/download/$filename"
    } else {
        return "https://github.com/$Repo/releases/download/$Ver/$filename"
    }
}

# 主函数
function Main {
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║     Antigravity Proxy 安装程序           ║" -ForegroundColor Cyan
    Write-Host "║            Windows 版                    ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""

    # ARM64 提示
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
        Write-Warn "检测到 ARM64 架构，将通过 x64 仿真运行"
    }

    Write-Info "安装目录: $InstallDir"
    Write-Info "版本: $Version"
    Write-Host ""

    # 构建下载信息
    $filename = "$BinaryName-$Target.zip"
    $downloadUrl = Get-DownloadUrl -Ver $Version

    # 创建临时目录
    $tempDir = New-Item -ItemType Directory -Path "$env:TEMP\antigravity-install-$(Get-Random)" -Force
    $tempFile = Join-Path $tempDir $filename

    try {
        # 下载
        Write-Info "下载中: $downloadUrl"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $downloadUrl -OutFile $tempFile -UseBasicParsing
        Write-Success "下载完成"

        # 创建安装目录
        if (-not (Test-Path $InstallDir)) {
            New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        }

        # 解压
        Write-Info "解压到: $InstallDir"
        Expand-Archive -Path $tempFile -DestinationPath $InstallDir -Force
        Write-Success "解压完成"

    } finally {
        # 清理临时文件
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    # 显示完成信息
    Write-Host ""
    Write-Host "════════════════════════════════════════════" -ForegroundColor Green
    Write-Success "安装完成！"
    Write-Host ""
    Write-Host "安装位置: $InstallDir" -ForegroundColor White
    Write-Host ""
    Write-Host "📁 目录内容:" -ForegroundColor Yellow
    Get-ChildItem $InstallDir | Format-Table Name, Length -AutoSize
    Write-Host ""
    Write-Host "🚀 快速开始:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. 进入目录:" -ForegroundColor White
    Write-Host "     cd `"$InstallDir`"" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  2. 配置环境变量:" -ForegroundColor White
    Write-Host "     copy .env.example .env" -ForegroundColor Gray
    Write-Host "     notepad .env" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  3. 启动服务:" -ForegroundColor White
    Write-Host "     .\$BinaryName-$Target.exe" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  4. 访问管理面板:" -ForegroundColor White
    Write-Host "     http://localhost:8088" -ForegroundColor Gray
    Write-Host ""
    Write-Host "════════════════════════════════════════════" -ForegroundColor Green
}

Main
