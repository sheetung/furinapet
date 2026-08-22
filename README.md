# 芙宁娜桌宠

面向 Windows 的轻量芙宁娜桌宠。项目由 OpenPets 分支演化而来，现已改为独立维护，不再追踪上游，也不包含 OpenPets 的插件市场、Agent 集成、局域网控制、语音和多宠物框架。

## 保留的基础能力

- 透明无边框桌宠、拖动与置顶
- v2 精灵协议：11 行动画、16 个注视方向
- 自动漫游、点击互动、随机气泡
- 显示开关、尺寸、漫游、置顶等设置
- Windows 托盘、开机启动、位置重置
- GitHub Releases 更新检查
- 简化为“首页 / 桌宠 / 设置”的控制中心

## 为什么更轻

桌面端使用 Tauri 2，直接复用 Windows WebView2，不再随应用打包 Chromium。前端只有一个 React 页面；后端只有窗口、托盘、设置、漫游和更新检查等必要模块。运行时插件宿主已经删除。

项目仍保留编译期扩展边界：

- 前端功能在 `src/extensions/registry.ts` 注册；
- 系统能力放在 `src-tauri/src` 的独立 Rust 模块；
- 新功能通过明确接口接入，不允许直接修改桌宠运动与设置内核。

这样后期可以增加番茄钟、提醒等自有模块，同时不会重新引入大型通用插件系统。

## 开发

需要 Node.js 22、pnpm、Rust stable、Microsoft C++ Build Tools 和 WebView2。

```powershell
pnpm install
pnpm desktop:dev
```

常用命令：

```powershell
pnpm build          # 前端类型检查与构建
pnpm desktop:build  # 生成 Windows NSIS 安装包
```

GitHub Actions 会在 Windows 环境验证 v2 桌宠资源、编译 Tauri，并上传安装包及 SHA-256 校验文件。

## 目录

```text
src/                         精简控制中心与桌宠渲染层
src/core/                    方向与动画协议
src/extensions/             编译期扩展注册表
src-tauri/src/               Windows 原生能力与轻量内核
public/assets/               安装包内置芙宁娜资源
pets/furina--lingxiaotian/   Codex v2 桌宠标准包
```

角色形象相关权利归原权利人所有。本项目中的代码遵循仓库许可证；芙宁娜素材仅用于非商业桌宠展示，请遵守相应权利方要求。
