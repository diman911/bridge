import { runAzureDevOpsConnectorIntegrationSuite } from './suite.js';

runAzureDevOpsConnectorIntegrationSuite({
  label: 'OAuth',
  token: process.env.BRIDGE_E2E_AZURE_DEVOPS_OAUTH_TOKEN,
  authType: 'oauth',
});
