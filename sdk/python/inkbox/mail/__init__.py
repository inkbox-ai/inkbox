"""
inkbox.mail — mail types and exceptions.
"""

from inkbox.mail.exceptions import InkboxAPIError, InkboxError
from inkbox.contact_rules import ContactRuleDirection
from inkbox.mail.types import (
    DraftAttachment,
    DraftAttachmentContent,
    DraftDetail,
    DraftRecipients,
    DraftSendState,
    DraftSummary,
    Mailbox,
    MailImportCreateResult,
    MailImportFormat,
    MailImportJob,
    MailImportJobPage,
    MailImportJobStatus,
    MailImportUploadTarget,
    Message,
    MessageDetail,
    ReplyAllRecipients,
    Thread,
    ThreadDetail,
)
from inkbox.signing_keys import SigningKey

__all__ = [
    "ContactRuleDirection",
    "InkboxError",
    "InkboxAPIError",
    "DraftAttachment",
    "DraftAttachmentContent",
    "DraftDetail",
    "DraftRecipients",
    "DraftSendState",
    "DraftSummary",
    "Mailbox",
    "MailImportCreateResult",
    "MailImportFormat",
    "MailImportJob",
    "MailImportJobPage",
    "MailImportJobStatus",
    "MailImportUploadTarget",
    "Message",
    "MessageDetail",
    "ReplyAllRecipients",
    "SigningKey",
    "Thread",
    "ThreadDetail",
]
