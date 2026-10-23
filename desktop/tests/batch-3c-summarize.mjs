import {readFile,readdir,writeFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(process.argv[2]);
const json=async path=>JSON.parse(await readFile(join(root,path),'utf8'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function writing(stage){
  const directories=(await readdir(join(root,stage),{withFileTypes:true})).filter(entry=>entry.isDirectory()&&entry.name.startsWith('writing-experience-'));
  assert.equal(directories.length,1,'writing output must be unambiguous');
  const folder=join(stage,directories[0].name);
  const summary=await json(join(folder,'writing-experience-ui.json'));
  const files=await readdir(join(root,folder,'checks'));
  const checks=[];
  for(const name of files.filter(file=>file.endsWith('.json')))checks.push({...await json(join(folder,'checks',name)),evidence:join(folder,'checks',name)});
  return {summary,checks};
}
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
const checkpoint=await json('checkpoint/checkpoint.json');
assert.equal(head,checkpoint.head,'HEAD changed after checkpoint');
const productFiles=['desktop/main.mjs','desktop/session.mjs','desktop/renderer/main.js','desktop/renderer/surface.js','desktop/renderer/selection-menu.js'];
const productHashes=Object.fromEntries(await Promise.all(productFiles.map(async file=>[file,digest(await readFile(file))])));
const c0save=await json('save/controlled-summary.json'),c0=await json('c0/controlled-summary.json');
const c0Rows=[...c0save.results.map(row=>({...row,evidence:'save/controlled-'+row.name+'.json'})),...c0.results.map(row=>({...row,evidence:'c0/controlled-'+row.name+'.json'}))];
assert.equal(c0Rows.length,14);assert.equal(new Set(c0Rows.map(row=>row.name)).size,14);
const saves=[];
for(const id of ['top-light','h3-continue-reopen']) {
  const file='save/controlled-'+id+'-save-outcome.json',evidence=await json(file);
  const actual=Buffer.from(evidence.disk.actual.base64,'base64'),expected=Buffer.from(evidence.disk.expected.base64,'base64');
  assert.ok(actual.equals(expected),'independent save byte comparison failed');
  assert.equal(digest(actual),evidence.disk.actual.sha256);
  saves.push({id,file,elapsedSinceActionMs:evidence.elapsedSinceActionMs,bytes:actual.length,sha256:digest(actual),
    initialMtimeMs:evidence.disk.initialMtimeMs,actualMtimeMs:evidence.disk.actualMtimeMs,
    savedState:evidence.savedState,correlation:evidence.correlation,
    ipc:evidence.traceEvents.filter(event=>event.event==='ipc-document'),
    compositionEvents:evidence.privateEvents.filter(event=>/composition/.test(event.event)),
  });
}
const first=await writing('controlled-writing/writing');
const follow=await writing('after-mode-fix/writing-followup');
const long=await writing('after-mode-fix/long-followup');
const tasks=new Map(first.checks.map(row=>[row.id,row]));
for(const row of [...follow.checks,...long.checks])tasks.set(row.id,row);
const all=[...tasks.values()];
const groupPass=prefixes=>all.filter(row=>prefixes.some(prefix=>row.id.startsWith(prefix))).every(row=>row.status==='passed')?'PASS':'BLOCKED';
const efficiency=await json('after-mode-fix/efficiency/writing-efficiency-ui.json');
const context=await json('after-mode-fix/context/writing-context-ui.json');
const mode=await json('after-mode-fix/mode-regression/controlled-summary.json');
const composition=await json('regression/composition/input-composition-gate-ui.json');
const core=await json('regression/core/result.json');
const coreText=await readFile(join(root,'regression/core/stdout.txt'),'utf8');
const coreCount=coreText.match(/(?:#|ℹ) tests (\d+)/)?.[1] || 'see raw output';
const formalScripts=['batch-3c-run.mjs','batch-3c-summarize.mjs','batch-3c-final-gate.mjs','capture-controlled-ui.mjs',
  'evidence-capture.mjs','floating-heading-menu-ui.mjs','hidden-launch.mjs','hidden-main.cjs','hidden-window-check.mjs',
  'save-diagnostics.cjs','writing-experience-ui.mjs','writing-efficiency-ui.mjs','writing-context-ui.mjs'].map(name=>'desktop/tests/'+name);
const ledger={schema:1,generatedAt:new Date().toISOString(),head,checkpoint:'checkpoint/checkpoint.json',productHashes,
  environment:{node:process.version,
    electron:JSON.parse(await readFile('node_modules/electron/package.json','utf8')).version,
    playwright:JSON.parse(await readFile('node_modules/@playwright/test/package.json','utf8')).version,
    browserPlugin:'Browser plugin not available; repository Playwright/Electron workflow used.'},
  saveHistory:{status:'INCONCLUSIVE',classification:'D',controlledRound:1,secondDiagnosticRound:false,
    reason:'Original save exception is unavailable; one fixed-order, single-concurrency controlled round did not reproduce it. Later H3 execution is a mode-fix regression, not a second save diagnostic.'},
  saves,c0Functional:{status:c0Rows.every(row=>row.status==='PASS')?'PASS':'BLOCKED',rows:c0Rows,
    scope:'2 save cases + 12 remaining cases in sequential controlled invocations; not an integrated visual 14/14 GREEN. All run at frozen product source before the Ctrl+E fix; H3/mode regression checks the changed path afterwards.'},
  visual:{status:'VISUAL_UNVERIFIED',rows:c0Rows.map(row=>({name:row.name,status:'VISUAL_UNVERIFIED'})),
    evidence:'capture/capture-controlled-ui.json',reason:'One bounded CDP capture attempt timed out; legacy ROI helper is not accepted.'},
  functionalPhases:{'3C.1':groupPass(['A-','B-','E-']),'3C.2':efficiency.status,'3C.3':groupPass(['C-','D-'])==='PASS'&&context.status==='PASS'?'PASS':'BLOCKED'},
  tasks:all.map(row=>({id:row.id,status:row.status==='passed'?'PASS':'BLOCKED',stage:row.stage,failure:row.failure,evidence:row.evidence,
    metrics:{coldFirstMs:row.metrics.coldFirstMs,warmMs:row.metrics.warmMs,stable:row.metrics.stable,edits:row.metrics.edits,pendingEdit:row.metrics.pendingEdit,
      documentCharacters:row.metrics.documentCharacters,clipboardStatus:row.metrics.clipboard?.status,unexpectedDialogs:row.metrics.unexpectedDialogs},
    actions:row.actions})),
  context,efficiency:{status:efficiency.status,records:efficiency.records},
  regression:{status:composition.passed&&core.exit.code===0&&mode.failures.length===0?'PASS':'BLOCKED',composition:composition.passedCount,core:coreCount,modeCases:mode.results.length},
  foregroundPerformance:'UNVERIFIED',humanAcceptance:'UNVERIFIED',formalScripts,finalCommit:null};
await writeFile(join(root,'evidence-ledger.json'),JSON.stringify(ledger,null,2),{flag:'wx'});
const oldMain=join(root,'checkpoint/wip/desktop/renderer/main.js');
const diff=spawnSync('git',['diff','--no-index','--',oldMain,resolve('desktop/renderer/main.js')],{encoding:'utf8',windowsHide:true});
assert.equal(diff.status,1,'expected exactly the new product patch since checkpoint');
const patch=diff.stdout.replace(/^diff --git .*$/m,'diff --git a/desktop/renderer/main.js b/desktop/renderer/main.js')
  .replace(/^--- .*$/m,'--- a/desktop/renderer/main.js').replace(/^\+\+\+ .*$/m,'+++ b/desktop/renderer/main.js');
await writeFile(join(root,'mode-toggle-only.patch'),patch,{flag:'wx'});
const rel=path=>relative(resolve('docs/reviews/batch-3c'),join(root,path)).replaceAll('\\','/');
const link=(label,path)=>`[${label}](${rel(path)})`;
const taskRows=ledger.tasks.map(row=>`| ${row.id} | ${row.status} | ${link('原始记录',row.evidence)} |`).join('\n');
const longRow=ledger.tasks.find(row=>row.id.startsWith('C-large-'));
const report=`# Batch 3C Recovery — 2026-10-19\n\n状态：**BLOCKED**。统一 Final Gate 的唯一结果见 ${link('final-gate.json','final-gate.json')}。不进入 Batch 4。\n\n`+
`## Actual HEAD / Working Tree\n\nHEAD：\`${head}\`，与冻结检查点一致。${link('检查点清单与642份范围内文件哈希','checkpoint/checkpoint.json')}；${link('原始工作树','checkpoint/status-before.txt')}；${link('原始tracked WIP','checkpoint/tracked-wip.patch')}。其他 Agent 的内容、包配置和实验文件保持；本轮产品修改只有模式切换 hunk，原保存诊断 WIP 保留。正式脚本纳入 Git 索引，尚无本批最终提交。\n\n`+
`## C0-SAVE 判定与证据\n\n历史 **INCONCLUSIVE / D**。只执行一轮固定顺序 top-light → H3 续写、并发1、独有文件/profile；5000ms 从动作结束起算，未补 Ctrl+S、未扩大超时或降低字节要求。独立解码 base64 后重新计算 SHA256 和比较 Buffer。\n\n`+
`| 场景 | 字节 / SHA256 | 动作后采证 | 证据 |\n| --- | --- | --- | --- |\n`+
 saves.map(row=>`| ${row.id} | ${row.bytes} / \`${row.sha256}\` | ${row.elapsedSinceActionMs}ms | ${link('全链路',row.file)} |`).join('\n')+
`\n\nRenderer 实际字段 dirty=false/saveFailed=false、DOM 已保存；IPC、Main/FileSession、独有 profile 和 launcher/Main 父子关系一致。基线冲突检查、临时写入、fsync、替换及 mtime 均在原始记录中。临时路径 rename 后 unlink 的 ENOENT 为既有清理分支，不能当作保存根因。UI“保存失败”由 save.catch 标记 saveError → report → Pane.saveFailed 触发，本轮未走到该异常路径。合成门另由9项事件模拟回归覆盖。\n\n`+
`原始异常仍缺失；不能倒推为测试问题。已确认触发上下文为顶部 H3 或浮动 H3 后续写并自动保存，未知具体环境触发条件。保留开关诊断脚本，下一次只在新异常出现时记录完整 message/code/syscall/path、Renderer/IPC/Main、文件哈希/mtime 和进程树；不再机械重复。\n\n`+
`## C0-CAPTURE 判定与证据\n\n**VISUAL_UNVERIFIED / 基础设施阻塞**。旧 hidden-capture.mjs 保留为未接受 WIP；正式路径不再按 ROI 差异签发 PASS。新 evidence-capture.mjs 永远把候选图与像素审查分开，功能模式只保存 DOM/原生隐藏状态侧车。${link('受控捕获探针','capture/capture-controlled-ui.json')} 首个 top-light 在5000ms内没有截图返回，立即停止，未执行后续主题/菜单捕获。无新有效PNG。\n\n`+
`已核查 [Electron离屏渲染](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) 和 [WebPreferences.offscreen](https://www.electronjs.org/docs/latest/api/structures/web-preferences)：offscreen 须在创建窗口时配置。现有 native hidden 窗口没有启用该路径，旧替换导出尝试失败；不能把它称作已验证方案。下一次需要专用离屏入口的 paint 帧、模式/菜单状态关联、浅深/顶部/浮动/窄窗原图审查及全过程 hidden/unfocused 记录，或独立测试显示环境。继续禁止 showInactive/抢前台入口。\n\n`+
`## 3C.0 Functional Matrix\n\n14项独立功能记录均PASS，由一次保存定向2项及剩余12项受控执行组成，非单次完整视觉 GREEN；菜单锚定逻辑未重新改写。模式修复后 H3续写/源文档切换回归再次通过。\n\n| 项目 | FUNCTIONAL | 原始记录 |\n| --- | --- | --- |\n`+
 c0Rows.map(row=>`| ${row.name} | ${row.status} | ${link('JSON',row.evidence)} |`).join('\n')+
`\n\n包含真实DOMRect/CodeMirror坐标、标题入口和aria状态、选区/光标、格式化范围、菜单生命周期、滚动/resize/zoom、精确Markdown与磁盘字节。几何值为CSS px，不能替代截图。\n\n`+
`## 3C.0 Visual Matrix\n\n| 项目 | VISUAL |\n| --- | --- |\n`+c0Rows.map(row=>`| ${row.name} | VISUAL_UNVERIFIED |`).join('\n')+
`\n\n历史已查看的局部图像只保留其原始有效范围；历史14/14、13/14、3张旧帧和窄窗拒绝均未抹去，也未拼接为全套视觉通过。\n\n`+
`## 3C.1 Results / 3C.2 Results / 3C.3 Results\n\n| 阶段 | 自动化功能 | 独立边界 |\n| --- | --- | --- |\n| 3C.1 | ${ledger.functionalPhases['3C.1']} | A/B/E闭环分别有通过记录；完整文章1815字符，合成DOM剪贴板已消费；真人理解、外部应用剪贴板UNVERIFIED |\n| 3C.2 | ${ledger.functionalPhases['3C.2']}，14/14 | 双主题各7组，格式/Undo/Redo/查找/模式切换各5轮，连续输入125字符；动作原始计数独立保存；真人效率与前台性能UNVERIFIED |\n| 3C.3 | ${ledger.functionalPhases['3C.3']} | 5k/200k、D中断及上下文3项通过；1M未完成；真实OS焦点、前台性能UNVERIFIED |\n\n`+
`| 写作项 | 最新独立功能结论 | 证据 |\n| --- | --- | --- |\n${taskRows}\n\n`+
`1M最后停止于 ${longRow.stage}：${longRow.failure?.message?.split('\n')[0]||'无失败'}。开头与中段修改精确匹配，中段两次测量分别为屏外和滚动后的屏内位置；尾部定位请求触发30秒自动化超时，不能确认该路径完成，更不能归因成纯基础设施或前台性能缺陷。已停止重跑。下一步需要定位请求前后的Renderer CPU/事件循环、CM viewport/measure/scroll目标和受控显示条件下的对照证据，不延长超时。冷/预热/稳定毫秒保留在各JSON，均为隐藏Renderer代理指标。\n\n`+
`## Confirmed Findings\n\n- **P2 / 已最小修复**：Ctrl+E在四帧滚动恢复期间被Pane.busy丢弃。模式切换移出文件命令锁，复用既有Pane.switching过期取消；未改保存、菜单锚定、编辑核心或文件模型。\n- **测试缺陷 / 已修正**：关闭后访问已释放的Playwright进程映射；同目录重开时提前删除profile；Markdown整串键入重复自动列表/引用前缀；可访问名称过期；选择屏外文字后期待浮条；草稿尾随防抖尚未完成就比较；未命名草稿恢复被错误要求旧文件名。独立期望正文、BOM/EOL及字节断言保留。\n- **P0/P1**：本轮没有确认正文损坏或错误覆盖；1M响应/完成性仍待定位，不能据此宣称所有长文功能正常。\n- **Known Issue**：外部2f92ca2的相邻行遮挡策略维持，选择文本无遮挡不代表相邻所有正文无遮挡。\n\n`+
`## Red/Green Evidence / Regression\n\nCtrl+E RED：${link('双主题10 PASS / 2 FAIL','controlled-efficiency/efficiency/writing-efficiency-ui.json')}；GREEN：${link('同路径14/14','after-mode-fix/efficiency/writing-efficiency-ui.json')}，包含快速切换和精确正文。H3模式/保存回归${mode.results.length}项、composition ${composition.passedCount}/9、源码/文件契约 ${coreCount}项，均以各原始退出码核对。${link('事件模拟回归','regression/composition/input-composition-gate-ui.json')}；${link('源码回归','regression/core/result.json')}；${link('上下文/冲突','after-mode-fix/context/writing-context-ui.json')}。\n\n`+
`首轮写作0/7、关闭清理卡住、中途短暂并发、Windows --import 路径错误、过早草稿比较及所有失败日志均保留。两个被中断的重叠写作运行不用于最终功能/性能结论；中断进程清单见 ${link('原始记录','concurrent-interruption.json')}。后续受控运行前检查无现有隔离Electron；结束再次记录进程。\n\n`+
`## Unverified / Remaining Blockers\n\n1. VISUAL：当前隐藏截图无可靠图像，测试基础设施阻塞；功能PASS不转成视觉PASS。\n2. 1M：尾部定位自动化超时，根因未决；3C.3功能路径未完成。\n3. 前台性能、微软拼音/物理选择、Alt+Tab、Win+V、Word/浏览器/微信剪贴板、人工可用性与设备验收：UNVERIFIED。\n4. C0-SAVE历史风险：INCONCLUSIVE，保留按新异常触发的监测；无重复诊断第二轮。\n\n`+
`## Final Commit / Rollback\n\nFinal Commit：**无**。HEAD不是Batch 3C交付基线，正式脚本和产品修复仅暂存供审阅。\n\n${link('仅本轮模式修复patch','mode-toggle-only.patch')} 以冻结WIP为旧版本生成；反向 --check 验证可回退，未实际回退。只反向应用此hunk并重建，不整文件覆盖main.js，不revert外部2f92ca2，也不触碰M1racle Novel/mig/既有WIP。原一次性WIP已有冻结副本，旧helper与probe不当作已签发正式方案。统一Gate只执行一次，JSON用wx防覆盖；未满足所有必需条件时保持BLOCKED。\n`;
await writeFile(resolve('docs/reviews/batch-3c/RECOVERY-REPORT.md'),report,{flag:'wx'});
console.log(JSON.stringify({head,phases:ledger.functionalPhases,c0:ledger.c0Functional.status,regression:ledger.regression.status,report:'docs/reviews/batch-3c/RECOVERY-REPORT.md'}));
