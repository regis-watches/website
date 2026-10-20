export const reduced: boolean = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer: boolean = typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
