"""Integration fixture diagnostics must not include credential values."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


def test_integration_context_repr_omits_credentials():
    path = Path(__file__).parents[3] / "tests/integration/python/conftest.py"
    name = "_fixture_repr_test"
    spec = spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
        config = module.SdkIntegrationConfig(
            base_url="https://example.com", interservice_secret="test-service-secret",
            environment="test", verbose=False,
        )
        bootstrap = module.BootstrapResult(
            email_address="test@example.com", password="test-password", user_id="test-user",
            org_id="test-org", api_key="test-api-key",
        )
        context = module.SdkIntegrationContext(config=config, bootstrap=bootstrap)
        for obj in (config, bootstrap, context):
            rendered = repr(obj)
            for credential in ("test-service-secret", "test-password", "test-api-key"):
                assert credential not in rendered
        assert "test-org" in repr(context)
    finally:
        sys.modules.pop(name, None)
