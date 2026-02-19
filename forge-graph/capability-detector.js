'use strict';

/**
 * Capability Detector — Detects domain capabilities per module
 * by analyzing file names, import patterns, symbol names, and directory structures.
 */

/**
 * Capability signatures: each capability has patterns that match against
 * file paths, import paths, and symbol names.
 */
const CAPABILITY_SIGNATURES = [
  {
    capability: 'authentication',
    filePatterns: [/auth/i, /login/i, /signup/i, /session/i, /oauth/i, /jwt/i, /passport/i, /keycloak/i],
    importPatterns: [/passport/i, /jsonwebtoken/i, /jwt/i, /bcrypt/i, /oauth/i, /auth0/i, /keycloak/i, /next-auth/i],
    symbolPatterns: [/authenticate/i, /login/i, /logout/i, /verifyToken/i, /hashPassword/i],
    weight: 0.9,
  },
  {
    capability: 'database',
    filePatterns: [/model/i, /schema/i, /migration/i, /entity/i, /repository/i, /dao/i, /prisma/i, /drizzle/i],
    importPatterns: [/prisma/i, /typeorm/i, /sequelize/i, /mongoose/i, /knex/i, /drizzle/i, /better-sqlite3/i, /pg\b/i, /mysql/i, /neo4j/i],
    symbolPatterns: [/createTable/i, /migrate/i, /findById/i, /repository/i, /getConnection/i],
    weight: 0.85,
  },
  {
    capability: 'api-server',
    filePatterns: [/route/i, /controller/i, /endpoint/i, /handler/i, /middleware/i, /resolver/i],
    importPatterns: [/express/i, /fastify/i, /koa/i, /hapi/i, /nestjs/i, /graphql/i, /trpc/i, /fastapi/i, /flask/i, /django/i, /gin/i],
    symbolPatterns: [/router/i, /handleRequest/i, /controller/i, /middleware/i, /resolver/i],
    weight: 0.9,
  },
  {
    capability: 'ui-components',
    filePatterns: [/component/i, /\.tsx$/, /\.jsx$/, /widget/i, /view/i, /page/i],
    importPatterns: [/react/i, /vue/i, /angular/i, /svelte/i, /solid-js/i, /preact/i],
    symbolPatterns: [/render/i, /component/i, /useState/i, /useEffect/i, /template/i],
    weight: 0.85,
  },
  {
    capability: 'state-management',
    filePatterns: [/store/i, /reducer/i, /action/i, /slice/i, /context/i, /atom/i],
    importPatterns: [/redux/i, /zustand/i, /recoil/i, /mobx/i, /vuex/i, /pinia/i, /jotai/i, /valtio/i],
    symbolPatterns: [/createStore/i, /dispatch/i, /reducer/i, /useSelector/i, /createSlice/i],
    weight: 0.8,
  },
  {
    capability: 'testing',
    filePatterns: [/\.test\./i, /\.spec\./i, /\.e2e\./i, /__tests__/i, /test\//i, /tests\//i, /fixtures/i],
    importPatterns: [/jest/i, /vitest/i, /mocha/i, /chai/i, /supertest/i, /playwright/i, /cypress/i, /pytest/i, /unittest/i],
    symbolPatterns: [/describe/i, /it\(/i, /expect/i, /test\(/i, /beforeEach/i, /assert/i],
    weight: 0.95,
  },
  {
    capability: 'caching',
    filePatterns: [/cache/i, /redis/i, /memcache/i],
    importPatterns: [/redis/i, /ioredis/i, /memcached/i, /lru-cache/i, /node-cache/i],
    symbolPatterns: [/getCache/i, /setCache/i, /invalidate/i, /ttl/i],
    weight: 0.8,
  },
  {
    capability: 'messaging',
    filePatterns: [/queue/i, /worker/i, /consumer/i, /producer/i, /pubsub/i, /event/i],
    importPatterns: [/bull/i, /rabbitmq/i, /amqplib/i, /kafka/i, /nats/i, /celery/i, /redis.*pub/i],
    symbolPatterns: [/publish/i, /subscribe/i, /enqueue/i, /processJob/i, /emit/i],
    weight: 0.8,
  },
  {
    capability: 'file-storage',
    filePatterns: [/upload/i, /storage/i, /s3/i, /blob/i, /media/i],
    importPatterns: [/aws-sdk.*s3/i, /multer/i, /@google-cloud\/storage/i, /minio/i, /cloudinary/i],
    symbolPatterns: [/uploadFile/i, /downloadFile/i, /putObject/i, /getSignedUrl/i],
    weight: 0.8,
  },
  {
    capability: 'email',
    filePatterns: [/email/i, /mailer/i, /notification/i, /smtp/i],
    importPatterns: [/nodemailer/i, /sendgrid/i, /ses/i, /mailgun/i, /postmark/i],
    symbolPatterns: [/sendEmail/i, /sendMail/i, /notify/i, /emailTemplate/i],
    weight: 0.85,
  },
  {
    capability: 'scheduling',
    filePatterns: [/cron/i, /scheduler/i, /job/i, /task/i],
    importPatterns: [/node-cron/i, /agenda/i, /bull/i, /celery/i, /crontab/i],
    symbolPatterns: [/schedule/i, /cron/i, /runAt/i, /recurring/i],
    weight: 0.75,
  },
  {
    capability: 'search',
    filePatterns: [/search/i, /elastic/i, /index/i],
    importPatterns: [/elasticsearch/i, /algolia/i, /meilisearch/i, /typesense/i, /lunr/i],
    symbolPatterns: [/searchIndex/i, /fullTextSearch/i, /reindex/i, /query/i],
    weight: 0.8,
  },
  {
    capability: 'ai-ml',
    filePatterns: [/ai/i, /ml/i, /model/i, /inference/i, /llm/i, /embedding/i, /vector/i],
    importPatterns: [/openai/i, /anthropic/i, /langchain/i, /tensorflow/i, /torch/i, /transformers/i, /pinecone/i, /chromadb/i],
    symbolPatterns: [/predict/i, /inference/i, /embed/i, /generateCompletion/i, /chatCompletion/i],
    weight: 0.85,
  },
  {
    capability: 'logging',
    filePatterns: [/logger/i, /logging/i, /telemetry/i, /observability/i],
    importPatterns: [/winston/i, /pino/i, /bunyan/i, /morgan/i, /datadog/i, /sentry/i, /opentelemetry/i],
    symbolPatterns: [/logger/i, /logError/i, /logInfo/i, /captureException/i],
    weight: 0.7,
  },
  {
    capability: 'configuration',
    filePatterns: [/config/i, /env/i, /settings/i, /\.env/i],
    importPatterns: [/dotenv/i, /config/i, /convict/i],
    symbolPatterns: [/getConfig/i, /loadEnv/i, /validateConfig/i],
    weight: 0.6,
  },
  {
    capability: 'graph-visualization',
    filePatterns: [/graph/i, /cytoscape/i, /d3/i, /chart/i, /visualization/i],
    importPatterns: [/cytoscape/i, /d3/i, /chart\.js/i, /recharts/i, /plotly/i, /vis-network/i],
    symbolPatterns: [/renderGraph/i, /drawChart/i, /createVisualization/i],
    weight: 0.8,
  },
  {
    capability: 'authorization',
    filePatterns: [/permission/i, /rbac/i, /acl/i, /policy/i, /guard/i, /role/i],
    importPatterns: [/casl/i, /casbin/i, /accesscontrol/i],
    symbolPatterns: [/canAccess/i, /checkPermission/i, /hasRole/i, /authorize/i, /guard/i],
    weight: 0.85,
  },
  {
    capability: 'websocket',
    filePatterns: [/socket/i, /ws/i, /realtime/i, /live/i],
    importPatterns: [/socket\.io/i, /ws\b/i, /pusher/i, /ably/i],
    symbolPatterns: [/onConnect/i, /onMessage/i, /broadcast/i, /emit/i],
    weight: 0.8,
  },
];

/**
 * Detect capabilities for a given module.
 * @param {string} moduleName
 * @param {string[]} filePaths - Files in this module (relative to repo root).
 * @param {Array<{file: string, name: string}>} symbols - Exported symbols in this module.
 * @param {Array<{source_file: string, import_name: string}>} imports - Imports in this module.
 * @returns {Array<{capability: string, confidence: number, evidence: string}>}
 */
function detectCapabilities(moduleName, filePaths, symbols, imports) {
  const results = [];

  for (const sig of CAPABILITY_SIGNATURES) {
    let score = 0;
    let maxScore = 0;
    const evidence = [];

    // Score file path matches
    const fileMatches = filePaths.filter(fp =>
      sig.filePatterns.some(p => p.test(fp))
    );
    if (fileMatches.length > 0) {
      const fileScore = Math.min(fileMatches.length / Math.max(filePaths.length, 1), 1) * 3;
      score += fileScore;
      evidence.push(`${fileMatches.length} file(s) match`);
    }
    maxScore += 3;

    // Score import matches
    const importMatches = imports.filter(imp =>
      sig.importPatterns.some(p => p.test(imp.import_name))
    );
    if (importMatches.length > 0) {
      const importScore = Math.min(importMatches.length, 5) * 0.6;
      score += importScore;
      const uniq = [...new Set(importMatches.map(i => i.import_name))].slice(0, 3);
      evidence.push(`imports: ${uniq.join(', ')}`);
    }
    maxScore += 3;

    // Score symbol name matches
    const symbolMatches = symbols.filter(sym =>
      sig.symbolPatterns.some(p => p.test(sym.name))
    );
    if (symbolMatches.length > 0) {
      const symScore = Math.min(symbolMatches.length, 5) * 0.4;
      score += symScore;
      const uniq = [...new Set(symbolMatches.map(s => s.name))].slice(0, 3);
      evidence.push(`symbols: ${uniq.join(', ')}`);
    }
    maxScore += 2;

    // Calculate confidence, weighted by the signature's inherent weight
    const rawConfidence = maxScore > 0 ? score / maxScore : 0;
    const confidence = rawConfidence * sig.weight;

    // Only include if confidence exceeds threshold
    if (confidence >= 0.15) {
      results.push({
        capability: sig.capability,
        confidence: Math.round(confidence * 100) / 100,
        evidence: evidence.join('; '),
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

module.exports = { detectCapabilities, CAPABILITY_SIGNATURES };
