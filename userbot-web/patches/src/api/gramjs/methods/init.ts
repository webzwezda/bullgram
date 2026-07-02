// BullRun-patched init.ts (runs inside GramJS Worker).
//
// Upstream (Ajaxy/telegram-tt v10.9.51): initializes update emitter, merges
// localDb, then calls initClient(initialArgs). No awareness of multi-thread
// context.
//
// BullRun patch: before initClient, hydrate the Worker-side bridge config
// from initialArgs. Main thread fetches the bridge token + sessionData +
// fingerprint (see patches/src/index.tsx), passes them through the initApi
// postMessage payload (see patches/src/global/actions/api/initial.ts and
// patches/src/api/types/misc.ts), and we install them here so that
// PromisedWebSockets.ts, client.ts and sessions.ts (all running in this
// Worker) can read getBridgeConfig() the same way they would on the main
// thread.

import type {
  ApiInitialArgs,
  ApiOnProgress,
  OnApiUpdate,
} from '../../types';
import type { LocalDb } from '../localDb';
import type { MethodArgs, MethodResponse, Methods } from './types';

import { updateFullLocalDb } from '../localDb';
import { init as initUpdateEmitter } from '../updates/apiUpdateEmitter';
import { init as initClient } from './client';
import * as methods from './index';
import { setBridgeConfig } from '../../../util/bullrunBridge';

export function initApi(_onUpdate: OnApiUpdate, initialArgs: ApiInitialArgs, initialLocalDb?: LocalDb) {
  initUpdateEmitter(_onUpdate);

  // BullRun: hydrate Worker-side bridge config BEFORE initClient runs,
  // otherwise TelegramClient constructor throws when reading fingerprint.
  if (initialArgs?.bullrunBridgeConfig) {
    setBridgeConfig(initialArgs.bullrunBridgeConfig);
  }

  if (initialLocalDb) updateFullLocalDb(initialLocalDb);

  initClient(initialArgs);
}

export function callApi<T extends keyof Methods>(fnName: T, ...args: MethodArgs<T>): MethodResponse<T> {
  // @ts-ignore
  return methods[fnName](...args) as MethodResponse<T>;
}

export function cancelApiProgress(progressCallback: ApiOnProgress) {
  progressCallback.isCanceled = true;
}
