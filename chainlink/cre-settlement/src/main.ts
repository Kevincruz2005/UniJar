// SPDX-License-Identifier: AGPL-3.0-only
import { Runner } from '@chainlink/cre-sdk';
import { configSchema } from './config';
import { initWorkflow } from './workflow';
export async function main() {
  const runner = await Runner.newRunner({ configSchema });
  await runner.run(initWorkflow);
}
