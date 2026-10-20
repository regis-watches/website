/** The one animated object on the site: a plain clock showing the current time. Hairlines only. */
import { h, SafeHtml } from "../lib/html";
import { reduced } from "../lib/motion-flag";

const CX = 100;

export function clockSvg(): SafeHtml {
  const ticks = [0, 90, 180, 270].map((d) => `<line x1="${CX}" y1="8" x2="${CX}" y2="16" transform="rotate(${d} ${CX} ${CX})"/>`).join("");
  return h`<svg class="clock" viewBox="0 0 200 200" role="img" aria-label="A clock showing the current time" fill="none" stroke="currentColor">
    <circle cx="100" cy="100" r="96" stroke-width="1"/>
    <g stroke-width="1.5">${new SafeHtml(ticks)}</g>
    <line class="c-h" x1="100" y1="100" x2="100" y2="58" stroke-width="2.5" stroke-linecap="round"/>
    <line class="c-m" x1="100" y1="100" x2="100" y2="30" stroke-width="1.75" stroke-linecap="round"/>
    <line class="c-s" x1="100" y1="112" x2="100" y2="22" stroke-width=".75" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="2.5" fill="currentColor" stroke="none"/>
  </svg>`;
}

/** Starts the hands. Returns a function that stops them. */
export function runClock(svg: SVGElement): () => void {
  const hh = svg.querySelector(".c-h"), mm = svg.querySelector(".c-m"), ss = svg.querySelector(".c-s");
  const set = (el: Element | null, deg: number) => el?.setAttribute("transform", `rotate(${deg.toFixed(2)} ${CX} ${CX})`);
  const paint = () => {
    const n = new Date();
    const localTime = new Date(n.getTime() + (n.getTimezoneOffset() + 60) * 60000);
    const s = localTime.getSeconds() + (reduced ? 0 : localTime.getMilliseconds() / 1000);
    set(hh, ((localTime.getHours() % 12) + localTime.getMinutes() / 60) * 30);
    set(mm, (localTime.getMinutes() + s / 60) * 6);
    set(ss, s * 6);
  };
  paint();
  if (reduced) { const t = window.setInterval(paint, 1000); return () => window.clearInterval(t); }
  let raf = 0;
  const loop = () => { paint(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(raf);
}
