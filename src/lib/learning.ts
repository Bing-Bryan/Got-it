import type { Inquiry } from "../types";

export const REFINEMENTS = {
  web: {
    label: "联网补充",
    prompt: "请围绕当前原文概念联网补充：搜索并打开相关资料，优先官方定义，说明外部资料怎样帮助理解原文。区分作者自定义和外部定义，必要时注明日期或版本，最多两条有用来源；没有相关资料就直说，不拿同名词凑数，不作真假裁决。",
  },
  simplify: {
    label: "再解释下",
    prompt: "我还没理解。请只针对当前原文知识点，用更简单的语言重新解释：先用一句大白话说明核心意思，再给一个熟悉的日常生活例子，并说明例子怎样对应原文中的概念。尽量用三到五句短句，去掉术语和旁支；假设数字标明是举例，类比不当成事实证据。保留必要的不确定性，不新增话题，需要外部背景、消除歧义或当前信息才能讲清时，按本轮联网规则查阅资料；仅换说法或举例不必搜索。不向我提问或要求复述。",
  },
  detail: {
    label: "详细介绍",
    prompt: "请在已有介绍基础上，详细介绍当前原文中的人物、机构、品牌或产品。不要重复已有定义，也不要仅把原回答写长；优先补充尚未讲清、与这段文章相关的两到三个有用细节，并给一个具体场景或例子，说明这些细节如何帮助理解原文。按对象选择合适内容，不强套产品模板，不扩展无关话题；假设场景明确标为举例，未知信息保留不确定性，没有可靠新增信息就明确说明，不编造。需要当前事实或消除歧义时按需查阅来源，保留来源与限制；无需向用户提问或要求复述。",
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
