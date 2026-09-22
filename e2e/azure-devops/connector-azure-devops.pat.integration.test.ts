import { runAzureDevOpsConnectorIntegrationSuite } from './suite.js';

runAzureDevOpsConnectorIntegrationSuite({
  label: 'PAT',
  token: process.env.BRIDGE_E2E_AZURE_DEVOPS_PAT,
  authType: 'api_token',
});
