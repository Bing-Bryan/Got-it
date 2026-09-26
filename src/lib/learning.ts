import type { Inquiry } from "../types";

export const REFINEMENTS = {
  simplify: {
    label: "再解释下",
    prompt: "我还没理解。请只针对当前原文知识点，用更简单的语言重新解释：先用一句大白话说明核心意思，再给一个熟悉的日常生活例子，并说明例子怎样对应原文中的概念。尽量用三到五句短句，去掉术语和旁支；假设数字标明是举例，类比不当成事实证据。保留必要的不确定性，不新增话题，不联网查证，不向我提问或要求复述。",
  },
  detail: {
    label: "详细介绍",
    prompt: "请在已有介绍基础上，详细介绍当前原文中的人物、机构、品牌或产品。不要重复已有定义，也不要仅把原回答写长；优先补充尚未讲清、与这段文章相关的两到三个有用细节，并给一个具体场景或例子，说明这些细节如何帮助理解原文。按对象选择合适内容，不强套产品模板，不扩展无关话题；假设场景明确标为举例，未知信息保留不确定性，没有可靠新增信息就明确说明，不编造。需要当前事实或消除歧义时按需查阅来源，保留来源与限制；无需向用户提问或要求复述。",
  },
  example: {
    label: "举个简单例子",
    prompt: "我还没理解。请只针对当前原文知识点，给一个熟悉的日常生活例子，用不超过四句短句说明例子怎样对应这个概念。假设数字要标明是举例，类比不当成事实证据，不新增话题，不向我提问或要求复述。",
  },
} as const;

export type Refinement = keyof typeof REFINEMENTS;

export function isVerificationUnfinished(inquiry: Inquiry): boolean {
  if (inquiry.intent !== "verify") return false;
  const latest = [...inquiry.messages].reverse().find(message => message.role === "assistant");
  return !canCompleteInquiry(inquiry) || latest?.verification?.completion !== "complete"
    || latest.verification.verdict === "incomplete"
    || (!!latest.search && latest.search.status !== "executed");
}

export function canCompleteInquiry(inquiry: Inquiry): boolean {
  const latest = [...inquiry.messages].reverse().find(message => message.role === "assistant");
  return latest?.mode !== "demo" && inquiry.status !== "answering" && !inquiry.lastError && latest?.completion !== "provisional" && latest?.completion !== "interrupted" && latest?.verification?.completion !== "provisional" && latest?.verification?.completion !== "interrupted" && inquiry.messages.some(
    (message) => message.role === "assistant" && message.content.trim().length > 0,
  );
}
