import type { Hooks } from "../config.js";

export async function runHook<K extends keyof Hooks>(
  hooks: Hooks | undefined,
  name: K,
  ...args: Parameters<NonNullable<Hooks[K]>>
): Promise<ReturnType<NonNullable<Hooks[K]>> | true> {
  const hook = hooks?.[name];
  if (!hook) return true as ReturnType<NonNullable<Hooks[K]>> | true;
  return (
    hook as (
      ...a: Parameters<NonNullable<Hooks[K]>>
    ) => ReturnType<NonNullable<Hooks[K]>>
  )(...args);
}
