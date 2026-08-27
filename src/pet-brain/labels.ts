/**
 * Shared Chinese label helpers for the brain/decision UIs.
 *
 * Extracted from BrainNavigation so the LMC Decision Inspector can reuse the
 * same vocabulary without duplicating mappings.
 */

import type { EmotionState } from "../neuro/contracts";
import type { AiSuggestionTrace, PetSemanticAction } from "./types";

export const EMOTION_LABELS: { key: keyof EmotionState; label: string }[] = [
  { key: "happiness", label: "开心" },
  { key: "affection", label: "亲密" },
  { key: "curiosity", label: "好奇" },
  { key: "annoyance", label: "烦躁" },
  { key: "fear", label: "紧张" },
  { key: "boredom", label: "无聊" },
  { key: "sleepiness", label: "困倦" },
];

export function goalLabel(goal: string) {
  switch (goal) {
    case "idle": return "空闲";
    case "wander": return "漫步";
    case "dock": return "窗口停靠";
    case "respond-user": return "回应用户";
    case "observe-agent": return "观察 Agent";
    case "celebrate": return "庆祝";
    case "rest": return "休息";
    default: return goal;
  }
}

export function moodLabel(mood: string) {
  switch (mood) {
    case "happy": return "开心";
    case "focused": return "专注";
    case "tired": return "疲惫";
    default: return "平常";
  }
}

export function agentStateLabel(state: string) {
  switch (state) {
    case "thinking": return "思考中";
    case "editing": return "编辑中";
    case "testing": return "测试中";
    case "waiting": return "等待中";
    case "success": return "成功";
    case "error": return "错误";
    default: return "空闲";
  }
}

export function attentionLabel(target: string) {
  const labels: Record<string, string> = { pointer: "鼠标", user: "用户", agent: "Agent", self: "自己", none: "无" };
  return labels[target] ?? target;
}

export function traceStatusLabel(status: AiSuggestionTrace["status"]) {
  switch (status) {
    case "accepted": return "已采纳";
    case "rejected": return "未采纳";
    default: return "等待决策";
  }
}

export function actionLabel(action: PetSemanticAction) {
  switch (action.type) {
    case "idle": return `idle${action.durationMs ? ` · ${action.durationMs}ms` : ""}`;
    case "wander": return "wander";
    case "dock": return "dock";
    case "observe": return `observe · ${action.durationMs}ms`;
    case "respond": return `respond · ${action.intensity}`;
    case "celebrate": return `celebrate · ${action.intensity}`;
    case "rest": return `rest · ${action.durationMs}ms`;
    case "wait": return `wait · ${action.durationMs}ms`;
  }
}

export function reasonLabel(reason: string) {
  return reason
    .replace("baseline calm state", "基础平静状态")
    .replace("recent user interaction", "最近有用户互动")
    .replace("repeated user interaction", "连续用户互动")
    .replace("agent error needs attention", "Agent 出错，需要关注")
    .replace("agent inactive", "Agent 当前未工作")
    .replace("agent completed work", "Agent 已完成任务")
    .replace("high user engagement", "用户互动强度较高")
    .replace("energy recovery", "恢复能量")
    .replace("autonomous exploration tendency", "自主漫步倾向")
    .replace("window exploration tendency", "窗口探索倾向")
    .replace("system intent", "系统 Intent")
    .replace("user intent", "用户 Intent")
    .replace("agent intent", "Agent Intent")
    .replace("plugin intent", "插件 Intent")
    .replace("ai intent", "AI 建议 Intent");
}

export function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 2) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
