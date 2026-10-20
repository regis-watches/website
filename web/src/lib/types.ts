export type Collection = "men" | "women" | "neutral";

/** One colour or shade of a watch. Each has its own photos and stock. */
export interface WatchColor {
  id: number;
  /** Empty for a watch that comes in a single colour. */
  name: string;
  /** Swatch colour as #rrggbb, or empty. */
  hex: string;
  stock: number;
  in_stock: boolean;
  /** This colour's photos. The first one is its main photo. */
  images: string[];
}

export interface Watch {
  id: number;
  slug: string;
  name: string;
  collection: Collection;
  tagline: string;
  description: string;
  price_kobo: number;
  stock: number;
  in_stock: boolean;
  featured: boolean;
  specs: Record<string, string>;
  /** Cover photos for cards and links: the first colour that has photos. */
  images: string[];
  /** Every colour of this watch, in the order the owner set. Always at least one. */
  colors: WatchColor[];
}

export interface AdminWatchColor extends WatchColor {
  /** Stored file names of this colour's photos, in order. `images` holds the matching URLs. */
  image_names: string[];
}

export interface AdminWatch extends Omit<Watch, "colors"> {
  active: boolean;
  price_naira: number;
  colors: AdminWatchColor[];
  raw: {
    movement: string; case_mm: number; case_material: string; strap: string; water_resistance: string;
    crystal: string; power_reserve: string; warranty: string;
  };
}

export interface User {
  id: number;
  email: string;
  name: string;
  phone: string;
  role: "customer" | "admin";
}

export interface SiteConfig {
  business: string;
  support_email: string;
  support_phone: string;
  whatsapp: string;
  plausible: string;
  states: string[];
}

export interface OrderItem {
  name: string;
  /** Colour name, empty for a single-colour watch. */
  color: string;
  qty: number;
  unit_price_kobo: number;
}

export type OrderStatus = "pending_payment" | "processing" | "out_for_delivery" | "delivered" | "cancelled";

export interface OrderView {
  ref: string;
  status: OrderStatus;
  status_label: string;
  status_message: string;
  total_kobo: number;
  city: string;
  state: string;
  created_at: string;
  paid_at: string | null;
  items: OrderItem[];
  events: { status: OrderStatus; label: string; at: string }[];
}

export interface AdminOrder extends OrderView {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  fee_kobo: number | null;
  net_kobo: number | null;
  allowed: OrderStatus[];
}

export interface SavedCard {
  id: number;
  last4: string;
  brand: string;
  exp_month: string;
  exp_year: string;
  bank: string;
}

export interface Bucket {
  label: string;
  start: string;
  orders: number;
  items: number;
  gross: number;
  fees: number;
  net: number;
}

export interface Stats {
  report: {
    total: Bucket; today: Bucket; this_week: Bucket; this_month: Bucket;
    weekly: Bucket[]; monthly: Bucket[]; top: { name: string; units: number; gross: number }[];
  };
  counts: Record<string, number>;
  low_stock: { name: string; stock: number }[];
  subscribers: number;
}
