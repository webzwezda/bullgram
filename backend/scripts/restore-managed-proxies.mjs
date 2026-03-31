import { ManagedProxyService } from '../services/managed-proxy.service.js';

const service = new ManagedProxyService();

try {
  const result = await service.restoreRuntimeFromState();
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}

