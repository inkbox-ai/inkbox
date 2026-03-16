"""Tests for ThreadsResource."""

from unittest.mock import MagicMock

from sample_data_mail import THREAD_DICT, THREAD_DETAIL_DICT, CURSOR_PAGE_THREADS
from inkbox.mail.resources.threads import ThreadsResource


MBOX = "aaaa1111-0000-0000-0000-000000000001"
THREAD_ID = "eeee5555-0000-0000-0000-000000000001"


def _resource():
    http = MagicMock()
    return ThreadsResource(http), http


class TestThreadsList:
    def test_iterates_single_page(self):
        res, http = _resource()
        http.get.return_value = CURSOR_PAGE_THREADS

        threads = list(res.list(MBOX))

        assert len(threads) == 1
        assert threads[0].subject == "Hello from test"
        assert threads[0].message_count == 2

    def test_empty_page(self):
        res, http = _resource()
        http.get.return_value = {"items": [], "next_cursor": None, "has_more": False}

        threads = list(res.list(MBOX))

        assert threads == []

    def test_multi_page(self):
        res, http = _resource()
        page1 = {"items": [THREAD_DICT], "next_cursor": "cur1", "has_more": True}
        page2 = {"items": [THREAD_DICT], "next_cursor": None, "has_more": False}
        http.get.side_effect = [page1, page2]

        threads = list(res.list(MBOX))

        assert len(threads) == 2
        assert http.get.call_count == 2


class TestThreadsGet:
    def test_returns_thread_detail(self):
        res, http = _resource()
        http.get.return_value = THREAD_DETAIL_DICT

        detail = res.get(MBOX, THREAD_ID)

        http.get.assert_called_once_with(f"/mailboxes/{MBOX}/threads/{THREAD_ID}")
        assert detail.subject == "Hello from test"
        assert len(detail.messages) == 1


class TestThreadsDelete:
    def test_deletes_thread(self):
        res, http = _resource()

        res.delete(MBOX, THREAD_ID)

        http.delete.assert_called_once_with(f"/mailboxes/{MBOX}/threads/{THREAD_ID}")
