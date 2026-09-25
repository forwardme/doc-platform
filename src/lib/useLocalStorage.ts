'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * SSR-safe persisted state (localStorage)。挂载时读取一次，调用 setValue 时写入。
 * 注意：挂载后首帧仍是 initial（避免 hydration 不一致），故读取发生在 useEffect 中。
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValueState] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValueState(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);

  const setValue = useCallback(
    (v: T) => {
      setValueState(v);
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  return [value, setValue];
}
