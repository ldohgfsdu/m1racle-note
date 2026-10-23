import {writeFile} from 'node:fs/promises';

const captureTimeoutMs = 30000;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const channelNoise = 12;
const minChangedPixels = 300;
const pixelLimitation = 'ROI delta only shows that a later presented frame changed the live menu rect. It does not identify menu glyphs or colors.';

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function metaPathFor(path) {
  return `${path}.meta.json`;
}

async function readTargets(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const regions = [];
    const suppressed = el => {
      for (let node = el; node; node = node.parentElement) {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true') return true;
        if (node.tagName === 'DETAILS' && !node.open) {
          const summary = node.querySelector('summary');
          if (!summary || !summary.contains(el)) return true;
        }
      }
      if (typeof el.checkVisibility !== 'function') return false;
      try {
        return el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        }) === false;
      } catch {
        return false;
      }
    };
    for (const el of document.querySelectorAll('#selection-text-options, #selection-list-options, #heading-menu[open] .menu-items, [role="menu"]')) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (suppressed(el)) continue;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      regions.push({
        id: el.id || null,
        role: el.getAttribute('role'),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    return {
      dpr: window.devicePixelRatio || 1,
      viewport: {width: window.innerWidth, height: window.innerHeight},
      regions,
    };
  });
}

export async function captureHidden(app, page, path) {
  const targets = await readTargets(page);
  const windowHandle = await app.browserWindow(page);
  const metaPath = metaPathFor(path);
  let meta = {
    path,
    metaPath,
    accepted: false,
    empty: true,
    size: null,
    visible: null,
    focused: null,
    pixelIdentity: 'unverified',
    presentation: {
      source: 'beginFrameSubscription',
      onlyDirty: false,
      frames: 0,
      invalidFrames: 0,
      dirtyRect: null,
      reason: null,
      threshold: {channelNoise, minChangedPixels},
      limitation: pixelLimitation,
      regions: targets.regions,
      viewport: targets.viewport,
      dpr: targets.dpr,
      roi: [],
    },
    error: null,
  };
  let persisted = false;
  const persist = async () => {
    meta.pixelIdentity = 'unverified';
    delete meta.png;
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    persisted = true;
  };
  try {
    const result = await withTimeout(windowHandle.evaluate(async (window, payload) => {
      const channelNoise = 12;
      const minChangedPixels = 300;
      const limitation = 'ROI delta only shows that a later presented frame changed the live menu rect. It does not identify menu glyphs or colors.';
      const timeoutMs = payload.timeoutMs;
      const targets = payload.targets;
      if (window.isDestroyed()) throw new Error('hidden capture target BrowserWindow was destroyed');
      if (window.webContents.isDestroyed()) throw new Error('hidden capture target WebContents was destroyed');
      if (typeof window.webContents.beginFrameSubscription !== 'function' || typeof window.webContents.endFrameSubscription !== 'function') {
        throw new Error('webContents.beginFrameSubscription is unavailable');
      }
      const visibleBefore = window.isVisible();
      const focusedBefore = window.isFocused();
      if (visibleBefore !== false || focusedBefore !== false) {
        return {
          ok: false,
          meta: {
            accepted: false,
            empty: true,
            size: null,
            visible: visibleBefore,
            focused: focusedBefore,
            pixelIdentity: 'unverified',
            error: 'BrowserWindow was visible or focused before hidden capture',
            presentation: {
              source: 'beginFrameSubscription',
              onlyDirty: false,
              frames: 0,
              regions: targets.regions,
              viewport: targets.viewport,
              dpr: targets.dpr,
              limitation,
            },
          },
        };
      }
      if (!(targets.viewport?.width > 0) || !(targets.viewport?.height > 0)) {
        return {
          ok: false,
          meta: {
            accepted: false,
            empty: true,
            visible: false,
            focused: false,
            pixelIdentity: 'unverified',
            error: 'hidden capture viewport is empty',
            presentation: {source: 'beginFrameSubscription', frames: 0, regions: targets.regions, limitation},
          },
        };
      }

      const menuOpen = Array.isArray(targets.regions) && targets.regions.length > 0;
      let settled = false;
      let frames = 0;
      let invalidFrames = 0;
      let baseline = null;
      let lastDirty = null;
      let lastSize = null;
      let lastRoi = [];

      const bitmapOf = image => {
        const scales = [];
        const addScale = value => {
          if (Number.isFinite(value) && value > 0 && !scales.includes(value)) scales.push(value);
        };
        addScale(1);
        if (typeof image.getScaleFactors === 'function') {
          const declared = image.getScaleFactors();
          if (Array.isArray(declared)) {
            for (const value of declared) addScale(value);
          }
        }
        for (const scale of scales) {
          const size = image.getSize(scale);
          if (!size || !(size.width > 0) || !(size.height > 0)) continue;
          const bitmap = image.toBitmap({scaleFactor: scale});
          if (bitmap?.length === size.width * size.height * 4) {
            return {width: size.width, height: size.height, scale, bitmap};
          }
        }
        return null;
      };

      const mapRect = (region, width, height) => {
        const sx = width / targets.viewport.width;
        const sy = height / targets.viewport.height;
        const x = Math.floor(region.left * sx);
        const y = Math.floor(region.top * sy);
        const right = Math.ceil((region.left + region.width) * sx);
        const bottom = Math.ceil((region.top + region.height) * sy);
        if (x < 0 || y < 0 || right > width || bottom > height || right - x < 4 || bottom - y < 4) return null;
        return {x, y, width: right - x, height: bottom - y};
      };

      const extract = (bitmap, stride, rect) => {
        const out = Buffer.alloc(rect.width * rect.height * 4);
        for (let row = 0; row < rect.height; row += 1) {
          const start = ((rect.y + row) * stride + rect.x) * 4;
          bitmap.copy(out, row * rect.width * 4, start, start + rect.width * 4);
        }
        return out;
      };

      const changedCount = (before, after) => {
        let changed = 0;
        for (let i = 0; i < before.length; i += 4) {
          if (
            Math.abs(before[i] - after[i]) > channelNoise ||
            Math.abs(before[i + 1] - after[i + 1]) > channelNoise ||
            Math.abs(before[i + 2] - after[i + 2]) > channelNoise
          ) changed += 1;
        }
        return {changedPixels: changed, totalPixels: before.length / 4};
      };

      const presentation = reason => ({
        source: 'beginFrameSubscription',
        onlyDirty: false,
        frames,
        invalidFrames,
        dirtyRect: lastDirty,
        reason,
        acceptedFrame: null,
        threshold: {channelNoise, minChangedPixels},
        limitation,
        regions: targets.regions,
        viewport: targets.viewport,
        dpr: targets.dpr,
        roi: lastRoi,
      });

      let result;
      let timer = null;
      try {
        result = await new Promise(resolve => {
          const finish = value => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve(value);
          };
          timer = setTimeout(() => {
            const roiText = lastRoi.map(item => `${item.id || 'menu'}:${item.changedPixels || 0}/${item.totalPixels || 0}`).join(',');
            const error = menuOpen
              ? `hidden menu frame was not proven after ${timeoutMs}ms; frames=${frames}; roi=${roiText || 'none'}; refusing to save a possible stale frame`
              : `hidden frame subscription produced no frame after ${timeoutMs}ms; frames=${frames}`;
            finish({
              ok: false,
              meta: {
                accepted: false,
                empty: true,
                size: lastSize,
                visible: window.isVisible(),
                focused: window.isFocused(),
                pixelIdentity: 'unverified',
                error,
                presentation: presentation(menuOpen ? 'menu-roi-unchanged' : 'no-frame'),
              },
            });
          }, timeoutMs);

          try {
          window.webContents.beginFrameSubscription(false, (image, dirtyRect) => {
            if (settled) return;
            try {
              frames += 1;
              lastDirty = dirtyRect && Number.isFinite(dirtyRect.x)
                ? {x: dirtyRect.x, y: dirtyRect.y, width: dirtyRect.width, height: dirtyRect.height}
                : null;
              if (!image || image.isEmpty()) {
                invalidFrames += 1;
                return;
              }
              const decoded = bitmapOf(image);
              if (!decoded) {
                invalidFrames += 1;
                return;
              }
              lastSize = {width: decoded.width, height: decoded.height, scaleFactor: decoded.scale};
              if (!menuOpen) {
                const png = image.toPNG().toString('base64');
                const visible = window.isVisible();
                const focused = window.isFocused();
                const hiddenOk = visible === false && focused === false;
                const info = presentation('no-open-menu');
                info.acceptedFrame = frames;
                finish({
                  ok: hiddenOk,
                  png,
                  meta: {
                    accepted: hiddenOk,
                    empty: false,
                    size: lastSize,
                    visible,
                    focused,
                    pixelIdentity: 'unverified',
                    error: hiddenOk ? null : 'hidden capture changed native window visibility or focus',
                    presentation: info,
                  },
                });
                return;
              }

              const slices = [];
              let outside = false;
              for (const region of targets.regions) {
                const rect = mapRect(region, decoded.width, decoded.height);
                if (!rect) {
                  outside = true;
                  break;
                }
                slices.push({id: region.id, rect, bytes: extract(decoded.bitmap, decoded.width, rect)});
              }
              if (outside) {
                invalidFrames += 1;
                lastRoi = targets.regions.map(region => ({id: region.id, error: 'rect-outside-frame'}));
                return;
              }
              if (!baseline) {
                baseline = slices;
                lastRoi = slices.map(slice => ({
                  id: slice.id,
                  bitmap: slice.rect,
                  changedPixels: 0,
                  totalPixels: slice.bytes.length / 4,
                  baseline: true,
                }));
                return;
              }
              const roi = slices.map((slice, index) => {
                const delta = changedCount(baseline[index].bytes, slice.bytes);
                return {
                  id: slice.id,
                  bitmap: slice.rect,
                  changedPixels: delta.changedPixels,
                  totalPixels: delta.totalPixels,
                  ratio: delta.totalPixels ? delta.changedPixels / delta.totalPixels : 0,
                };
              });
              lastRoi = roi;
              if (!roi.every(item => item.changedPixels >= minChangedPixels)) return;
              const png = image.toPNG().toString('base64');
              const visible = window.isVisible();
              const focused = window.isFocused();
              const hiddenOk = visible === false && focused === false;
              const info = presentation('menu-roi-changed');
              info.acceptedFrame = frames;
              info.roi = roi;
              finish({
                ok: hiddenOk,
                png,
                meta: {
                  accepted: hiddenOk,
                  empty: false,
                  size: lastSize,
                  visible,
                  focused,
                  pixelIdentity: 'unverified',
                  error: hiddenOk ? null : 'hidden capture changed native window visibility or focus',
                  presentation: info,
                },
              });
            } catch (error) {
              finish({
                ok: false,
                meta: {
                  accepted: false,
                  empty: true,
                  size: lastSize,
                  visible: window.isVisible(),
                  focused: window.isFocused(),
                  pixelIdentity: 'unverified',
                  error: String(error?.message || error),
                  presentation: presentation('frame-callback-error'),
                },
              });
            }
          });
        } catch (error) {
          finish({
            ok: false,
            meta: {
              accepted: false,
              empty: true,
              size: lastSize,
              visible: window.isVisible(),
              focused: window.isFocused(),
              pixelIdentity: 'unverified',
              error: String(error?.message || error),
              presentation: presentation('subscription-start-error'),
            },
          });
        }
      });
    } finally {
      if (timer) clearTimeout(timer);
      try { window.webContents.endFrameSubscription(); } catch {}
    }
      return result;
    }, {timeoutMs: captureTimeoutMs, targets}), captureTimeoutMs + 2000,
    `hidden capture protocol timed out after ${captureTimeoutMs}ms`);

    meta = {...meta, ...result.meta, path, metaPath, pixelIdentity: 'unverified'};
    delete meta.png;
    if (!result.ok) {
      meta.accepted = false;
      await persist();
      throw new Error(meta.error || 'hidden presentation was not proven');
    }
    const png = Buffer.from(result.png, 'base64');
    if (png.length <= pngSignature.length || !png.subarray(0, pngSignature.length).equals(pngSignature)) {
      meta.accepted = false;
      meta.error = 'hidden frame subscription did not return a PNG image';
      await persist();
      throw new Error(meta.error);
    }
    if (!(meta.size?.width > 0) || !(meta.size?.height > 0)) {
      meta.accepted = false;
      meta.error = `hidden capture returned invalid image size: ${JSON.stringify(meta.size)}`;
      await persist();
      throw new Error(meta.error);
    }
    if (meta.visible !== false) {
      meta.accepted = false;
      meta.error = 'hidden capture made the BrowserWindow visible';
      await persist();
      throw new Error(meta.error);
    }
    if (meta.focused !== false) {
      meta.accepted = false;
      meta.error = 'hidden capture focused the BrowserWindow';
      await persist();
      throw new Error(meta.error);
    }
    await writeFile(path, png);
    meta.accepted = true;
    meta.empty = false;
    meta.bytes = png.length;
    meta.error = null;
    await persist();
    return meta;
  } catch (error) {
    if (!persisted) {
      meta.accepted = false;
      meta.error = meta.error || String(error?.message || error);
      await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`).catch(() => {});
    }
    throw error;
  } finally {
    const subscriptionCleanup = await windowHandle.evaluate(window => {
      try {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return {ended: false, reason: 'destroyed'};
        if (typeof window.webContents.endFrameSubscription !== 'function') return {ended: false, reason: 'unavailable'};
        window.webContents.endFrameSubscription();
        return {ended: true};
      } catch (error) {
        return {ended: false, reason: String(error?.message || error)};
      }
    }).catch(error => ({ended: false, reason: String(error?.message || error)}));
    if (!meta.presentation || typeof meta.presentation !== 'object') meta.presentation = {};
    meta.presentation.subscriptionCleanup = subscriptionCleanup;
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`).catch(() => {});
    await windowHandle.dispose().catch(() => {});
  }
}
