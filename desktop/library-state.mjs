import {open, readFile, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {groupNameKey} from './library-names.mjs';
import {setTimeout as delay} from 'node:timers/promises';

const FILE = 'library.json';
export const LIBRARY_ITEM_LIMIT = 500;
export const LIBRARY_GROUP_LIMIT = 100;
export const LIBRARY_TOMBSTONE_LIMIT = 500;
const NAME_LIMIT = 60;
const PATH_LIMIT = 4096;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validPath = value => typeof value === 'string' && value.trim() !== '' && value.length <= PATH_LIMIT;
const validGroupName = value => typeof value === 'string' && value === value.trim() && value !== '' && value.length <= NAME_LIMIT;
const isNormalizedPath = value => {
 try { return resolve(value) === value; } catch { return false; }
};
const validGroup = value => isObject(value) && hasExactKeys(value, ['id', 'name', 'collapsed'])
 && typeof value.id === 'string' && value.id !== ''
 && validGroupName(value.name) && typeof value.collapsed === 'boolean';
const validItem = value => isObject(value) && hasExactKeys(value, ['path', 'groupId', 'pinned', 'fixed'])
 && validPath(value.path) && isNormalizedPath(value.path)
 && (value.groupId === null || (typeof value.groupId === 'string' && value.groupId !== ''))
 && typeof value.pinned === 'boolean' && typeof value.fixed === 'boolean';
const validTime = value => Number.isFinite(value) && value >= 0;
const validRemoval = value => isObject(value) && hasExactKeys(value,['key','removedAt'])
 && validPath(value.key) && pathKey(value.key) === value.key && validTime(value.removedAt);

export const emptyLibrary = () => ({version: 1, collapsed: false, groups: [], items: []});

const validLibrary = value => {
 const keys=['version','collapsed','groups','items'];
 if (!isObject(value) || !hasExactKeys(value, Object.hasOwn(value,'removed')?[...keys,'removed']:keys)
  || value.version !== 1 || typeof value.collapsed !== 'boolean'
  || !Array.isArray(value.groups) || value.groups.length > LIBRARY_GROUP_LIMIT
  || !Array.isArray(value.items) || value.items.length > LIBRARY_ITEM_LIMIT
  || !value.groups.every(validGroup) || !value.items.every(validItem)
  || (Object.hasOwn(value,'removed') && (!Array.isArray(value.removed) || value.removed.length > LIBRARY_TOMBSTONE_LIMIT || !value.removed.every(validRemoval)))) return false;
 const groupIds = new Set(value.groups.map(group => group.id));
 if (groupIds.size !== value.groups.length) return false;
 const paths = new Set();
 for (const item of value.items) {
  const key = pathKey(item.path);
  if (!key || paths.has(key) || (item.groupId !== null && !groupIds.has(item.groupId))) return false;
  paths.add(key);
 }
 const removals=new Set();
 for(const entry of value.removed||[]){
  if(removals.has(entry.key)||paths.has(entry.key))return false;
  removals.add(entry.key);
 }
 return true;
};

const libraryError = (message, cause) => {
 const error = new Error(message, cause === undefined ? undefined : {cause});
 error.code = 'LIBRARY_STATE_INVALID';
 return error;
};

export function pathKey(path) {
 try { return resolve(path).replaceAll('/', '\\').toLowerCase(); } catch { return ''; }
}

const normalizePath = path => {
 if (!validPath(path)) throw libraryError('文档路径无效');
 const normalized = resolve(path);
 if (normalized.length > PATH_LIMIT) throw libraryError('文档路径过长');
 return normalized;
};

const normalizeDirectory = directory => {
 if (!validPath(directory)) throw libraryError('库目录无效');
 return directory;
};

const normalizeName = name => {
 if (typeof name !== 'string') throw libraryError('分组名必须是字符串');
 const normalized = name.trim();
 if (normalized === '' || normalized.length > NAME_LIMIT) throw libraryError('分组名不能为空且长度不能超过 60 个字符');
 return normalized;
};

const assertLibrary = value => {
 if (!validLibrary(value)) throw libraryError('库元数据记录无效');
 return value;
};

export async function readLibrary(directory) {
 const root = normalizeDirectory(directory);
 let text;
 try {
  text = await readFile(join(root, FILE), 'utf8');
 } catch (error) {
  if (error.code === 'ENOENT') return emptyLibrary();
  throw libraryError(`无法读取库元数据：${error.message}`, error);
 }
 let value;
 try {
  value = JSON.parse(text);
 } catch (error) {
  throw libraryError(`库元数据不是有效 JSON：${error.message}`, error);
 }
 return structuredClone(assertLibrary(value));
}

async function writeLibrary(directory, value) {
 assertLibrary(value);
 const target = join(directory, FILE);
 const temp = join(directory, `.library-${randomUUID()}.tmp`);
 let failure;
 try {
  const handle = await open(temp, 'wx');
  try {
   await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
   await handle.sync();
  } finally {
   await handle.close();
  }
  // Windows readers and antivirus can briefly deny replacement. Keep the
  // flushed temporary file and retry the atomic rename; never unlink target.
  const waits=[20,40,80,160];
  for(let attempt=0;;attempt++){
   try{await rename(temp,target);break;}
   catch(error){
    if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=waits.length)throw error;
    await delay(waits[attempt]);
   }
  }
 } catch (error) {
  failure = error;
 }
 try {
  await unlink(temp);
 } catch (error) {
  if (error.code !== 'ENOENT' && !failure) failure = error;
 }
 if (!failure) return;
 if (failure.code === 'LIBRARY_STATE_INVALID') throw failure;
 throw libraryError(`无法写入库元数据：${failure.message}`, failure);
}

// One queue covers every logical library under this process. This keeps
// read-modify-write operations from different windows from replacing each other.
let chain = Promise.resolve();
const serial = job => {
 const task = chain.then(job);
 chain = task.catch(() => {});
 return task;
};

const findGroup = (record, id) => record.groups.find(group => group.id === id);
const assertUniqueName = (record, name, exceptId) => {
 if (record.groups.some(group => group.id !== exceptId && groupNameKey(group.name) === groupNameKey(name))) {
  throw libraryError('已存在同名分组，请换一个名称');
 }
};
const findItemIndex = (record, path) => {
 const key = pathKey(path);
 return record.items.findIndex(item => pathKey(item.path) === key);
};
const updateItem = (record, path, changes) => {
 const normalized = normalizePath(path);
 if(record.removed?.some(entry=>entry.key===pathKey(normalized)))throw libraryError('这个文档入口已移出，请重新打开后再操作');
 const index = findItemIndex(record, normalized);
 if (index >= 0) {
  record.items[index] = {...record.items[index], ...changes};
  return;
 }
 if (record.items.length >= LIBRARY_ITEM_LIMIT) throw libraryError('库文档条目已达到 500 条上限');
 record.items.push({path: normalized, groupId: null, pinned: false, fixed: false, ...changes});
};

const assertAction = (action, required, optional = []) => {
 const allowed = ['type', ...required, ...optional];
 if (Object.keys(action).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(action, key))) {
  throw libraryError('库操作字段无效');
 }
};

const applyAction = (current, action, now) => {
 const record = structuredClone(current);
 if (!isObject(action) || typeof action.type !== 'string') throw libraryError('库操作无效');
 switch (action.type) {
  case 'remember': {
   assertAction(action, ['path'], ['openedAt']);
   const openedAt=Object.hasOwn(action,'openedAt')?action.openedAt:now;
   if(!validTime(openedAt))throw libraryError('打开时间无效');
   const path = normalizePath(action.path);
   const key=pathKey(path),removal=record.removed?.find(entry=>entry.key===key);
   // A delayed successful open/save cannot undo a newer remove intention.
   // A genuinely later explicit open restores the path with fresh preferences.
   if(removal && removal.removedAt>=openedAt)return {record:current,changed:false};
   if (findItemIndex(record, path) >= 0) return {record: current, changed: false};
   if (record.items.length >= LIBRARY_ITEM_LIMIT) throw libraryError('库文档条目已达到 500 条上限');
   if(removal){
    record.removed=record.removed.filter(entry=>entry.key!==key);
    if(!record.removed.length)delete record.removed;
   }
   record.items.push({path, groupId: null, pinned: false, fixed: false});
   break;
  }
  case 'collapse':
   assertAction(action, ['collapsed']);
   if (typeof action.collapsed !== 'boolean') throw libraryError('collapsed 必须是布尔值');
   record.collapsed = action.collapsed;
   break;
  case 'group-add': {
   assertAction(action, ['name']);
   const name = normalizeName(action.name);
   assertUniqueName(record, name);
   if (record.groups.length >= LIBRARY_GROUP_LIMIT) throw libraryError('分组已达到 100 个上限');
   record.groups.push({id: randomUUID(), name, collapsed: false});
   break;
  }
  case 'group-rename': {
   assertAction(action, ['id', 'name']);
   const group = findGroup(record, action.id);
   if (!group) throw libraryError('分组不存在');
   const name = normalizeName(action.name);
   if (name === group.name) return {record: current, changed: false};
   assertUniqueName(record, name, group.id);
   group.name = name;
   break;
  }
  case 'group-remove': {
   assertAction(action, ['id']);
   const index = record.groups.findIndex(group => group.id === action.id);
   if (index < 0) throw libraryError('分组不存在');
   record.groups.splice(index, 1);
   for (const item of record.items) if (item.groupId === action.id) item.groupId = null;
   break;
  }
  case 'group-collapse': {
   assertAction(action, ['id', 'collapsed']);
   const group = findGroup(record, action.id);
   if (!group) throw libraryError('分组不存在');
   if (typeof action.collapsed !== 'boolean') throw libraryError('collapsed 必须是布尔值');
   group.collapsed = action.collapsed;
   break;
  }
  case 'item-update': {
   assertAction(action, ['path'], ['groupId', 'pinned', 'fixed']);
   const changes = {};
   if (Object.hasOwn(action, 'groupId')) {
    if (action.groupId === null) changes.groupId = null;
    else if (typeof action.groupId === 'string' && findGroup(record, action.groupId)) changes.groupId = action.groupId;
    else throw libraryError('分组不存在');
   }
   for (const field of ['pinned', 'fixed']) {
    if (!Object.hasOwn(action, field)) continue;
    if (typeof action[field] !== 'boolean') throw libraryError(`${field} 必须是布尔值`);
    changes[field] = action[field];
   }
   if (Object.keys(changes).length === 0) throw libraryError('item-update 未提供有效字段');
   updateItem(record, action.path, changes);
   break;
  }
  case 'item-remove': {
   assertAction(action, ['path']);
   const path = normalizePath(action.path);
   const index = findItemIndex(record, path);
   if(index>=0)record.items.splice(index,1);
   const key=pathKey(path),previous=record.removed?.find(entry=>entry.key===key);
   record.removed=[{key,removedAt:Math.max(now,previous?.removedAt||0)},...(record.removed||[]).filter(entry=>entry.key!==key)].slice(0,LIBRARY_TOMBSTONE_LIMIT);
   break;
  }
  default:
   throw libraryError('不支持的库操作');
 }
 return {record: assertLibrary(record), changed: true};
};

export function updateLibrary(directory, action, now=Date.now()) {
 if(!validTime(now))return Promise.reject(libraryError('库操作时间无效'));
 return serial(async () => {
  const current = await readLibrary(directory);
  const result = applyAction(current, action, now);
  if (result.changed) await writeLibrary(directory, result.record);
  return structuredClone(result.record);
 });
}
