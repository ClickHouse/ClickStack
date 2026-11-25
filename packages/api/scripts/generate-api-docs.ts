import fs from 'fs';
import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

// Relative import: run via ts-node without tsconfig-paths, so @/ does not resolve here
import { swaggerOptions } from '../src/utils/swagger';

const specs = swaggerJsdoc(swaggerOptions);
const outputPath = path.resolve(__dirname, '../openapi.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(specs, null, 2));

console.log(`OpenAPI specification written to ${outputPath}`);
