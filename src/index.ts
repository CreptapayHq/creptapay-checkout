/**
 * @creptapay/checkout — accept stablecoin payments with CreptaPay.
 *
 *   const crepta = new CreptaPay({ publicKey: "pk_test_..." });
 *   const payment = await crepta.initialize({ amount: 25, customer: { email, first_name, last_name } });
 *   crepta.open(payment, { onSuccess: (r) => verifyOnYourServer(r.reference) });   // modal iframe
 *   crepta.mount("#pay", payment, { onSuccess });                                   // inline iframe
 *   crepta.redirect(payment);                                                       // hosted page
 *
 * Callbacks are a UX signal only. Always confirm payment on your server
 * (webhook `payment.paid`, or GET /payment/:id with your secret key).
 */

/* ------------------------------------------------------------------ types */

export type Environment = "sandbox" | "production";

export type PaymentStatus =
    | "pending"
    | "confirming"
    | "paid"
    | "overpaid"
    | "underpaid"
    | "expired";

export interface CreptaPayOptions {
    /** Your public key (pk_test_… or pk_live_…). Never use a secret key in the browser. */
    publicKey: string;
    /** API base URL. Default: https://api.creptapay.online/v1 */
    apiUrl?: string;
    /** Hosted checkout base URL. Default: taken from the API's checkout_url. */
    checkoutUrl?: string;
}

export interface CustomerInput {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
}

export interface LineItem {
    name: string;
    amount: number;
    quantity: number;
}

export interface InitializeParams {
    /** Amount in `currency` (e.g. 25.5). Use this or `items`. */
    amount?: number;
    /** Line items; their total is charged. Use this or `amount`. */
    items?: LineItem[];
    /** Fiat currency of the amount. Default: USD. */
    currency?: "USD" | "EUR" | (string & {});
    description?: string;
    /** New or existing customer details. Use this or `customerId`. */
    customer?: CustomerInput;
    customerId?: string;
    /** https URL the hosted page returns to after payment (?reference=…&status=…). */
    redirectUrl?: string;
    /** Your own data (max 4KB), returned in webhooks and API responses. */
    metadata?: Record<string, unknown>;
    /** Pre-select a coin (e.g. "USDC"). The customer can still change it. */
    cryptoCurrency?: string;
    /** Pre-select a network (e.g. "BASE"). */
    network?: string;
    /** When the payment expires. Default: set by CreptaPay. */
    expiresAt?: Date | string;
}

export interface Payment {
    id: string;
    reference: string;
    checkoutUrl: string;
    status: PaymentStatus;
    amount: number;
    total: number;
    currency: string;
    redirectUrl: string | null;
    metadata: Record<string, unknown> | null;
    expiresAt: string | null;
    /** Full API response. */
    raw: Record<string, any>;
}

export interface PaymentResult {
    reference: string;
    status: PaymentStatus;
    amount?: number;
    currency?: string;
    cryptoAmount?: number;
    cryptoCurrency?: string;
    amountPaid?: number;
    network?: string | null;
    txHash?: string | null;
}

export interface CheckoutCallbacks {
    /** Payment fully received. Verify on your server before fulfilling. */
    onSuccess?: (result: PaymentResult) => void;
    /** Customer closed the checkout (after success too). */
    onClose?: (result: { reference: string; status?: PaymentStatus }) => void;
    /** Every status update: pending, confirming, underpaid, expired, paid. */
    onStatusChange?: (result: PaymentResult) => void;
    /** Payment window ended without full payment. */
    onExpired?: (result: PaymentResult) => void;
    /** Checkout failed to load. */
    onError?: (error: CreptaPayError) => void;
    /** Checkout finished loading. */
    onLoad?: () => void;
}

export interface OpenOptions extends CheckoutCallbacks {
    /**
     * After success, go to the payment's redirectUrl instead of staying on the page.
     * Default: true when no onSuccess is given.
     */
    redirectOnSuccess?: boolean;
    /** Close the modal automatically this many ms after success. Default 2500; false to keep open. */
    autoCloseAfterSuccess?: number | false;
}

export interface MountOptions extends CheckoutCallbacks {
    redirectOnSuccess?: boolean;
    /** Iframe height. Default "680px". */
    height?: string;
}

export interface CheckoutHandle {
    reference: string;
    /** Remove the iframe (and modal). */
    close: () => void;
}

export class CreptaPayError extends Error {
    status?: number;
    details?: unknown;
    constructor(message: string, status?: number, details?: unknown) {
        super(message);
        this.name = "CreptaPayError";
        this.status = status;
        this.details = details;
    }
}

/* -------------------------------------------------------------- constants */

const DEFAULT_API_URL = "https://api.creptapay.online/v1";
const MESSAGE_SOURCE = "creptapay-checkout";
const OVERLAY_ID = "creptapay-checkout-overlay";

type AnyPayment = string | Payment | { reference: string; checkoutUrl?: string; checkout_url?: string };

function isBrowser(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

function trimSlash(url: string) {
    return url.replace(/\/+$/, "");
}

function toResult(reference: string, payload: Record<string, any> = {}): PaymentResult {
    return {
        reference,
        status: payload.status,
        amount: payload.amount,
        currency: payload.currency,
        cryptoAmount: payload.crypto_amount,
        cryptoCurrency: payload.crypto_currency,
        amountPaid: payload.amount_paid,
        network: payload.network ?? null,
        txHash: payload.tx_hash ?? null,
    };
}

function withQuery(url: string, params: Record<string, string>) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
}

/* ------------------------------------------------------------------ client */

export class CreptaPay {
    readonly publicKey: string;
    readonly apiUrl: string;
    private checkoutBase?: string;

    constructor(options: CreptaPayOptions) {
        if (!options || !options.publicKey) {
            throw new CreptaPayError("publicKey is required");
        }
        if (options.publicKey.startsWith("sk_")) {
            throw new CreptaPayError(
                "Never use a secret key (sk_…) in the browser. Use your public key (pk_…).",
            );
        }
        if (!options.publicKey.startsWith("pk_")) {
            throw new CreptaPayError("publicKey must start with pk_");
        }
        this.publicKey = options.publicKey;
        this.apiUrl = trimSlash(options.apiUrl || DEFAULT_API_URL);
        this.checkoutBase = options.checkoutUrl ? trimSlash(options.checkoutUrl) : undefined;
    }

    /** "sandbox" for pk_test_ keys, "production" for pk_live_ keys. */
    get environment(): Environment {
        return this.publicKey.startsWith("pk_live_") ? "production" : "sandbox";
    }

    /* ---------------------------------------------------------- API calls */

    private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
        let res: Response;
        try {
            res = await fetch(`${this.apiUrl}${path}`, {
                method: init.method || "GET",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "x-api-key": this.publicKey,
                },
                body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            });
        } catch (error) {
            throw new CreptaPayError("Could not reach CreptaPay. Check your connection.", 0, error);
        }
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new CreptaPayError(json?.message || `Request failed (${res.status})`, res.status, json);
        }
        return json?.data as T;
    }

    private toPayment(data: Record<string, any>): Payment {
        const checkoutUrl: string =
            data.checkout_url ||
            (this.checkoutBase ? `${this.checkoutBase}/${data.reference}` : "");
        if (!this.checkoutBase && data.checkout_url) {
            try {
                const u = new URL(data.checkout_url);
                this.checkoutBase = `${u.origin}`;
            } catch {
                /* ignore */
            }
        }
        return {
            id: String(data.id ?? data._id ?? ""),
            reference: data.reference,
            checkoutUrl,
            status: data.status,
            amount: data.amount,
            total: data.total,
            currency: data.currency,
            redirectUrl: data.redirect_url ?? null,
            metadata: data.metadata ?? null,
            expiresAt: data.expires_at ?? null,
            raw: data,
        };
    }

    /** Create a payment. Returns its reference and hosted checkout URL. */
    async initialize(params: InitializeParams): Promise<Payment> {
        if (!params) throw new CreptaPayError("initialize() needs parameters");
        if (params.amount == null && !(params.items && params.items.length)) {
            throw new CreptaPayError("Provide amount or items");
        }
        if (params.amount != null && !(Number(params.amount) > 0)) {
            throw new CreptaPayError("amount must be greater than 0");
        }
        if (!params.customer && !params.customerId) {
            throw new CreptaPayError("Provide customer { email, first_name, last_name } or customerId");
        }
        if (params.customer && !params.customer.email) {
            throw new CreptaPayError("customer.email is required");
        }

        const data = await this.request<Record<string, any>>("/payment", {
            method: "POST",
            body: {
                amount: params.amount,
                items: params.items,
                currency: params.currency || "USD",
                description: params.description,
                customer: params.customer,
                customer_id: params.customerId,
                redirect_url: params.redirectUrl,
                metadata: params.metadata,
                crypto_currency: params.cryptoCurrency,
                network: params.network,
                expires_at:
                    params.expiresAt instanceof Date ? params.expiresAt.toISOString() : params.expiresAt,
            },
        });
        return this.toPayment(data);
    }

    /**
     * Current status of a payment (public key). Handy for UI updates.
     * For fulfilment decisions use a webhook or your secret key on your server.
     */
    async getPayment(reference: string): Promise<Payment> {
        const data = await this.request<Record<string, any>>(
            `/payment/reference/${encodeURIComponent(reference)}`,
        );
        return this.toPayment(data);
    }

    /* ------------------------------------------------------- presentation */

    private resolveUrl(payment: AnyPayment): { reference: string; url: string } {
        if (typeof payment === "string") {
            if (/^https?:\/\//i.test(payment)) {
                const u = new URL(payment);
                const reference = u.pathname.split("/").filter(Boolean).pop() || "";
                return { reference, url: payment };
            }
            if (!this.checkoutBase) {
                throw new CreptaPayError(
                    "Pass the Payment from initialize(), a checkout URL, or set `checkoutUrl` in the constructor.",
                );
            }
            return { reference: payment, url: `${this.checkoutBase}/${payment}` };
        }
        const url =
            (payment as any).checkoutUrl ||
            (payment as any).checkout_url ||
            (this.checkoutBase ? `${this.checkoutBase}/${payment.reference}` : "");
        if (!url) throw new CreptaPayError("Payment has no checkout URL");
        return { reference: payment.reference, url };
    }

    /** Send the customer to the hosted checkout page (full-page redirect). */
    redirect(payment: AnyPayment): void {
        if (!isBrowser()) throw new CreptaPayError("redirect() only works in the browser");
        window.location.assign(this.resolveUrl(payment).url);
    }

    /** Open the checkout in a modal over your page. */
    open(payment: AnyPayment, options: OpenOptions = {}): CheckoutHandle {
        if (!isBrowser()) throw new CreptaPayError("open() only works in the browser");
        const { reference, url } = this.resolveUrl(payment);

        document.getElementById(OVERLAY_ID)?.remove();

        const overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "CreptaPay checkout");
        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            zIndex: "2147483647",
            background: "rgba(8, 10, 20, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            boxSizing: "border-box",
        } as CSSStyleDeclaration);

        const frameWrap = document.createElement("div");
        Object.assign(frameWrap.style, {
            position: "relative",
            width: "100%",
            maxWidth: "480px",
            height: "min(760px, 100%)",
            borderRadius: "16px",
            overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,0.45)",
            background: "#0D0F1A",
        } as CSSStyleDeclaration);

        const close = document.createElement("button");
        close.type = "button";
        close.setAttribute("aria-label", "Close checkout");
        close.textContent = "×";
        Object.assign(close.style, {
            position: "absolute",
            top: "8px",
            right: "10px",
            zIndex: "1",
            width: "32px",
            height: "32px",
            border: "none",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.12)",
            color: "#fff",
            fontSize: "22px",
            lineHeight: "32px",
            cursor: "pointer",
        } as CSSStyleDeclaration);

        const iframe = this.createIframe(url, "100%");
        frameWrap.appendChild(close);
        frameWrap.appendChild(iframe);
        overlay.appendChild(frameWrap);

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        document.body.appendChild(overlay);

        let lastStatus: PaymentStatus | undefined;
        let closed = false;
        const destroy = () => {
            if (closed) return;
            closed = true;
            stop();
            document.removeEventListener("keydown", onKey);
            overlay.remove();
            document.body.style.overflow = prevOverflow;
        };
        const userClose = () => {
            destroy();
            options.onClose?.({ reference, status: lastStatus });
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") userClose();
        };
        close.addEventListener("click", userClose);
        document.addEventListener("keydown", onKey);

        const stop = this.listen(iframe, url, reference, {
            ...options,
            onStatusChange: (r) => {
                lastStatus = r.status;
                options.onStatusChange?.(r);
            },
            onSuccess: (r) => {
                lastStatus = r.status;
                options.onSuccess?.(r);
                const redirect = options.redirectOnSuccess ?? !options.onSuccess;
                if (redirect) {
                    this.followRedirect(reference, r.status);
                    return;
                }
                const delay = options.autoCloseAfterSuccess ?? 2500;
                if (delay !== false) {
                    setTimeout(() => {
                        if (!closed) userClose();
                    }, delay);
                }
            },
            onRequestClose: userClose,
        });

        return { reference, close: userClose };
    }

    /** Embed the checkout inline inside an element on your page. */
    mount(container: string | HTMLElement, payment: AnyPayment, options: MountOptions = {}): CheckoutHandle {
        if (!isBrowser()) throw new CreptaPayError("mount() only works in the browser");
        const el =
            typeof container === "string" ? document.querySelector<HTMLElement>(container) : container;
        if (!el) throw new CreptaPayError(`Container ${String(container)} not found`);

        const { reference, url } = this.resolveUrl(payment);
        const iframe = this.createIframe(url, options.height || "680px");
        iframe.style.borderRadius = "16px";
        el.innerHTML = "";
        el.appendChild(iframe);

        let removed = false;
        const unmount = () => {
            if (removed) return;
            removed = true;
            stop();
            iframe.remove();
        };

        const stop = this.listen(iframe, url, reference, {
            ...options,
            onSuccess: (r) => {
                options.onSuccess?.(r);
                const redirect = options.redirectOnSuccess ?? !options.onSuccess;
                if (redirect) this.followRedirect(reference, r.status);
            },
            onRequestClose: () => {
                options.onClose?.({ reference });
            },
        });

        return { reference, close: unmount };
    }

    /**
     * One call: create the payment, then show it.
     *   mode "popup" (default) | "inline" (needs container) | "redirect"
     */
    async checkout(
        params: InitializeParams &
            OpenOptions & {
                mode?: "popup" | "inline" | "redirect";
                container?: string | HTMLElement;
                height?: string;
            },
    ): Promise<CheckoutHandle | void> {
        const payment = await this.initialize(params);
        const mode = params.mode || "popup";
        if (mode === "redirect") return this.redirect(payment);
        if (mode === "inline") {
            if (!params.container) throw new CreptaPayError('mode "inline" needs a container');
            return this.mount(params.container, payment, params);
        }
        return this.open(payment, params);
    }

    /* ------------------------------------------------------------ helpers */

    private createIframe(checkoutUrl: string, height: string): HTMLIFrameElement {
        const iframe = document.createElement("iframe");
        iframe.src = withQuery(checkoutUrl, {
            embed: "1",
            parent_origin: window.location.origin,
        });
        iframe.title = "CreptaPay checkout";
        iframe.allow = "clipboard-write";
        Object.assign(iframe.style, {
            width: "100%",
            height,
            border: "0",
            display: "block",
            background: "transparent",
        } as CSSStyleDeclaration);
        return iframe;
    }

    private listen(
        iframe: HTMLIFrameElement,
        checkoutUrl: string,
        reference: string,
        cb: CheckoutCallbacks & { onRequestClose: () => void },
    ): () => void {
        const expectedOrigin = new URL(checkoutUrl).origin;
        let succeeded = false;
        let expired = false;

        const onMessage = (event: MessageEvent) => {
            // Only trust messages from our checkout iframe.
            if (event.origin !== expectedOrigin) return;
            if (event.source !== iframe.contentWindow) return;
            const data = event.data;
            if (!data || data.source !== MESSAGE_SOURCE) return;
            if (data.reference && data.reference !== reference) return;

            const result = toResult(reference, data.payload);
            switch (data.type) {
                case "checkout.loaded":
                    cb.onLoad?.();
                    break;
                case "payment.pending":
                case "payment.confirming":
                case "payment.underpaid":
                    cb.onStatusChange?.(result);
                    break;
                case "payment.expired":
                    cb.onStatusChange?.(result);
                    if (!expired) {
                        expired = true;
                        cb.onExpired?.(result);
                    }
                    break;
                case "payment.success":
                    cb.onStatusChange?.(result);
                    if (!succeeded) {
                        succeeded = true;
                        cb.onSuccess?.(result);
                    }
                    break;
                case "checkout.close":
                    cb.onRequestClose();
                    break;
            }
        };

        const onError = () => cb.onError?.(new CreptaPayError("Checkout failed to load"));
        iframe.addEventListener("error", onError);
        window.addEventListener("message", onMessage);
        return () => {
            window.removeEventListener("message", onMessage);
            iframe.removeEventListener("error", onError);
        };
    }

    /** Go to the payment's redirect_url (if it has one) after success. */
    private async followRedirect(reference: string, status: PaymentStatus) {
        try {
            const payment = await this.getPayment(reference);
            if (payment.redirectUrl) {
                window.location.assign(
                    withQuery(payment.redirectUrl, { reference, status: payment.status || status }),
                );
            }
        } catch {
            /* stay on page */
        }
    }
}

export default CreptaPay;
