import {test} from 'node:test';
import assert from 'node:assert/strict';
import {associationText, defaultsComplete, createDefaultOnboarding} from '../renderer/onboarding.js';

test('association text only says complete when the query explicitly succeeded', () => {
  assert.equal(associationText('md', null), '.md · 未检查');
  assert.equal(associationText('md', {available: false, md: true}), '.md · 未检查');
  assert.equal(associationText('md', {available: true, md: true}), '.md · 已设置');
  assert.equal(associationText('markdown', {available: true, markdown: null}), '.markdown · 未确认');
  assert.equal(associationText('markdown', {available: true, markdown: false}), '.markdown · 待设置');
  assert.equal(defaultsComplete({available: true, md: true, markdown: true}), true);
  assert.equal(defaultsComplete({available: true, md: true, markdown: false}), false);
  assert.equal(defaultsComplete({available: false, md: true, markdown: true}), false);
});

function createHarness() {
  const nodeListeners = new Map();
  function listen(map, type, fn) {
    const list = map.get(type) || [];
    list.push(fn);
    map.set(type, list);
  }
  function make(id) {
    const local = new Map();
    const node = {
      id,
      disabled: false,
      hidden: false,
      textContent: '',
      title: '',
      dataset: {},
      isConnected: true,
      open: false,
      onclick: null,
      focusCount: 0,
      setAttribute() {},
      addEventListener(type, fn) { listen(local, type, fn); },
      dispatch(type, event = {}) {
        const ev = {...event, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }};
        for (const fn of local.get(type) || []) fn(ev);
        return ev;
      },
      showModal() { node.open = true; },
      close() { node.open = false; },
      focus() { node.focusCount += 1; document.activeElement = node; },
    };
    nodeListeners.set(id, node);
    return node;
  }
  for (const id of ['onboarding', 'onboarding-open', 'onboarding-new', 'onboarding-primary', 'onboarding-skip', 'onboarding-description', 'onboarding-message', 'association-md', 'association-markdown', 'filename', 'status', 'error', 'error-message', 'open', 'new']) make(id);
  const queries = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    activeElement: null,
    hidden: false,
    getElementById: id => nodeListeners.get(id) || null,
    querySelector(selector) { queries.push(selector); return null; },
    addEventListener(type, fn) { listen(documentListeners, type, fn); },
    emit(type, event = {}) { for (const fn of documentListeners.get(type) || []) fn(event); },
  };
  const window = {
    addEventListener(type, fn) { listen(windowListeners, type, fn); },
    emit(type, event = {}) { for (const fn of windowListeners.get(type) || []) fn(event); },
  };
  globalThis.document = document;
  globalThis.window = window;
  return {document, window, nodes: nodeListeners, queries};
}

function boot(actions = {}) {
  const harness = createHarness();
  const box = {state: {available: true, dismissed: false, md: false, markdown: false}, fail: false, dismiss: null, settings: null};
  const calls = [];
  const bridge = {
    request(type) {
      calls.push(type);
      if (type === 'onboarding-state') {
        if (box.fail) return Promise.reject(new Error('query failed'));
        return Promise.resolve(box.state);
      }
      if (type === 'onboarding-dismiss') {
        calls.dismiss = (calls.dismiss || 0) + 1;
        return box.dismiss ? box.dismiss() : Promise.resolve(true);
      }
      if (type === 'default-app') return box.settings ? box.settings() : Promise.resolve({targeted: true});
      return Promise.reject(new Error('unexpected ' + type));
    },
  };
  const api = createDefaultOnboarding(bridge, actions);
  const nodes = harness.nodes;
  return {...harness, api, calls, box, nodes};
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

test('returning from settings keeps note and dismissal operations exclusive', async () => {
  let releaseNote, releaseDismiss;
  const flow=boot({openExisting:()=>new Promise(resolve=>{releaseNote=resolve;})});
  await flow.api.open();
  await flow.nodes.get('onboarding-primary').onclick();
  const pending=flow.nodes.get('onboarding-open').onclick();
  flow.window.emit('focus');
  await flush();
  for(const id of ['onboarding-open','onboarding-new','onboarding-primary','onboarding-skip']) assert.equal(flow.nodes.get(id).disabled,true,id+' must remain busy');
  const settingsCalls=flow.calls.filter(x=>x==='default-app').length;
  await flow.nodes.get('onboarding-primary').onclick();
  assert.equal(flow.calls.filter(x=>x==='default-app').length,settingsCalls);
  flow.box.dismiss=()=>new Promise(resolve=>{releaseDismiss=resolve;});
  releaseNote({ok:true});
  await flush();
  flow.window.emit('focus');
  await flush();
  for(const id of ['onboarding-open','onboarding-new','onboarding-primary','onboarding-skip']) assert.equal(flow.nodes.get(id).disabled,true,id+' must remain busy during dismissal');
  releaseDismiss(true);
  await pending;
  assert.equal(flow.nodes.get('onboarding').open,false);
});

test('settings launch cannot overlap note creation or dismissal', async()=>{
  let releaseSettings;
  let newCalls=0;
  const flow=boot({createNote:async()=>{newCalls++;return {ok:true};}});
  await flow.api.open();
  flow.box.settings=()=>new Promise(resolve=>{releaseSettings=resolve;});
  const pending=flow.nodes.get('onboarding-primary').onclick();
  await flow.nodes.get('onboarding-new').onclick();
  await flow.nodes.get('onboarding-skip').onclick();
  flow.nodes.get('onboarding').dispatch('cancel');
  assert.equal(newCalls,0);
  assert.equal(flow.calls.dismiss||0,0);
  assert.equal(flow.nodes.get('onboarding').open,true);
  releaseSettings({targeted:true});
  await pending;
  assert.equal(flow.nodes.get('onboarding-new').disabled,false);
});

test('first-use onboarding follows the callback contract', async () => {
  const editor = {closest: selector => selector === '.cm-content' ? editor : null};

  const source = boot();
  source.box.state = {available: false, dismissed: false, md: false, markdown: false};
  await source.api.init();
  assert.equal(source.nodes.get('onboarding').open, false);
  await source.api.open();
  assert.equal(source.nodes.get('onboarding').open, true);
  assert.match(source.nodes.get('onboarding-message').textContent, /预览版/);
  assert.equal(source.nodes.get('onboarding-primary').disabled, true);
  assert.equal(source.nodes.get('onboarding-open').disabled, false);
  assert.equal(source.nodes.get('onboarding-new').disabled, false);

  const fresh = boot();
  await fresh.api.init();
  assert.equal(fresh.nodes.get('onboarding').open, true);
  assert.equal(fresh.nodes.get('onboarding-primary').disabled, false);
  assert.equal(fresh.nodes.get('onboarding-primary').textContent, '前往设置');
  assert.equal(fresh.nodes.get('onboarding-open').focusCount, 1);

  const dismissed = boot();
  dismissed.box.state = {available: true, dismissed: true, md: false, markdown: false};
  await dismissed.api.init();
  assert.equal(dismissed.nodes.get('onboarding').open, false);

  const failedInit = boot();
  failedInit.box.fail = true;
  await failedInit.api.init();
  assert.equal(failedInit.nodes.get('onboarding').open, true);
  assert.equal(failedInit.nodes.get('association-md').textContent, '.md · 未确认');
  assert.equal(failedInit.nodes.get('association-markdown').textContent, '.markdown · 未确认');
  assert.equal(failedInit.nodes.get('onboarding-message').dataset.error, 'true');
  assert.notEqual(failedInit.nodes.get('onboarding-primary').textContent, '开始使用');

  let focused = 0;
  const flow = boot({
    openExisting: async () => ({ok: false, cancelled: true}),
    createNote: async () => ({ok: false, error: '没能新建笔记，请重试。'}),
    focusEditor() { focused += 1; },
  });
  await flow.api.open(false);
  await flow.nodes.get('onboarding-primary').onclick();
  flow.box.state = {available: true, dismissed: false, md: true, markdown: true};
  flow.window.emit('focus');
  await flush();
  assert.equal(flow.nodes.get('association-md').textContent, '.md · 已设置');
  assert.equal(flow.nodes.get('onboarding-primary').textContent, '开始使用');
  flow.box.fail = true;
  flow.window.emit('focus');
  await flush();
  assert.equal(flow.nodes.get('association-md').textContent, '.md · 未确认');
  assert.equal(flow.nodes.get('association-markdown').textContent, '.markdown · 未确认');
  assert.notEqual(flow.nodes.get('onboarding-primary').textContent, '开始使用');
  assert.equal(flow.nodes.get('onboarding-message').dataset.error, 'true');
  assert.equal(flow.nodes.get('onboarding').open, true);
  await flow.nodes.get('onboarding-primary').onclick();
  assert.equal(flow.calls.dismiss || 0, 0);
  assert.equal(flow.nodes.get('onboarding').open, true);

  flow.nodes.get('filename').title = '旧标题';
  await flow.nodes.get('onboarding-open').onclick();
  assert.equal(flow.nodes.get('onboarding').open, true);
  assert.equal(flow.calls.dismiss || 0, 0);
  assert.match(flow.nodes.get('onboarding-message').textContent, /还没有打开笔记/);
  await flow.nodes.get('onboarding-new').onclick();
  assert.equal(flow.nodes.get('onboarding').open, true);
  assert.equal(flow.nodes.get('onboarding-message').dataset.error, 'true');
  assert.equal(focused, 0);
  assert.deepEqual(flow.queries, []);

  const missing = boot();
  let decoy = 0;
  missing.nodes.get('open').onclick = () => { decoy += 1; };
  await missing.api.open(false);
  await missing.nodes.get('onboarding-open').onclick();
  assert.equal(decoy, 0);
  assert.equal(missing.nodes.get('onboarding').open, true);
  assert.match(missing.nodes.get('onboarding-message').textContent, /现在不能打开笔记/);
  assert.equal(missing.calls.dismiss || 0, 0);

  let release;
  let focusedOk = 0;
  const inflight = boot({
    openExisting: () => new Promise(resolve => { release = resolve; }),
    focusEditor() { focusedOk += 1; },
  });
  await inflight.api.open(false);
  const pending = inflight.nodes.get('onboarding-open').onclick();
  inflight.nodes.get('onboarding').dispatch('cancel');
  assert.equal(inflight.nodes.get('onboarding').open, true);
  assert.equal(inflight.calls.dismiss || 0, 0);
  release({ok: true});
  await pending;
  assert.equal(inflight.nodes.get('onboarding').open, false);
  assert.equal(focusedOk, 1);
  assert.deepEqual(inflight.queries, []);

  let releaseDismiss;
  let focusedDismiss = 0;
  const writing = boot({
    createNote: async () => ({ok: true}),
    focusEditor() { focusedDismiss += 1; },
  });
  writing.box.dismiss = () => new Promise(resolve => { releaseDismiss = resolve; });
  await writing.api.open(false);
  const closing = writing.nodes.get('onboarding-new').onclick();
  await flush();
  assert.equal(writing.calls.dismiss, 1);
  writing.nodes.get('onboarding').dispatch('cancel');
  assert.equal(writing.nodes.get('onboarding').open, true);
  assert.equal(writing.calls.dismiss, 1);
  releaseDismiss(true);
  await closing;
  assert.equal(writing.nodes.get('onboarding').open, false);
  assert.equal(focusedDismiss, 1);

  const typing = boot();
  typing.document.emit('compositionstart', {target: editor});
  await typing.api.init();
  assert.equal(typing.nodes.get('onboarding').open, false);
  typing.document.emit('compositionend', {target: editor});
  await flush();
  assert.equal(typing.nodes.get('onboarding').open, true);
});
