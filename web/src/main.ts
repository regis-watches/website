import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource-variable/familjen-grotesk/wght.css";
import "./styles/main.css";
import "./styles/admin.css";

import { adminPage } from "./admin/admin";
import { api } from "./lib/api";
import { afterNavigate, route, setNotFound, startRouter } from "./lib/router";
import { initTheme } from "./lib/theme";
import { refreshUser, state } from "./lib/store";
import type { SiteConfig } from "./lib/types";
import { checkout, checkoutComplete } from "./pages/checkout";
import { collection } from "./pages/collection";
import { home } from "./pages/home";
import { account, orders } from "./pages/orders";
import { about, contact, delivery, notFound, privacy, terms, unsubscribed } from "./pages/static";
import { watchPage } from "./pages/watch";
import { initChrome, markActive, renderFooter, renderHeader, showBanner, updateBagCount } from "./ui/chrome";
import { initSwatches } from "./ui/swatch";

async function boot(): Promise<void> {
  initTheme();
  initSwatches();
  try { state.config = await api<SiteConfig>("GET", "/api/config"); } catch { state.config = null; }
  await refreshUser();

  renderHeader();
  renderFooter();
  initChrome();
  showBanner();

  route("/", home);
  route("/collection", collection);
  route("/collection/:c", collection);
  route("/watch/:slug", watchPage);
  route("/checkout", checkout);
  route("/checkout/complete", checkoutComplete);
  route("/orders", orders);
  route("/account", account);
  route("/contact", async () => contact());
  route("/about", async () => about());
  route("/privacy", async () => privacy());
  route("/terms", async () => terms());
  route("/delivery", async () => delivery());
  route("/unsubscribed", async () => unsubscribed());
  route("/admin", adminPage);
  route("/admin/:tab", adminPage);
  setNotFound(async () => notFound());

  afterNavigate(() => { markActive(); updateBagCount(); });
  startRouter();
}

void boot();
