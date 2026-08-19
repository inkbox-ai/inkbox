"""
inkbox.mail — mail types and exceptions.
"""

from inkbox.mail.exceptions import InkboxAPIError, InkboxError
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
