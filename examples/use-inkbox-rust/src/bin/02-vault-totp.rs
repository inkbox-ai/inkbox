//! Vault TOTP workflow.
//!
//! Creates a login credential with TOTP, generates one-time codes, then cleans
//! up. Mirrors `examples/use-inkbox-cli/02-vault-totp.sh`.
//!
//! Uses the public TOTP challenge at <https://authenticationtest.com/totpChallenge/>
//!   Email:    totp@authenticationtest.com
//!   Password: pa$$w0rd
//!   Secret:   I65VU7K5ZQL7WB4E
//!
//! Run with:  cargo run --bin 02-vault-totp

use std::env;
use std::thread::sleep;
use std::time::Duration;

use inkbox::vault::{parse_totp_uri, LoginPayload, SecretPayload};
use inkbox::{AgentIdentity, Inkbox};

const HANDLE: &str = "rust-vault-demo";
const TOTP_URI: &str = "otpauth://totp/totp@authenticationtest.com?secret=I65VU7K5ZQL7WB4E";

fn main() -> inkbox::Result<()> {
    // from_env() reads INKBOX_VAULT_KEY too and unlocks at construction. We
    // also keep the key around so we can re-unlock after creating a secret.
    let vault_key =
        env::var("INKBOX_VAULT_KEY").expect("Set INKBOX_VAULT_KEY before running this example");
    let inkbox = Inkbox::from_env()?;

    println!("=> Checking vault status");
    match inkbox.vault().info()? {
        Some(info) => println!(
            "   secrets={} keys={} recovery_keys={}",
            info.secret_count, info.key_count, info.recovery_key_count
        ),
        None => {
            println!("   Vault is not initialized — run `inkbox vault init` first.");
            return Ok(());
        }
    }

    println!("\n=> Creating identity: {HANDLE}");
    let identity = inkbox.create_identity(HANDLE)?;

    let outcome = run(&inkbox, &identity, &vault_key);
    cleanup(&identity);
    outcome
}

fn run(inkbox: &Inkbox, identity: &AgentIdentity, vault_key: &str) -> inkbox::Result<()> {
    println!("\n=> Creating login secret with TOTP");
    // create_secret stores the secret AND grants this identity access to it.
    let secret = identity.create_secret(
        "authenticationtest.com",
        &SecretPayload::Login(LoginPayload {
            password: "pa$$w0rd".into(),
            username: Some("totp@authenticationtest.com".into()),
            email: None,
            url: Some("https://authenticationtest.com/totpChallenge/".into()),
            totp: Some(parse_totp_uri(TOTP_URI)?),
            notes: None,
        }),
        None,
    )?;
    let secret_id = secret.id.to_string();
    println!("   Created secret: {secret_id}");

    // `credentials()` is a view over the snapshot taken at unlock time, so a
    // freshly created secret is not in it yet — re-unlock to pick it up.
    println!(
        "\n=> Listing login credentials for {}",
        identity.agent_handle()
    );
    println!(
        "   before re-unlock: {} login(s)",
        identity.credentials()?.list_logins().len()
    );
    inkbox.vault().unlock(vault_key, None)?;
    for login in identity.credentials()?.list_logins() {
        let has_totp = matches!(&login.payload, SecretPayload::Login(p) if p.totp.is_some());
        let username = match &login.payload {
            SecretPayload::Login(p) => p.username.clone(),
            _ => None,
        };
        println!(
            "   {} username={:?} has_totp={}",
            login.name, username, has_totp
        );
    }

    println!("\n=> Generating TOTP codes");
    for i in 1..=3 {
        // Codes are computed client-side from the decrypted secret — no server
        // round-trip for the code itself.
        let code = identity.get_totp_code(&secret_id)?;
        println!("   {} ({}s remaining)", code.code, code.seconds_remaining);
        if i < 3 {
            sleep(Duration::from_secs(5));
        }
    }

    println!("\n=> Removing TOTP from the login");
    identity.remove_totp(&secret_id)?;
    match identity.get_totp_code(&secret_id) {
        Ok(_) => println!("   unexpected: code still generated"),
        Err(e) => println!("   as expected: {e}"),
    }

    println!("\n=> Deleting the secret");
    identity.delete_secret(&secret_id)?;
    Ok(())
}

/// Delete the identity (cascades to mailbox + tunnel). Best-effort.
fn cleanup(identity: &AgentIdentity) {
    if env::var("INKBOX_KEEP_IDENTITY").is_ok() {
        println!("\n=> INKBOX_KEEP_IDENTITY set — leaving the identity in place.");
        return;
    }
    println!("\n=> Cleaning up...");
    if let Err(e) = identity.delete() {
        eprintln!("   could not delete the identity: {e}");
        return;
    }
    println!("   Done.");
}
