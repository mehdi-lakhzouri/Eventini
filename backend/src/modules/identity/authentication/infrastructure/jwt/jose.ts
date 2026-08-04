/**
 * The only place `jose` is loaded.
 *
 * `jose` 6 is ESM-only. Node 24 can `require()` it, but Jest replaces `require`
 * and hands the ESM source to its CommonJS compiler, which dies on `export`.
 * A dynamic import works everywhere: TypeScript preserves it in CommonJS
 * output under `module: nodenext`, and the test scripts already run with
 * `--experimental-vm-modules` for Prisma's WASM query compiler.
 */
type Jose = typeof import('jose');

let pending: Promise<Jose> | undefined;

export function loadJose(): Promise<Jose> {
  return (pending ??= import('jose'));
}
