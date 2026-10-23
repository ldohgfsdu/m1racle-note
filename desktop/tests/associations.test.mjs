import {test} from 'node:test';
import assert from 'node:assert/strict';
import {markdownRegistrationPlan, registerMarkdown, machineRegistrationMatches, machineUserCleanupPlan, settingsURL} from '../associations.mjs';

const PROG_ID = 'M1racleNote.Markdown';
const LEGACY_KEY = 'HKCU\\Software\\Classes\\Applications\\M1racle Note.exe';
const LEGACY_COMMAND = `${LEGACY_KEY}\\shell\\open\\command`;
const CAPABILITIES = 'HKCU\\Software\\M1racleNote\\Capabilities';

function windowsArgv(command) {
  const args = [];
  let index = 0;
  while (index < command.length) {
    while (index < command.length && (command[index] === ' ' || command[index] === '\t')) index += 1;
    if (index >= command.length) break;
    let value = '';
    let quoted = false;
    while (index < command.length) {
      const current = command[index];
      if (!quoted && (current === ' ' || current === '\t')) break;
      if (current === '\\') {
        let slashes = 0;
        while (index < command.length && command[index] === '\\') {
          slashes += 1;
          index += 1;
        }
        if (command[index] === '"') {
          value += '\\'.repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            value += '"';
            index += 1;
          } else if (quoted && command[index + 1] === '"') {
            value += '"';
            index += 2;
          } else {
            quoted = !quoted;
            index += 1;
          }
        } else value += '\\'.repeat(slashes);
        continue;
      }
      if (current === '"') {
        if (quoted && command[index + 1] === '"') {
          value += '"';
          index += 2;
        } else {
          quoted = !quoted;
          index += 1;
        }
        continue;
      }
      value += current;
      index += 1;
    }
    args.push(value);
  }
  return args;
}

function iconTarget(data) {
  const comma = data.lastIndexOf(',');
  assert.equal(data.slice(comma), ',0');
  return windowsArgv(data.slice(0, comma));
}

function normalizeKey(key) {
  return String(key ?? '').replace(/\\+$/, '');
}

function legacyRead(data) {
  const seen = [];
  return {
    seen,
    async read(query) {
      seen.push(query);
      const name = query?.name ?? null;
      const isDefault = name == null || name === '' || name === '(default)';
      if (normalizeKey(query?.key) === LEGACY_COMMAND && isDefault) return data;
      return null;
    },
  };
}

async function planFor(executable, {iconPath, readResult = null} = {}) {
  const reader = legacyRead(readResult);
  const plan = await markdownRegistrationPlan(executable, {iconPath, read: reader.read});
  return {plan, seen: reader.seen};
}

function signatureOf(plan) {
  return plan.operations.map(operation => ({
    kind: operation.kind,
    role: operation.role,
    key: operation.key,
    name: operation.name || null,
    type: operation.type ?? null,
  }));
}

function assertRegistryAllowed(plan) {
  const allowedSet = [
    /^HKCU\\Software\\Classes\\M1racleNote\.Markdown(?:\\.*)?$/,
    /^HKCU\\Software\\Classes\\\.md\\OpenWithProgids$/,
    /^HKCU\\Software\\Classes\\\.markdown\\OpenWithProgids$/,
    /^HKCU\\Software\\M1racleNote\\Capabilities(?:\\.*)?$/,
    /^HKCU\\Software\\RegisteredApplications$/,
  ];
  for (const operation of plan.operations) {
    if (operation.kind === 'notify') {
      assert.equal(operation.role, 'shell');
      continue;
    }
    assert.equal(/UserChoice/i.test(operation.key), false, operation.key);
    assert.equal(/^HK(?:LM|CR)\\/i.test(operation.key), false, operation.key);
    if (operation.kind === 'delete-key') {
      assert.equal(operation.key, LEGACY_KEY);
      assert.equal(operation.role, 'migrate-legacy-application');
      continue;
    }
    assert.equal(operation.kind, 'set');
    assert.equal(allowedSet.some(pattern => pattern.test(operation.key)), true, operation.key);
    assert.equal(/\\Applications\\/i.test(operation.key), false, operation.key);
  }
}

test('command parser keeps a quoted executable separate from its argument', () => {
  assert.deepEqual(windowsArgv('"C:\\Program Files\\M1racle Note\\M1racle Note.exe" "%1"'), [
    'C:\\Program Files\\M1racle Note\\M1racle Note.exe',
    '%1',
  ]);
  assert.deepEqual(windowsArgv('"C:\\A \\"Quoted\\"\\app.exe" "%1"'), ['C:\\A "Quoted"\\app.exe', '%1']);
  assert.deepEqual(windowsArgv('"C:\\Trailing\\app.exe\\\\" "%1"'), ['C:\\Trailing\\app.exe\\', '%1']);
});

test('ProgID and capability identity do not follow the install path', async () => {
  const first = await planFor('C:\\A\\M1racle Note.exe', {iconPath: 'C:\\A\\icon.ico'});
  const second = await planFor('D:\\Other\\M1racle Note.exe', {iconPath: 'D:\\Other\\icon.ico'});
  assert.equal(first.plan.progId, PROG_ID);
  assert.equal(second.plan.progId, PROG_ID);
  assert.deepEqual(signatureOf(first.plan), signatureOf(second.plan));
  const identity = first.plan.operations.find(operation => operation.kind === 'set' && operation.key === `HKCU\\Software\\Classes\\${PROG_ID}` && !operation.name);
  assert.ok(identity);
  assert.ok(identity.role === 'identity' || identity.role === 'progid');
  assert.equal(identity.data, 'M1racle Note Markdown');
  assert.ok(!identity.name);
  const registered = first.plan.operations.find(operation => operation.role === 'registered-application');
  assert.deepEqual(
    {key: registered.key, name: registered.name, data: registered.data, type: registered.type},
    {key: 'HKCU\\Software\\RegisteredApplications', name: 'M1racle Note', data: 'Software\\M1racleNote\\Capabilities', type: 'REG_SZ'},
  );
  const associations = first.plan.operations.filter(operation => operation.role === 'file-association');
  assert.deepEqual(associations.map(operation => operation.name).sort(), ['.markdown', '.md']);
  assert.ok(associations.every(operation => operation.key === `${CAPABILITIES}\\FileAssociations` && operation.data === PROG_ID && operation.type === 'REG_SZ'));
});

test('supplied official icon is used at index zero for both icon entries', async () => {
  const executable = 'C:\\Program Files\\M1racle Note\\M1racle Note.exe';
  const iconPath = 'C:\\Program Files\\M1racle "Note"\\assets\\icon.ico';
  const {plan} = await planFor(executable, {iconPath});
  const icons = plan.operations.filter(operation => operation.role === 'icon');
  assert.equal(icons.length, 2);
  assert.ok(icons.some(operation => operation.key === `HKCU\\Software\\Classes\\${PROG_ID}\\DefaultIcon` && !operation.name));
  assert.ok(icons.some(operation => operation.key === CAPABILITIES && operation.name === 'ApplicationIcon'));
  for (const operation of icons) {
    assert.equal(operation.kind, 'set');
    assert.equal(operation.type, 'REG_SZ');
    assert.deepEqual(iconTarget(operation.data), [iconPath]);
    assert.equal(operation.data.includes(executable), false);
  }
});

test('missing icon file falls back to the executable icon resource', async () => {
  const executable = 'C:\\Program Files\\M1racle Note\\M1racle Note.exe';
  const {plan} = await planFor(executable);
  const icons = plan.operations.filter(operation => operation.role === 'icon');
  assert.equal(icons.length, 2);
  for (const operation of icons) assert.deepEqual(iconTarget(operation.data), [executable]);
});

test('OpenWith adds only our ProgID and does not replace the current default', async () => {
  const {plan} = await planFor('C:\\M1racle Note\\M1racle Note.exe', {iconPath: 'C:\\M1racle Note\\icon.ico'});
  const openWith = plan.operations.filter(operation => operation.role === 'open-with');
  assert.deepEqual(openWith.map(operation => operation.key).sort(), [
    'HKCU\\Software\\Classes\\.markdown\\OpenWithProgids',
    'HKCU\\Software\\Classes\\.md\\OpenWithProgids',
  ]);
  for (const operation of openWith) {
    assert.equal(operation.kind, 'set');
    assert.equal(operation.name, PROG_ID);
    assert.equal(operation.type, 'REG_NONE');
    assert.equal(operation.data, '');
  }
  const replacedDefault = plan.operations.find(operation => (
    operation.kind === 'set'
    && (operation.key === 'HKCU\\Software\\Classes\\.md' || operation.key === 'HKCU\\Software\\Classes\\.markdown')
    && !operation.name
  ));
  assert.equal(replacedDefault, undefined);
  assertRegistryAllowed(plan);
  assert.equal(plan.operations.at(-1), plan.operations.find(operation => operation.kind === 'notify'));
  assert.equal(plan.operations.at(-1).kind, 'notify');
});

test('canonical ProgID publishes FriendlyAppName and an Application record', async () => {
  const iconPath = 'C:\\M1racle Note\\icon.ico';
  const {plan} = await planFor('C:\\M1racle Note\\M1racle Note.exe', {iconPath});
  const friendly = plan.operations.find(operation => operation.kind === 'set' && operation.name === 'FriendlyAppName');
  assert.ok(friendly);
  assert.match(friendly.key, /^HKCU\\Software\\Classes\\M1racleNote\.Markdown(?:\\Application)?$/);
  assert.match(friendly.data, /^M1racle Note/);
  const application = plan.operations.filter(operation => operation.kind === 'set' && operation.key === `HKCU\\Software\\Classes\\${PROG_ID}\\Application`);
  assert.ok(application.some(operation => operation.name === 'ApplicationName' && operation.data.includes('M1racle Note')));
  const applicationIcon = application.find(operation => operation.name === 'ApplicationIcon');
  if (applicationIcon) assert.deepEqual(iconTarget(applicationIcon.data), [iconPath]);
  assertRegistryAllowed(plan);
});
test('legacy Applications registration is deleted only when its command belongs to M1racle Note', async () => {
  const executable = 'C:\\New\\M1racle Note.exe';
  const iconPath = 'C:\\New\\icon.ico';
  const ours = await planFor(executable, {
    iconPath,
    readResult: {exists: true, type: 'REG_SZ', data: '"D:\\Old Path\\M1racle Note.exe" "%1"'},
  });
  assert.deepEqual(ours.plan.operations.filter(operation => operation.kind === 'delete-key'), [
    {kind: 'delete-key', role: 'migrate-legacy-application', key: LEGACY_KEY},
  ]);
  assert.ok(ours.seen.some(query => normalizeKey(query.key) === LEGACY_COMMAND));
  assert.equal(ours.plan.operations.some(operation => operation.kind === 'set' && /\\Applications\\/i.test(operation.key)), false);
  assert.equal(ours.plan.operations.at(-1).kind, 'notify');

  const disguised = await planFor(executable, {
    iconPath,
    readResult: {exists: true, type: 'REG_SZ', data: '"C:\\Other App\\helper.exe" "M1racle Note.exe"'},
  });
  assert.equal(disguised.plan.operations.some(operation => operation.kind === 'delete-key'), false);

  const missing = await planFor(executable, {iconPath, readResult: null});
  assert.equal(missing.plan.operations.some(operation => operation.kind === 'delete-key'), false);

  const broken = await planFor(executable, {iconPath, readResult: {exists: true, type: 'REG_SZ', data: '"'}});
  assert.equal(broken.plan.operations.some(operation => operation.kind === 'delete-key'), false);

  for (const result of [ours, disguised, missing, broken]) assertRegistryAllowed(result.plan);
});

test('open command quoting round-trips spaces, quotes, trailing slashes, and percent signs', async () => {
  const paths = [
    'C:\\M1racle Note\\M1racle Note.exe',
    'C:\\Program Files\\M1racle Note\\M1racle Note.exe',
    'C:\\A "Quoted"\\M1racle Note.exe',
    'C:\\Trailing\\M1racle Note.exe\\',
    'C:\\Percent %PATH%\\M1racle Note.exe',
  ];
  for (const executable of paths) {
    const {plan} = await planFor(executable, {iconPath: 'C:\\Program Files\\M1racle Note\\icon.ico'});
    const commands = plan.operations.filter(operation => operation.role === 'open-command');
    assert.equal(commands.length, 1, executable);
    const [command] = commands;
    assert.equal(command.key, `HKCU\\Software\\Classes\\${PROG_ID}\\shell\\open\\command`);
    assert.equal(command.kind, 'set');
    assert.equal(command.type, 'REG_SZ');
    assert.ok(!command.name);
    assert.deepEqual(command.argv, [executable, '%1']);
    assert.deepEqual(windowsArgv(command.data), [executable, '%1']);
  }
});

test('injected plan is applied only through the injected runner and stops after a failure', async () => {
  const executable = 'C:\\Program Files\\M1racle Note\\M1racle Note.exe';
  const operations = [
    {kind: 'set', role: 'identity', key: `HKCU\\Software\\Classes\\${PROG_ID}`, name: null, type: 'REG_SZ', data: 'M1racle Note Markdown'},
    {kind: 'set', role: 'open-with', key: 'HKCU\\Software\\Classes\\.md\\OpenWithProgids', name: PROG_ID, type: 'REG_NONE', data: ''},
    {kind: 'delete-key', role: 'migrate-legacy-application', key: LEGACY_KEY},
    {kind: 'notify', role: 'shell'},
  ];
  const calls = [];
  let forwarded = null;
  await registerMarkdown(executable, {
    iconPath: 'C:\\Program Files\\M1racle Note\\icon.ico',
    read: async () => { throw new Error('runner test must not read the registry'); },
    plan(received, options) {
      forwarded = {received, iconPath: options.iconPath, hasRead: typeof options.read === 'function'};
      return Promise.resolve({progId: PROG_ID, operations});
    },
    async run(file, args, options) {
      assert.equal(options.windowsHide, true);
      calls.push({file, args});
      return {stdout: ''};
    },
  });
  assert.deepEqual(forwarded, {received: executable, iconPath: 'C:\\Program Files\\M1racle Note\\icon.ico', hasRead: true});
  const program = value => String(value).replace(/^.*[\\/]/, '').toLowerCase();
  assert.deepEqual(calls.slice(0, 3).map(call => program(call.file)), ['reg.exe', 'reg.exe', 'reg.exe']);
  assert.notEqual(program(calls[3].file), 'reg.exe');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[0].args, ['add', operations[0].key, '/ve', '/t', 'REG_SZ', '/d', operations[0].data, '/f']);
  assert.deepEqual(calls[1].args, ['add', operations[1].key, '/v', PROG_ID, '/t', 'REG_NONE', '/d', '', '/f']);
  assert.deepEqual(calls[2].args, ['delete', LEGACY_KEY, '/f']);
  assert.equal(calls.some(call => call.args.some(arg => /UserChoice/i.test(String(arg)))), false);

  const attempted = [];
  await assert.rejects(registerMarkdown(executable, {
    plan: () => Promise.resolve({progId: PROG_ID, operations}),
    async run(file, args) {
      attempted.push(args[0]);
      if (attempted.length === 2) throw new Error('reg failed');
      return {stdout: ''};
    },
  }), /reg failed/);
  assert.deepEqual(attempted, ['add', 'add']);
});

test('default plan reaches the registry only through the injected runner', async () => {
  const executable = 'C:\\Program Files\\M1racle Note\\M1racle Note.exe';
  const iconPath = 'C:\\Program Files\\M1racle Note\\assets\\icon.ico';
  const calls = [];
  const reader = legacyRead({exists: true, type: 'REG_SZ', data: '"D:\\Previous\\M1racle Note.exe" "%1"'});
  await registerMarkdown(executable, {
    iconPath,
    read: reader.read,
    async run(file, args, options) {
      assert.equal(options?.windowsHide, true);
      calls.push({file, args});
      return {stdout: ''};
    },
  });
  assert.ok(reader.seen.some(query => normalizeKey(query.key) === LEGACY_COMMAND));
  const program = value => String(value).replace(/^.*[\\/]/, '').toLowerCase();
  const deletes = calls.filter(call => program(call.file) === 'reg.exe' && call.args[0] === 'delete');
  assert.deepEqual(deletes.map(call => call.args), [['delete', LEGACY_KEY, '/f']]);
  assert.notEqual(program(calls.at(-1).file), 'reg.exe');
  let icons = 0;
  for (const call of calls) {
    assert.equal(call.args.some(arg => /UserChoice/i.test(String(arg))), false);
    const dataIndex = call.args.indexOf('/d');
    if (dataIndex < 0) continue;
    const data = call.args[dataIndex + 1];
    if (typeof data !== 'string') continue;
    if (data.includes('%1')) assert.deepEqual(windowsArgv(data), [executable, '%1']);
    if (data.endsWith(',0')) {
      icons += 1;
      assert.deepEqual(iconTarget(data), [iconPath]);
    }
  }
  assert.ok(icons >= 2);
});

test('registry reads use the injected runner and unexpected read failures stop before writes', async () => {
  const calls=[];
  await registerMarkdown('C:\\Note\\M1racle Note.exe', {run:async(file,args)=>{
    calls.push({file,args});
    return {stdout:args[0]==='query'?'    (Default)    REG_SZ    "C:\\Old\\M1racle Note.exe" "%1"\r\n':''};
  }});
  assert.equal(calls[0].args[0],'query');
  assert.ok(calls.some(call=>call.args[0]==='delete'));
  const attempted=[];
  await assert.rejects(registerMarkdown('C:\\Note\\M1racle Note.exe', {run:async(file,args)=>{
    attempted.push(args[0]);
    throw Object.assign(new Error('read unavailable'),{code:'EACCES'});
  }}),/read unavailable/);
  assert.deepEqual(attempted,['query']);
});

test('machine identity requires both the installer marker and the matching shared command',async()=>{
  const executable='C:\\Program Files\\M1racle Note\\M1racle Note.exe';
  const marker='[Install]\r\nMode=AllUsers\r\nAppId={A1C4E7B2-5D30-4F88-9C21-6B0E4F2A8D17}\r\n';
  const readRegistry=async query=>{
    assert.equal(query.key,'HKLM\\Software\\Classes\\M1racleNote.Markdown\\shell\\open\\command');
    return {type:'REG_SZ',data:'"'+executable+'" "%1"'};
  };
  assert.equal(await machineRegistrationMatches(executable,{readMarker:async()=>Buffer.from('\uFEFF'+marker,'utf16le'),readRegistry}),true);
  assert.equal(await machineRegistrationMatches(executable,{readMarker:async()=>marker,readRegistry:async()=>({type:'REG_SZ',data:'"C:\\Other\\M1racle Note.exe" "%1"'})}),false);
  assert.equal(await machineRegistrationMatches(executable,{readMarker:async()=>marker.replace('AllUsers','CurrentUser'),readRegistry:async()=>{throw new Error('must not query');}}),false);
  assert.equal(await machineRegistrationMatches(executable,{readMarker:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});},readRegistry}),false);
  assert.equal(settingsURL(26100,0,'',true),'ms-settings:defaultapps?registeredAppMachine=M1racle%20Note');
});

test('machine startup migrates only our stale per-user identity and never writes a replacement',async()=>{
  const calls=[];
  await registerMarkdown('C:\\Program Files\\M1racle Note\\M1racle Note.exe',{
    machineRegistrationMatches:async()=>true,
    read:async({key,name})=>key.endsWith('\\command')?{type:'REG_SZ',data:'"C:\\Old\\M1racle Note.exe" "%1"'}:key.endsWith('RegisteredApplications')?{type:'REG_SZ',data:'Software\\M1racleNote\\Capabilities'}:name==='ApplicationName'?{type:'REG_SZ',data:'M1racle Note'}:key.endsWith('OpenWithProgids')?{type:'REG_NONE',data:''}:null,
    run:async(file,args)=>{calls.push({file,args});return {stdout:''};},
  });
  assert.equal(calls.filter(call=>call.file==='reg.exe').every(call=>call.args[0]==='delete'),true);
  assert.equal(calls.filter(call=>call.file==='reg.exe').length,6);
  assert.equal(calls.some(call=>call.args.some(arg=>/UserChoice|HKLM|FileExts/.test(arg))),false);
  const untouched=[];
  await registerMarkdown('C:\\Program Files\\M1racle Note\\M1racle Note.exe',{
    machineRegistrationMatches:async()=>true,
    read:async()=>({type:'REG_SZ',data:'"C:\\Other\\helper.exe" "%1"'}),
    run:async(...args)=>untouched.push(args),
  });
  assert.deepEqual(untouched,[]);
});
test('machine migration removes orphaned OpenWith values even after its user ProgID is gone',async()=>{
  const plan=await machineUserCleanupPlan(async({key})=>key.endsWith('OpenWithProgids')?{exists:true,type:'REG_NONE',data:''}:null);
  assert.deepEqual(plan.operations.filter(op=>op.kind==='delete-value').map(op=>op.key).sort(),[
    'HKCU\\Software\\Classes\\.markdown\\OpenWithProgids','HKCU\\Software\\Classes\\.md\\OpenWithProgids',
  ]);
  assert.equal(plan.operations.some(op=>op.kind==='delete-key'),false);
});
