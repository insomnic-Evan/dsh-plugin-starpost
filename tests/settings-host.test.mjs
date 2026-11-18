import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { registerNotificationSettings, settingsNamespace } from '../src/settings.mjs';

// Some Harness versions do not yet ship a published settings provider matching
// their agent-loop packages. Test it in the installed host's own dependency graph.
test('native DSH settings descriptor, validation, persistence and reset', { skip: !process.env.DSH_SETTINGS_TEST_MODULES }, async () => {
  const require=createRequire(join(resolve(process.env.DSH_SETTINGS_TEST_MODULES),'../package.json'));
  const load=name=>import(pathToFileURL(require.resolve('@deepseek-ai/'+name)));
  const [{Context},{default:FileSettings}]=await Promise.all([load('cordis'),load('dsh-settings-file')]);
  const dir=mkdtempSync(join(tmpdir(),'starpost-settings-host-')); const path=join(dir,'settings.json');
  const ctx=new Context(); let get;
  const base={receiveMode:'mixed',squareMode:'digest',feedMode:'digest',digestIntervalMs:300000};
  try {
    await ctx.plugin(FileSettings,{path,watch:false});
    let scope;
    const fork=ctx.plugin({apply(c){get=registerNotificationSettings(c,base);c.inject(['settings'],s=>{scope=s.settings;});}}); await fork;
    const descriptor=(await ctx.settings.describe()).find(d=>d.ns===settingsNamespace);
    assert.ok(descriptor,'notification panel must be registered, not absent');
    assert.equal(descriptor.applies,'restart');
    assert.deepEqual(descriptor.value,base);
    assert.ok(JSON.stringify(descriptor.schema).includes('squareMode'));
    await scope.update(settingsNamespace,{squareMode:'manual',feedMode:'manual'});
    assert.equal(get().squareMode,'manual');
    assert.equal(JSON.parse(readFileSync(path,'utf8'))[settingsNamespace].feedMode,'manual');
    await assert.rejects(scope.update(settingsNamespace,{digestIntervalMs:0}));
    assert.equal(get().digestIntervalMs,300000);
    await scope.replace(settingsNamespace,{}); assert.deepEqual(get(),base);
    await fork.dispose();
    assert.equal((await ctx.settings.describe()).some(d=>d.ns===settingsNamespace),false);
  } finally { await ctx.fiber.dispose(); rmSync(dir,{recursive:true,force:true}); }
});
