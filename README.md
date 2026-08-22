# 芙宁娜桌宠

<p align="center">
  <img src="public/assets/furina-app-icon.png" width="128" alt="芙宁娜桌宠头像" />
</p>

面向 Windows 独立维护的轻量芙宁娜桌宠。默认角色和产品品牌始终是芙宁娜，同时提供轻量的编译期角色注册能力。项目专注透明桌面动画、互动、漫游和基础设置，不包含通用插件市场、Agent 集成、局域网控制或语音框架。

## 保留的基础能力

- 透明无边框桌宠、拖动与置顶
- v2 精灵协议：11 行动画、16 个注视方向
- 平滑贴地漫游、拖动重力落地、点击互动与随机气泡
- 显示开关、尺寸、漫游、置顶等设置
- Windows 托盘、开机启动、位置重置
- GitHub Releases 更新检查、版本弹窗、下载进度与安装包校验
- 构建期自动发现角色，并在主页切换
- 简化为“首页 / 桌宠 / 设置”的控制中心

## 为什么更轻

桌面端使用 Tauri 2，直接复用 Windows WebView2，不随应用打包 Chromium。前端只有一个 React 页面；后端只有窗口、托盘、设置、漫游和更新检查等必要模块。

项目仍保留编译期扩展边界：

- 角色在 `characters/<id>/` 中注册，Vite 构建时自动发现；
- 前端功能在 `src/extensions/registry.ts` 注册；
- 系统能力放在 `src-tauri/src` 的独立 Rust 模块；
- 新功能通过明确接口接入，不允许直接修改桌宠运动与设置内核。

这样后期可以增加角色、番茄钟、提醒等自有模块，同时不会重新引入大型通用插件系统。动画播放器严格遵守 v2 各行的实际帧数和逐帧时长，避免读取透明尾格。

## 增加角色

复制 `characters/furina` 为新的小写英文 id 目录，并替换其中四个文件：

```text
characters/new-character/
├─ character.json
├─ avatar.png
├─ thumbnail.png
└─ spritesheet.webp
```

`character.json` 中的 `id` 必须与目录名一致；新增角色应保持 `isDefault` 为 `false` 或省略。图集须遵守 8 列 × 11 行、单格 192 × 208 的 v2 契约。运行 `pnpm dev` 或 `pnpm build` 后，角色会被自动扫描并显示在主页，无需修改注册表代码。

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

GitHub Actions 会在 Windows 环境验证全部角色资源并编译 Tauri；推送版本标签时会发布 Windows `.exe` 安装包和轻量 `update.json` 清单，供客户端安全检查、下载并校验更新。

## 目录

```text
src/                         精简控制中心与桌宠渲染层
src/characters/              构建期角色发现与运行时注册表
src/core/                    方向与动画协议
src/extensions/             编译期扩展注册表
src-tauri/src/               Windows 原生能力与轻量内核
characters/                  自包含角色清单与素材
public/assets/               芙宁娜桌宠品牌资源
pets/furina--lingxiaotian/   Codex v2 桌宠标准包
```

角色形象相关权利归原权利人所有。本项目中的代码遵循仓库许可证；芙宁娜素材仅用于非商业桌宠展示，请遵守相应权利方要求。
