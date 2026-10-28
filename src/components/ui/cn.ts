/** Join class names, skipping falsy values. Tiny stand-in for clsx so no dependency is needed. */
export type ClassValue = string | false | null | undefined;

export const cn = (...parts: ClassValue[]): string => parts.filter(Boolean).join(' ');
