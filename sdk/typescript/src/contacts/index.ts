export * from "./types.js";
export * from "./facts.js";
export * from "./correspondence.js";
export * from "./resources/communicationPolicy.js";
export type {
  CreateContactOptions,
  ContactCreatePermissions,
  ListContactsOptions,
  LookupContactsOptions,
  ContactMergeField,
  MergeContactsOptions,
  UpdateContactOptions,
} from "./resources/contacts.js";
export type {
  ContactCorrespondenceOptions,
  GetContactCorrespondenceOptions,
} from "./resources/correspondence.js";
export type {
  ContactFactsResource,
  CreateContactFactOptions,
  ListContactFactsOptions,
  UpdateContactFactOptions,
} from "./resources/contactFacts.js";
export type { ContactCorrespondenceResource } from "./resources/correspondence.js";
