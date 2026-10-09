import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load-ts.mjs';
const { PetNeeds, RECOVERY_TARGETS } = await load('../src/pet-brain/needs.ts');
const { activityForStep } = await load('../src/actions/activity.ts');
const { currentPetActivity } = await load('../src/pet/activity.ts');
const { reactionForSemanticAction } = await load('../src/pet-brain/adapters/reaction.ts');
const { performNeedRecovery } = await load('../src/pet-brain/recovery.ts');
const { ActionCoordinator, ACTION_PRIORITY } = await load('../src/actions/coordinator.ts');
const { permitsExecution } = await load('../src/pet/execution-policy.ts');
const { PetBlackboard } = await load('../src/pet-brain/Blackboard.ts');
const { PetUtilityPlanner } = await load('../src/pet-brain/Planner.ts');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('the same waiting image can represent observation, idle or rest without sharing effects', () => {
  const observe = reactionForSemanticAction({ type: 'observe', durationMs: 1000 }, 'waiting');
  const rest = reactionForSemanticAction({ type: 'rest', durationMs: 1000 }, 'waiting');
  assert.equal(observe.reaction, rest.reaction);
  assert.equal(activityForStep(observe), 'observe');
  assert.equal(activityForStep(rest), 'rest');
  assert.equal(activityForStep({ reaction: 'waiting', durationMs: 1000 }), 'idle');
  assert.equal(activityForStep({ reaction: 'running', durationMs: 1000 }), 'observe');
  const effects = activity => {
    const needs = new PetNeeds(); needs.observe(activity, 0);
    for (let sec = 1; sec <= 10; sec++) needs.observe(activity, sec * 1000);
    return needs.snapshot().energy;
  };
  assert.ok(effects('observe') < effects('idle'));
  assert.ok(effects('idle') < effects('rest'));
  assert.ok(effects('walk') < effects('observe'));
});

test('real execution overrides locomotion and hide, drag or fall pause all activities', () => {
  const input = { visible: true, dragging: false, falling: false, execution: 'tea', locomotion: 'walk' };
  assert.equal(currentPetActivity(input), 'tea');
  assert.equal(currentPetActivity({ ...input, execution: null }), 'walk');
  for (const paused of [{ visible: false }, { dragging: true }, { falling: true }]) {
    assert.equal(currentPetActivity({ ...input, ...paused }), 'paused');
  }
});

function seededNeeds(reason) {
  const needs = new PetNeeds();
  const seconds = reason === 'exhausted' ? 130 : reason === 'tired' ? 100 : reason === 'thirsty' ? 800 : 1600;
  const end = reason === 'hungry' ? -5000 : 0;
  const activity = reason === 'tired' || reason === 'exhausted' ? 'walk' : 'idle';
  for (let sec = 0; sec <= seconds; sec++) needs.observe(activity, end + (sec - seconds) * 1000);
  if (reason === 'hungry') {
    needs.observe('tea', -5000);
    for (let sec = 1; sec <= 5; sec++) needs.observe('tea', -5000 + sec * 1000);
  }
  needs.observe('idle', 0);
  assert.equal(needs.snapshot().reason, reason);
  return needs;
}

function fixture(reason) {
  let now = 0;
  const jobs = new Set(), needs = seededNeeds(reason), displayed = [], activities = [];
  const schedule = (callback, ms) => {
    const job = { at: now + ms, callback }; jobs.add(job); return () => jobs.delete(job);
  };
  const coordinator = new ActionCoordinator(schedule, () => now);
  const observe = () => {
    const activity = coordinator.snapshot().activity ?? 'idle';
    activities.push(activity); needs.observe(activity, now);
  };
  coordinator.subscribeActivity(observe);
  coordinator.subscribe(step => displayed.push(step));
  let cancelSample = () => {};
  const sample = () => { observe(); cancelSample = schedule(sample, 250); };
  sample();
  const start = () => coordinator.execute(ACTION_PRIORITY.background,
    session => performNeedRecovery(session, reason, () => needs.snapshot()), `recovery:${reason}`);
  const advance = async ms => {
    const target = now + ms;
    for (;;) {
      const at = Math.min(...[...jobs].map(job => job.at));
      if (at > target) break;
      now = at;
      for (const job of [...jobs].filter(job => job.at === at)) { jobs.delete(job); job.callback(); }
      await flush();
    }
    now = target; await flush();
  };
  return { coordinator, needs, jobs, displayed, activities, start, advance, dispose: () => cancelSample() };
}

test('energy recovery stays in one coordinator session beyond an animation and finishes at the target', async () => {
  for (const reason of ['tired', 'exhausted']) {
    const f = fixture(reason), task = f.start(), sessionId = f.coordinator.snapshot().sessionId;
    await f.advance(7000);
    assert.equal(f.coordinator.snapshot().sessionId, sessionId);
    assert.ok(f.needs.snapshot().energy < RECOVERY_TARGETS.energy);
    assert.equal(f.needs.snapshot().activity, reason === 'tired' ? 'rest' : 'sleep');
    await f.advance(40000);
    assert.deepEqual(await task, { status: 'completed' });
    assert.ok(f.needs.snapshot().energy >= RECOVERY_TARGETS.energy);
    assert.equal(f.needs.snapshot().recovering, false);
    f.dispose();
  }
});

test('drink and food finish a full clip and satisfy their own need', async () => {
  for (const [reason, field] of [['thirsty', 'thirst'], ['hungry', 'hunger']]) {
    const f = fixture(reason), task = f.start();
    await f.advance(1000);
    assert.equal(f.coordinator.snapshot().active, true);
    assert.equal(f.needs.snapshot().reason, reason, 'crossing the entry threshold does not terminate recovery');
    await f.advance(6000);
    assert.deepEqual(await task, { status: 'completed' });
    assert.ok(f.needs.snapshot()[field] <= RECOVERY_TARGETS[field]);
    f.dispose();
  }
});

test('user replacement, stop, hide and drag cancel recovery without granting unearned completion', async () => {
  for (const reason of ['replace', 'stop', 'hidden', 'drag']) {
    const f = fixture('tired'), task = f.start();
    await f.advance(1000);
    const partial = f.needs.snapshot().energy;
    assert.ok(partial < RECOVERY_TARGETS.energy);
    let replacement;
    if (reason === 'replace') replacement = f.coordinator.request({ actionId: 'click', source: 'user',
      steps: [{ reaction: 'waving', durationMs: 1700 }] });
    else if (reason === 'stop') f.coordinator.stop();
    else f.coordinator.block(reason, true);
    assert.equal((await task).status, 'cancelled');
    assert.equal(f.needs.snapshot().energy, partial);
    await f.advance(2000);
    assert.ok(f.needs.snapshot().energy < partial + .01);
    if (replacement) await replacement;
    f.dispose();
  }
});

test('ordinary background requests yield to recovery while user and agent priority remain available', () => {
  const settings = { petVisible: true, autonomousBehavior: true };
  assert.equal(permitsExecution(settings, ACTION_PRIORITY.background, 'recovery:tired'), false);
  assert.equal(permitsExecution(settings, ACTION_PRIORITY.background, 'semantic'), true);
  assert.equal(permitsExecution(settings, ACTION_PRIORITY.user, 'recovery:tired'), true);
  assert.equal(permitsExecution(settings, ACTION_PRIORITY.agent, 'recovery:tired'), true);
});

test('semantic waits clear a prior recovery activity and neutral release does not leak it', async () => {
  const f = fixture('tired');
  const task = f.coordinator.execute(ACTION_PRIORITY.user, async session => {
    await session.perform({ reaction: 'waiting', activity: 'rest', durationMs: 1000 });
    await session.wait(1000);
  });
  await f.advance(1000);
  assert.equal(f.coordinator.snapshot().activity, 'idle');
  const energy = f.needs.snapshot().energy;
  await f.advance(1000); await task;
  assert.ok(f.needs.snapshot().energy < energy + .002);
  assert.equal(f.coordinator.snapshot().activity, null);
  f.dispose();
});

test('only actual unmet needs mark a plan for continuous recovery', () => {
  const board = new PetBlackboard(), planner = new PetUtilityPlanner(() => 0);
  const context = { now: 100000, autonomousMovement: true, canMove: true, canDock: true,
    userReactionActive: false, agentState: 'idle', idleForMs: 100000,
    wanderWeight: 1, dockWeight: 1, activity: 1, curiosity: 1 };
  for (let sec = 0; sec <= 100; sec++) board.observeActivity('furina', 'walk', sec * 1000);
  assert.equal(planner.plan(context, board).actions[0].recovery, 'tired');
  const fresh = new PetBlackboard();
  fresh.submitIntent({ id: 'rest', source: 'user', goal: 'rest', priority: 1, createdAt: 100000, expiresAt: 101000 });
  assert.equal(planner.plan(context, fresh).actions[0].recovery, undefined);
});
