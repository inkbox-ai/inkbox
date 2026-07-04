//! [`Inkbox`]: org-level entry point for all Inkbox APIs.
//!
//! Faithful port of `inkbox/client.py`. One transport per API sub-base, a
//! shared [`CookieJar`], and a resource accessor per domain. Because
//! [`AgentIdentity`] and [`crate::tunnels::resources::tunnels::TunnelsResource`]
//! hold a back-reference to the client, the client is always handed out as an
//! `Arc<Inkbox>` (built with [`Arc::new_cyclic`] so the tunnels resource can
//! capture a `Weak` without a reference cycle).

use std::sync::{Arc, Weak};

use serde_json::Value;
use url::Url;

use crate::agent_identity::AgentIdentity;
use crate::agent_signup::types::{
    AgentSignupResendResponse, AgentSignupResponse, AgentSignupStatusResponse,
    AgentSignupVerifyResponse,
};
use crate::api_keys::resources::api_keys::ApiKeysResource;
use crate::contacts::resources::contacts::ContactsResource;
use crate::cookies::CookieJar;
use crate::error::{ApiErrorDetail, InkboxError, Result};
use crate::http::{default_timeout, HttpTransport, NO_QUERY};
use crate::identities::resources::identities::IdentitiesResource;
use crate::identities::types::{
    AgentIdentitySummary, IdentityMailboxCreateOptions, IdentityPhoneNumberCreateOptions,
    IdentityTunnelCreateOptions, Unset, VaultSecretIds,
};
use crate::imessage::resources::contact_rules::IMessageContactRulesResource;
use crate::imessage::resources::imessages::IMessagesResource;
use crate::mail::resources::contact_rules::MailContactRulesResource;
use crate::mail::resources::domains::DomainsResource;
use crate::mail::resources::identity_contact_rules::MailIdentityContactRulesResource;
use crate::mail::resources::mailboxes::MailboxesResource;
use crate::mail::resources::messages::MessagesResource;
use crate::mail::resources::threads::ThreadsResource;
use crate::notes::resources::notes::NotesResource;
use crate::phone::resources::calls::CallsResource;
use crate::phone::resources::contact_rules::PhoneContactRulesResource;
use crate::phone::resources::hosted_realtime::HostedRealtimeResource;
use crate::phone::resources::identity_contact_rules::PhoneIdentityContactRulesResource;
use crate::phone::resources::incoming_call_action::IncomingCallActionResource;
use crate::phone::resources::numbers::PhoneNumbersResource;
use crate::phone::resources::sms_opt_ins::SmsOptInsResource;
use crate::phone::resources::texts::TextsResource;
use crate::signing_keys::{SigningKey, SigningKeysResource};
use crate::tunnels::resources::tunnels::TunnelsResource;
use crate::vault::resources::vault::VaultResource;
use crate::webhooks::deliveries::WebhookDeliveriesResource;
use crate::webhooks::subscriptions::WebhookSubscriptionsResource;
use crate::whoami::types::{parse_whoami, WhoamiResponse};

/// Default API base URL. Override via [`InkboxBuilder::base_url`] for
/// self-hosting or tests.
pub const DEFAULT_BASE_URL: &str = "https://inkbox.ai";

/// `User-Agent` announcing the SDK (e.g. `inkbox-rust/0.4.17`); an optional
/// caller token goes first (`inkbox-cli/1.2.3 inkbox-rust/...`).
fn sdk_user_agent(prefix: Option<&str>) -> String {
    let base = concat!("inkbox-rust/", env!("CARGO_PKG_VERSION"));
    match prefix {
        Some(p) => format!("{p} {base}"),
        None => base.to_string(),
    }
}

/// Builder for [`Inkbox`], mirroring the Python `Inkbox(...)` keyword args.
pub struct InkboxBuilder {
    api_key: String,
    base_url: String,
    timeout_secs: f64,
    vault_key: Option<String>,
    user_agent_prefix: Option<String>,
}

impl InkboxBuilder {
    /// Override the API base URL (self-hosting / tests). Must be HTTPS unless
    /// the host is `localhost` / `127.0.0.1`.
    pub fn base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    /// Request timeout in seconds (default 30).
    pub fn timeout_secs(mut self, timeout_secs: f64) -> Self {
        self.timeout_secs = timeout_secs;
        self
    }

    /// Unlock the vault at construction so `identity.credentials()` is
    /// immediately available. Accepts a vault key or recovery code.
    pub fn vault_key(mut self, vault_key: impl Into<String>) -> Self {
        self.vault_key = Some(vault_key.into());
        self
    }

    /// Prepend a token to the `User-Agent` header (e.g. `"inkbox-cli/1.2.3"`)
    /// so a downstream tool identifies itself ahead of the SDK's own token.
    pub fn user_agent_prefix(mut self, prefix: impl Into<String>) -> Self {
        self.user_agent_prefix = Some(prefix.into());
        self
    }

    /// Build the client.
    pub fn build(self) -> Result<Arc<Inkbox>> {
        Inkbox::build(
            self.api_key,
            self.base_url,
            self.timeout_secs,
            self.vault_key,
            self.user_agent_prefix,
        )
    }
}

/// Org-level entry point for all Inkbox APIs.
///
/// ```no_run
/// use inkbox::Inkbox;
/// # fn main() -> inkbox::Result<()> {
/// let inkbox = Inkbox::new("ApiKey_...")?;
/// let identity = inkbox.create_identity("support-bot")?;
/// identity.send_email(&["customer@example.com".into()], "Hello!", Some("Hi there"),
///                      None, None, None, None, None, false)?;
/// # Ok(())
/// # }
/// ```
pub struct Inkbox {
    api_key: String,
    base_url: String,

    // Mail
    mailboxes: MailboxesResource,
    messages: MessagesResource,
    threads: ThreadsResource,
    mail_contact_rules: MailContactRulesResource,
    domains: DomainsResource,

    // Phone
    calls: CallsResource,
    phone_numbers: PhoneNumbersResource,
    texts: TextsResource,
    incoming_call_action: IncomingCallActionResource,
    hosted_realtime: HostedRealtimeResource,
    #[cfg(feature = "tunnels-runtime")]
    realtime: crate::phone::realtime::RealtimeResource,
    phone_contact_rules: PhoneContactRulesResource,
    sms_opt_ins: SmsOptInsResource,

    // Identity-keyed contact rules (forward-looking; ride the api-root transport).
    mail_identity_contact_rules: MailIdentityContactRulesResource,
    phone_identity_contact_rules: PhoneIdentityContactRulesResource,

    // iMessage
    imessages: IMessagesResource,
    imessage_contact_rules: IMessageContactRulesResource,

    // Vault / contacts / notes
    vault: VaultResource,
    contacts: ContactsResource,
    notes: NotesResource,

    // Org-level
    signing_keys: SigningKeysResource,
    webhook_subscriptions: WebhookSubscriptionsResource,
    webhook_deliveries: WebhookDeliveriesResource,
    api_keys: ApiKeysResource,
    identities: IdentitiesResource,
    tunnels: TunnelsResource,

    // Transport used for the bare `/api` root (whoami, signup parity).
    root_api_http: Arc<HttpTransport>,
}

impl Inkbox {
    /// Create a client with default options (base URL `https://inkbox.ai`,
    /// 30s timeout, vault locked).
    pub fn new(api_key: impl Into<String>) -> Result<Arc<Self>> {
        Self::builder(api_key).build()
    }

    /// Start a builder for advanced options.
    pub fn builder(api_key: impl Into<String>) -> InkboxBuilder {
        InkboxBuilder {
            api_key: api_key.into(),
            base_url: DEFAULT_BASE_URL.to_string(),
            timeout_secs: default_timeout(),
            vault_key: None,
            user_agent_prefix: None,
        }
    }

    /// Build a client from the environment. Resolves `api_key` / `base_url` /
    /// `vault_key` from the matching env var (`INKBOX_API_KEY` /
    /// `INKBOX_BASE_URL` / `INKBOX_VAULT_KEY`), then from `~/.inkbox/config`.
    /// Handy for background/agent processes that don't inherit the shell's env.
    /// Errors if no API key is found anywhere.
    pub fn from_env() -> Result<Arc<Self>> {
        let (api_key, base_url, vault_key) =
            crate::config::resolve_client_settings(None, None, None);
        let api_key = api_key.ok_or_else(|| {
            InkboxError::InvalidArgument(
                "no API key found: set INKBOX_API_KEY or add 'api_key = ...' to ~/.inkbox/config"
                    .to_string(),
            )
        })?;
        let mut builder = Self::builder(api_key);
        if let Some(base_url) = base_url {
            builder = builder.base_url(base_url);
        }
        if let Some(vault_key) = vault_key {
            builder = builder.vault_key(vault_key);
        }
        builder.build()
    }

    fn build(
        api_key: String,
        base_url: String,
        timeout: f64,
        vault_key: Option<String>,
        user_agent_prefix: Option<String>,
    ) -> Result<Arc<Self>> {
        validate_base_url(&base_url)?;
        let trimmed = base_url.trim_end_matches('/');
        let api_base = format!("{trimmed}/api");
        let api_root = format!("{trimmed}/api/v1");
        let jar = Arc::new(CookieJar::new());
        let user_agent = sdk_user_agent(user_agent_prefix.as_deref());

        // One transport per sub-base, mirroring client.py.
        let mk = |suffix: &str| -> Result<Arc<HttpTransport>> {
            Ok(Arc::new(HttpTransport::new(
                &api_key,
                suffix.to_string(),
                timeout,
                jar.clone(),
                &user_agent,
            )?))
        };
        let mail_http = mk(&format!("{api_root}/mail"))?;
        let contacts_http = mk(&api_root)?;
        let phone_http = mk(&format!("{api_root}/phone"))?;
        let imessage_http = mk(&format!("{api_root}/imessage"))?;
        let ids_http = mk(&format!("{api_root}/identities"))?;
        let vault_http = mk(&format!("{api_root}/vault"))?;
        let domains_http = mk(&format!("{api_root}/domains"))?;
        let root_api_http = mk(&api_base)?;
        let api_http = mk(&api_root)?;

        let vault = VaultResource::new(vault_http, root_api_http.clone());
        if let Some(key) = vault_key.as_deref() {
            // Unlock the whole vault at construction (no identity filter), so
            // `identity.credentials()` is immediately available — matching the
            // Python `vault_key=` kwarg behaviour.
            vault.unlock(key, None)?;
        }

        // `Arc::new_cyclic` hands the tunnels resource a `Weak<Inkbox>` so it
        // can launch the runtime against this client without a refcount cycle.
        let inkbox = Arc::new_cyclic(|weak: &Weak<Inkbox>| Inkbox {
            mailboxes: MailboxesResource::new(mail_http.clone()),
            messages: MessagesResource::new(mail_http.clone()),
            threads: ThreadsResource::new(mail_http.clone()),
            mail_contact_rules: MailContactRulesResource::new(mail_http.clone()),
            domains: DomainsResource::new(domains_http.clone()),

            calls: CallsResource::new(phone_http.clone()),
            phone_numbers: PhoneNumbersResource::new(phone_http.clone()),
            texts: TextsResource::new(phone_http.clone()),
            incoming_call_action: IncomingCallActionResource::new(phone_http.clone()),
            hosted_realtime: HostedRealtimeResource::new(phone_http.clone()),
            #[cfg(feature = "tunnels-runtime")]
            realtime: crate::phone::realtime::RealtimeResource::new(
                api_key.clone(),
                trimmed.to_string(),
            ),
            phone_contact_rules: PhoneContactRulesResource::new(phone_http.clone()),
            sms_opt_ins: SmsOptInsResource::new(phone_http.clone()),

            // Identity-keyed contact rules ride the api-root transport (base
            // /api/v1) so they reach both /identities/{handle}/...-contact-rules
            // and the org-wide /mail|/phone/contact-rules with full paths.
            mail_identity_contact_rules: MailIdentityContactRulesResource::new(api_http.clone()),
            phone_identity_contact_rules: PhoneIdentityContactRulesResource::new(api_http.clone()),

            imessages: IMessagesResource::new(imessage_http.clone()),
            imessage_contact_rules: IMessageContactRulesResource::new(imessage_http.clone()),

            vault,
            contacts: ContactsResource::new(contacts_http.clone()),
            notes: NotesResource::new(contacts_http.clone()),

            signing_keys: SigningKeysResource::new(api_http.clone()),
            webhook_subscriptions: WebhookSubscriptionsResource::new(api_http.clone()),
            webhook_deliveries: WebhookDeliveriesResource::new(api_http.clone()),
            api_keys: ApiKeysResource::new(api_http.clone()),
            identities: IdentitiesResource::new(ids_http.clone()),
            tunnels: TunnelsResource::new(api_http.clone(), weak.clone()),

            root_api_http: root_api_http.clone(),
            api_key: api_key.clone(),
            base_url: trimmed.to_string(),
        });
        Ok(inkbox)
    }

    /// The API key this client authenticates with. Held for the tunnel-agent
    /// runtime, which authenticates the data-plane hello with the same key.
    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    /// The configured base URL (no trailing slash).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    // ----- Public resource accessors (mirror the Python @property names) -----

    pub fn mailboxes(&self) -> &MailboxesResource {
        &self.mailboxes
    }
    pub fn messages(&self) -> &MessagesResource {
        &self.messages
    }
    pub fn threads(&self) -> &ThreadsResource {
        &self.threads
    }
    /// Mail per-mailbox allow/block rules (+ org-wide list).
    ///
    /// Deprecated: contact rules are now keyed by agent identity — use
    /// [`Self::mail_identity_contact_rules`] (or the `identity.*_mail_contact_rule`
    /// helpers).
    #[deprecated(note = "Contact rules are now keyed by agent identity. Use \
                mail_identity_contact_rules() or identity.*_mail_contact_rule().")]
    pub fn mail_contact_rules(&self) -> &MailContactRulesResource {
        &self.mail_contact_rules
    }
    pub fn domains(&self) -> &DomainsResource {
        &self.domains
    }

    pub fn calls(&self) -> &CallsResource {
        &self.calls
    }
    pub fn phone_numbers(&self) -> &PhoneNumbersResource {
        &self.phone_numbers
    }
    pub fn texts(&self) -> &TextsResource {
        &self.texts
    }
    /// Identity-scoped inbound-call routing config (`get()` / `set()`).
    pub fn incoming_call_action(&self) -> &IncomingCallActionResource {
        &self.incoming_call_action
    }
    /// Identity-scoped platform-hosted realtime voice config
    /// (`get_config()` / `set_config()`).
    pub fn hosted_realtime(&self) -> &HostedRealtimeResource {
        &self.hosted_realtime
    }
    /// Live call observe + intervene control channel
    /// (`connect(call_id, agent_identity_id)`).
    ///
    /// Requires the `tunnels-runtime` feature (the streaming client reuses its
    /// async runtime + WebSocket frame codec).
    #[cfg(feature = "tunnels-runtime")]
    pub fn realtime(&self) -> &crate::phone::realtime::RealtimeResource {
        &self.realtime
    }
    /// Phone per-number allow/block rules (+ org-wide list).
    ///
    /// Deprecated: contact rules are now keyed by agent identity — use
    /// [`Self::phone_identity_contact_rules`] (or the
    /// `identity.*_phone_contact_rule` helpers).
    #[deprecated(note = "Contact rules are now keyed by agent identity. Use \
                phone_identity_contact_rules() or identity.*_phone_contact_rule().")]
    pub fn phone_contact_rules(&self) -> &PhoneContactRulesResource {
        &self.phone_contact_rules
    }
    pub fn sms_opt_ins(&self) -> &SmsOptInsResource {
        &self.sms_opt_ins
    }

    /// Mail per-identity allow/block rules (+ org-wide list), keyed by
    /// `agent_handle`.
    pub fn mail_identity_contact_rules(&self) -> &MailIdentityContactRulesResource {
        &self.mail_identity_contact_rules
    }
    /// Phone per-identity allow/block rules (+ org-wide list), keyed by
    /// `agent_handle`.
    pub fn phone_identity_contact_rules(&self) -> &PhoneIdentityContactRulesResource {
        &self.phone_identity_contact_rules
    }

    /// Webhook signing key management (per-identity create/rotate/status).
    pub fn signing_keys(&self) -> &SigningKeysResource {
        &self.signing_keys
    }

    pub fn imessages(&self) -> &IMessagesResource {
        &self.imessages
    }
    pub fn imessage_contact_rules(&self) -> &IMessageContactRulesResource {
        &self.imessage_contact_rules
    }

    pub fn vault(&self) -> &VaultResource {
        &self.vault
    }
    pub fn contacts(&self) -> &ContactsResource {
        &self.contacts
    }
    pub fn notes(&self) -> &NotesResource {
        &self.notes
    }

    pub fn api_keys(&self) -> &ApiKeysResource {
        &self.api_keys
    }
    pub fn identities(&self) -> &IdentitiesResource {
        &self.identities
    }
    pub fn tunnels(&self) -> &TunnelsResource {
        &self.tunnels
    }

    /// Webhook subscription management and delivery log
    /// (`inkbox.webhooks().subscriptions()` / `inkbox.webhooks().deliveries()`).
    pub fn webhooks(&self) -> WebhooksNamespace<'_> {
        WebhooksNamespace {
            subscriptions: &self.webhook_subscriptions,
            deliveries: &self.webhook_deliveries,
        }
    }

    // ----- Org-level operations -----

    /// Create a new agent identity, atomically provisioning the linked mailbox
    /// and tunnel. See `Inkbox.create_identity` in the Python SDK.
    ///
    /// `description` / `sending_domain` use the [`Unset`] sentinel: `Unset::Omit`
    /// defers to the server default, `Unset::Value(None)` forces the column/
    /// platform default, `Unset::Value(Some(..))` sets it.
    #[allow(clippy::too_many_arguments)]
    pub fn create_identity_with(
        self: &Arc<Self>,
        agent_handle: &str,
        display_name: Option<&str>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        email_local_part: Option<&str>,
        sending_domain: Unset<String>,
        tunnel: Option<&IdentityTunnelCreateOptions>,
        phone_number: Option<&IdentityPhoneNumberCreateOptions>,
        vault_secret_ids: Option<&VaultSecretIds>,
    ) -> Result<AgentIdentity> {
        // Assemble the nested mailbox spec only when a mailbox field was given,
        // matching the Python `mailbox_kwargs` construction.
        let mailbox = if email_local_part.is_some() || !sending_domain.is_omit() {
            Some(IdentityMailboxCreateOptions {
                email_local_part: email_local_part.map(|s| s.to_string()),
                sending_domain,
            })
        } else {
            None
        };
        let data = self.identities.create(
            agent_handle,
            display_name,
            description,
            imessage_enabled,
            mailbox.as_ref(),
            tunnel,
            phone_number,
            vault_secret_ids,
        )?;
        Ok(AgentIdentity::new(data, self.clone()))
    }

    /// Convenience wrapper for the common case: create an identity by handle
    /// with all options defaulted.
    pub fn create_identity(self: &Arc<Self>, agent_handle: &str) -> Result<AgentIdentity> {
        self.create_identity_with(
            agent_handle,
            None,
            Unset::Omit,
            None,
            None,
            Unset::Omit,
            None,
            None,
            None,
        )
    }

    /// Get an agent identity by handle.
    pub fn get_identity(self: &Arc<Self>, agent_handle: &str) -> Result<AgentIdentity> {
        let data = self.identities.get(agent_handle)?;
        Ok(AgentIdentity::new(data, self.clone()))
    }

    /// List all agent identities for your organisation.
    pub fn list_identities(&self) -> Result<Vec<AgentIdentitySummary>> {
        self.identities.list()
    }

    /// Return the authenticated caller's identity and auth type.
    pub fn whoami(&self) -> Result<WhoamiResponse> {
        let data = self.root_api_http.get("/whoami", NO_QUERY)?;
        parse_whoami(data)
    }

    /// Create or rotate a webhook signing key via the deprecated org-level
    /// endpoint. The plaintext key is returned once — save it immediately.
    ///
    /// Deprecated: signing keys are now per agent identity. Prefer
    /// `identity.create_signing_key()` (or
    /// `inkbox.signing_keys().create_or_rotate(agent_handle)`). With an
    /// agent-scoped API key this rotates that key's identity; with an admin key
    /// the server returns 409 ([`InkboxError::Api`]).
    #[deprecated(note = "Signing keys are now per agent identity. Use \
                identity.create_signing_key() or \
                signing_keys().create_or_rotate(agent_handle).")]
    pub fn create_signing_key(&self) -> Result<SigningKey> {
        #[allow(deprecated)]
        self.signing_keys.create_or_rotate_org()
    }

    // ----- Agent signup (associated functions — no client instance needed) ---

    /// Register a new agent (public — no API key required).
    #[allow(clippy::too_many_arguments)]
    pub fn signup(
        human_email: &str,
        note_to_human: &str,
        display_name: Option<&str>,
        agent_handle: Option<&str>,
        email_local_part: Option<&str>,
        harness: Option<&str>,
        base_url: Option<&str>,
        timeout_secs: Option<f64>,
    ) -> Result<AgentSignupResponse> {
        let mut body = serde_json::Map::new();
        body.insert("human_email".into(), human_email.into());
        body.insert("note_to_human".into(), note_to_human.into());
        if let Some(v) = display_name {
            body.insert("display_name".into(), v.into());
        }
        if let Some(v) = agent_handle {
            body.insert("agent_handle".into(), v.into());
        }
        if let Some(v) = email_local_part {
            body.insert("email_local_part".into(), v.into());
        }
        if let Some(v) = harness {
            body.insert("harness".into(), v.into());
        }
        let data = signup_request(
            "POST",
            "",
            None,
            Some(Value::Object(body)),
            base_url,
            timeout_secs,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Submit a 6-digit verification code to unlock full capabilities.
    pub fn verify_signup(
        api_key: &str,
        verification_code: &str,
        base_url: Option<&str>,
        timeout_secs: Option<f64>,
    ) -> Result<AgentSignupVerifyResponse> {
        let body = serde_json::json!({ "verification_code": verification_code });
        let data = signup_request(
            "POST",
            "/verify",
            Some(api_key),
            Some(body),
            base_url,
            timeout_secs,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Resend the verification email (5-minute cooldown).
    pub fn resend_signup_verification(
        api_key: &str,
        base_url: Option<&str>,
        timeout_secs: Option<f64>,
    ) -> Result<AgentSignupResendResponse> {
        let data = signup_request(
            "POST",
            "/resend-verification",
            Some(api_key),
            None,
            base_url,
            timeout_secs,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Check the current signup claim status and restrictions.
    pub fn get_signup_status(
        api_key: &str,
        base_url: Option<&str>,
        timeout_secs: Option<f64>,
    ) -> Result<AgentSignupStatusResponse> {
        let data = signup_request(
            "GET",
            "/status",
            Some(api_key),
            None,
            base_url,
            timeout_secs,
        )?;
        Ok(serde_json::from_value(data)?)
    }
}

/// Typed namespace for `inkbox.webhooks().subscriptions()` and
/// `inkbox.webhooks().deliveries()`.
pub struct WebhooksNamespace<'a> {
    subscriptions: &'a WebhookSubscriptionsResource,
    deliveries: &'a WebhookDeliveriesResource,
}

impl<'a> WebhooksNamespace<'a> {
    pub fn subscriptions(&self) -> &'a WebhookSubscriptionsResource {
        self.subscriptions
    }

    pub fn deliveries(&self) -> &'a WebhookDeliveriesResource {
        self.deliveries
    }
}

/// Validate that `base_url` is HTTPS (or localhost/127.0.0.1 over HTTP),
/// mirroring `Inkbox._validate_base_url`.
fn validate_base_url(base_url: &str) -> Result<()> {
    if base_url.starts_with("https://") {
        return Ok(());
    }
    let host = Url::parse(base_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()));
    match host.as_deref() {
        Some("localhost") | Some("127.0.0.1") => Ok(()),
        _ => Err(InkboxError::InvalidArgument(
            "Only HTTPS base URLs are permitted (HTTP is allowed for localhost and 127.0.0.1)."
                .into(),
        )),
    }
}

/// One-shot HTTP request for the agent-signup endpoints (a standalone
/// `reqwest::blocking::Client`, matching the Python classmethod helper).
fn signup_request(
    method: &str,
    path: &str,
    api_key: Option<&str>,
    json: Option<Value>,
    base_url: Option<&str>,
    timeout_secs: Option<f64>,
) -> Result<Value> {
    let base = base_url.unwrap_or(DEFAULT_BASE_URL);
    validate_base_url(base)?;
    let url = format!("{}/api/v1/agent-signup{}", base.trim_end_matches('/'), path);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs_f64(
            timeout_secs.unwrap_or(default_timeout()),
        ))
        .user_agent(sdk_user_agent(None))
        .build()?;
    let m = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| InkboxError::InvalidArgument(format!("bad method {method}")))?;
    let mut rb = client
        .request(m, &url)
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(key) = api_key {
        rb = rb.header("X-API-Key", key);
    }
    if let Some(j) = json {
        rb = rb.json(&j);
    }
    let resp = rb.send()?;
    let status = resp.status().as_u16();
    let text = resp.text().unwrap_or_default();
    if status >= 400 {
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("detail")
                    .and_then(|d| d.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.clone());
        return Err(InkboxError::Api {
            status_code: status,
            detail: ApiErrorDetail::Message(detail),
        });
    }
    if text.is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_str(&text)?)
}
