<p align="center">
  <img src="characters/furina/icons/app.png" width="128" alt="芙宁娜桌宠" />
</p>

<h1 align="center">芙宁娜桌宠 · FurinaPet</h1>

<p align="center">让芙宁娜住进你的 Windows 桌面。</p>

<p align="center">
  <a href="https://github.com/sheetung/furinapet/releases/latest">下载安装</a> ·
  <a href="https://github.com/sheetung/furinapet/releases">版本更新</a> ·
  <a href="https://github.com/sheetung/furinapet/issues">反馈问题</a>
</p>

FurinaPet 是一款以芙宁娜为主角的二维桌面宠物。她会看向鼠标、在桌面漫步，也会在活动后休息、喝茶和吃点心。你可以与她互动，或通过可选的 MCP 接入，让她用动作和气泡回应编程助手。

基于 **Tauri 2 + React + Rust** 构建，复用 Windows WebView2，无需随应用打包 Chromium。

## 她能做什么

- **桌面陪伴**：透明无边框显示，支持拖拽、视线跟随、挥手、跳跃及多种日常动作。
- **自主生活**：根据体力、口渴和饥饿安排休息与饮食；可单独关闭走动，让她安静待在原地。
- **桌面移动**：支持漫步、拖动后的重力落地和可选的窗口边缘停靠。
- **随心设置**：调整大小、移动速度与行为倾向，支持置顶、显示隐藏、位置重置和开机启动。
- **智能体互动**：内置 MCP 服务，提供状态查询、状态设置、动作和气泡工具；支持 Codex 一键配置及 Claude Code 集成。
- **托盘与更新**：从系统托盘管理桌宠，在应用内检查版本、下载安装包并校验完整性。

## 安装与使用

1. 打开 [最新版本下载页](https://github.com/sheetung/furinapet/releases/latest)，下载 `furinapet-Windows-v*.exe` 安装包。
2. 安装并启动应用。运行需要 Windows WebView2 Runtime。
3. 从系统托盘打开控制中心，在「宠物」中调整外观、移动与自主行为。

点击角色可互动，拖拽可改变她的位置。希望减少打扰时，可以关闭「允许走动」和「允许停靠」，保留原地的日常动作；关闭「自主行为」则停止自主安排动作。

找不到角色时，使用「重置桌宠位置」。关闭控制中心会收起到托盘，不会退出桌宠。

## 连接编程助手

桌宠本身可独立运行，智能体接入是可选功能。

在控制中心的「智能体」页面选择 Codex 并点击「一键接入」，随后重启 Codex 或重新加载 MCP。让助手调用 `furinapet_status`，即可检查实际连接；「已配置」表示配置已写入，并不代表已经连接。

连接后，助手可以请求动作、显示简短气泡或更新工作状态。Codex 接入目前需要助手调用工具，不会自动同步所有思考、编辑和测试过程。Claude Code 另提供生命周期 hooks 集成。

配置方式、工具列表和隐私边界见 [智能体接入文档](docs/agent-mcp.md)。

## 从源码运行

开发环境：Windows、Node.js 22 或更高版本、pnpm（版本见 `package.json`）、Rust stable、Microsoft C++ Build Tools 和 WebView2。

```powershell
git clone https://github.com/sheetung/furinapet.git
cd furinapet
pnpm install
pnpm desktop:dev
```

常用命令：

```powershell
pnpm test              # 自动化测试
pnpm build             # 类型检查与前端构建
pnpm desktop:build     # 编译桌面程序与 Windows NSIS 安装包
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。`pnpm dev` 仅启动前端，完整桌面功能请使用 `pnpm desktop:dev`。

## 项目结构

```text
characters/furina/    芙宁娜素材、动作定义、图标与独立 Codex 宠物包
src/                 控制中心、桌宠呈现与行为运行时
src-tauri/           窗口、托盘、系统集成、MCP 与更新能力
tests/               自动化测试
docs/                功能设计、接入说明与开发记录
```

项目以芙宁娜的互动体验为重点。角色资源统一维护在 [characters/furina](characters/furina/README.md)，通用的动作执行、移动控制与气泡呈现与角色素材分离。

- [角色资源说明](characters/furina/README.md)
- [自主行为与需求机制](docs/AUTONOMOUS_NEEDS.md)
- [动作系统设计与重构记录](docs/ACTION_SYSTEM_REFACTOR_PLAN.md)

## 反馈与贡献

欢迎通过 [Issues](https://github.com/sheetung/furinapet/issues) 提交问题和建议。报告问题时，请附上应用版本、Windows 版本、复现步骤；动画或窗口位置问题可附截图或录屏。

## 开源协议与版权

芙宁娜为《原神》角色，角色形象及相关权利归原权利人所有。本项目为非官方同人桌宠，与原权利方无隶属关系。

项目代码采用 [MIT 开源协议](LICENSE)，允许使用、修改、分发和商业使用，须保留版权声明与许可证文本。

MIT 协议不授予芙宁娜角色形象及第三方美术素材的使用权。角色素材仅用于非商业桌宠展示，请遵守相应权利方要求。
