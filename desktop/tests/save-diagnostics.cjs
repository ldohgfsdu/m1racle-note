"use strict";

// QA-only save trace. Electron loads this with an explicit -r before desktop/main.mjs.
// It stays inert unless NOTE_QA_SAVE_DIAG=1, and it must not change save results or errors.
const saveDiagEnabled = process.env.NOTE_QA_SAVE_DIAG === "1" && !!process.versions.electron;
if (saveDiagEnabled && typeof process.once === "function") {
  process.once("loaded", () => {
    try {
      installSaveDiagnostics();
    } catch (error) {
      writeInstallFailure(error);
    }
  });
}

function writeInstallFailure(error) {
  try {
    process.stderr.write("[note-qa-save] install failed: " + (error && error.stack || error) + "\n");
  } catch {}
}

function installSaveDiagnostics() {
  const fs = require("node:fs");
  const moduleApi = require("node:module");
  const {createHash} = require("node:crypto");
  const {resolve} = require("node:path");
  const {pathToFileURL} = require("node:url");
  const promises = fs.promises;
  const original = {
    readFile: promises.readFile,
    open: promises.open,
    writeFile: promises.writeFile,
    rename: promises.rename,
    unlink: promises.unlink,
  };

  function sha256(value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return createHash("sha256").update(bytes).digest("hex");
  }

  function errorFields(error) {
    return {
      message: error && (error.message || String(error)) || String(error),
      code: error && error.code || null,
      stack: error && error.stack || null,
      syscall: error && error.syscall || null,
      path: error && error.path || null,
      dest: error && error.dest || null,
      errno: error && error.errno || null,
    };
  }

  let cachedProfile;
  function currentProfile() {
    if (typeof cachedProfile === "string") return cachedProfile;
    try {
      const value = require("electron").app.getPath("userData");
      if (typeof value === "string" && value) cachedProfile = value;
      return typeof cachedProfile === "string" ? cachedProfile : null;
    } catch {
      return null;
    }
  }

  function log(entry) {
    const file = process.env.NOTE_QA_SAVE_DIAG_LOG;
    if (!file) return;
    try {
      fs.mkdirSync(resolve(file, ".."), {recursive: true});
      fs.appendFileSync(file, JSON.stringify({
        t: new Date().toISOString(),
        ...entry,
        pid: process.pid,
        profile: currentProfile(),
      }) + "\n");
    } catch (error) {
      try {
        process.stderr.write("[note-qa-save] log failed: " + (error && error.message || error) + "\n");
      } catch {}
    }
  }

  function isOwnedFixture(value) {
    if (typeof value !== "string" || !value) return false;
    const parts = value.replaceAll("/", "\\").split("\\").filter(Boolean);
    const marker = parts.findIndex(part => part.toLowerCase().startsWith("note-3c0-"));
    if (marker < 0 || marker !== parts.length - 2) return false;
    const base = parts[parts.length - 1].toLowerCase();
    return base.endsWith(".md") || base.endsWith(".markdown") || (base.startsWith(".m1racle-") && base.endsWith(".tmp"));
  }

  function payloadSize(data) {
    if (typeof data === "string") return Buffer.byteLength(data);
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) return data.length;
    return null;
  }

  function payloadHash(data) {
    if (typeof data === "string") return sha256(Buffer.from(data));
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) return sha256(data);
    return null;
  }

  function traceFs(op, fields, run) {
    try {
      const pending = run();
      return Promise.resolve(pending).then(result => {
        log({event: "fs", op, ok: true, ...fields(result)});
        return result;
      }, error => {
        log({event: "fs", op, ok: false, ...errorFields(error)});
        throw error;
      });
    } catch (error) {
      log({event: "fs", op, ok: false, sync: true, ...errorFields(error)});
      throw error;
    }
  }

  function wrapHandle(handle, target) {
    if (!handle || handle.__noteQaWrapped) return handle;
    const writeFile = handle.writeFile;
    const sync = handle.sync;
    if (typeof writeFile === "function") {
      handle.writeFile = function(data, options) {
        return traceFs("writeFile", () => ({
          path: target,
          length: payloadSize(data),
          sha256: payloadHash(data),
        }), () => writeFile.call(handle, data, options));
      };
    }
    if (typeof sync === "function") {
      handle.sync = function() {
        return traceFs("fsync", () => ({path: target}), () => sync.call(handle));
      };
    }
    Object.defineProperty(handle, "__noteQaWrapped", {value: true});
    return handle;
  }

  promises.readFile = function(path) {
    const args = arguments;
    if (!isOwnedFixture(path)) return original.readFile.apply(promises, args);
    return traceFs("readFile", result => ({
      path,
      length: payloadSize(result),
      sha256: payloadHash(result),
    }), () => original.readFile.apply(promises, args));
  };
  promises.open = function(path, flags) {
    const args = arguments;
    if (!isOwnedFixture(path)) return original.open.apply(promises, args);
    return traceFs("open", () => ({path, flags: flags == null ? null : String(flags)}), () => original.open.apply(promises, args))
      .then(handle => wrapHandle(handle, path));
  };
  promises.writeFile = function(path, data) {
    const args = arguments;
    if (!isOwnedFixture(path)) return original.writeFile.apply(promises, args);
    return traceFs("writeFile", () => ({
      path,
      length: payloadSize(data),
      sha256: payloadHash(data),
    }), () => original.writeFile.apply(promises, args));
  };
  promises.rename = function(from, to) {
    const args = arguments;
    if (!isOwnedFixture(from) && !isOwnedFixture(to)) return original.rename.apply(promises, args);
    return traceFs("rename", () => ({from, to}), () => original.rename.apply(promises, args));
  };
  promises.unlink = function(path) {
    const args = arguments;
    if (!isOwnedFixture(path)) return original.unlink.apply(promises, args);
    return traceFs("unlink", () => ({path}), () => original.unlink.apply(promises, args));
  };
  if (typeof moduleApi.syncBuiltinESMExports === "function") moduleApi.syncBuiltinESMExports();

  let sessionWrapStarted = false;
  function scheduleSessionWrap() {
    if (sessionWrapStarted) return;
    sessionWrapStarted = true;
    const href = pathToFileURL(resolve(__dirname, "../session.mjs")).href;
    import(href).then(mod => {
      const FileSession = mod && mod.FileSession;
      const proto = FileSession && FileSession.prototype;
      const origSave = proto && proto.save;
      if (typeof origSave !== "function" || origSave.__noteQaWrapped === true) {
        log({event: "session-wrap", ok: false, href, reason: typeof origSave !== "function" ? "missing-save" : "already-wrapped"});
        return;
      }
      function wrappedSave(raw, destination, overwrite) {
        const before = {
          destination: typeof destination === "string" ? destination : null,
          sessionPath: typeof this.path === "string" ? this.path : null,
          overwrite: overwrite === true,
          baseHash: typeof this.baseHash === "string" ? this.baseHash : null,
          externalChange: this.externalChange === true,
          bytesLength: this.bytes ? this.bytes.length : null,
          bytesHash: this.bytes ? sha256(this.bytes) : null,
          rawLength: typeof raw === "string" ? raw.length : null,
          rawHash: typeof raw === "string" ? sha256(Buffer.from(raw)) : null,
        };
        return Promise.resolve(origSave.call(this, raw, destination, overwrite)).then(result => {
          log({
            event: "session-save",
            ok: true,
            ...before,
            afterBaseHash: typeof this.baseHash === "string" ? this.baseHash : null,
            resultRawLength: result && typeof result.raw === "string" ? result.raw.length : null,
            resultRawHash: result && typeof result.raw === "string" ? sha256(Buffer.from(result.raw)) : null,
            resultHasPath: !!(result && result.path),
          });
          return result;
        }, error => {
          log({event: "session-save", ok: false, ...before, ...errorFields(error)});
          throw error;
        });
      }
      Object.defineProperty(wrappedSave, "__noteQaWrapped", {value: true});
      proto.save = wrappedSave;
      log({event: "session-wrap", ok: true, href});
    }).catch(error => {
      log({event: "session-wrap", ok: false, href, ...errorFields(error)});
    });
  }

  const {ipcMain} = require("electron");
  const originalHandle = ipcMain.handle;
  if (typeof originalHandle !== "function") {
    log({event: "ipc-hook", ok: false, reason: "missing-handle"});
    return;
  }
  function handle(channel, listener) {
    let next = listener;
    if (channel === "document" && typeof listener === "function") {
      next = function(event, type, payload) {
        if (type !== "save" && type !== "save-as") return listener.apply(this, arguments);
        const raw = payload && typeof payload.raw === "string" ? payload.raw : "";
        const started = Date.now();
        const base = {
          event: "ipc-document",
          type,
          rawIsString: !!(payload && typeof payload.raw === "string"),
          rawLength: raw.length,
          rawHash: sha256(Buffer.from(raw)),
        };
        try {
          return Promise.resolve(listener.apply(this, arguments)).then(result => {
            log({
              ...base,
              ok: true,
              elapsedMs: Date.now() - started,
              canceled: result == null,
              resultRawLength: result && typeof result.raw === "string" ? result.raw.length : null,
              resultRawHash: result && typeof result.raw === "string" ? sha256(Buffer.from(result.raw)) : null,
              resultHasPath: !!(result && result.path),
            });
            return result;
          }, error => {
            log({...base, ok: false, elapsedMs: Date.now() - started, ...errorFields(error)});
            throw error;
          });
        } catch (error) {
          log({...base, ok: false, sync: true, elapsedMs: Date.now() - started, ...errorFields(error)});
          throw error;
        }
      };
      scheduleSessionWrap();
    }
    return originalHandle.call(ipcMain, channel, next);
  }
  ipcMain.handle = handle;
  log({
    event: "ipc-hook",
    ok: ipcMain.handle === handle,
    fs: ["readFile", "open", "writeFile", "rename", "unlink"],
  });
}
