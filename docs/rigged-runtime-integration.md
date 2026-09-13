# GLB 身体层对接（2026-09-07）

美术精修暂缓。本阶段交付可选运行时链路，不代表模型生产美术验收完成。

## 骨骼动画更新（2026-09-09，最新）

候选已增加左右膝骨至 21 骨、8 段动画；walk/jump/cheer/think 为 Blender
真实姿态与根骨位移轨道，不再使用下节提到的整体程序化起伏替代。步行含手臂摆动、
髋/膝运动及衣摆摆动，跳跃含预蹲/腾空/落地关键姿态。walk/think 循环，其余动作单次。
GLB 控制器叠加小步长阻尼跟随（后发/双衣摆）和关节 Z 角限幅。
324 项测试包含真实膝骨变化、步行循环、12 秒关节范围与 idle 复位；非完整 IK 或
足底锁定，尚未对全部帧视觉验收。新工程与 GLB 已生成，运行中的旧 exe 不自动更新。

## 2026-09-09 外观一致性修复（最新，覆盖旧动作回退策略）

用户报告待机与运动外观不同，确认原因是能力缺口触发 spritesheet 回退，非模型加载未完成。
现在 GLB 成功加载后始终保留：缺失动作保留已支持动作/表情，通过 diagnostics.unsupported
记录能力缺口，不再切换角色外观。仅未启用 GLB、加载中或加载/渲染失败时显示 sprite。
jumping/cheer 增加同模型基础弹跳，running/run-left/run-right 增加小幅起伏与摇摆，
review 增加轻微思考倾斜；这些是程序化近似，不是新增 Blender 动画或完整步态/IK。
变换作用于独立展示 Group，不改变蒙皮静止姿态、不替代 PetView 的窗口位移。
323 项 / 25 文件测试与前端构建通过，真实 GLB 测试覆盖所有 reaction 不换身体、
缺失解剖部件时保留挥手/表情、运动范围及返回 idle 复位。下文旧“未支持动作切 sprite”
及其浏览器验收为历史策略，不再描述当前行为。

## 已连接的执行路径

`pet-brain/runtime.ts` 的脑计划和反射计划执行点 → `deliverRigPlan`
→ 同一 pet WebView 内的订阅通道 → `GlbBody` → AnimationMixer / morph
→ `RiggedPet` → `PetBody` → `PetView`。

既有 `desktop.react` 通道保留：不改 Rust 事件格式、反应计时、气泡或
PetView 的窗口漫游/重力/拖动。通道不跨 WebView，控制中心仍通过原有
Tauri 事件驱动 pet 窗口的脑执行器。旧手写 2D Skeleton 后端不冒充 GLB 后端。

## 开启与回退

- 默认依然显示 spritesheet。开发 URL：`/?window=pet&renderer=rigged`。
- 原生开发或打包时设置 `VITE_PET_RENDERER=rigged`，无需修改原生窗口 URL。
- 仅内置 Furina 使用候选模型；导入/在线角色继续使用自己的 spritesheet。
- Three.js、GLTFLoader 和候选 GLB 为懒加载分块；未开启时不加载该分块。
- 共享 `PetBody` 在模型就绪前保留 sprite；加载、解析、WebGL 初始化、
  WebGL 上下文丢失或帧执行失败时保持/恢复 sprite。懒加载错误有边界保护。
- 遇到未支持的 MotorPlan 或旧 reaction 时暂时显示 sprite；GLB 计划到期后
  自动回到 idle。取消按计划 id 匹配，旧取消不能打断新动作。
- Shadow 计划不执行；活动反射不能被低优先级计划覆盖。
- 取消幂等；取消/到期恢复最近一次 legacy reaction 并重置表情强度。
  计划计时使用真实帧间隔（包括隐藏间隔），仅动画积分限制到 50ms。
- 上下文丢失为本次挂载的终止故障，迟到模型不会重新启动渲染；重新挂载才重试。
  卸载时释放共享 Skeleton、纹理、材质与网格资源。

## 当前能力与诚实降级

支持 wave / recoil / idle 动画、neutral / happy / surprised / annoyed / tired
表情、有限 lean / turn / lookAt / lookAway、自动眨眼。表情和动作可同时驱动，
所有独立眼部网格同步应用 morph。权重和时长夹限，异常帧时间被限制。

sad、非 wave 手势、耳/尾专属动作及窗口位移动作不假装完成：报告 unsupported
并显示 legacy。`step` / `approach` / `retreat` 不移动 GLB 的本地根节点，
避免与窗口移动重复。本阶段不扩展 AI 自主漫游的既有能力边界。

lean 仅支持左右；forward/back 明确回退，不再误解为右倾。显式 expression
不受 idleStyle 的动作排列顺序影响；仅有 idleStyle 时遵守其 weight。

## 验证

- `npm test`：316 项 / 24 文件通过。`tests/glb-body.integration.test.ts`
  解码实际导出的 GLB 网格、蒙皮和动画；Node 下仅纹理解码替换为空 Texture，
  不伪造骨骼/动画。图像和 WebGL 仍由浏览器验证。
- `npm run build`：通过；主 JS 约 376 KB，GLB 约 4.61 MB，懒加载 Three/身体分块
  约 623 KB（有大于 500 KB 的体积警告，尚未做资源体积优化）。
- `/rigged-integration.html` 使用与 PetView **相同的 PetBody**，可验证启停、
  组合 MotorPlan、反射、取消、不支持动作回退和模拟加载失败。
- 浏览器已确认加载后 backend=rigged；模拟无效模型后 backend=legacy，
  原版精灵保留。模型完整性报告仍见 `characters/furina/model/qa/`。
- 浏览器已等待并确认不支持动作切至 legacy，取消后恢复 rigged。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked` 通过。原生 CSP
  的 connect-src 补充 `'self'` / `blob:`，允许本地 GLB 及内嵌图片读取，
  未新增远程域名。对应配置防回归检查已加入测试。
- 本轮 `cargo test --manifest-path src-tauri/Cargo.toml --locked` 通过；Rust 当前
  为 0 个测试，只验证测试目标编译/链接，不能代替窗口端到端测试。
- 本轮新增真实 GLB 回归：表情优先级、深度 lean 回退、取消状态复位、
  停帧到期与动画限步、共享骨架单次释放；取消通道改为一次性通知。

原生抽样补记：已运行内嵌 GLB 的 Tauri 调试版，确认候选显示、控制中心挥手/
短气泡和隐藏恢复。拖动未观察到位移，双击未可靠显示气泡，不能标为通过。
详细复现及边界见 [原生验收记录](s5-native-acceptance.md)。

尚未完成：Tauri/WebView2 完整验收（拖动/双击、长气泡/多屏、原生故障注入、
打包安装）；全部 MotorPrimitive 的专属美术实现；完整 IK/物理身体
约束接入；最终美术及资源大小优化。不要将本次浏览器共用组件验证称为原生验收。
