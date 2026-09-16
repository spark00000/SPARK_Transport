import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProgressExpression, buildProgressRestoreExpression, PROGRESS_ROOT_ID } from '../src/progress.mjs';
import { loadTheme } from '../src/theme.mjs';

const theme=await loadTheme();

test('progress overlay expression carries only bounded activity metadata and usage integration',()=>{
  const expression=buildProgressExpression(theme,{
    checkedAt:'2026-09-15T00:00:00.000Z',
    activity:{
      active:{operationId:'op-test',operation:'run_command',startedAtMs:1000,watchdogMs:30000,mutating:true},
      pendingUncertainMutation:null,
      last:null,
    },
  });
  assert.match(expression,new RegExp(PROGRESS_ROOT_ID));
  assert.match(expression,/run_command/);
  assert.match(expression,/brainWorking/);
  assert.match(expression,/app-initial-/);
  assert.match(expression,/safeGet/);
  assert.match(expression,/\/wham\/usage/);
  assert.match(expression,/remainingPercent/);
  assert.match(expression,/Open profile menu/);
  assert.match(expression,/Search/);
  assert.match(expression,/Update/);
  assert.doesNotMatch(expression,/\.Uqt\b/);
  assert.doesNotMatch(expression,/targetPath|commandArgs|Authorization: Bearer/);
  assert.doesNotThrow(()=>new Function(`return ${expression}`));
});

test('progress restore removes overlay and browser state',()=>{
  const expression=buildProgressRestoreExpression();
  assert.match(expression,new RegExp(PROGRESS_ROOT_ID));
  assert.match(expression,/\.remove\(\)/);
  assert.match(expression,/__sparkProgressState/);
});
