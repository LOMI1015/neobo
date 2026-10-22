import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom 不计算布局；仅补齐 Radix 的观察接口，尺寸与定位由真实浏览器验收。
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
}

afterEach(() => {
  cleanup();
});
