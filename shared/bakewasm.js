import { readFileSync } from 'node:fs';

let wasm = null;
let wasmTried = false;

export function bakeWasm() {
  if (wasmTried) return wasm;
  wasmTried = true;
  try {
    const url = new URL('./bakekernel.wasm', import.meta.url);
    wasm = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(url)), {}).exports;
  } catch {
    wasm = null;
  }
  return wasm;
}

export function bakeWasmReady() {
  return !!bakeWasm();
}
