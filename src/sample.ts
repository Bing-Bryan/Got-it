import { SCHEMA_VERSION, type DocumentSnapshot, type Workspace } from "./types";

export const SAMPLE_MARKDOWN = `# 陪伴类 AI 产品分析

> **示例文档**：这份节选用于体验 Got-it。文中的市场数据与用户比例尚未核查，请把它们当作练习材料，而不是研究结论。

## 执行摘要

陪伴类 AI 产品以建立情感联结、提供情绪价值与缓解孤独为核心目标。报告认为，**18–34 岁 Z 世代是当前主力用户**，并把“被倾听感”视为比回答正确率更重要的体验变量。

市场规模方面，报告声称全球 AI 陪伴 App 市场从 2025 年的 84 亿美元增长到 2035 年的 548 亿美元，**CAGR 约为 20%**。

## 1. 用户、需求与使用场景

### 1.1 用户画像

| 维度 | 报告中的说法 |
| --- | --- |
| 年龄 | 18–34 岁为主力；**67% 的 35 岁以下成人曾与 AI 伴侣互动** |
| 状态 | 学生、职场白领、自由职业者为主；独居、异地和单身人群渗透率较高 |
| 动机 | 缓解孤独、无评判倾诉、即时响应、定制化亲密关系 |

这里至少包含三个需要追问的知识缺口：年龄结论的样本是什么、“AI 伴侣互动”如何定义、67% 的原始出处在哪里。

### 1.2 典型使用场景

1. **深夜情绪倾诉**：用户在独处时表达工作或关系压力。
2. **虚拟恋爱与角色互动**：用户与稳定人设进行长期对话。
3. **儿童和老年陪伴**：产品承担讲故事、提醒、联系家人等任务。
4. **心理疗愈辅助**：使用情绪日记、冥想或 CBT 式提问，但不替代专业治疗。

## 2. 市场指标怎么读

### 2.1 CAGR

CAGR 是 Compound Annual Growth Rate 的缩写，中文常译为“复合年增长率”。它把一段时间的总增长换算成每年以同一比例增长的等效速度。

例如，一项业务从 100 增长到 144，历时两年，CAGR 不是 22%，而是 20%，因为：

\`\`\`text
100 × 1.20 × 1.20 = 144
\`\`\`

### 2.2 竞品速览

| 产品 | 报告定位 | 需要进一步认识的地方 |
| --- | --- | --- |
| Replika | 一对一关系型 AI 伴侣 | 形象、人设、长期记忆和语音体验 |
| Character.AI | 角色扮演 UGC 平台 | 角色发现、创作工具和社区结构 |
| Nomi | 强个性化虚拟伴侣 | 关系连续性和记忆呈现 |
| 星野 | 沉浸式 AI 虚拟社交 | 多模态人设、抽卡与创作者生态 |

## 3. 阅读时需要区分的三层内容

- **报告声称了什么**：忠实复述当前 Markdown。
- **外部证据支持什么**：回到原始研究、样本和数据口径。
- **我现在怎样理解**：用自己的话写下一句能在之后复述的认识。

只有第三层由读者确认后，一个知识点才算真正闭环。
`;

export function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createDemoDocument(): DocumentSnapshot {
  return {
    id: `demo-${stableHash(SAMPLE_MARKDOWN)}`,
    filename: "陪伴类AI产品分析·示例.md",
    markdown: SAMPLE_MARKDOWN,
    importedAt: new Date().toISOString(),
    contentHash: stableHash(SAMPLE_MARKDOWN),
    isDemo: true,
  };
}

export function createInitialWorkspace(): Workspace {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    modelDefaultsVersion: 3,
    document: createDemoDocument(),
    inquiries: [],
    activeInquiryId: null,
    activeProviderId: "codex",
    updatedAt: now,
    hasUnexportedChanges: false,
  };
}
