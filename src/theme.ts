// The page's colors live in tokens.css; the map reads them here.

const media = matchMedia("(prefers-color-scheme: dark)");

export const isDark = () => media.matches;

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function onSchemeChange(fn: () => void) {
  media.addEventListener("change", fn);
}
