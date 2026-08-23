# furinapet Plugin API v1

当前版本提供轻量的内置插件宿主。插件使用 TypeScript 编译进应用，通过受限 `PluginContext` 与桌宠交互。

## 新增插件

在 `src/plugins/builtin/` 下创建目录：

```text
src/plugins/builtin/my-plugin/
└─ index.ts
```

插件会由 `registry.ts` 中的 `import.meta.glob()` 自动发现，无需修改注册表。

```ts
import type { FurinaPlugin } from "../../types";

let dispose: (() => void) | undefined;

const plugin: FurinaPlugin = {
  manifest: {
    id: "my-plugin",
    name: "我的插件",
    version: "1.0.0",
    apiVersion: 1,
    description: "插件说明",
    permissions: ["events", "pet:react", "storage"],
  },

  activate(context) {
    dispose = context.events.on("pet:double-clicked", async () => {
      await context.pet.react("jumping", "插件运行成功");
    });
  },

  deactivate() {
    dispose?.();
    dispose = undefined;
  },
};

export default plugin;
```

## API

### `context.pet`

- `react(reaction, message?)`
- `showMessage(message)`

### `context.events`

- `on(event, callback)`
- `emit(event, payload?)`

当前桥接事件：

- `app:ready`
- `pet:double-clicked`
- `pet:drag-start`
- `pet:drag-end`

### `context.storage`

插件存储自动按插件 id 隔离：

- `get(key)`
- `set(key, value)`
- `remove(key)`

### `context.logger`

- `info()`
- `warn()`
- `error()`

## 权限

插件必须在 `manifest.permissions` 中声明调用 API 所需的权限：

- `pet:react`
- `pet:message`
- `events`
- `storage`

未声明权限时调用对应 API 会抛出错误。

## 当前限制

Plugin API v1 只加载应用内置插件，不执行下载得到的第三方 JavaScript。后续如果支持 `.furina-plugin` 安装包，应在 Worker/独立 WebView 等隔离环境运行第三方代码，而不是在主 React WebView 中直接 `eval` 或 `new Function`。
