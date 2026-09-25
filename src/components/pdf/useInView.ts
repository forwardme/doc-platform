'use client';

import { useEffect, useRef, useState } from 'react';

/** 元素进入视口（带提前量）时返回 true，用于 PDF 页面的懒渲染。 */
export function useInView<T extends HTMLElement>(rootMargin = '800px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, inView] as const;
}
