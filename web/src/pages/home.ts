import { allWatches } from "../lib/catalog";
import { naira } from "../lib/format";
import { $, h } from "../lib/html";
import type { PageResult } from "../lib/router";
import { clockSvg, runClock } from "../ui/clock";
import { COLLECTION_INFO, bindNewsletter, newsletterForm, slots } from "./shared";

export async function home(): Promise<PageResult> {
  const watches = await allWatches(true);
  const picks = [...watches.filter((w) => w.featured), ...watches.filter((w) => !w.featured)].slice(0, 4);

  const cells = (["men", "women", "neutral"] as const).map((c) => {
    const list = watches.filter((w) => w.collection === c);
    const from = list.length ? Math.min(...list.map((w) => w.price_kobo)) : 0;
    return h`<a class="cell" href="/collection/${c}">
      <span class="cell-name">${COLLECTION_INFO[c].title}</span>
      <span class="cell-meta">${list.length} ${list.length === 1 ? "watch" : "watches"}${from ? h`, from ${naira(from)}` : ""}</span>
      <span class="cell-arrow" aria-hidden="true">&rarr;</span>
    </a>`;
  });

  return {
    title: "Regis | Time, by appointment.",
    html: h`
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">A considered collection</p>
        <h1 id="hero-title">Time,<br><em>by appointment.</em></h1>
        <p class="lede">Considered wristwatches for men, women and everyone. Insured delivery across Nigeria.</p>
        <p class="actions"><a class="btn" href="/collection">View the collection</a><a class="textlink" href="/orders">Track an order</a></p>
      </div>
      <div class="hero-clock">${clockSvg()}</div>
    </section>

    <section class="section" aria-labelledby="three-h">
      <h2 id="three-h" class="section-title">Three ways to tell the time.</h2>
      <div class="cells">${cells}</div>
    </section>

    <section class="section" aria-labelledby="books-h">
      <div class="section-row"><h2 id="books-h" class="section-title">On the books</h2><a class="textlink" href="/collection">See all</a></div>
      <div class="grid four">${slots(picks, 4, 4)}</div>
    </section>

    <section class="section" aria-labelledby="prom-h">
      <h2 id="prom-h" class="sr-only">What you can count on</h2>
      <ul class="promise">
        <li><h3>The price is the price.</h3><p>What you see is what you pay. We never add card, handling or delivery charges.</p></li>
        <li><h3>Insured, door to door.</h3><p>Every order is insured and has a tracking page from payment to delivery.</p></li>
        <li><h3>Paid safely.</h3><p>Checkout runs on Paystack, with cards, bank transfer and USSD.</p></li>
      </ul>
    </section>

    <section class="section list" aria-labelledby="nl-h">
      <h2 id="nl-h" class="section-title">The list</h2>
      <p class="lede">New pieces and restocks, rarely and only if you ask.</p>
      ${newsletterForm("nl-home")}
    </section>`,
    mount(root) {
      bindNewsletter(root, "nl-home");
      return runClock($<SVGElement>(".clock", root)! as SVGElement);
    },
  };
}
