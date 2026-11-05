import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { apply } from '../lib/index.js';
test('standalone DSH plugin authenticates requests and exposes live facts and world tool', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'room-dsh-api-'));
  let handler, tool, dispose, preStep;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const webServer = { port: server.address().port, protocol: 'http:', register(route) { handler = route.handler; return () => {}; } };
  apply({ get(name) { return name === 'webServer' ? webServer : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) } :
    name === 'llm' ? { async *stream() { yield { type: 'text-delta', text: '{"text":"房间连接正常","roomAction":null}' }; } } : null; },
    webServer, tools: { register(value) { tool = value; return () => {}; } }, on(event, fn) { if (event === 'dispose') dispose = fn; if (event === 'agent/pre-step') preStep = fn; },
  }, { dshHome: home, adapter: 'standalone' });
  t.after(async () => { dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(home, { recursive: true }); });
  const host = JSON.parse(fs.readFileSync(path.join(home, 'room-world', 'host.json'), 'utf8'));
  const route = suffix => base + host.api + suffix;
  const headers = { 'x-pet-token': host.token, 'content-type': 'application/json' };
  assert.equal((await fetch(route('/status'))).status, 403);
  assert.equal((await fetch(route('/status'), { headers: { ...headers, origin: 'https://example.org' } })).status, 403);
  const status = await (await fetch(route('/status'), { headers })).json();
  assert.equal(status.role.name, '大肥鱼'); assert.equal(status.roomLink.version, 1);
  assert.equal(status.qqContext.registered, true); assert.equal(typeof preStep, 'function');
  const actionSchema = tool.parameters.properties.action;
  assert.ok(actionSchema.enum.includes('home') && actionSchema.enum.includes('visit') && actionSchema.enum.includes('move') && actionSchema.enum.includes('go_home'));
  assert.match(actionSchema.description, /回家/);
  const state = await fetch(route('/room/state'), { method: 'POST', headers, body: JSON.stringify({ activity: 'rice', phase: 'day', position: { x: 77, y: 76 } }) });
  assert.equal((await state.json()).ok, true);
  const facts = await tool.execute({ target: 'room', action: 'observe' }); assert.ok(facts.context.includes('白米饭'));
  const ownerVisit = await fetch(route('/world'), { method: 'POST', headers, body: JSON.stringify({ action: 'visit', area: 'farm' }) });
  assert.equal(ownerVisit.status, 400); assert.match((await ownerVisit.json()).error, /她自己/);
  const wish = await (await fetch(route('/world'), { method: 'POST', headers, body: JSON.stringify({ action: 'wish', text: '想看大西瓜' }) })).json();
  assert.equal(wish.world.wishes[0].text, '想看大西瓜');
  assert.equal((await tool.execute({ target: 'world', action: 'wish', text: 'x' })).code, 'WISH_OWNER_ONLY');
  const visit = await tool.execute({ target: 'world', action: 'visit', area: 'farm' });
  // DSH rejects tool output that does not survive a JSON round trip (the real QQ failure on 2026-11-05).
  for (const args of [{ target: 'world', action: 'observe' }, { target: 'world', action: 'plant', area: 'farm', species: 'rice' }, { target: 'world', action: 'water', area: 'farm', slot: 0 },
    { target: 'world', action: 'harvest', area: 'farm', slot: 0 }, { target: 'world', action: 'shop' }, { target: 'world', action: 'codex' }, { target: 'room', action: 'status' },
    { target: 'world', action: 'walk', area: 'room' }, { target: 'room', action: 'go_home' }, { target: 'world', action: 'cast' }]) {
    const out = await tool.execute(args);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), out, 'lossless output for ' + JSON.stringify(args));
  }
  assert.equal((await tool.execute({ target: 'room', action: 'status' })).ok, true, 'status is treated as observe');
  assert.equal((await tool.execute({ target: 'world', action: 'walk', area: 'room' })).command.action, 'walk', 'room activity sent to world still reaches the room');
  assert.equal(visit.world.location, 'farm');
  const commands = await (await fetch(route('/commands?since=0'), { headers })).json(); assert.equal(commands.events[0].action, 'away');
  const chat = await fetch(route('/chat'), { method: 'POST', headers, body: JSON.stringify({ text: '连接测试', requestId: 'fixture-api-1' }) });
  assert.equal((await chat.json()).reply.text, '房间连接正常');
  assert.equal((await (await fetch(route('/room/events?since=0'), { headers })).json()).events.length, 0, 'desktop must not create QQ events');
});
