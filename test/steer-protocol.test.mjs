// vizier spec 062 (steer a busy turn): §3 `delay_ms` and the §8 "Read mid-turn" echo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { complete, completionDelay } from '../src/protocol.mjs';
import { functionTool } from './helpers.mjs';

const frontmatter = (sender, extra = '') => `---\nsender: ${sender}\n${extra}sent_at: 2026-11-15T10:00:00+07:00\nmetadata: {}\n---\n\n`;
const call = (id) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'echo', arguments: '{}' } }] });

test('delay_ms is read from the run request and nowhere else', () => {
  const run = { role: 'user', content: '{"tool":"echo","arguments":{},"delay_ms":1500}' };
  assert.equal(completionDelay({ messages: [run] }), 1500);
  assert.equal(completionDelay({ messages: [{ role: 'user', content: '{"tool":"echo"}' }] }), 0);
  assert.equal(completionDelay({ messages: [{ role: 'user', content: 'hello' }] }), 0);
  // While the tool's result is answered, the delay is spent already.
  assert.equal(completionDelay({ messages: [run, call('c1'), { role: 'tool', tool_call_id: 'c1', content: 'ok' }] }), 0);
});

test('delay_ms out of range is an invalid request', () => {
  for (const value of ['-1', '10001', '1.5', '"2"']) {
    const reply = complete([{ role: 'user', content: `{"tool":"echo","delay_ms":${value}}` }], [functionTool()]);
    assert.match(reply.content, /^Invalid tool request: delay_ms must be an integer from 0 to 10000/u, value);
    assert.equal(completionDelay({ messages: [{ role: 'user', content: `{"tool":"echo","delay_ms":${value}}` }] }), 0);
  }
});

test('with delay_ms, tool is optional and say is the final answer', () => {
  const reply = complete([{ role: 'user', content: '{"say":"done","delay_ms":2000}' }], [functionTool()]);
  assert.equal(reply.content, 'done');
  assert.equal(reply.tool_calls, undefined);
  assert.match(complete([{ role: 'user', content: '{"say":"done"}' }], [functionTool()]).content, /^Invalid tool request: missing `tool`/u);
});

test('a delayed tool request still calls the tool', () => {
  const reply = complete([{ role: 'user', content: '{"tool":"echo","arguments":{"text":"hi"},"delay_ms":10}' }], [functionTool()]);
  assert.equal(reply.tool_calls[0].function.name, 'echo');
});

test('§8 lists what a running turn read at its round boundary, in order', () => {
  const reply = complete([
    { role: 'user', content: '{"tool":"echo"}' },
    call('c1'),
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    { role: 'user', content: [
      { type: 'text', text: `${frontmatter('background')}[Background work finished] d_1 succeeded` },
      { type: 'text', text: `${frontmatter('dana', 'via: mid_turn\n')}keep the old token format` },
      { type: 'text', text: `${frontmatter('dana', 'via: mid_turn\n')}and the logs` },
    ] },
  ], [functionTool()]);
  assert.equal(
    reply.content,
    '**Read mid-turn**:\nbackground: [Background work finished] d_1 succeeded\nkeep the old token format\nand the logs',
  );
});

test('a request of its own after a tool result still runs: only marked parts are mid-turn reads', () => {
  // A new turn can load history before the last reply is saved, so its request follows a tool result.
  const tools = [functionTool()];
  const reply = complete([
    { role: 'user', content: '{"tool":"echo"}' },
    call('c1'),
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    { role: 'user', content: `${frontmatter('dana')}tools` },
  ], tools);
  assert.doesNotMatch(reply.content, /Read mid-turn/u);
  assert.match(reply.content, /echo/u);
});

test('a plain note after tool results is not a mid-turn read', () => {
  const reply = complete([
    { role: 'user', content: '{"tool":"echo"}' },
    call('c1'),
    { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    { role: 'user', content: '[Images loaded into context. Continue processing.]' },
  ], [functionTool()]);
  assert.doesNotMatch(reply.content, /Read mid-turn/u);
});
