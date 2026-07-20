export * from "./types.js";
export * from "./facts.js";
export * from "./correspondence.js";
export type {
  CreateContactOptions,
  GetContactOptions,
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
export type { ContactFactsResource } from "./resources/contactFacts.js";
export type { ContactCorrespondenceResource } from "./resources/correspondence.js";
