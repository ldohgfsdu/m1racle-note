export function associationText(extension, state) {
  if (!state || state.available !== true) return '.' + extension + ' · 未检查';
  const value = state[extension];
  const label = value === true ? '已设置' : value == null ? '未确认' : '待设置';
  return '.' + extension + ' · ' + label;
}

export function defaultsComplete(state) {
  return Boolean(state && state.available === true && state.md === true && state.markdown === true);
}

function productError(kind, raw) {
  const text = String(raw || '').replace(/^Error:\s*/, '').trim();
  if (text && /[\u4e00-\u9fff]/.test(text) && text.length <= 80 && !text.includes('\n')) return text;
  return kind === 'open' ? '没能打开这篇笔记。文件还在原处，可以再试一次。' : '没能新建笔记。可以再试一次。';
}

export function createDefaultOnboarding(bridge, actions = {}) {
  const modal = document.getElementById('onboarding');
  const openNote = document.getElementById('onboarding-open');
  const newNote = document.getElementById('onboarding-new');
  const primary = document.getElementById('onboarding-primary');
  const skip = document.getElementById('onboarding-skip');
  const description = document.getElementById('onboarding-description');
  const message = document.getElementById('onboarding-message');
  let awaitingSettings = false, checking = false, closing = false, noteInFlight = false, settingsInFlight = false, complete = false, lastState = null, previousFocus = null, editorComposing = false, deferredOpen = null;

  function say(text, isError) {
    message.textContent = text;
    if (isError) message.dataset.error = 'true';
    else delete message.dataset.error;
    message.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  }
  function setBusy() {
    const value = checking || closing || noteInFlight || settingsInFlight;
    for (const node of [openNote, newNote, skip, primary]) if (node) node.disabled = value;
    if (!value && lastState && lastState.available === false && !complete) primary.disabled = true;
  }
  function showState(state) {
    complete = defaultsComplete(state);
    for (const extension of ['md', 'markdown']) {
      const node = document.getElementById('association-' + extension);
      if (node) node.textContent = associationText(extension, state);
    }
    primary.textContent = complete ? '开始使用' : awaitingSettings ? '再检查一次' : '前往设置';
    if (skip) skip.hidden = false;
    if (description) description.textContent = '笔记就是你电脑里的 Markdown 文件。M1racle Note 在原处打开和保存，不会移动、复制或收进别的库。';
    const detail = state.available !== true
      ? '此预览版暂不检查系统默认应用。你可以直接打开或新建笔记。'
      : complete
        ? '.md 和 .markdown 都会用 M1racle Note 打开。'
        : state.md == null || state.markdown == null
          ? '暂时无法确认是否已设为默认。你仍可前往设置，或直接开始写笔记。'
          : awaitingSettings
            ? '请在 Windows 设置中为 .md 和 .markdown 选择 M1racle Note，然后回到这里。'
            : state.md === true || state.markdown === true
              ? '还有一种格式没有设为默认。两种都可以稍后再设。'
              : '默认打开方式可以稍后再设。不设置也能写笔记。';
    say(detail, false);
  }
  function invalidateQuery() {
    complete = false;
    const dismissed = lastState?.dismissed === true;
    lastState = {available: true, dismissed, md: null, markdown: null};
    for (const extension of ['md', 'markdown']) {
      const node = document.getElementById('association-' + extension);
      if (node) node.textContent = '.' + extension + ' · 未确认';
    }
    if (primary) {
      primary.textContent = awaitingSettings ? '再检查一次' : '前往设置';
    }
    say('暂时无法确认默认应用。你可以先开始使用，稍后再检查。', true);
  }
  async function refresh() {
    if (checking) return lastState;
    checking = true;
    setBusy();
    try {
      const state = await bridge.request('onboarding-state');
      if (!state || typeof state !== 'object') throw new Error('暂时无法确认默认应用。');
      lastState = state;
      showState(state);
      return state;
    } catch {
      invalidateQuery();
      return null;
    } finally {
      checking = false;
      setBusy();
    }
  }
  function focusEditor() {
    if (editorComposing) return;
    if (typeof actions.focusEditor === 'function') actions.focusEditor();
  }
  function restoreFocus() {
    const target = previousFocus && previousFocus.isConnected !== false ? previousFocus : null;
    previousFocus = null;
    if (editorComposing) return;
    target?.focus?.({preventScroll: true});
  }
  async function dismissAndClose(toEditor) {
    if (closing || noteInFlight || settingsInFlight) return false;
    closing = true;
    setBusy();
    try {
      await bridge.request('onboarding-dismiss');
      awaitingSettings = false;
      modal.close();
      if (toEditor) focusEditor();
      else restoreFocus();
      return true;
    } catch {
      say('未能保存这次选择，请重试。', true);
      return false;
    } finally {
      closing = false;
      setBusy();
    }
  }
  function present() {
    if (!modal.open) previousFocus = document.activeElement;
    if (!modal.open) modal.showModal();
    (openNote || primary).focus();
  }
  async function open(first = false) {
    if (editorComposing) { deferredOpen = first; return; }
    const state = await refresh();
    if (first && state?.available === false) return;
    if (first && state?.dismissed) return;
    present();
  }
  async function invokeCommand(kind) {
    const action = kind === 'open' ? actions.openExisting : actions.createNote;
    if (typeof action !== 'function') throw new Error(kind === 'open' ? '现在不能打开笔记。' : '现在不能新建笔记。');
    return action();
  }
  async function runNote(kind) {
    if (editorComposing) { say('输入法还在输入，请先完成当前文字。', true); return; }
    if (noteInFlight || closing || settingsInFlight || checking) return;
    noteInFlight = true;
    setBusy();
    let succeeded = false;
    try {
      const result = await invokeCommand(kind);
      if (!result || result.ok !== true) {
        say(result?.error || (kind === 'open' ? '还没有打开笔记。' : '还没有新建笔记。'), Boolean(result?.error));
        return;
      }
      succeeded = true;
    } catch (error) {
      say(productError(kind, error?.message || error), true);
      return;
    } finally {
      noteInFlight = false;
      setBusy();
    }
    if (succeeded) await dismissAndClose(true);
  }
  openNote.onclick = () => runNote('open');
  newNote.onclick = () => runNote('new');
  skip.onclick = () => dismissAndClose(false);
  primary.onclick = async () => {
    if (noteInFlight || closing || settingsInFlight || checking) return;
    if (complete) { await dismissAndClose(false); return; }
    if (awaitingSettings) { await refresh(); return; }
    if (lastState && lastState.available === false) { say('此预览版暂不支持系统默认打开设置。', true); return; }
    settingsInFlight = true;
    setBusy();
    try {
      const result = await bridge.request('default-app');
      awaitingSettings = true;
      primary.textContent = '再检查一次';
      say(result?.targeted
        ? '请在 Windows 设置中为 .md 和 .markdown 选择 M1racle Note，然后回到这里。'
        : '请在 Windows 默认应用设置中搜索 .md，选择 M1racle Note。.markdown 也可以同样设置。', false);
    } catch {
      say('未能打开 Windows 设置。可在系统“设置 → 应用 → 默认应用”中搜索 .md，选择 M1racle Note。', true);
    } finally {
      settingsInFlight = false;
      setBusy();
    }
  };
  modal.addEventListener('cancel', event => {
    event.preventDefault();
    if (noteInFlight || closing || settingsInFlight) return;
    dismissAndClose(false);
  });
  window.addEventListener('focus', () => { if (awaitingSettings && modal.open) refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && awaitingSettings && modal.open) refresh(); });
  document.addEventListener('compositionstart', event => { if (event.target?.closest?.('.cm-content')) editorComposing = true; }, true);
  document.addEventListener('compositionend', event => {
    if (!event.target?.closest?.('.cm-content')) return;
    editorComposing = false;
    if (deferredOpen !== null) { const first = deferredOpen; deferredOpen = null; open(first); }
  }, true);
  return {init: () => open(true), open: () => open(false)};
}
