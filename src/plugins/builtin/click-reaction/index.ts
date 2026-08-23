import type { Reaction } from "../../../types";
import type { FurinaPlugin } from "../../types";

let disposers: Array<() => void> = [];
let streak = 0;
let lastClickAt = 0;

const interactions: readonly { reaction: Reaction; message: string }[] = [
  { reaction: "waving", message: "嗯？是在叫我吗？" },
  { reaction: "review", message: "你刚刚是不是戳了我一下？" },
  { reaction: "waiting", message: "我有在认真陪着你哦。" },
  { reaction: "jumping", message: "嘿嘿，抓到你啦！" },
  { reaction: "failed", message: "再戳的话，我可要记仇啦……" },
];

const clickReactionPlugin: FurinaPlugin = {
  manifest: {
    id: "click-reaction",
    name: "点击互动增强",
    version: "1.1.0",
    apiVersion: 1,
    author: "furinapet",
    description: "单击和双击桌宠都会触发更明显的随机动作、连续点击反馈与互动气泡。",
    permissions: ["events", "pet:react"],
  },

  activate(context) {
    const onClick = context.events.on("pet:clicked", async () => {
      const now = Date.now();
      streak = now - lastClickAt < 1800 ? streak + 1 : 1;
      lastClickAt = now;

      if (streak >= 3) {
        streak = 0;
        await context.pet.react("jumping", "好啦好啦！我知道你在这里啦！✨");
        return;
      }

      const interaction = interactions[Math.floor(Math.random() * interactions.length)];
      await context.pet.react(interaction.reaction, interaction.message);
    });

    const onDoubleClick = context.events.on("pet:double-clicked", async () => {
      streak = 0;
      await context.pet.react("jumping", "哇！突然这么热情，我都吓了一跳！✨");
    });

    disposers = [onClick, onDoubleClick];
    context.logger.info("activated with single-click, double-click and click-streak interactions");
  },

  deactivate() {
    disposers.forEach((dispose) => dispose());
    disposers = [];
    streak = 0;
    lastClickAt = 0;
  },
};

export default clickReactionPlugin;
