const toolbar = document.getElementById('format');
const editorWorkspace = document.getElementById('editor-workspace');
const more = document.getElementById('format-more');
const moreItems = more?.querySelector('.menu-items');
const writingMenu = document.getElementById('writing-menu');
const writingItems = writingMenu?.querySelector('.menu-items');
const writingButtons = writingMenu
  ? [...writingMenu.querySelectorAll('button')]
  : [];

if (toolbar && editorWorkspace && more && moreItems && writingMenu && writingItems) {
  const formatItems = new Map(
    ['bold', 'italic', 'quote', 'list', 'task', 'link', 'image', 'fence']
      .map(id => [id, toolbar.querySelector(`[data-format="${id}"]`)]),
  );
  const commandItems = new Map(
    ['undo', 'redo', 'find'].map(id => [id, document.getElementById(id)]),
  );
  const writingItemsToMove = [
    ['outline-toggle', document.getElementById('outline-toggle')],
    ['focus-toggle', document.getElementById('focus-toggle')],
    ['commands-open', document.getElementById('commands-open')],
  ];
  const markers = new Map();

  const markerFor = key => {
    if (!markers.has(key)) markers.set(key, document.createComment(`format-responsive:${key}`));
    return markers.get(key);
  };
  const moveToMore = key => {
    const node = formatItems.get(key) || writingItemsToMove.find(([id]) => id === key)?.[1];
    if (!node || node.parentElement === moreItems) return;
    if (!node.previousSibling?.isSameNode?.(markerFor(key))) {
      node.parentElement.insertBefore(markerFor(key), node);
    }
    moreItems.append(node);
  };
  const restore = key => {
    const node = formatItems.get(key)
      || writingItemsToMove.find(([id]) => id === key)?.[1];
    const marker = markers.get(key);
    if (!node || !marker?.parentNode || node.parentElement === marker.parentNode) return;
    marker.parentNode.insertBefore(node, marker.nextSibling);
  };
  const icon = (id, glyph, label, shortcut) => {
    const button = commandItems.get(id);
    if (!button) return;
    if (!button.dataset.responsiveLabel) {
      button.dataset.responsiveLabel = button.textContent.trim();
      button.dataset.responsiveTitle = button.title;
    }
    button.textContent = glyph;
    button.setAttribute('aria-label', label);
    button.title = `${label} · ${shortcut}`;
    button.dataset.responsiveIcon = 'true';
  };
  const restoreIcon = id => {
    const button = commandItems.get(id);
    if (!button?.dataset.responsiveLabel) return;
    button.textContent = button.dataset.responsiveLabel;
    button.title = button.dataset.responsiveTitle;
    delete button.dataset.responsiveLabel;
    delete button.dataset.responsiveTitle;
    delete button.dataset.responsiveIcon;
  };
  const reset = () => {
    for (const key of formatItems.keys()) {
      restore(key);
    }
    for (const [key] of writingItemsToMove) restore(key);
    writingMenu.hidden = writingButtons.some(button => button.parentElement !== writingItems);
    for (const id of commandItems.keys()) restoreIcon(id);
    toolbar.dataset.compact = 'false';
    toolbar.dataset.level = '0';
  };
  const compact = () => {
    for (const key of ['task', 'link', 'image', 'fence']) moveToMore(key);
    more.hidden = false;
    icon('undo', '↶', '撤销', 'Ctrl+Z');
    icon('redo', '↷', '重做', 'Ctrl+Shift+Z');
    icon('find', '⌕', '查找', 'Ctrl+F');
    toolbar.dataset.compact = 'true';
  };
  const middle = () => {
    compact();
    for (const key of ['quote', 'list', ...writingItemsToMove.map(([id]) => id)]) moveToMore(key);
    writingMenu.hidden = writingButtons.every(button => button.parentElement === moreItems);
    toolbar.dataset.level = '2';
  };
  const narrow = () => {
    middle();
    for (const key of ['bold', 'italic']) moveToMore(key);
    toolbar.dataset.level = '3';
  };
  const apply = () => {
    reset();
    const width = editorWorkspace.clientWidth;
    if (width < 460) {
      middle();
      if (width < 360 || toolbar.scrollWidth > toolbar.clientWidth) narrow();
    } else if (width < 640 || toolbar.scrollWidth > toolbar.clientWidth) {
      compact();
      if (toolbar.scrollWidth > toolbar.clientWidth) {
        middle();
        if (toolbar.scrollWidth > toolbar.clientWidth) narrow();
      }
    }
  };

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      apply();
    });
  };
  new ResizeObserver(schedule).observe(editorWorkspace);
  window.addEventListener('resize', schedule, {passive:true});
  const sidebar = document.getElementById('document-sidebar');
  if (sidebar) new MutationObserver(schedule).observe(sidebar, {attributes:true,attributeFilter:['hidden','style','data-animating']});
  apply();
}
