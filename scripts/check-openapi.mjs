import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
await SwaggerParser.validate('docs/openapi.json');
const types = await readFile('packages/contracts/src/generated.ts', 'utf8');
if (!types.includes('getLiveness') || !types.includes('exchangeZaloToken'))
  throw new Error('Typed contract missing operations');
console.log('OpenAPI 3.1 schema and generated operation types valid');
