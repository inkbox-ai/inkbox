//! Additive directional contact-rule options and responses.

use serde::{Deserialize, Serialize};

/// Coverage of a contact rule. Inbound/outbound list filters also include Both.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactRuleDirection {
    Inbound,
    Outbound,
    #[default]
    Both,
}

/// One side of an atomic action edit; the addressed rule must cover this side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactRuleApplyTo {
    Inbound,
    Outbound,
}

/// Existing rule fields plus coverage. Older responses default to Both.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectionalContactRule<T> {
    #[serde(flatten)]
    pub rule: T,
    #[serde(default)]
    pub direction: ContactRuleDirection,
}

impl<T> std::ops::Deref for DirectionalContactRule<T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.rule
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactRuleCreateOptions<A, M> {
    pub action: A,
    pub match_type: M,
    pub match_target: String,
    /// Omission uses Both and preserves the legacy request shape.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<ContactRuleDirection>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactRuleUpdateOptions<A> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<A>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<ContactRuleDirection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apply_to: Option<ContactRuleApplyTo>,
}

impl<A> Default for ContactRuleUpdateOptions<A> {
    fn default() -> Self {
        Self {
            action: None,
            direction: None,
            apply_to: None,
        }
    }
}

impl<A> ContactRuleUpdateOptions<A> {
    pub(crate) fn validate(&self) -> crate::Result<()> {
        if self.action.is_none() && self.direction.is_none() {
            return Err(crate::InkboxError::InvalidArgument(
                "action or direction is required".into(),
            ));
        }
        if self.apply_to.is_some() && (self.action.is_none() || self.direction.is_some()) {
            return Err(crate::InkboxError::InvalidArgument(
                "apply_to requires action and cannot be combined with direction".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ContactRuleListOptions<A, M> {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<A>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_type: Option<M>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<ContactRuleDirection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i64>,
}

impl<A, M> Default for ContactRuleListOptions<A, M> {
    fn default() -> Self {
        Self {
            action: None,
            match_type: None,
            direction: None,
            limit: None,
            offset: None,
        }
    }
}

impl<A: Serialize, M: Serialize> ContactRuleListOptions<A, M> {
    pub(crate) fn query(&self) -> crate::Result<Vec<(&'static str, String)>> {
        let value = serde_json::to_value(self)?;
        Ok(["action", "match_type", "direction", "limit", "offset"]
            .into_iter()
            .filter_map(|key| {
                value.get(key).map(|v| {
                    (
                        key,
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string()),
                    )
                })
            })
            .collect())
    }
}

pub(crate) fn parse_list<T: serde::de::DeserializeOwned>(
    mut value: serde_json::Value,
) -> crate::Result<Vec<T>> {
    if let Some(items) = value.get_mut("items") {
        value = items.take();
    }
    Ok(serde_json::from_value(value)?)
}

macro_rules! directional_rule_methods {
    ($resource:ident, $rule:ty, $action:ty, $match_type:ty, $filter:literal, $id:ty) => {
        impl $resource {
            /// List applicable rules, including Both for a one-direction filter.
            pub fn list_with_options(
                &self,
                owner: &str,
                options: &crate::contact_rules::ContactRuleListOptions<$action, $match_type>,
            ) -> crate::Result<Vec<crate::contact_rules::DirectionalContactRule<$rule>>> {
                crate::contact_rules::parse_list(
                    self.http.get(&rule_path(owner, None), &options.query()?)?,
                )
            }

            pub fn list_all_with_options(
                &self,
                owner_id: Option<$id>,
                options: &crate::contact_rules::ContactRuleListOptions<$action, $match_type>,
            ) -> crate::Result<Vec<crate::contact_rules::DirectionalContactRule<$rule>>> {
                let mut query = options.query()?;
                if let Some(id) = owner_id {
                    query.push(($filter, id.to_string()));
                }
                crate::contact_rules::parse_list(self.http.get(ORG_BASE, &query)?)
            }

            pub fn get_with_options(
                &self,
                owner: &str,
                rule_id: &str,
            ) -> crate::Result<crate::contact_rules::DirectionalContactRule<$rule>> {
                Ok(serde_json::from_value(self.http.get(
                    &rule_path(owner, Some(rule_id)),
                    crate::http::NO_QUERY,
                )?)?)
            }

            /// Save coverage. A successful create may widen an existing rule with the same ID.
            pub fn create_with_options(
                &self,
                owner: &str,
                options: &crate::contact_rules::ContactRuleCreateOptions<$action, $match_type>,
            ) -> crate::Result<crate::contact_rules::DirectionalContactRule<$rule>> {
                Ok(serde_json::from_value(self.http.post(
                    &rule_path(owner, None),
                    Some(options),
                    crate::http::NO_QUERY,
                )?)?)
            }

            /// Edit coverage or atomically edit one covered side while preserving the other.
            pub fn update_with_options(
                &self,
                owner: &str,
                rule_id: &str,
                options: &crate::contact_rules::ContactRuleUpdateOptions<$action>,
            ) -> crate::Result<crate::contact_rules::DirectionalContactRule<$rule>> {
                options.validate()?;
                Ok(serde_json::from_value(
                    self.http.patch(&rule_path(owner, Some(rule_id)), options)?,
                )?)
            }
        }
    };
}
pub(crate) use directional_rule_methods;
