# 2026-10-18：PDF 原位译中与界面修正

PDF 译中现在和网页、Markdown 一样：用同一个翻译图标在原文与中文之间整篇切换，选择随阅读记录保存，刷新后保持。

中文直接显示在原 PDF 页面上：只把已译段落所在位置换成中文。图表、图片、公式、竖排页边文字和未译段落保持原样，页面版式不变。中文按原段落区域自动缩小字号，单行标题可略微收窄；仍放不下时，段尾显示「…」，点击可查看完整中文。

此前按页切换的「原页 / 中文稿」开关和重排的中文稿已移除。已保存的 PDF 译文会直接以新方式显示，不需要重新翻译。

中文显示中仍可在同一段内选字使用「解释一下 / 查找来源 / 问一问」，只发送所选中文与该段英文原文。

同时修正：
- Markdown 页面不再重复显示保存状态，体验版欢迎页的同一提示也不再重复。
- 体验服务连不上时，设置面板统一显示「体验服务暂时无法连接」；能力未知时显示「正在读取 / 暂时无法确认」，不再断言「搜索服务尚未配置」。
- 体验版顶栏的模型按钮直接显示 DeepSeek（本地版此处仍为 Codex），接入方式不变。

验证：
- 自动测试覆盖：整篇切换、零段 / 部分完成不进入空的中文侧、扫描页提示、放不下时的缩字号与截断、单行收窄、取色回退、中文选字锚点，以及单一保存状态与故障措辞。
- 真实浏览器验收：在隔离数据中使用一篇已译 32 页论文 PDF 的既有译文，桌面与 375px 宽度均已检查。
- 本次未发起新的模型调用。

已知限制：
- 读屏软件在中文显示下仍可能读到被遮住的英文；键盘扩展选区不会弹出选区卡片。
- 图题、坐标标签等被识别为段落的短文字也会被替换，个别会显示「…」。
- 翻译进行中逐批出现中文、双栏论文、彩色背景页和旋转页面未在真实浏览器中验证。
- 未在 Safari、Firefox 或真机上验证。

## In-place PDF translation and UI fixes

PDF translation now works like web pages and Markdown: the same translate icon switches the whole document between Original and Chinese. The choice is saved with the reading record and survives a refresh.

Chinese appears on the original PDF page itself: only translated paragraphs are replaced where they sit. Figures, images, formulas, vertical margin text, and untranslated paragraphs stay as they are, so the layout does not change. Chinese shrinks to fit each original paragraph box, and one-line titles may narrow slightly. Anything that still does not fit ends with "…", which opens the full Chinese.

The per-page **Original / Chinese draft** switch and the reflowed draft are gone. Previously saved PDF translations display this way directly, with no re-translation.

Selecting Chinese text within one paragraph still offers Explain / Find sources / Ask, and sends only the selected Chinese and that paragraph's English original.

Also fixed:
- Markdown pages no longer show the save status twice, and the hosted welcome page no longer repeats the same hint.
- When the trial service cannot be reached, the settings panel uses one wording. While capabilities are unknown it says so, instead of claiming search is not configured.
- The hosted model button now reads DeepSeek; the local version still shows Codex there. The model connection itself is unchanged.

Verification:
- Automated tests cover whole-document switching, not entering an empty Chinese side when nothing (or only part) is translated, image-only page notices, shrink-and-truncate fitting, one-line narrowing, colour fallback, Chinese selection anchors, the single save status, and the failure wording.
- Real-browser acceptance used isolated data and existing translations of a 32-page paper, at desktop and 375px widths.
- This release made no new model calls.

Known limitations:
- In the Chinese view, screen readers may still read the covered English, and extending a selection with the keyboard does not open the selection card.
- Short figure titles or axis labels detected as paragraphs are also replaced, and a few may show "…".
- Chinese appearing batch by batch during a running translation, two-column papers, coloured backgrounds, and rotated pages were not checked in a real browser.
- Not verified on Safari, Firefox, or real mobile devices.
