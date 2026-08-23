import type { FurinaPlugin } from "../../types";

let dispose: (() => void) | undefined;

const clickReactionPlugin: FurinaPlugin = {
  manifest: {
    id: "click-reaction",
    name: "点击互动增强",
    version: "1.0.0",
    apiVersion: 1,
    author: "furinapet",
    description: "示例插件：响应桌宠双击事件并触发开心互动。",
    permissions: ["events", "pet:react"],
  },

  activate(context) {
    dispose = context.events.on("pet:double-clicked", async () => {
      await context.pet.react("jumping", "嘿嘿，被你发现啦！");
    });
    context.logger.info("activated");
  },

  deactivate() {
    dispose?.();
    dispose = undefined;
  },
};

export default clickReactionPlugin;
