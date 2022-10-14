// Responsible for consuming and syncing with the server/local cache
import localforage from 'localforage';
import * as memoryDriver from 'localforage-driver-memory';
import _debug from '@codesandbox/common/lib/utils/debug';
import { ParsedConfigurationFiles } from '@codesandbox/common/lib/templates/template';
import Manager from './manager';
import { SerializedTranspiledModule } from './transpiled-module';

const debug = _debug('cs:compiler:cache');

const host = process.env.CODESANDBOX_HOST;
// eslint-disable-next-line no-console
console.log('cache - CODESANDBOX_HOST: ', host);
localforage.defineDriver(memoryDriver);
localforage.setDriver([
  localforage.INDEXEDDB,
  localforage.LOCALSTORAGE,
  localforage.WEBSQL,
  memoryDriver._driver,
]);

const MAX_CACHE_SIZE = 1024 * 1024 * 20;
let APICacheUsed = false;
try {
  localforage.config({
    name: 'CodeSandboxApp',
    storeName: 'sandboxes', // Should be alphanumeric, with underscores.
    description:
      'Cached transpilations of the sandboxes, for faster initialization time.',
  });

  // Prewarm store
  localforage.keys();
} catch (e) {
  console.warn('Problems initializing IndexedDB store.');
  console.warn(e);
}

function shouldSaveOnlineCache(firstRun: boolean, changes: number) {
  // eslint-disable-next-line no-console
  console.log('cache - inside shouldSaveOnlineCache: ', firstRun, changes);
  // eslint-disable-next-line no-console
  console.log(
    'cache - (window as any).__SANDBOX_DATA__: ',
    (window as any).__SANDBOX_DATA__
  );
  if (!firstRun || changes > 0) {
    return false;
  }

  if (!(window as any).__SANDBOX_DATA__) {
    return true;
  }

  return false;
}

export function clearIndexedDBCache() {
  return localforage.clear();
}

export async function saveCache(
  managerModuleToTranspile: any,
  manager: Manager,
  changes: number,
  firstRun: boolean
) {
  // eslint-disable-next-line no-console
  console.log('cache - inside saveCache, manager: ', manager);
  if (!manager.id) {
    // eslint-disable-next-line no-console
    console.log(
      `cache - about to return false because manager.id is defined: ${manager.id}`
    );
    return Promise.resolve(false);
  }

  const managerState = {
    ...(await manager.serialize({
      entryPath: managerModuleToTranspile
        ? managerModuleToTranspile.path
        : null,
      optimizeForSize: true,
    })),
  };
  // eslint-disable-next-line no-console
  console.log('cache - managerState: ', managerState);

  try {
    if (process.env.NODE_ENV === 'development') {
      debug(
        'Saving cache of ' +
          (JSON.stringify(managerState).length / 1024).toFixed(2) +
          'kb to indexedDB'
      );
    }

    await localforage.setItem(manager.id, managerState);
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.error(e);
    }
    manager.clearCache();
  }

  if (shouldSaveOnlineCache(firstRun, changes)) {
    const stringifiedManagerState = JSON.stringify(managerState);

    // eslint-disable-next-line no-console
    console.log(
      'cache - inside if result of shouldSaveOnlineCache, stringifiedManagerState: ',
      stringifiedManagerState
    );

    if (stringifiedManagerState.length > MAX_CACHE_SIZE) {
      // eslint-disable-next-line no-console
      console.log(
        'cache - stringifiedManagerState.length > MAX_CACHE_SIZE: ',
        MAX_CACHE_SIZE,
        stringifiedManagerState.length
      );
      return Promise.resolve(false);
    }

    debug(
      'Saving cache of ' +
        (stringifiedManagerState.length / 1024).toFixed(2) +
        'kb to CodeSandbox API'
    );
    // eslint-disable-next-line no-console
    console.log(
      'Saving cache of ' +
        (stringifiedManagerState.length / 1024).toFixed(2) +
        'kb to CodeSandbox API'
    );
    // eslint-disable-next-line no-console
    console.log(`cache - value used in fetch ${manager.cacheUrl ?? host}`);
    // eslint-disable-next-line no-console
    console.log(`cache - manager value before fetch: ${manager}`);
    return window
      .fetch(
        `${manager.cacheUrl ?? host}/api/v1/sandboxes/${manager.id}/cache`,
        {
          method: 'POST',
          body: JSON.stringify({
            version: manager.version,
            data: stringifiedManagerState,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      .then(x => x.json())
      .catch(e => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('Something went wrong while saving cache.');
          console.warn(e);
        }
      });
  }

  return Promise.resolve(false);
}

export function deleteAPICache(
  sandboxId: string,
  version: string,
  manager?: Manager // TODO can't really be optional
): Promise<any> {
  if (APICacheUsed && !process.env.SANDPACK) {
    debug('Deleting cache of API');
    // eslint-disable-next-line no-console
    console.log(
      `cache - deleting cache of api value used in fetch ${
        manager?.cacheUrl ?? host
      }`
    );
    return window
      .fetch(
        `${manager?.cacheUrl ?? host}/api/v1/sandboxes/${sandboxId}/cache`,
        {
          method: 'DELETE',
          body: JSON.stringify({
            version,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      .then(x => x.json())
      .catch(e => {
        console.error('Something went wrong while deleting cache.');
        console.error(e);
      });
  }

  return Promise.resolve(false);
}

export type ManagerCache = {
  transpiledModules: { [id: string]: SerializedTranspiledModule };
  cachedPaths: { [path: string]: { [path: string]: string } };
  version: string;
  timestamp: number;
  configurations: ParsedConfigurationFiles;
  entry: string | undefined;
  meta: { [dir: string]: string[] };
  dependenciesQuery: string;
};

function findCacheToUse(
  cache1: ManagerCache | undefined,
  cache2: ManagerCache | undefined
) {
  if (!cache1 && !cache2) {
    return null;
  }

  if (cache1 && !cache2) {
    return cache1!;
  }

  if (cache2 && !cache1) {
    return cache2!;
  }

  return cache2!.timestamp > cache1!.timestamp ? cache2! : cache1!;
}

export function ignoreNextCache() {
  try {
    localStorage.setItem('ignoreCache', 'true');
  } catch (e) {
    console.warn(e);
  }
}

export async function consumeCache(manager: Manager) {
  // eslint-disable-next-line no-console
  console.log('cache - inside consumeCache, manager: ', manager);
  if (!manager.id) {
    return false;
  }

  try {
    const shouldIgnoreCache =
      localStorage.getItem('ignoreCache') ||
      localStorage.getItem('ignoreCacheDev');
    // eslint-disable-next-line no-console
    console.log('cache - should ignore cache: ', shouldIgnoreCache);
    if (shouldIgnoreCache) {
      localStorage.removeItem('ignoreCache');
      // eslint-disable-next-line no-console
      console.log('cache - ignoring cache: ', shouldIgnoreCache);
      return false;
    }
    // eslint-disable-next-line no-console
    console.log(
      'cache - value of (window as any).__SANDBOX_DATA__ inside consumeCache: ',
      (window as any).__SANDBOX_DATA__
    );
    const cacheData = (window as any).__SANDBOX_DATA__;
    const localData: ManagerCache | undefined = await localforage.getItem(
      manager.id
    );

    const cache = findCacheToUse(cacheData && cacheData.data, localData);
    // eslint-disable-next-line no-console
    console.log('cache - result of findCacheToUse: ', cache);
    if (cache) {
      // eslint-disable-next-line no-console
      console.log(
        'cache - cache present checking version: ',
        cache.version,
        manager.version,
        cache.version === manager.version
      );
      if (cache.version === manager.version) {
        if (cache === localData) {
          APICacheUsed = false;
        } else {
          APICacheUsed = true;
        }
        // eslint-disable-next-line no-console
        console.log(
          `cache - Loading cache from ${
            cache === localData ? 'IndexedDB' : 'API'
          }`
        );
        debug(
          `Loading cache from ${cache === localData ? 'IndexedDB' : 'API'}`,
          cache
        );

        await manager.load(cache);

        return true;
      }
    }

    return false;
  } catch (e) {
    console.warn('Problems consuming cache');
    console.warn(e);

    return false;
  }
}
