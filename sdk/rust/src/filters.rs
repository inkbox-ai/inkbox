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
/// days in `tz` (default UTC) with `end_datetime` whole-day inclusive; datetimes
/// with an explicit `Z`/offset are exact instants (`tz` ignored); naive
/// datetimes are interpreted in `tz`. The SDK forwards the raw strings.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DateRangeFilter {
    /// Inclusive `created_at` lower bound; `None` leaves the side open. UTC
    /// unless `tz` is set.
    pub start_datetime: Option<String>,
    /// `created_at` upper bound, whole-day inclusive for bare dates; `None`
    /// leaves the side open.
    pub end_datetime: Option<String>,
    /// IANA timezone name for zone-less values; `None` is UTC.
    pub tz: Option<String>,
}

impl DateRangeFilter {
    /// Append the set date-range params to a query vector. Only `Some` fields
    /// are emitted, so a default filter adds nothing to the wire.
    pub(crate) fn apply(&self, params: &mut Vec<(&'static str, String)>) {
        if let Some(v) = &self.start_datetime {
            params.push(("start_datetime", v.clone()));
        }
        if let Some(v) = &self.end_datetime {
            params.push(("end_datetime", v.clone()));
        }
        if let Some(v) = &self.tz {
            params.push(("tz", v.clone()));
        }
    }
}

/// Match conversations by any participant, or by a saved contact's active identifiers.
///
/// The variants make the selectors mutually exclusive. Existing list methods
/// remain unfiltered; pass this selector to the corresponding `*_matching` method.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationParticipantFilter {
    /// One to 100 email addresses or E.164 phone numbers, matched with OR semantics.
    Participants(Vec<String>),
    /// Resolve the accessible active email addresses and phone numbers of a contact.
    ContactId(uuid::Uuid),
}

impl ConversationParticipantFilter {
    pub(crate) fn apply(&self, params: &mut Vec<(&'static str, String)>) -> crate::Result<()> {
        match self {
            Self::Participants(values) => {
                if values.is_empty() || values.len() > 100 {
                    return Err(crate::InkboxError::InvalidArgument(
                        "participants must contain between 1 and 100 addresses".into(),
                    ));
                }
                params.extend(values.iter().cloned().map(|value| ("participants", value)));
            }
            Self::ContactId(value) => params.push(("contact_id", value.to_string())),
        }
        Ok(())
    }
}
