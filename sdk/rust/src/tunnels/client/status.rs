//! Sampleable local state for the tunnel data-plane runtime.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::SystemTime;

use super::runtime::StatusCallback;

/// The local connection state observed by a tunnel runtime.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[non_exhaustive]
pub enum LocalTunnelStatus {
    /// The handle has not observed a running connection yet.
    #[default]
    Idle,
    /// The initial connection is being established.
    Connecting,
    /// The HELLO handshake completed and the tunnel is accepting traffic.
    Connected,
    /// A connection was lost or establishment failed and will be retried.
    Reconnecting,
    /// The runtime stopped or authentication was rejected.
    Closed,
    /// A newer client took ownership of the tunnel.
    Superseded,
}

/// An atomic snapshot of the runtime's local connection state.
#[derive(Debug, Clone)]
pub struct TunnelStatusSnapshot {
    /// Current local runtime state.
    pub status: LocalTunnelStatus,
    /// Local time of the latest successful HELLO handshake.
    pub last_connected_at: Option<SystemTime>,
}

/// Cloneable, thread-safe local liveness state for a blocking tunnel connection.
///
/// Pass [`callback`](Self::callback) to
/// [`TunnelsResource::connect_with_status`](crate::tunnels::resources::TunnelsResource::connect_with_status)
/// on a caller-owned thread, then sample a clone from another thread.
#[derive(Debug, Clone, Default)]
pub struct TunnelStatusHandle {
    inner: Arc<RwLock<TunnelStatusSnapshot>>,
}

impl Default for TunnelStatusSnapshot {
    fn default() -> Self {
        Self {
            status: LocalTunnelStatus::Idle,
            last_connected_at: None,
        }
    }
}

impl TunnelStatusHandle {
    /// Create a handle in the [`Idle`](LocalTunnelStatus::Idle) state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the current local runtime state.
    pub fn status(&self) -> LocalTunnelStatus {
        self.read().status
    }

    /// Return whether the latest observed state is `Connected`.
    pub fn is_connected(&self) -> bool {
        self.status() == LocalTunnelStatus::Connected
    }

    /// Return the local time of the latest successful HELLO handshake.
    ///
    /// The timestamp remains available while the runtime reconnects.
    pub fn last_connected_at(&self) -> Option<SystemTime> {
        self.read().last_connected_at
    }

    /// Read the status and timestamp under one lock.
    pub fn snapshot(&self) -> TunnelStatusSnapshot {
        self.read().clone()
    }

    /// Build a status callback that updates this handle before returning.
    ///
    /// Unknown future status strings leave the current snapshot unchanged.
    pub fn callback(&self) -> StatusCallback {
        let handle = self.clone();
        Box::new(move |status| handle.update(status))
    }

    fn update(&self, status: &str) {
        let status = match status {
            "connecting" => LocalTunnelStatus::Connecting,
            "connected" => LocalTunnelStatus::Connected,
            "reconnecting" => LocalTunnelStatus::Reconnecting,
            "closed" => LocalTunnelStatus::Closed,
            "superseded" => LocalTunnelStatus::Superseded,
            _ => return,
        };
        let mut snapshot = self.write();
        snapshot.status = status;
        if status == LocalTunnelStatus::Connected {
            snapshot.last_connected_at = Some(SystemTime::now());
        }
    }

    fn read(&self) -> RwLockReadGuard<'_, TunnelStatusSnapshot> {
        self.inner.read().unwrap_or_else(|err| err.into_inner())
    }

    fn write(&self) -> RwLockWriteGuard<'_, TunnelStatusSnapshot> {
        self.inner.write().unwrap_or_else(|err| err.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_tracks_lifecycle_and_retains_last_connection() {
        let handle = TunnelStatusHandle::new();
        assert_eq!(handle.status(), LocalTunnelStatus::Idle);
        assert!(!handle.is_connected());
        assert_eq!(handle.last_connected_at(), None);

        let callback = handle.callback();
        callback("connecting");
        assert_eq!(handle.status(), LocalTunnelStatus::Connecting);
        callback("connected");
        let connected_at = handle.last_connected_at().unwrap();
        assert!(handle.is_connected());

        callback("reconnecting");
        let snapshot = handle.snapshot();
        assert_eq!(snapshot.status, LocalTunnelStatus::Reconnecting);
        assert_eq!(snapshot.last_connected_at, Some(connected_at));

        callback("future-state");
        assert_eq!(handle.snapshot().last_connected_at, Some(connected_at));
        assert_eq!(handle.status(), LocalTunnelStatus::Reconnecting);
        std::thread::sleep(std::time::Duration::from_millis(2));
        callback("connected");
        let recovered_at = handle.last_connected_at().unwrap();
        assert!(recovered_at > connected_at);
        callback("superseded");
        assert_eq!(handle.status(), LocalTunnelStatus::Superseded);
        assert_eq!(handle.last_connected_at(), Some(recovered_at));
    }

    #[test]
    fn poisoned_status_lock_remains_sampleable() {
        let handle = TunnelStatusHandle::new();
        let poisoner = handle.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.inner.write().unwrap();
            panic!("poison status lock");
        })
        .join();

        assert_eq!(handle.status(), LocalTunnelStatus::Idle);
        handle.callback()("connected");
        assert!(handle.is_connected());
        assert!(handle.last_connected_at().is_some());
    }

    #[test]
    fn concurrent_updates_and_snapshots_remain_consistent() {
        let handle = TunnelStatusHandle::new();
        handle.callback()("connected");
        let first_connected_at = handle.last_connected_at().unwrap();
        let mut threads = Vec::new();

        for index in 0..8 {
            let updater = handle.clone();
            threads.push(std::thread::spawn(move || {
                let callback = updater.callback();
                for iteration in 0..1_000 {
                    if (index + iteration) % 2 == 0 {
                        callback("reconnecting");
                    } else {
                        callback("connected");
                    }
                    let snapshot = updater.snapshot();
                    if snapshot.status == LocalTunnelStatus::Connected {
                        assert!(snapshot.last_connected_at.is_some());
                    }
                }
            }));
        }
        for thread in threads {
            thread.join().unwrap();
        }

        handle.callback()("connected");
        assert!(handle.is_connected());
        assert!(handle.last_connected_at().unwrap() >= first_connected_at);
        handle.callback()("closed");
        assert_eq!(handle.status(), LocalTunnelStatus::Closed);
        assert!(handle.last_connected_at().is_some());
    }
}
