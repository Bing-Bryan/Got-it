# 2026-10-17：Markdown 与 PDF 全文译中

本地 Markdown（含公开样例）现在可以像网页一样主动全文译中：同一个语言图标开启授权，分批翻译、显示进度、可停止和续译，完成后在原文与中文之间切换。原文件不改动，译文旁路保存在阅读记录中；原文变化后旧译文不再使用并给出提示。

PDF 提供按页「原页 / 中文稿」。每页默认显示原页，可单独切到中文稿；中文稿按阅读顺序（双栏先左后右）显示段落译文，未译段落以原文显示并标注「未译」。只发送有文字层页面的正文段落：图例、表格行、坐标标签留在原页，正文网址原样保留不外发，没有文字层的页面提示「此页为图片，暂不能全文翻译，可框选后提问」，中文 PDF 不发送。读取 PDF 文字层在本机完成，不调用模型。中文稿内选字可用「解释一下 / 查找来源 / 问一问」，只发送所选中文与该段英文原文。本地版与体验版行为一致。

验证：自动测试覆盖段落重建（含双栏）、翻译单元从已保存原文重建、过期版本与伪造单元拒绝、停止与失败后的续译标识、保存与恢复。真实翻译验收在隔离数据中完成：本地版完整翻译一篇 32 页英文论文 PDF，体验版翻译一篇 Markdown 样例，并验证刷新后不发起翻译请求、备份恢复后译文一致。本次公开同步本身没有新增模型调用。

已知限制：Markdown 页面目前会把保存状态显示两次（体验版欢迎页的同一提示也会重复），属于待修复的界面问题，不影响保存；PDF 段落由文字层推断，公式密集处可能拆段，页面上下边缘的短正文行可能被略去，较长且以首字母大写为主的标题可能被当作非正文略去；中文稿内暂不支持收藏；体验版每批计一次每日次数，长 PDF 一天内可能译不完。未在 Safari、Firefox 或真机上验证。

## Full-text translation for Markdown and PDF

Local Markdown files, including the public samples, can now be translated on request like web pages: the same language icon asks for permission, then translates in batches with progress, stop, and continuation, and switches between Original and Chinese when done. Source files are never changed; translations are stored alongside the reading record, and a changed original no longer reuses the old translation and explains why.

PDFs get a per-page **Original / Chinese draft** switch. Each page opens as the original and can be switched on its own. The draft shows paragraphs in reading order (left column before right), with untranslated paragraphs shown in the original language and tagged. Only body paragraphs from pages with a text layer are sent: legends, table rows, and axis labels stay on the original page; web addresses are kept verbatim and not sent; image-only pages say they cannot be translated yet and can still be region-selected; Chinese PDFs are not sent. Reading the text layer is local and calls no model. Selecting text in a draft offers Explain / Find sources / Ask and sends only the selected Chinese and that paragraph's English original. Local and hosted modes behave the same.

Verification: automated tests cover paragraph reconstruction (including two columns), rebuilding translation units from the saved original, rejecting stale versions and forged units, operation identity after stop or failure, and persistence. Real translation acceptance used isolated data: a full 32-page English paper PDF in local mode and a Markdown sample in hosted mode, with no translation requests after refresh and identical translations after backup restore. This public sync added no model calls.

Known limitations: Markdown pages currently show the save status twice (the hosted welcome page also repeats one hint); this is a pending UI fix and does not affect saving. PDF paragraphs are inferred from the text layer, so formula-heavy passages may split, short body lines near page edges may be dropped, and long title-case headings may be treated as non-body text. Bookmarking inside a Chinese draft is not supported yet. In hosted mode each batch counts toward the daily allowance, so a long PDF may not finish in one day. Not verified on Safari, Firefox, or real mobile devices.
