import { mkdir, writeFile, copyFile } from 'node:fs/promises';
await mkdir('editor-corpus', { recursive: true });
const samples = [
 ['001-plain','Plain text.\n\nAnother paragraph.\n'],
 ['002-chinese','中文输入，候选替换。全角标点！\n'],
 ['003-heading','# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6\n'],
 ['004-bold-italic','**bold** *italic* ~~strike~~ __other__\n'],
 ['005-lists','- first\n  - nested\n\n1. one\n2. two\n'],
 ['006-task-list','- [ ] 待完成\n- [x] 已完成\n'],
 ['007-links','[Example](https://example.com "Title")\n\n<https://example.com>\n'],
 ['008-image','![fallback image](missing-local-image.png)\n'],
 ['009-blockquote','> quote\n>\n> **nested**\n'],
 ['010-code','Inline `code`.\n\n~~~js\nconst value = 1;\n~~~\n'],
 ['011-table','| A | B |\n| --- | --- |\n| 中文 | **bold** |\n'],
 ['012-frontmatter','---\nstatus: active\ntags: [editor]\n---\n\n# Note\n'],
 ['013-html-comment','Before\n\n<!-- private comment -->\n\nAfter\n'],
 ['014-mixed-cn-en','M1racle 编辑器 v0.0：CodeMirror 6 + Android。\n'],
 ['015-emoji','🌱 👨‍👩‍👧‍👦 👍🏽 🇨🇳 é\n'],
 ['019-weird-spacing','\uFEFF#  Title\r\n\r\n*   item  \n\tindent\r<!-- keep -->\r\nno final newline'],
];
for (const [name, value] of samples) await writeFile(`editor-corpus/${name}.md`, value);
for (const [n, size] of [['016-large-10k',10000],['017-large-50k',50000],['018-large-100k',100000],['021-large-500k',500000],['022-large-1m',1000000]]) {
 const line = '# 思考与记录\n\n中文 English **bold**。\n\n- [ ] 一个任务\n\n';
 await writeFile(`editor-corpus/${n}.md`, line.repeat(Math.ceil(size/line.length)).slice(0,size));
}
// The supplied Note brief is real, but is not the requested Reader task book.
await copyFile('docs/product-brief.md', 'editor-corpus/023-real-note-brief.md');
await mkdir('mobile/app/src/main/assets', { recursive: true });
await writeFile('mobile/app/src/main/assets/welcome.md', '# 留一点空间，给思考。\n\n像普通笔记一样写，文件仍然是你的 Markdown。\n\n## 从这里开始\n\n点击这段文字，直接开始编辑。试试 **粗体**、*斜体* 和 `代码`，离开当前行后，标记会轻轻收起。\n\n- [ ] 写下一个想法\n- [x] 保留对文件的掌控\n\n> 不急着整理所有知识，先把一个想法写清楚。\n\n---\n\n这是 M1racle Note 的第一块地基。\n');
