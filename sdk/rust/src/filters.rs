//! Shared, additive query filters for the comms list endpoints.

/// Optional `created_at` date-range filter shared by every comms list
/// endpoint (messages, calls, texts, text conversations, iMessages, iMessage
/// conversations).
///
/// All fields default to `None`, in which case the corresponding query
/// parameter is omitted — a `DateRangeFilter::default()` is byte-for-byte
/// identical on the wire to passing no filter at all. Pass it to the
/// `*_filtered` sibling methods (e.g. [`crate::phone::resources::calls::CallsResource::list_filtered`])
/// to narrow a listing by date without changing the original `list` signatures.
///
/// The server owns resolution: bare dates (`2026-07-01`) resolve to calendar
/// days in `tz` (default UTC) with `end_date` whole-day inclusive; datetimes
/// with an explicit `Z`/offset are exact instants (`tz` ignored); naive
/// datetimes are interpreted in `tz`. The SDK forwards the raw strings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DateRangeFilter {
    /// Inclusive `created_at` lower bound; `None` leaves the side open. UTC
    /// unless `tz` is set.
    pub start_date: Option<String>,
    /// `created_at` upper bound, whole-day inclusive for bare dates; `None`
    /// leaves the side open.
    pub end_date: Option<String>,
    /// IANA timezone name for zone-less values; `None` is UTC.
    pub tz: Option<String>,
}

impl DateRangeFilter {
    /// Append the set date-range params to a query vector. Only `Some` fields
    /// are emitted, so a default filter adds nothing to the wire.
    pub(crate) fn apply(&self, params: &mut Vec<(&'static str, String)>) {
        if let Some(v) = &self.start_date {
            params.push(("start_date", v.clone()));
        }
        if let Some(v) = &self.end_date {
            params.push(("end_date", v.clone()));
        }
        if let Some(v) = &self.tz {
            params.push(("tz", v.clone()));
        }
    }
}
