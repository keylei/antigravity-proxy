#!/bin/bash
#
# Antigravity Proxy 一键安装脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.sh | bash
#
# 或指定安装目录:
#   curl -fsSL https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.sh | bash -s -- --dir /opt/antigravity
#
# 或指定版本:
#   curl -fsSL https://raw.githubusercontent.com/Kazuki-0147/Antigravity-Proxy/main/install.sh | bash -s -- --version v1.0.0
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 默认值
INSTALL_DIR="$(pwd)"
VERSION="latest"
REPO="Kazuki-0147/Antigravity-Proxy"
BINARY_NAME="antigravity-proxy"

# 打印带颜色的消息
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# 显示帮助
show_help() {
    cat << EOF
Antigravity Proxy 安装脚本

用法:
  install.sh [选项]

选项:
  -d, --dir DIR       安装目录 (默认: 当前目录)
  -v, --version VER   指定版本 (默认: latest)
  -h, --help          显示帮助

示例:
  # 默认安装到当前目录
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash

  # 安装到指定目录
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- -d /opt/antigravity

  # 安装指定版本
  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- -v v1.0.0
EOF
}

# 解析参数
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--dir)
                INSTALL_DIR="$2"
                shift 2
                ;;
            -v|--version)
                VERSION="$2"
                shift 2
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                error "未知参数: $1"
                ;;
        esac
    done
}

# 检测操作系统
detect_os() {
    local os=""
    case "$(uname -s)" in
        Linux*)
            os="linux"
            ;;
        Darwin*)
            os="macos"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            os="windows"
            ;;
        *)
            error "不支持的操作系统: $(uname -s)"
            ;;
    esac
    echo "$os"
}

# 检测 CPU 架构
detect_arch() {
    local arch=""
    case "$(uname -m)" in
        x86_64|amd64)
            arch="x64"
            ;;
        aarch64|arm64)
            arch="arm64"
            ;;
        *)
            error "不支持的 CPU 架构: $(uname -m)"
            ;;
    esac
    echo "$arch"
}

# 获取下载 URL
get_download_url() {
    local os="$1"
    local arch="$2"
    local version="$3"

    local target="${os}-${arch}"
    local ext="tar.gz"

    # Windows 使用 zip
    if [[ "$os" == "windows" ]]; then
        ext="zip"
    fi

    # macOS 只支持 x64 和 arm64
    if [[ "$os" == "macos" && "$arch" == "arm64" ]]; then
        target="macos-arm64"
    fi

    local filename="${BINARY_NAME}-${target}.${ext}"

    if [[ "$version" == "latest" ]]; then
        echo "https://github.com/$REPO/releases/latest/download/$filename"
    else
        echo "https://github.com/$REPO/releases/download/$version/$filename"
    fi
}

# 检查命令是否存在
check_command() {
    command -v "$1" &> /dev/null
}

# 下载文件
download_file() {
    local url="$1"
    local output="$2"

    info "下载中: $url"

    if check_command curl; then
        curl -fsSL "$url" -o "$output"
    elif check_command wget; then
        wget -q "$url" -O "$output"
    else
        error "需要 curl 或 wget 来下载文件"
    fi
}

# 解压文件
extract_file() {
    local file="$1"
    local dest="$2"

    info "解压到: $dest"

    if [[ "$file" == *.tar.gz ]]; then
        tar -xzf "$file" -C "$dest"
    elif [[ "$file" == *.zip ]]; then
        if check_command unzip; then
            unzip -q "$file" -d "$dest"
        else
            error "需要 unzip 来解压 zip 文件"
        fi
    else
        error "不支持的压缩格式: $file"
    fi
}

# 主函数
main() {
    parse_args "$@"

    echo ""
    echo "╔══════════════════════════════════════════╗"
    echo "║     Antigravity Proxy 安装程序           ║"
    echo "╚══════════════════════════════════════════╝"
    echo ""

    # 检测系统环境
    local os=$(detect_os)
    local arch=$(detect_arch)

    info "检测到系统: $os-$arch"
    info "安装目录: $INSTALL_DIR"
    info "版本: $VERSION"
    echo ""

    # 构建目标名称
    local target="${os}-${arch}"
    local ext="tar.gz"
    [[ "$os" == "windows" ]] && ext="zip"

    local binary_suffix=""
    [[ "$os" == "windows" ]] && binary_suffix=".exe"

    # 获取下载 URL
    local download_url=$(get_download_url "$os" "$arch" "$VERSION")
    local filename="${BINARY_NAME}-${target}.${ext}"

    # 创建临时目录
    local tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT

    local tmp_file="$tmp_dir/$filename"

    # 下载
    download_file "$download_url" "$tmp_file"
    success "下载完成"

    # 创建安装目录
    mkdir -p "$INSTALL_DIR"

    # 解压
    extract_file "$tmp_file" "$INSTALL_DIR"
    success "解压完成"

    # 设置可执行权限
    local binary_path="$INSTALL_DIR/${BINARY_NAME}-${target}${binary_suffix}"
    if [[ -f "$binary_path" ]]; then
        chmod +x "$binary_path"

        # 创建软链接（方便使用）
        local link_path="$INSTALL_DIR/$BINARY_NAME$binary_suffix"
        if [[ ! -f "$link_path" ]]; then
            ln -sf "$(basename "$binary_path")" "$link_path"
        fi
    fi

    echo ""
    echo "════════════════════════════════════════════"
    success "安装完成！"
    echo ""
    echo "安装位置: $INSTALL_DIR"
    echo ""
    echo "📁 目录内容:"
    ls -la "$INSTALL_DIR"
    echo ""
    echo "🚀 快速开始:"
    echo ""
    echo "  1. 进入目录:"
    echo "     cd $INSTALL_DIR"
    echo ""
    echo "  2. 配置环境变量:"
    echo "     cp .env.example .env"
    echo "     nano .env  # 或使用其他编辑器"
    echo ""
    echo "  3. 启动服务:"
    if [[ "$os" == "windows" ]]; then
        echo "     .\\${BINARY_NAME}-${target}.exe"
    else
        echo "     ./${BINARY_NAME}-${target}"
    fi
    echo ""
    echo "  4. 访问管理面板:"
    echo "     http://localhost:8088"
    echo ""
    echo "════════════════════════════════════════════"
}

main "$@"
