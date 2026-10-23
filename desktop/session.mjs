import { readFile, open, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export class FileSession {
  constructor() { this.path = ''; this.bytes = null; this.raw = ''; this.bom = false; this.baseHash = null; this.externalChange = false; }
  async load(path) {
    const bytes = await readFile(path);
    const bom = bytes.subarray(0,3).equals(Buffer.from([239,187,191]));
    const raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bom ? bytes.subarray(3) : bytes);
    this.path = path; this.bytes = bytes; this.raw = raw; this.bom = bom;
    this.baseHash = digest(bytes); this.externalChange = false;
    return {path,raw};
  }
  async save(raw, destination = this.path, overwrite = false, publication = null) {
    if (typeof raw !== 'string' || !destination) throw new Error('无效的保存请求');
    if (publication !== null && typeof publication?.replace !== 'function') throw new Error('无效的宿主保存边界');
    let expected = null;
    try { expected = await readFile(destination); }
    catch(error) { if(error.code !== 'ENOENT' || destination === this.path) throw error; }
    if (destination === this.path) {
      // The recovery flow may have marked this session: the draft was taken
      // against different bytes, so an in-place save would discard a version
      // the user never saw. Refuse like any external change.
      if (this.externalChange) throw new Error('文件已被其他程序修改。请另存为，避免覆盖外部更改。');
      if (!expected.equals(this.bytes)) throw new Error('文件已被其他程序修改。请另存为，避免覆盖外部更改。');
      if (raw === this.raw) return {path:destination,raw};
    } else if (expected && !overwrite) throw new Error('目标文件已存在');
    const bytes = Buffer.concat([this.bom ? Buffer.from([239,187,191]) : Buffer.alloc(0),Buffer.from(raw,'utf8')]);
    const temp = join(dirname(destination),`.m1racle-${randomUUID()}.tmp`);
    try {
      const handle = await open(temp,'wx');
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      // Recheck immediately before replacement, after potentially slow temporary writes.
      let current = null;
      try { current = await readFile(destination); }
      catch(error) { if(error.code !== 'ENOENT') throw error; }
      if(expected === null ? current !== null : current === null || !current.equals(expected)) {
        throw new Error('保存期间目标文件发生外部更改，请另存为。');
      }
      if (publication) await publication.replace({temporaryPath:temp,destination,bytes});
      else await rename(temp,destination);
    } finally {
      // A host publication can have an unknown outcome or a foreign object at
      // this name. Its recovery protocol owns retention; never blindly unlink it.
      if (!publication) await unlink(temp).catch(error => { if(error.code !== 'ENOENT') throw error; });
    }
    this.path = destination; this.bytes = bytes; this.raw = raw;
    this.baseHash = digest(bytes); this.externalChange = false;
    return {path:destination,raw};
  }
}
