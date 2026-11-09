from unittest.mock import Mock
from inkbox.identities.resources.identities import IdentitiesResource


def test_hosting_keeps_empty_events_and_explicit_credit_selection():
    http = Mock()
    response = {'mode':'inkbox', 'identity_id':'identity', 'state':'provisioning', 'generation':2, 'applied_generation':1, 'future_field':True}
    http.get.return_value = http.put.return_value = response
    resource = IdentitiesResource(http)
    assert resource.get_hosting('@agent/one').applied_generation == 1
    http.get.assert_called_once_with('/%40agent%2Fone/hosting')
    options = {'expected_generation':1, 'trigger_events':[], 'credential_binding_id':None}
    assert resource.update_hosting('agent', options).generation == 2
    http.put.assert_called_once_with('/agent/hosting', json=options)
    resource.update_hosting('agent', {'expected_generation':2, 'enabled':False})
    assert http.put.call_args.kwargs['json'] == {'expected_generation':2, 'enabled':False}


def test_delivery_pagination_and_retry_keep_the_original_id():
    http = Mock()
    item = dict(id='event', event='message.received', state='expired', attempts=3,
                received_at='2026-01-01T00:00:00Z', last_error='unavailable', retryable=True)
    http.get.return_value = {'items': [item]}
    http.post.return_value = {'queued': True}
    resource = IdentitiesResource(http)
    deliveries = resource.list_hosting_deliveries('@example', before='cursor')
    assert deliveries[0].id == 'event' and deliveries[0].retryable
    http.get.assert_called_once_with('/%40example/hosting/deliveries', params={'before': 'cursor'})
    assert resource.retry_hosting_delivery('@example', 'id/path')
    http.post.assert_called_once_with('/%40example/hosting/deliveries/id%2Fpath/retry', json={})


def test_persistent_default_model_survives_requests_and_responses():
    from inkbox.identities.hosting import HostingUpdate
    http = Mock()
    http.get.return_value = http.put.return_value = {'mode': 'inkbox', 'identity_id': 'identity', 'default_model': 'gpt-6-luna'}
    resource = IdentitiesResource(http)
    assert resource.get_hosting('agent').default_model == 'gpt-6-luna'
    update: HostingUpdate = {'expected_generation': 1, 'default_model': 'gpt-6-luna'}
    assert resource.update_hosting('agent', update).default_model == 'gpt-6-luna'
    http.put.assert_called_once_with('/agent/hosting', json=update)


def test_computer_reads_preserve_missing_data_and_do_not_mutate():
    from inkbox.computers import ComputersResource
    http = Mock()
    resource = ComputersResource(http)
    http.get.return_value = {'items': [], 'missing_intervals': 'unavailable'}
    assert resource.usage_history('machine/path', window='7d')['items'] == []
    http.get.assert_called_with('/computers/machines/machine%2Fpath/usage/history', params={'window': '7d'})
    http.get.return_value = {'status': 'not_running', 'conversations': []}
    assert resource.conversations('machine')['status'] == 'not_running'
    resource.conversation('machine', 'session/a', before='42')
    http.get.assert_called_with('/computers/machines/machine/conversations', params={'session_id':'session/a','before':'42'})
    http.get.return_value = {'items': [{'id': 'run', 'terminal': True}]}
    assert resource.session_runs('session/a')[0]['terminal']
    http.get.assert_called_with('/computers/sessions/session%2Fa/runs')
    http.post.assert_not_called()


def test_templates_preserve_selected_defaults_and_unavailable_harness():
    import json
    from pathlib import Path
    from inkbox.computers import ComputersResource
    wire = json.loads((Path(__file__).resolve().parents[3] / "contracts/computer-templates.json").read_text())
    http = Mock()
    http.get.return_value = wire
    result = ComputersResource(http).templates()
    http.get.assert_called_once_with("/computers/templates")
    assert result["hosted_defaults"]["codex"]["id"] == "codex-current"
    assert result["hosted_defaults"]["hermes"] is None
    assert result["items"][0]["software"]["os"] is None
    assert result["hosted_defaults"]["codex"]["total_disk_bytes"] == 12000000000
    http.post.assert_not_called()
