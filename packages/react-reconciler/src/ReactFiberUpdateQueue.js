/**
 * Copyright (c) 2013-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {ExpirationTime} from './ReactFiberExpirationTime';
import type {CapturedValue} from './ReactCapturedValue';

import {
  debugRenderPhaseSideEffects,
  debugRenderPhaseSideEffectsForStrictMode,
} from 'shared/ReactFeatureFlags';
import {Callback as CallbackEffect} from 'shared/ReactTypeOfSideEffect';
import {ClassComponent, HostRoot} from 'shared/ReactTypeOfWork';
import invariant from 'fbjs/lib/invariant';
import warning from 'fbjs/lib/warning';
import {StrictMode} from './ReactTypeOfMode';

import {NoWork} from './ReactFiberExpirationTime';

let didWarnUpdateInsideUpdate;

if (__DEV__) {
  didWarnUpdateInsideUpdate = false;
}

type PartialState<State, Props> =
  | $Subtype<State>
  | ((prevState: State, props: Props) => $Subtype<State>);

// Callbacks are not validated until invocation
type Callback = mixed;

export type Update<State> = {
  expirationTime: ExpirationTime,
  partialState: PartialState<any, any>,
  callback: Callback | null,
  isReplace: boolean,
  isForced: boolean,
  capturedValue: CapturedValue<mixed> | null,
  next: Update<State> | null,
};

// Singly linked-list of updates. When an update is scheduled, it is added to
// the queue of the current fiber and the work-in-progress fiber. The two queues
// are separate but they share a persistent structure.
//
// During reconciliation, updates are removed from the work-in-progress fiber,
// but they remain on the current fiber. That ensures that if a work-in-progress
// is aborted, the aborted updates are recovered by cloning from current.
//
// The work-in-progress queue is always a subset of the current queue.
//
// When the tree is committed, the work-in-progress becomes the current.
// 单一链式更新队列，当一个更新被计划，它会被添加到当前 fiber 队列和工作中的 fiber
// .first，.next
// 两个队列分离但共享持久的数据结构
// 经过调度，更新（fiber）将会从工作中的 fiber 去除，但是会留在当前 fiber 中
// 这确保了正在工作中的被中止，被中止的更新能从当前队列中恢复过来
// 工作中的队列始终是当前队列的子集
export type UpdateQueue<State> = {
  // A processed update is not removed from the queue if there are any
  // unprocessed updates that came before it. In that case, we need to keep
  // track of the base state, which represents the base state of the first
  // unprocessed update, which is the same as the first update in the list.
  // baseState 代表第一个未处理的更新，与列表中第一个更新一样
  baseState: State,
  // For the same reason, we keep track of the remaining expiration time.
  // 跟踪剩余时间
  expirationTime: ExpirationTime,
  first: Update<State> | null,
  last: Update<State> | null,
  callbackList: Array<Update<State>> | null,
  hasForceUpdate: boolean,
  isInitialized: boolean,
  capturedValues: Array<CapturedValue<mixed>> | null,

  // Dev only
  isProcessing?: boolean,
};

function createUpdateQueue<State>(baseState: State): UpdateQueue<State> {
  const queue: UpdateQueue<State> = {
    baseState,
    expirationTime: NoWork,
    first: null,
    last: null,
    callbackList: null,
    hasForceUpdate: false,
    isInitialized: false,
    capturedValues: null,
  };
  if (__DEV__) {
    queue.isProcessing = false;
  }
  return queue;
}

export function insertUpdateIntoQueue<State>(
  queue: UpdateQueue<State>,
  update: Update<State>,
): void {
  // Append the update to the end of the list.
  if (queue.last === null) {
    // Queue is empty
    queue.first = queue.last = update;
  } else {
    queue.last.next = update;
    queue.last = update;
  }
  if (
    queue.expirationTime === NoWork ||
    queue.expirationTime > update.expirationTime
  ) {
    queue.expirationTime = update.expirationTime;
  }
}

let q1;
let q2;
export function ensureUpdateQueues(fiber: Fiber) {
  q1 = q2 = null;
  // We'll have at least one and at most two distinct update queues.
  const alternateFiber = fiber.alternate;
  let queue1 = fiber.updateQueue;
  if (queue1 === null) {
    // TODO: We don't know what the base state will be until we begin work.
    // It depends on which fiber is the next current. Initialize with an empty
    // base state, then set to the memoizedState when rendering. Not super
    // happy with this approach.
    // 创建 fiber 的更新队列
    queue1 = fiber.updateQueue = createUpdateQueue((null: any));
  }

  let queue2;
  if (alternateFiber !== null) {
    queue2 = alternateFiber.updateQueue;
    if (queue2 === null) {
      queue2 = alternateFiber.updateQueue = createUpdateQueue((null: any));
    }
  } else {
    queue2 = null;
  }
  queue2 = queue2 !== queue1 ? queue2 : null;

  // Use module variables instead of returning a tuple
  q1 = queue1;
  q2 = queue2;
}

export function insertUpdateIntoFiber<State>(
  fiber: Fiber,
  update: Update<State>,
): void {
  ensureUpdateQueues(fiber);
  const queue1: Fiber = (q1: any);
  const queue2: Fiber | null = (q2: any);

  // Warn if an update is scheduled from inside an updater function.
  if (__DEV__) {
    if (
      (queue1.isProcessing || (queue2 !== null && queue2.isProcessing)) &&
      !didWarnUpdateInsideUpdate
    ) {
      warning(
        false,
        'An update (setState, replaceState, or forceUpdate) was scheduled ' +
          'from inside an update function. Update functions should be pure, ' +
          'with zero side-effects. Consider using componentDidUpdate or a ' +
          'callback.',
      );
      didWarnUpdateInsideUpdate = true;
    }
  }

  // If there's only one queue, add the update to that queue and exit.
  if (queue2 === null) {
    insertUpdateIntoQueue(queue1, update);
    return;
  }

  // If either queue is empty, we need to add to both queues.
  if (queue1.last === null || queue2.last === null) {
    insertUpdateIntoQueue(queue1, update);
    insertUpdateIntoQueue(queue2, update);
    return;
  }

  // If both lists are not empty, the last update is the same for both lists
  // because of structural sharing. So, we should only append to one of
  // the lists.
  insertUpdateIntoQueue(queue1, update);
  // But we still need to update the `last` pointer of queue2.
  queue2.last = update;
}

export function getUpdateExpirationTime(fiber: Fiber): ExpirationTime {
  switch (fiber.tag) {
    case HostRoot:
    case ClassComponent:
      const updateQueue = fiber.updateQueue;
      if (updateQueue === null) {
        return NoWork;
      }
      return updateQueue.expirationTime;
    default:
      return NoWork;
  }
}

function getStateFromUpdate(update, instance, prevState, props) {
  const partialState = update.partialState;
  if (typeof partialState === 'function') {
    return partialState.call(instance, prevState, props);
  } else {
    return partialState;
  }
}

export function processUpdateQueue<State>(
  current: Fiber | null,
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
  instance: any,
  props: any,
  renderExpirationTime: ExpirationTime,
): State {
  if (current !== null && current.updateQueue === queue) {
    // We need to create a work-in-progress queue, by cloning the current queue.
    const currentQueue = queue;
    queue = workInProgress.updateQueue = {
      baseState: currentQueue.baseState,
      expirationTime: currentQueue.expirationTime,
      first: currentQueue.first,
      last: currentQueue.last,
      isInitialized: currentQueue.isInitialized,
      capturedValues: currentQueue.capturedValues,
      // These fields are no longer valid because they were already committed.
      // Reset them.
      callbackList: null,
      hasForceUpdate: false,
    };
  }

  if (__DEV__) {
    // Set this flag so we can warn if setState is called inside the update
    // function of another setState.
    queue.isProcessing = true;
  }

  // Reset the remaining expiration time. If we skip over any updates, we'll
  // increase this accordingly.
  queue.expirationTime = NoWork;

  // TODO: We don't know what the base state will be until we begin work.
  // It depends on which fiber is the next current. Initialize with an empty
  // base state, then set to the memoizedState when rendering. Not super
  // happy with this approach.
  let state;
  if (queue.isInitialized) {
    state = queue.baseState;
  } else {
    state = queue.baseState = workInProgress.memoizedState;
    queue.isInitialized = true;
  }
  let dontMutatePrevState = true;
  let update = queue.first;
  let didSkip = false;
  while (update !== null) {
    const updateExpirationTime = update.expirationTime;
    if (updateExpirationTime > renderExpirationTime) {
      // This update does not have sufficient priority. Skip it.
      const remainingExpirationTime = queue.expirationTime;
      if (
        remainingExpirationTime === NoWork ||
        remainingExpirationTime > updateExpirationTime
      ) {
        // Update the remaining expiration time.
        queue.expirationTime = updateExpirationTime;
      }
      if (!didSkip) {
        didSkip = true;
        queue.baseState = state;
      }
      // Continue to the next update.
      update = update.next;
      continue;
    }

    // This update does have sufficient priority.

    // If no previous updates were skipped, drop this update from the queue by
    // advancing the head of the list.
    if (!didSkip) {
      queue.first = update.next;
      if (queue.first === null) {
        queue.last = null;
      }
    }

    // Invoke setState callback an extra time to help detect side-effects.
    // Ignore the return value in this case.
    if (
      debugRenderPhaseSideEffects ||
      (debugRenderPhaseSideEffectsForStrictMode &&
        workInProgress.mode & StrictMode)
    ) {
      getStateFromUpdate(update, instance, state, props);
    }

    // Process the update
    let partialState;
    if (update.isReplace) {
      state = getStateFromUpdate(update, instance, state, props);
      dontMutatePrevState = true;
    } else {
      partialState = getStateFromUpdate(update, instance, state, props);
      if (partialState) {
        if (dontMutatePrevState) {
          // $FlowFixMe: Idk how to type this properly.
          state = Object.assign({}, state, partialState);
        } else {
          state = Object.assign(state, partialState);
        }
        dontMutatePrevState = false;
      }
    }
    if (update.isForced) {
      queue.hasForceUpdate = true;
    }
    if (update.callback !== null) {
      // Append to list of callbacks.
      let callbackList = queue.callbackList;
      if (callbackList === null) {
        callbackList = queue.callbackList = [];
      }
      callbackList.push(update);
    }
    if (update.capturedValue !== null) {
      let capturedValues = queue.capturedValues;
      if (capturedValues === null) {
        queue.capturedValues = [update.capturedValue];
      } else {
        capturedValues.push(update.capturedValue);
      }
    }
    update = update.next;
  }

  if (queue.callbackList !== null) {
    workInProgress.effectTag |= CallbackEffect;
  } else if (
    queue.first === null &&
    !queue.hasForceUpdate &&
    queue.capturedValues === null
  ) {
    // The queue is empty. We can reset it.
    workInProgress.updateQueue = null;
  }

  if (!didSkip) {
    didSkip = true;
    queue.baseState = state;
  }

  if (__DEV__) {
    // No longer processing.
    queue.isProcessing = false;
  }

  return state;
}

export function commitCallbacks<State>(
  queue: UpdateQueue<State>,
  context: any,
) {
  const callbackList = queue.callbackList;
  if (callbackList === null) {
    return;
  }
  // Set the list to null to make sure they don't get called more than once.
  queue.callbackList = null;
  for (let i = 0; i < callbackList.length; i++) {
    const update = callbackList[i];
    const callback = update.callback;
    // This update might be processed again. Clear the callback so it's only
    // called once.
    update.callback = null;
    invariant(
      typeof callback === 'function',
      'Invalid argument passed as callback. Expected a function. Instead ' +
        'received: %s',
      callback,
    );
    callback.call(context);
  }
}
