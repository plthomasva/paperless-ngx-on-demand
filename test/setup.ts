import cp from 'node:child_process';

// Stryker test runner captures stdout/stderr with WritableWorkerStdio, which lacks a native file descriptor.
// AWS CDK's NodejsFunction invokes esbuild using child_process.spawnSync with stdio: ['pipe', 'pipe', process.stderr].
// Node's spawnSync requires native file descriptors or strings ('pipe'/'inherit'/'ignore') in stdio.
// Normalize any custom non-fd stream objects to 'pipe' to prevent TypeError [ERR_INVALID_ARG_VALUE].
const origSpawnSync = cp.spawnSync;
cp.spawnSync = function (this: unknown, cmd: any, args: any, options: any) {
  if (options && Array.isArray(options.stdio)) {
    options = {
      ...options,
      stdio: options.stdio.map((s: any) => {
        if (s && typeof s === 'object' && !(s.fd || (s._handle && s._handle.fd !== undefined))) {
          return 'pipe';
        }
        return s;
      }),
    };
  }
  return origSpawnSync.call(this, cmd, args, options);
} as typeof cp.spawnSync;
