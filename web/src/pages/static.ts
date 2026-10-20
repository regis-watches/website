import { ApiError, api } from "../lib/api";
import { $, h, raw } from "../lib/html";
import type { SafeHtml } from "../lib/html";
import { toast } from "../lib/motion";
import type { PageResult } from "../lib/router";
import { state } from "../lib/store";
import { newsletterForm, bindNewsletter } from "./shared";

const UPDATED = "1 October 2026";

function doc(title: string, eyebrow: string, body: SafeHtml, description: string): PageResult {
  return {
    title: `${title} | Regis`,
    description,
    html: h`<article class="page prose"><header class="coll-head"><p class="eyebrow">${eyebrow}</p><h1 class="title">${title}</h1><p class="lede small">Last updated ${UPDATED}</p></header><div class="prose-body">${body}</div></article>`,
  };
}

const who = () => {
  const c = state.config;
  return h`<strong>${c?.business ?? "Regis"}</strong>${c?.support_email ? h`. Email <a href="mailto:${c.support_email}">${c.support_email}</a>` : ""}`;
};

export function about(): PageResult {
  return {
    title: "About Regis | Regis",
    description: "Why Regis exists, and what time by appointment means.",
    html: h`<article class="page prose"><header class="coll-head"><p class="eyebrow">About</p><h1 class="title">Time, by appointment.</h1></header>
      <div class="prose-body">
        <p class="big">Most of us check the time without thinking. A good watch asks you to think about it, just a little.</p>
        <p>Regis began with a simple idea: keeping time should feel like keeping an appointment. Deliberate. Unhurried. Worth showing up for.</p>
        <p>So we choose slowly. Every watch in the book has to keep honest time, sit well on a real wrist, and still look right in ten years. We would rather list thirteen watches we believe in than three hundred we do not.</p>
        <h2>How we work</h2>
        <p>We show you real photographs of the watch, with the full specification beside them. We price every piece plainly, and the price you see is the price you pay. Delivery is insured and free. When you buy, your payment goes through Paystack.</p>
        <p>If something is not right, tell us. We would much rather fix it than have you wear a watch you do not love.</p>
        <p><a class="btn" href="/collection">See the collection</a></p>
      </div></article>`,
  };
}

export function privacy(): PageResult {
  return doc("Privacy policy", "Legal", h`
    <p>This policy explains what personal data ${who()} ("Regis", "we") collects, why, and what your rights are under the Nigeria Data Protection Act 2023.</p>
    <h2>What we collect</h2>
    <ul><li><strong>Order details:</strong> your name, email, phone number, delivery address and delivery notes, so we can deliver your watch and contact you about it.</li>
    <li><strong>Account details</strong> (only if you create an account): your name, email, phone and a securely hashed password.</li>
    <li><strong>Payment information:</strong> you pay on Paystack's page. If you choose to save a card, Paystack gives us a token plus the card's brand, last four digits and expiry date, which we use to let you pay again in one step.</li>
    <li><strong>Email list:</strong> your email address, if you join the list or tick the box at checkout.</li>
    <li><strong>Technical data:</strong> your IP address and basic request information are used briefly for security and to prevent abuse.</li></ul>
    <h2>Why we use it</h2>
    <p>To process and deliver your order, to send receipts and order updates, to prevent fraud, to answer your messages, and, only if you opted in, to send you news. Our legal bases are performing our contract with you, our legitimate interest in running a safe shop, our legal obligations, and your consent for marketing and analytics.</p>
    <h2>Cookies and storage</h2>
    <p>We set one essential cookie that keeps you signed in. Your bag and your light or dark display choice are stored on your own device. If analytics is switched on and you agree to it, we use privacy-friendly analytics that does not set cookies. You can change your choice at any time with "Cookie choices" in the footer.</p>
    <h2>Who we share it with</h2>
    <p>Paystack (payment processing), our email delivery provider, and delivery couriers (name, phone and address only). We do not sell your data.</p>
    <h2>How long we keep it</h2>
    <p>Order records are kept for six years for accounting and warranty purposes. Account data is kept until you ask us to delete it. Email list addresses are kept until you unsubscribe.</p>
    <h2>Your rights</h2>
    <p>You can ask to see, correct, export or delete your data, to object to marketing, and to withdraw consent at any time. Every marketing email has a one-click unsubscribe link. To use any of these rights, <a href="/contact">contact us</a>. You may also complain to the Nigeria Data Protection Commission.</p>
    <h2>Security</h2>
    <p>Connections are encrypted, passwords are hashed, access to order data is restricted, and card payments are handled by a PCI-compliant processor.</p>`, "How Regis collects, uses and protects your personal data.");
}

export function terms(): PageResult {
  return doc("Terms of service", "Legal", h`
    <p>These terms apply when you buy from ${who()}. By placing an order you agree to them.</p>
    <h2>Orders and prices</h2>
    <p>All prices are in Nigerian naira and are the final price you pay. We do not add card, handling or delivery charges. An order is accepted when your payment is confirmed and we send you a receipt. If a watch turns out to be unavailable, we will tell you and refund you in full.</p>
    <h2>Payment</h2>
    <p>Payments are processed by Paystack.</p>
    <h2>Delivery</h2>
    <p>Delivery terms are set out on our <a href="/delivery">delivery and returns</a> page and form part of these terms.</p>
    <h2>Warranty</h2>
    <p>Each watch carries the warranty period shown on its page, covering manufacturing defects in the movement and case. It does not cover accidental damage, water damage beyond the stated water resistance, wear to straps, or unauthorised repair.</p>
    <h2>Accounts</h2>
    <p>You are responsible for keeping your password safe. Tell us at once if you think your account has been used without your permission.</p>
    <h2>Intellectual property</h2>
    <p>The Regis name, designs, text and images belong to us or our licensors. Please do not copy them without permission.</p>
    <h2>Our liability</h2>
    <p>Nothing in these terms limits your statutory rights as a consumer. Beyond that, our liability for any order is limited to the price you paid for it.</p>
    <h2>Governing law</h2>
    <p>These terms are governed by the laws of the Federal Republic of Nigeria.</p>
    <h2>Changes</h2>
    <p>We may update these terms. The version in force when you order is the one that applies to your order.</p>`, "The terms that apply when you shop with Regis.");
}

export function delivery(): PageResult {
  return doc("Delivery and returns", "Help", h`
    <h2>Delivery</h2>
    <p>Delivery is free and fully insured anywhere in Nigeria. Orders are prepared within two working days of payment. Once your order is out for delivery, we email you and the status on your <a href="/orders">order page</a> changes to "Out for Delivery". The courier will call the number you gave us, so please keep your phone on.</p>
    <p>Delivery usually takes one to five working days after dispatch, depending on the destination. Please inspect the parcel at handover and tell us straight away if it looks damaged.</p>
    <h2>Returns</h2>
    <p>Changed your mind? You can return an unworn watch, in its original packaging with all tags and papers, within 7 days of delivery. Contact us first so we can arrange collection. Once the watch passes inspection we refund the full price you paid to your original payment method.</p>
    <p>If a watch arrives faulty or not as described, we will repair, replace or refund it, at no cost to you.</p>
    <h2>Warranty and repairs</h2>
    <p>Every watch has a warranty, shown on its page. If something is wrong, <a href="/contact">contact us</a> with your order number and we will arrange an inspection.</p>
    <h2>Cancellations</h2>
    <p>You can cancel an order before it is out for delivery. After that, the returns process applies.</p>`, "How Regis delivers across Nigeria, and how returns and warranty work.");
}

export function unsubscribed(): PageResult {
  return { title: "Unsubscribed | Regis", html: h`<section class="page narrow"><p class="eyebrow">The list</p><h1 class="title">You are unsubscribed.</h1><p class="lede">We will not email you any more news. Receipts and order updates will still reach you if you order.</p><a class="btn" href="/">Back to Regis</a></section>` };
}

export function notFound(): PageResult {
  return { title: "Page not found | Regis", html: h`<section class="page narrow lost"><p class="eyebrow">Error 404</p><h1 class="title">This page missed its <em>appointment.</em></h1><p class="lede">The link may be old, or the watch may have sold out for good.</p><div class="actions"><a class="btn" href="/">Go home</a><a class="btn ghost" href="/collection">See the collection</a></div></section>` };
}

export function contact(): PageResult {
  const c = state.config;
  return {
    title: "Contact | Regis",
    description: "Talk to the Regis team about an order, a watch or a repair.",
    html: h`
    <section class="page contact">
      <header class="coll-head"><p class="eyebrow">Online-only shop</p><h1 class="title">Say hello.</h1><p class="lede">We currently operate online only. Questions about an order, a watch, or a repair? A real person will answer.</p></header>
      <div class="contact-grid">
        <div class="contact-side">
          <ul class="contact-list">
            ${c?.support_email ? h`<li><span>Email</span><a href="mailto:${c.support_email}">${c.support_email}</a></li>` : ""}
            ${c?.support_phone ? h`<li><span>Phone</span><a href="tel:${c.support_phone.replace(/[^\d+]/g, "")}">${c.support_phone}</a></li>` : ""}
            ${c?.whatsapp ? h`<li><span>WhatsApp</span><a href="https://wa.me/${c.whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener">Message us</a></li>` : ""}
          </ul>
          <p class="hint">For an order, include your order number. It looks like RG-ABCD2345.</p>
          <div class="list-mini"><p class="eyebrow">The list</p>${newsletterForm("nl-contact")}</div>
        </div>
        <form id="contact-form" class="stack" novalidate>
          <div class="field"><label for="c-name">Your name</label><input id="c-name" name="name" autocomplete="name" required maxlength="80"></div>
          <div class="field"><label for="c-email">Your email</label><input id="c-email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
          <div class="field"><label for="c-msg">Message</label><textarea id="c-msg" name="message" rows="6" required minlength="10" maxlength="2000"></textarea></div>
          <p class="err" id="c-err" role="alert"></p>
          <button class="btn" type="submit">Send message</button>
        </form>
      </div>
    </section>`,
    mount(root) {
      bindNewsletter(root, "nl-contact");
      const form = $<HTMLFormElement>("#contact-form", root)!;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = $("#c-err", root)!;
        err.textContent = "";
        try {
          await api("POST", "/api/contact", Object.fromEntries(new FormData(form).entries()));
          form.reset();
          toast("Message sent. We will reply soon.");
          err.textContent = "";
          form.insertAdjacentHTML("afterbegin", raw(`<p class="ok" role="status">Thank you. Your message is on its way.</p>`).value);
        } catch (ex) { err.textContent = ex instanceof ApiError ? ex.message : "Something went wrong."; }
      });
    },
  };
}
