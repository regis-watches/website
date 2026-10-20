//! Regis payments service (Rust).
//!
//! This is the ONLY process that knows the Paystack secret key. The web app and the core service never see it.
//!
//! Money rule: the customer is charged exactly the amount the core service sends (the catalogue price).
//! Paystack's `bearer` is set to `account`, so Paystack deducts its fee from the merchant's settlement,
//! and the fee reported on the transaction is passed back so the core can record net = price - fee.
//!
//! Without PAYSTACK_SECRET_KEY (and outside production) it runs in MOCK mode with a local test checkout page,
//! so the whole shop can be demonstrated offline.

mod fee;

use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha512;
use subtle::ConstantTimeEq;

type HmacSha512 = Hmac<Sha512>;
type ApiError = (StatusCode, Json<Value>);
type ApiResult = Result<Json<Value>, ApiError>;

struct MockTx {
    amount_kobo: u64,
    email: String,
    callback: String,
    paid: bool,
}

#[derive(Clone)]
struct AppState {
    http: reqwest::Client,
    secret: Option<String>,
    token: String,
    fee: fee::FeeConfig,
    mock: Arc<Mutex<HashMap<String, MockTx>>>,
    mock_base: String,
}

fn err(status: StatusCode, msg: &str) -> ApiError {
    (status, Json(json!({ "error": msg })))
}

fn authorize(headers: &HeaderMap, st: &AppState) -> Result<(), ApiError> {
    let given = headers
        .get("x-internal-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if bool::from(given.as_bytes().ct_eq(st.token.as_bytes())) {
        Ok(())
    } else {
        Err(err(StatusCode::UNAUTHORIZED, "unauthorized"))
    }
}

fn valid_ref(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn signature_valid(secret: &str, body: &[u8], header: &str) -> bool {
    let Ok(mut mac) = HmacSha512::new_from_slice(secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    let expected = hex::encode(mac.finalize().into_bytes());
    bool::from(expected.as_bytes().ct_eq(header.trim().to_ascii_lowercase().as_bytes()))
}

fn normalize(data: &Value, cfg: &fee::FeeConfig) -> Value {
    let amount = data["amount"].as_u64().unwrap_or(0);
    let (fees, estimated) = match data["fees"].as_u64() {
        Some(f) => (f, false),
        None => (cfg.estimate(amount), true),
    };
    let a = &data["authorization"];
    let authorization = if a.is_object() {
        json!({
            "authorization_code": a["authorization_code"].as_str().unwrap_or(""),
            "signature": a["signature"].as_str().unwrap_or(""),
            "last4": a["last4"].as_str().unwrap_or(""),
            "card_type": a["card_type"].as_str().unwrap_or(""),
            "exp_month": a["exp_month"].as_str().unwrap_or(""),
            "exp_year": a["exp_year"].as_str().unwrap_or(""),
            "bank": a["bank"].as_str().unwrap_or(""),
            "reusable": a["reusable"].as_bool().unwrap_or(false),
        })
    } else {
        Value::Null
    };
    json!({
        "status": data["status"].as_str().unwrap_or("unknown"),
        "reference": data["reference"].as_str().unwrap_or(""),
        "amount_kobo": amount,
        "currency": data["currency"].as_str().unwrap_or(""),
        "fees_kobo": fees,
        "fees_estimated": estimated,
        "paid_at": data["paid_at"].as_str(),
        "authorization": authorization,
    })
}

async fn paystack_call(st: &AppState, req: reqwest::RequestBuilder) -> Result<Value, ApiError> {
    let secret = st
        .secret
        .as_ref()
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "paystack is not configured"))?;
    let res = req.bearer_auth(secret).send().await.map_err(|e| {
        eprintln!("paystack request failed: {e}");
        err(StatusCode::BAD_GATEWAY, "paystack unreachable")
    })?;
    let http_ok = res.status().is_success();
    let body: Value = res
        .json()
        .await
        .map_err(|_| err(StatusCode::BAD_GATEWAY, "unreadable paystack response"))?;
    if !http_ok || body["status"].as_bool() != Some(true) {
        eprintln!("paystack rejected: {}", body["message"].as_str().unwrap_or("no message"));
        return Err(err(StatusCode::BAD_GATEWAY, "paystack rejected the request"));
    }
    Ok(body["data"].clone())
}

// ---------------------------------------------------------------- initialize

#[derive(Deserialize)]
struct InitReq {
    reference: String,
    email: String,
    amount_kobo: u64,
    callback_url: String,
    order_ref: String,
}

async fn initialize(State(st): State<AppState>, headers: HeaderMap, Json(req): Json<InitReq>) -> ApiResult {
    authorize(&headers, &st)?;
    if !valid_ref(&req.reference)
        || !valid_ref(&req.order_ref)
        || req.amount_kobo < 10_000
        || req.email.len() > 254
        || !req.email.contains('@')
        || !(req.callback_url.starts_with("http://") || req.callback_url.starts_with("https://"))
    {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "invalid request"));
    }

    if st.secret.is_none() {
        st.mock.lock().unwrap().insert(
            req.reference.clone(),
            MockTx { amount_kobo: req.amount_kobo, email: req.email.clone(), callback: req.callback_url.clone(), paid: false },
        );
        return Ok(Json(json!({
            "authorization_url": format!("{}/mock/checkout/{}", st.mock_base, req.reference),
            "access_code": "mock",
            "reference": req.reference,
        })));
    }

    // The amount is exactly what the core computed from the catalogue. No fee is added.
    let body = json!({
        "email": req.email,
        "amount": req.amount_kobo,
        "currency": "NGN",
        "reference": req.reference,
        "callback_url": req.callback_url,
        "bearer": "account",
        "metadata": { "order_ref": req.order_ref },
    });
    let data = paystack_call(&st, st.http.post("https://api.paystack.co/transaction/initialize").json(&body)).await?;
    Ok(Json(json!({
        "authorization_url": data["authorization_url"],
        "access_code": data["access_code"],
        "reference": data["reference"],
    })))
}

// -------------------------------------------------------------------- verify

async fn verify(State(st): State<AppState>, headers: HeaderMap, Path(reference): Path<String>) -> ApiResult {
    authorize(&headers, &st)?;
    if !valid_ref(&reference) {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "invalid reference"));
    }
    if st.secret.is_none() {
        let map = st.mock.lock().unwrap();
        let tx = map.get(&reference).ok_or_else(|| err(StatusCode::NOT_FOUND, "unknown reference"))?;
        let status = if tx.paid { "success" } else { "abandoned" };
        let data = json!({
            "status": status,
            "reference": reference,
            "amount": tx.amount_kobo,
            "currency": "NGN",
            "paid_at": "",
            "authorization": {
                "authorization_code": "AUTH_MOCK", "signature": "SIG_MOCK", "last4": "4081", "card_type": "visa",
                "exp_month": "12", "exp_year": "2032", "bank": "MOCK BANK", "reusable": true
            }
        });
        return Ok(Json(normalize(&data, &st.fee)));
    }
    let url = format!("https://api.paystack.co/transaction/verify/{reference}");
    let data = paystack_call(&st, st.http.get(url)).await?;
    Ok(Json(normalize(&data, &st.fee)))
}

// -------------------------------------------------------------------- charge

#[derive(Deserialize)]
struct ChargeReq {
    reference: String,
    email: String,
    amount_kobo: u64,
    authorization_code: String,
}

async fn charge(State(st): State<AppState>, headers: HeaderMap, Json(req): Json<ChargeReq>) -> ApiResult {
    authorize(&headers, &st)?;
    let code_ok = !req.authorization_code.is_empty()
        && req.authorization_code.len() <= 64
        && req.authorization_code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    if !valid_ref(&req.reference) || req.amount_kobo < 10_000 || !req.email.contains('@') || !code_ok {
        return Err(err(StatusCode::UNPROCESSABLE_ENTITY, "invalid request"));
    }
    if st.secret.is_none() {
        st.mock.lock().unwrap().insert(
            req.reference.clone(),
            MockTx { amount_kobo: req.amount_kobo, email: req.email.clone(), callback: String::new(), paid: true },
        );
        let data = json!({ "status": "success", "reference": req.reference, "amount": req.amount_kobo, "currency": "NGN" });
        return Ok(Json(normalize(&data, &st.fee)));
    }
    let body = json!({
        "authorization_code": req.authorization_code,
        "email": req.email,
        "amount": req.amount_kobo,
        "currency": "NGN",
        "reference": req.reference,
    });
    let data = paystack_call(&st, st.http.post("https://api.paystack.co/transaction/charge_authorization").json(&body)).await?;
    Ok(Json(normalize(&data, &st.fee)))
}

// ------------------------------------------------------------------- webhook

async fn webhook(State(st): State<AppState>, headers: HeaderMap, body: Bytes) -> ApiResult {
    authorize(&headers, &st)?; // only the core service may ask us to check a signature
    let Some(secret) = st.secret.as_ref() else {
        return Ok(Json(json!({ "valid": false })));
    };
    let sig = headers.get("x-paystack-signature").and_then(|v| v.to_str().ok()).unwrap_or("");
    if !signature_valid(secret, &body, sig) {
        return Ok(Json(json!({ "valid": false })));
    }
    let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    Ok(Json(json!({
        "valid": true,
        "event": v["event"].as_str().unwrap_or(""),
        "reference": v["data"]["reference"].as_str().unwrap_or(""),
    })))
}

// ------------------------------------------------------- mock checkout (dev)

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

async fn mock_page(State(st): State<AppState>, Path(reference): Path<String>) -> Response {
    if st.secret.is_some() || !valid_ref(&reference) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let map = st.mock.lock().unwrap();
    let Some(tx) = map.get(&reference) else { return StatusCode::NOT_FOUND.into_response() };
    let naira = tx.amount_kobo / 100;
    let page = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test checkout | Regis</title>
<style>
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F5ED;font-family:system-ui,sans-serif;color:#231F20}}
main{{background:#F7F5ED;padding:2.5rem;max-width:26rem;width:calc(100% - 2rem);border:1px solid #231F20}}
small{{letter-spacing:.14em;text-transform:uppercase;font-size:.7rem}}
h1{{font-family:Georgia,serif;font-weight:400;font-size:2.4rem;margin:.4rem 0 1rem}}
p{{line-height:1.5}}
a{{display:block;text-align:center;background:#231F20;color:#F7F5ED;border:1px solid #231F20;padding:1rem;text-decoration:none;margin-top:1.5rem}}
a:focus-visible,a:hover{{background:#F7F5ED;color:#231F20}}
</style></head><body><main>
<small>Test mode, no real money moves</small>
<h1>&#8358;{naira}</h1>
<p>Order {reference}<br>{email}</p>
<p>This stands in for the Paystack page while no PAYSTACK_SECRET_KEY is set. Add your key to go live.</p>
<a href="/mock/pay/{reference}">Pay &#8358;{naira} (test)</a>
</main></body></html>"#,
        naira = naira,
        reference = esc(&reference),
        email = esc(&tx.email),
    );
    Html(page).into_response()
}

async fn mock_pay(State(st): State<AppState>, Path(reference): Path<String>) -> Response {
    if st.secret.is_some() || !valid_ref(&reference) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mut map = st.mock.lock().unwrap();
    let Some(tx) = map.get_mut(&reference) else { return StatusCode::NOT_FOUND.into_response() };
    tx.paid = true;
    let sep = if tx.callback.contains('?') { '&' } else { '?' };
    Redirect::to(&format!("{}{}reference={}&trxref={}", tx.callback, sep, reference, reference)).into_response()
}

async fn healthz() -> &'static str {
    "ok"
}

#[tokio::main]
async fn main() {
    let secret = std::env::var("PAYSTACK_SECRET_KEY").ok().filter(|s| !s.trim().is_empty());
    let production = std::env::var("APP_ENV").map(|v| v == "production").unwrap_or(false);
    let token = std::env::var("INTERNAL_TOKEN").unwrap_or_default();

    if production && secret.is_none() {
        panic!("PAYSTACK_SECRET_KEY is required in production");
    }
    if production && token.len() < 32 {
        panic!("INTERNAL_TOKEN must be 32+ characters in production");
    }
    let token = if token.is_empty() { "dev-internal-token-change-me-0000000000".to_string() } else { token };
    if secret.is_none() {
        eprintln!("payments: MOCK MODE (no PAYSTACK_SECRET_KEY). Nothing real will be charged.");
    }

    let port: u16 = std::env::var("PAYMENTS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8101);
    let state = AppState {
        http: reqwest::Client::builder().timeout(Duration::from_secs(20)).build().expect("http client"),
        secret,
        token,
        fee: fee::FeeConfig::from_env(),
        mock: Arc::new(Mutex::new(HashMap::new())),
        mock_base: std::env::var("PAYMENTS_PUBLIC_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{port}")),
    };

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/internal/initialize", post(initialize))
        .route("/internal/verify/:reference", get(verify))
        .route("/internal/charge", post(charge))
        .route("/internal/webhook", post(webhook))
        .route("/mock/checkout/:reference", get(mock_page))
        .route("/mock/pay/:reference", get(mock_pay))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port)); // loopback only
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    println!("payments listening on http://{addr}");
    axum::serve(listener, app).await.expect("server");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_valid_signature() {
        let sig = "a64f9d544d65c9aeab4a7f4c13aad05164c31660900845c0a4c210911c8d42b73712751edb74535a8abd175678d732d611e8e0c3b497f297df883ea36718747e";
        assert!(signature_valid("sk_test_abc", br#"{"event":"charge.success"}"#, sig));
    }

    #[test]
    fn rejects_tampered_body_or_wrong_key() {
        let sig = "a64f9d544d65c9aeab4a7f4c13aad05164c31660900845c0a4c210911c8d42b73712751edb74535a8abd175678d732d611e8e0c3b497f297df883ea36718747e";
        assert!(!signature_valid("sk_test_abc", br#"{"event":"charge.failed"}"#, sig));
        assert!(!signature_valid("sk_test_other", br#"{"event":"charge.success"}"#, sig));
        assert!(!signature_valid("sk_test_abc", b"{}", ""));
    }

    #[test]
    fn references_cannot_inject_paths() {
        assert!(valid_ref("RG-ABCD2345"));
        assert!(!valid_ref("../../secrets"));
        assert!(!valid_ref("a/b"));
        assert!(!valid_ref(""));
    }

    #[test]
    fn real_fee_wins_over_estimate() {
        let cfg = fee::FeeConfig::from_env();
        let v = normalize(&json!({"status":"success","amount":2000000,"fees":20000,"currency":"NGN"}), &cfg);
        assert_eq!(v["fees_kobo"], 20000);
        assert_eq!(v["fees_estimated"], false);
    }
}
