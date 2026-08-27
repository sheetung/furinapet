# 3D 模型放置目录

把角色的 VRM 模型放成 `pet.vrm`，桌宠在 3D 后端下会自动加载：

```text
public/models/pet.vrm
```

需要用别的路径或文件名时，在桌宠窗口的开发者控制台里设置：

```js
localStorage.setItem("furinapet.vrmUrl", "/models/my-character.vrm");
localStorage.setItem("furinapet.renderBackend", "vrm");
```

仓库不附带任何模型文件：角色形象的权利归原权利人所有，模型的二次分发通常不被授权。
请自行准备符合授权条件的 VRM 1.0（或 0.x）模型。

模型上有以下节点时会被自动接入程序化动作层，命名规则见
`src/motion/rig/VrmRig.ts` 的 `EXTRA_PATTERNS`：

- 耳朵：`Ear_L` / `Ear_R`
- 尾巴：`Tail_1` / `Tail_2` / `Tail_3`

头发、裙摆等次级骨骼由模型自带的 VRM SpringBone 设置驱动，不需要额外命名。
