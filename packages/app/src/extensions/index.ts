import type { AlertUIExtension } from '@/components/alerts/alertUIExtension';

// Optional UI extensions, read by the components that offer each extension
// point. This build supplies none. Typed through a function so the compiler
// doesn't narrow the exports to `undefined`.
const none = (): AlertUIExtension | undefined => undefined;

export const alertUIExtension = none();
