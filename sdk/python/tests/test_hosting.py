from unittest.mock import Mock
from inkbox.identities.resources.identities import IdentitiesResource


def test_provider_capabilities_and_admission_preserve_selected_key_and_shape():
    import json
    from pathlib import Path
    from inkbox.computers import ComputersResource
    wire = json.loads((Path(__file__).resolve().parents[3] / 'contracts/hosting-capabilities.json').read_text())
    http = Mock()
    http.get.return_value = wire
    resource = ComputersResource(http)
    assert resource.hosting_capabilities() == wire
    http.get.assert_called_once_with('/computers/hosting/capabilities')
    http.post.return_value = {'allowed': True}
    selection = {'harness': 'claude_code', 'shape_id': 'v1-cpu2-ram8gb',
                 'credential_binding_id': 'saved-key', 'default_model': 'claude-sonnet-5-5'}
    assert resource.hosting_admission(selection)
    http.post.assert_called_once_with('/computers/hosting/admission', json=selection)


def test_model_key_provider_is_retained_on_create_rotation_and_revoke():
    from inkbox.computers import ComputersResource
    http = Mock()
    resource = ComputersResource(http)
    input = {'provider': 'anthropic', 'name': 'Example', 'api_key': 'synthetic-provider-key'}
    key = {'id': 'key', 'name': 'Example', 'provider': 'anthropic', 'display_suffix': '-key', 'version': 1, 'revoked': False}
    http.get.return_value = {'items': [key]}
    http.post.return_value = key
    assert resource.model_keys() == [key]
    assert resource.create_model_key(input, idempotency_key='create-once') == key
    http.post.assert_called_once_with('/computers/secret-bindings', json=input, headers={'Idempotency-Key': 'create-once'})
    resource.rotate_model_key('key/path', input, expected_version=1)
    http.put.assert_called_once_with('/computers/secret-bindings/key%2Fpath', json={**input, 'expected_version': 1})
    resource.revoke_model_key('key/path')
    http.delete_with_response.assert_called_once_with('/computers/secret-bindings/key%2Fpath')


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


def test_authoritative_server_hosting_fixture():
    import json
    from pathlib import Path
    wire = json.loads((Path(__file__).resolve().parents[3] / 'contracts/hosted-workspace-v1.json').read_text())
    http = Mock()
    http.put.return_value = wire['hosting']
    result = IdentitiesResource(http).update_hosting('example', wire['hosting_update'])
    assert result.default_model == wire['hosting']['default_model']
    http.put.assert_called_once_with('/example/hosting', json=wire['hosting_update'])


def test_shapes_keep_version_numeric_allocations_and_unavailable_choices():
    import json
    from pathlib import Path
    from inkbox.computers import ComputersResource
    wire = json.loads((Path(__file__).resolve().parents[3] / 'contracts/computer-shapes.json').read_text())
    http = Mock()
    http.get.return_value = wire
    assert ComputersResource(http).shapes() == wire
    http.get.assert_called_once_with('/computers/shapes')
    http.post.assert_not_called()


def test_shape_preference_is_optional_and_survives_configuration():
    http = Mock()
    http.put.return_value = {'mode': 'inkbox', 'identity_id': 'identity', 'shape_id': 'v1-cpu2-ram8gb'}
    command = {'expected_generation': 0, 'shape_id': 'v1-cpu2-ram8gb'}
    result = IdentitiesResource(http).update_hosting('example', command)
    assert result.shape_id == command['shape_id']
    http.put.assert_called_once_with('/example/hosting', json=command)
