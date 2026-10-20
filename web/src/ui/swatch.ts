/**
 * Colour swatches. The page's Content Security Policy blocks style attributes written into markup, so a swatch
 * carries its colour in data-hex and this paints it through the style API, which the policy allows.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;

function paint(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>("[data-hex]").forEach((el) => {
    const hex = el.dataset.hex ?? "";
    el.style.backgroundColor = HEX.test(hex) ? hex : "transparent";
  });
}

export function initSwatches(): void {
  paint(document);
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.matches("[data-hex]")) paint(n.parentNode ?? document);
        else paint(n);
      });
    }
  }).observe(document.body, { childList: true, subtree: true });
}
