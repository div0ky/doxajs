import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'

import {
  IntrospectionError,
  applicationInfo,
  assertCurrentManifest,
  createGnosisKnowledge as createApplicationKnowledge,
  describeAuthentication,
  describeModel,
  explainComponent,
  inspectArchitectureDiagnostics,
  inspectGraph,
  inspectSurface,
  safeManifest,
  sanitizeInspectionValue,
  type InspectionSurface,
} from '@doxajs/introspection'
import type { DoxaManifest } from '@doxajs/manifest'

import {
  documentationIndex,
  searchDocumentation,
  type DocumentationSection,
} from './documentation.js'
import {
  GNOSIS_HANDBOOK_SCHEMA_VERSION,
  handbookEntry,
  handbookIndex,
  programmingModel,
  renderHandbookMarkdown,
  roleGuide,
  type DoxaRole,
  type HandbookEntry,
  type ProgrammingModel,
} from './handbook.js'

export { documentationIndex, searchDocumentation, type DocumentationSection }
export {
  GNOSIS_HANDBOOK_SCHEMA_VERSION,
  handbookEntry,
  handbookIndex,
  programmingModel,
  renderHandbookMarkdown,
  roleGuide,
  type DoxaRole,
  type HandbookEntry,
  type ProgrammingModel,
}

export const GNOSIS_PROTOCOL_ADAPTER_VERSION = 2 as const
export const GNOSIS_VERSION = packageVersion()
export const MAX_MODEL_QUERY_RESULT_BYTES = 1_000_000

export interface GnosisEngineeringKnowledge extends ReturnType<typeof createApplicationKnowledge> {
  readonly handbook: Readonly<{
    readonly schemaVersion: typeof GNOSIS_HANDBOOK_SCHEMA_VERSION
    readonly entries: readonly HandbookEntry[]
  }>
  readonly programmingModel: ProgrammingModel
}

export interface ArchitectureReviewRequest {
  readonly goal: string
  readonly invariants?: readonly string[]
  readonly consistency?: 'atomic' | 'after-commit' | 'eventual'
  readonly componentIds?: readonly string[]
}

export interface ArchitectureReview {
  readonly status: 'recommendation' | 'insufficient-intent'
  readonly goal: string
  readonly invariants: readonly string[]
  readonly consistency: 'atomic' | 'after-commit' | 'eventual' | null
  readonly recommendation: string
  readonly boundary: string
  readonly transactionOwnership: string
  readonly collaboration: string
  readonly guarantees: readonly string[]
  readonly rejectedAlternatives: readonly string[]
  readonly guideIds: readonly string[]
  readonly components: readonly ReturnType<typeof explainComponent>[]
  readonly diagnostics: ReturnType<typeof inspectArchitectureDiagnostics>
}

export interface GnosisModelQueryRequest {
  readonly modelId: string
  readonly fields: readonly string[]
  readonly filters: readonly {
    readonly attribute: string
    readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'ilike'
    readonly value: string | number | boolean | null
  }[]
  readonly orderBy: readonly {
    readonly attribute: string
    readonly direction: 'asc' | 'desc'
  }[]
  readonly limit: number
}

export interface GnosisModelQueryResult {
  readonly modelId: string
  readonly fields: readonly string[]
  readonly rows: readonly Readonly<Record<string, unknown>>[]
  readonly returned: number
  readonly truncated: boolean
  readonly executionId: string
}

export interface GnosisServerOptions {
  readonly queryModels?: (request: GnosisModelQueryRequest) => Promise<GnosisModelQueryResult>
}

const readOnlyAnnotations = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
})

const sourceSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
})
const boundedInspectionSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())).max(100),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
const applicationInfoSchema = z.object({
  schemaVersion: z.literal(2),
  applicationId: z.string(),
  frameworkVersion: z.string(),
  compilerVersion: z.string(),
  manifestFormatVersion: z.number().int(),
  buildHash: z.string(),
  time: z.object({ timeZone: z.string(), locale: z.string() }),
  plugins: z.array(z.string()),
  gnosisVersion: z.string(),
  protocolAdapterVersion: z.literal(2),
})
const graphInspectionSchema = z.object({
  schemaVersion: z.literal(2),
  applicationId: z.string(),
  buildHash: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
})
const modelInspectionSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  exportName: z.string(),
  entityType: z.string(),
  attributes: z.array(z.string()),
  attributeTypes: z.record(z.string(), z.record(z.string(), z.unknown())),
  relationships: z.array(z.record(z.string(), z.unknown())),
  storage: z.record(z.string(), z.unknown()),
  source: sourceSchema,
})
const authenticationInspectionSchema = z.object({
  mode: z.enum(['doxa-owned', 'managed', 'login-only']),
  source: z.enum(['doxa-owned', 'model', 'table']),
  modelId: z.string().optional(),
  table: z.string(),
  identifier: z.record(z.string(), z.unknown()),
  contactEmail: z.string().optional(),
  verification: z.record(z.string(), z.unknown()),
  eligibility: z.array(z.record(z.string(), z.unknown())),
  hashers: z.array(z.string()),
  credentialOwnership: z.enum(['doxa', 'external']),
  credentialUpgrade: z.enum(['never', 'in-place']),
  securityWarnings: z.array(z.string()),
  routes: z.record(z.string(), z.unknown()),
})
const documentationSearchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['programming-model', 'role', 'concept', 'module', 'diagnostic']),
        package: z.string(),
        version: z.string(),
        source: z.string(),
        heading: z.string(),
        summary: z.string(),
        aliases: z.array(z.string()),
        rationale: z.string(),
        text: z.string(),
        role: z.string().optional(),
        details: z.record(z.string(), z.unknown()).optional(),
        activation: z.record(z.string(), z.unknown()).optional(),
        score: z.number().int().nonnegative(),
      }),
    )
    .max(20),
})
const handbookEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['programming-model', 'role', 'concept', 'module', 'diagnostic']),
  package: z.string(),
  version: z.string(),
  source: z.string(),
  heading: z.string(),
  summary: z.string(),
  aliases: z.array(z.string()),
  rationale: z.string(),
  text: z.string(),
  role: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  activation: z.record(z.string(), z.unknown()).optional(),
})
const programmingModelSchema = z.object({
  schemaVersion: z.literal(1),
  version: z.string(),
  title: z.literal('Doxa Programming Model'),
  rules: z.array(z.string()),
  decisionGuide: z.object({
    atomic: z.string(),
    afterCommit: z.string(),
    eventual: z.string(),
  }),
  guideIds: z.array(z.string()),
})
const componentExplanationSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  kind: z.string(),
  ownerId: z.string(),
  name: z.string(),
  source: sourceSchema,
  component: z.record(z.string(), z.unknown()),
  dependencies: z.array(z.record(z.string(), z.unknown())),
  consumers: z.array(z.string()),
  transaction: z.record(z.string(), z.unknown()),
  canonicalFolder: z.string(),
  guideIds: z.array(z.string()),
  diagnostics: z.array(z.record(z.string(), z.unknown())),
  guidance: z.array(handbookEntrySchema),
})
const architectureReviewOutputSchema = z.object({
  status: z.enum(['recommendation', 'insufficient-intent']),
  goal: z.string(),
  invariants: z.array(z.string()),
  consistency: z.enum(['atomic', 'after-commit', 'eventual']).nullable(),
  recommendation: z.string(),
  boundary: z.string(),
  transactionOwnership: z.string(),
  collaboration: z.string(),
  guarantees: z.array(z.string()),
  rejectedAlternatives: z.array(z.string()),
  guideIds: z.array(z.string()),
  components: z.array(z.record(z.string(), z.unknown())),
  diagnostics: boundedInspectionSchema,
})
const modelQueryValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
])
const modelQueryInputSchema = {
  modelId: z.string().min(1).max(256),
  fields: z.array(z.string().min(1).max(128)).min(1).max(50),
  filters: z
    .array(
      z.object({
        attribute: z.string().min(1).max(128),
        operator: z.enum(['=', '!=', '<', '<=', '>', '>=', 'like', 'ilike']),
        value: modelQueryValueSchema,
      }),
    )
    .max(20)
    .optional(),
  orderBy: z
    .array(
      z.object({
        attribute: z.string().min(1).max(128),
        direction: z.enum(['asc', 'desc']),
      }),
    )
    .max(5)
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
}
const modelQueryOutputSchema = z.object({
  modelId: z.string(),
  fields: z.array(z.string()).max(50),
  rows: z.array(z.record(z.string(), z.unknown())).max(100),
  returned: z.number().int().min(0).max(100),
  truncated: z.boolean(),
  executionId: z.string(),
})

const surfaceTools: Readonly<Record<string, InspectionSurface>> = {
  list_actions: 'actions',
  list_queries: 'queries',
  list_events: 'events',
  list_listeners: 'listeners',
  list_observers: 'observers',
  list_jobs: 'jobs',
  list_schedules: 'schedules',
  list_permission_sources: 'permissionSources',
  list_policies: 'policies',
  list_commands: 'commands',
  list_realtime_commands: 'realtimeCommands',
  list_providers: 'providers',
  list_services: 'services',
}
const roleNames = [
  'application',
  'feature',
  'configuration',
  'provider',
  'service',
  'model',
  'action',
  'query',
  'route',
  'event',
  'listener',
  'job',
  'schedule',
  'observer',
  'policy',
  'permission-source',
  'signal',
  'signal-handler',
  'command',
  'realtime-command',
] as const satisfies readonly DoxaRole[]

export function createGnosisKnowledge(manifest: DoxaManifest): GnosisEngineeringKnowledge {
  assertCurrentManifest(manifest)
  assertMatchingGnosisVersion(manifest)
  const entries = handbookIndex(manifest.frameworkVersion, manifest)
  return Object.freeze({
    ...createApplicationKnowledge(manifest),
    handbook: Object.freeze({
      schemaVersion: GNOSIS_HANDBOOK_SCHEMA_VERSION,
      entries,
    }),
    programmingModel: programmingModel(manifest.frameworkVersion),
  })
}

export function reviewArchitecture(
  manifest: DoxaManifest,
  request: ArchitectureReviewRequest,
): ArchitectureReview {
  assertCurrentManifest(manifest)
  assertMatchingGnosisVersion(manifest)
  const rawGoal = request.goal.trim()
  if (rawGoal.length === 0 || rawGoal.length > 2_000) {
    throw new IntrospectionError(
      'invalid_input',
      'Architecture goal must contain 1 through 2,000 characters.',
    )
  }
  const goal = sanitizeInspectionValue(rawGoal) as string
  if ((request.invariants?.length ?? 0) > 10) {
    throw new IntrospectionError(
      'invalid_input',
      'Architecture review accepts at most 10 invariants.',
    )
  }
  const invalidInvariant = request.invariants?.find((invariant) => {
    const length = invariant.trim().length
    return length === 0 || length > 1_000
  })
  if (invalidInvariant !== undefined) {
    throw new IntrospectionError(
      'invalid_input',
      'Each architecture invariant must contain 1 through 1,000 characters.',
    )
  }
  const invariants = Object.freeze([
    ...new Set(
      (request.invariants ?? [])
        .map((invariant) => invariant.trim())
        .filter(Boolean)
        .map((invariant) => sanitizeInspectionValue(invariant) as string),
    ),
  ])
  if ((request.componentIds?.length ?? 0) > 20) {
    throw new IntrospectionError(
      'invalid_input',
      'Architecture review accepts at most 20 component IDs.',
    )
  }
  const invalidComponentId = request.componentIds?.find((id) => id.length === 0 || id.length > 256)
  if (invalidComponentId !== undefined) {
    throw new IntrospectionError(
      'invalid_input',
      'Each component ID must contain 1 through 256 characters.',
    )
  }
  const componentIds = [...new Set(request.componentIds ?? [])]
  const components = Object.freeze(componentIds.map((id) => explainComponent(manifest, id)))
  const diagnostics = inspectArchitectureDiagnostics(manifest)
  const guideIds = Object.freeze([
    'programming-model.core',
    'concept.orchestration-consistency',
    'concept.execution-transactions',
    'concept.providers-provides',
    'diagnostic.nested-action-dispatch',
  ])
  if (!request.consistency || invariants.length === 0) {
    return Object.freeze({
      status: 'insufficient-intent',
      goal,
      invariants,
      consistency: request.consistency ?? null,
      recommendation:
        'Gnosis cannot choose an orchestration shape from the component graph alone. Declare the business invariant and whether it requires atomic, after-commit, or eventual consistency.',
      boundary:
        'Undetermined until the business invariant and consistency requirement are explicit.',
      transactionOwnership:
        'Undetermined; the manifest describes structure but not business intent.',
      collaboration: 'Do not refactor operation boundaries until the missing intent is supplied.',
      guarantees: Object.freeze([]),
      rejectedAlternatives: Object.freeze([]),
      guideIds,
      components,
      diagnostics,
    })
  }
  if (request.consistency === 'atomic') {
    return Object.freeze({
      status: 'recommendation',
      goal,
      invariants,
      consistency: 'atomic',
      recommendation:
        'Keep every required mutation inside one top-level Action or Job transaction and call an ordinary service directly for reusable work.',
      boundary:
        'The invoked Action or Job is the sole admitted mutation boundary. If both roles need the behavior, both call the same ordinary service without calling one another.',
      transactionOwnership:
        'The invoked Action or Job owns the writable unit of work. The ordinary service joins it; any failure rolls back every required mutation and staged event or outbox intent.',
      collaboration:
        'Place reusable behavior in a plain constructor-injected service. Export it through Feature.provides only when another Feature needs it; never promote it into Feature.providers.',
      guarantees: Object.freeze([
        'Required mutations commit together or roll back together.',
        'Local facts and queued intent stage under the owning unit of work.',
        'Each Action or Job remains independently authorized, observable, and retryable at its own top-level boundary.',
      ]),
      rejectedAlternatives: Object.freeze([
        'Nested ActionBus dispatch, because it creates competing operation and transaction ownership.',
        'After-commit delivery, because later failure cannot roll back the original mutation.',
        'Queued listener delivery, because it runs in a later execution and transaction.',
      ]),
      guideIds,
      components,
      diagnostics,
    })
  }
  if (request.consistency === 'after-commit') {
    return Object.freeze({
      status: 'recommendation',
      goal,
      invariants,
      consistency: 'after-commit',
      recommendation:
        'Commit the owning Action or Job first, then run the reaction through an explicit after-commit Listener.',
      boundary:
        'The original Action or Job owns the durable mutation; the Listener is a later reaction.',
      transactionOwnership:
        'The original transaction is already committed before the reaction runs and cannot be rolled back by a Listener failure.',
      collaboration:
        'Use a service for reusable reaction behavior, but retain the explicit after-commit Listener as the timing boundary.',
      guarantees: Object.freeze([
        'The reaction never runs after a rolled-back mutation.',
        'The original mutation remains committed if the reaction fails.',
      ]),
      rejectedAlternatives: Object.freeze([
        'Direct atomic collaboration when the reaction must intentionally occur only after durability.',
        'Queued delivery when immediate post-commit execution, rather than durable retry, is required.',
      ]),
      guideIds,
      components,
      diagnostics,
    })
  }
  return Object.freeze({
    status: 'recommendation',
    goal,
    invariants,
    consistency: 'eventual',
    recommendation:
      'Represent the accepted fact with an Event and use a queued Listener that dispatches a later top-level Action, or dispatch a Job for the independently retryable consequence.',
    boundary: 'The producer and queued consumer are separate admitted executions.',
    transactionOwnership:
      'The producer commits durable queue intent atomically. A queued Listener receives a fresh execution but no automatic writable transaction, so its dispatched Action owns the later transaction; a Job attempt owns its transaction directly.',
    collaboration:
      'Put reusable mutation behavior in an ordinary service called by the later Action or Job, and make the durable consumer idempotent.',
    guarantees: Object.freeze([
      'No queued consequence becomes eligible before the producer commits.',
      'The later Action or Job transaction may complete later and may be retried under at-least-once delivery.',
    ]),
    rejectedAlternatives: Object.freeze([
      'Claiming same-transaction atomicity across the durable queue boundary.',
      'Dispatching an Action from an Action, Query, or Job; a queued Listener is different because it is a fresh admission with no active operation.',
    ]),
    guideIds,
    components,
    diagnostics,
  })
}

export function createGnosisServer(
  manifest: DoxaManifest,
  options: GnosisServerOptions = {},
): McpServer {
  assertCurrentManifest(manifest)
  const knowledge = createGnosisKnowledge(manifest)
  const docs = knowledge.handbook.entries
  const model = knowledge.programmingModel
  const server = new McpServer(
    { name: 'doxa-gnosis', version: GNOSIS_VERSION },
    { instructions: renderGnosisInstructions() },
  )

  registerJsonResource(server, 'application-manifest', 'doxa://application/manifest', () =>
    safeManifest(manifest),
  )
  registerJsonResource(server, 'application-graph', 'doxa://application/graph', () =>
    inspectGraph(manifest),
  )
  registerJsonResource(server, 'application-routes', 'doxa://application/routes', () =>
    inspectSurface(manifest, 'routes'),
  )
  registerJsonResource(server, 'application-models', 'doxa://application/models', () =>
    inspectSurface(manifest, 'models'),
  )
  registerJsonResource(
    server,
    'application-authentication',
    'doxa://application/authentication',
    () => describeAuthentication(manifest),
  )
  registerJsonResource(server, 'documentation-index', 'doxa://documentation/index', () => docs)
  registerJsonResource(
    server,
    'programming-model',
    'doxa://guidance/programming-model',
    () => model,
  )
  registerJsonResource(server, 'role-catalog', 'doxa://guidance/roles', () =>
    docs.filter((entry) => entry.kind === 'role'),
  )
  registerJsonResource(server, 'installed-modules', 'doxa://guidance/modules', () =>
    docs.filter((entry) => entry.kind === 'module'),
  )
  registerJsonResource(server, 'consistency-guide', 'doxa://guidance/consistency', () =>
    handbookEntry(docs, 'concept.orchestration-consistency'),
  )
  registerJsonResource(server, 'architecture-diagnostics', 'doxa://application/diagnostics', () =>
    inspectArchitectureDiagnostics(manifest),
  )

  server.registerTool(
    'application_info',
    {
      description: 'Describe the exact compiled Doxa application and Gnosis versions.',
      outputSchema: applicationInfoSchema,
      annotations: readOnlyAnnotations,
    },
    async () =>
      toolResult(() => ({
        ...applicationInfo(manifest),
        gnosisVersion: GNOSIS_VERSION,
        protocolAdapterVersion: GNOSIS_PROTOCOL_ADAPTER_VERSION,
      })),
  )

  server.registerTool(
    'inspect_graph',
    {
      description: 'Return deterministic counts for the compiled Doxa application graph.',
      outputSchema: graphInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => inspectGraph(manifest)),
  )

  server.registerTool(
    'get_programming_model',
    {
      description:
        'Return the version-matched Doxa programming model. Call this before structural or architectural Doxa work.',
      outputSchema: programmingModelSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => model),
  )

  server.registerTool(
    'explain_role',
    {
      description:
        'Explain how one Doxa framework role is selected, registered, invoked, scoped, authorized, transacted, injected, and tested.',
      inputSchema: { role: z.enum(roleNames) },
      outputSchema: handbookEntrySchema,
      annotations: readOnlyAnnotations,
    },
    async ({ role }) =>
      toolResult(() => {
        const guide = roleGuide(docs, role)
        if (!guide) throw new IntrospectionError('not_found', `Role guide ${role} is unavailable.`)
        return guide
      }),
  )

  server.registerTool(
    'read_doc',
    {
      description: 'Read one version-matched Doxa handbook entry by stable guide ID.',
      inputSchema: { id: z.string().min(1).max(256) },
      outputSchema: handbookEntrySchema,
      annotations: readOnlyAnnotations,
    },
    async ({ id }) =>
      toolResult(() => {
        const entry = handbookEntry(docs, id)
        if (!entry) throw new IntrospectionError('not_found', `Guide ${id} is unavailable.`)
        return entry
      }),
  )

  server.registerTool(
    'explain_component',
    {
      description:
        'Explain one compiled component, its dependencies and consumers, effective transaction behavior, canonical location, diagnostics, and matching Doxa guidance.',
      inputSchema: { id: z.string().min(1).max(256) },
      outputSchema: componentExplanationSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ id }) =>
      toolResult(() => {
        const explanation = explainComponent(manifest, id)
        return {
          ...explanation,
          guidance: explanation.guideIds
            .map((guideId) => handbookEntry(docs, guideId))
            .filter((entry): entry is HandbookEntry => entry !== undefined),
        }
      }),
  )

  server.registerTool(
    'review_architecture',
    {
      description:
        'Evaluate a proposed Doxa architecture from explicit business invariants and atomic, after-commit, or eventual consistency requirements. Gnosis does not infer business intent from source or folders.',
      inputSchema: {
        goal: z.string().trim().min(1).max(2_000),
        invariants: z.array(z.string().trim().min(1).max(1_000)).max(10).optional(),
        consistency: z.enum(['atomic', 'after-commit', 'eventual']).optional(),
        componentIds: z.array(z.string().min(1).max(256)).max(20).optional(),
      },
      outputSchema: architectureReviewOutputSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ goal, invariants, consistency, componentIds }) =>
      toolResult(() =>
        reviewArchitecture(manifest, {
          goal,
          ...(invariants ? { invariants } : {}),
          ...(consistency ? { consistency } : {}),
          ...(componentIds ? { componentIds } : {}),
        }),
      ),
  )

  server.registerTool(
    'list_routes',
    {
      description: 'List compiled HTTP routes with access and source provenance.',
      outputSchema: boundedInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => inspectSurface(manifest, 'routes')),
  )

  server.registerTool(
    'describe_model',
    {
      description: 'Describe one model, including logical attributes, storage, and relationships.',
      inputSchema: { id: z.string().min(1).max(256) },
      outputSchema: modelInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => toolResult(() => describeModel(manifest, id)),
  )

  server.registerTool(
    'describe_authentication',
    {
      description: 'Describe the compiled authentication mapping without credential values.',
      outputSchema: authenticationInspectionSchema,
      annotations: readOnlyAnnotations,
    },
    async () => toolResult(() => describeAuthentication(manifest)),
  )

  if (options.queryModels) {
    server.registerTool(
      'query_models',
      {
        description:
          'Query one declared Doxa model through a bounded read-only ModelSession. Call describe_model first and request only the logical fields needed for the task.',
        inputSchema: modelQueryInputSchema,
        outputSchema: modelQueryOutputSchema,
        annotations: readOnlyAnnotations,
      },
      async ({ modelId, fields, filters, orderBy, limit }) =>
        toolResult(async () => {
          const model = describeModel(manifest, modelId)
          const uniqueFields = [...new Set(fields)]
          const requestedAttributes = [
            ...uniqueFields,
            ...(filters ?? []).map((filter) => filter.attribute),
            ...(orderBy ?? []).map((order) => order.attribute),
          ]
          const unknown = requestedAttributes.find(
            (attribute) => !model.attributes.includes(attribute),
          )
          if (unknown) {
            throw new IntrospectionError(
              'invalid_input',
              `${modelId} does not declare logical attribute ${unknown}.`,
            )
          }
          const result = sanitizeInspectionValue(
            await options.queryModels!({
              modelId,
              fields: uniqueFields,
              filters: filters ?? [],
              orderBy: orderBy ?? [],
              limit: limit ?? 20,
            }),
          )
          if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_MODEL_QUERY_RESULT_BYTES) {
            throw new IntrospectionError(
              'invalid_input',
              'Model query result exceeds 1,000,000 bytes. Request fewer fields or rows.',
            )
          }
          return result
        }),
    )
  }

  for (const [name, surface] of Object.entries(surfaceTools)) {
    server.registerTool(
      name,
      {
        description: `List compiled Doxa ${surface}.`,
        outputSchema: boundedInspectionSchema,
        annotations: readOnlyAnnotations,
      },
      async () => toolResult(() => inspectSurface(manifest, surface)),
    )
  }

  server.registerTool(
    'search_docs',
    {
      description:
        'Search the complete version-matched local Doxa handbook by stable ID, role, alias, rationale, summary, or text.',
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(20).optional(),
      },
      outputSchema: documentationSearchSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ query, limit }) =>
      toolResult(() => ({ items: searchDocumentation(docs, query, limit) })),
  )

  return server
}

export async function startGnosisServer(
  manifest: DoxaManifest,
  options: GnosisServerOptions = {},
): Promise<void> {
  const server = createGnosisServer(manifest, options)
  await server.connect(new StdioServerTransport())
}

export function renderGnosisGuidelines(): string {
  return `## Doxa application guidance

- Call \`application_info\` and \`get_programming_model\` before substantial Doxa work. Use \`explain_role\`, \`explain_component\`, \`review_architecture\`, and \`search_docs\` instead of inferring framework behavior from source, folders, or private implementation details.
- If Gnosis is unavailable or version-mismatched, stop Doxa-specific structural and architectural changes. Reload or reopen the MCP client, approve project trust if prompted, and start a new agent task. If tools remain absent, inspect the MCP startup error; registration files alone do not prove initialization. Unrelated work may continue.
- State business invariants and the required atomic, after-commit, or eventual consistency before choosing orchestration. Gnosis cannot infer business intent from the manifest.
- Actions are primary synchronous mutation boundaries. Job attempts are independent top-level writable boundaries. Queries are read-only.
- Put reusable application behavior in ordinary constructor-injected services. Services join the caller's execution and transaction; they do not own transactions.
- Never dispatch an Action from an Action, Query, or Job, directly or through a service. Preserve atomic invariants by calling a shared ordinary service inside the owning Action or Job transaction.
- Use local work for same-unit-of-work reactions, after-commit work only when later failure may leave the original mutation committed, and queued work only for independently retryable eventual consequences.
- A queued Listener receives a fresh execution but no automatic writable transaction. It may dispatch a later top-level Action; alternatively, queue a Job whose attempt owns its writable transaction.
- Use \`Feature.provides\` to export ordinary services across Feature boundaries. Use \`Feature.providers\` only for singleton infrastructure with durable identity and lifecycle.
- Canonical folders communicate intent but never activate runtime behavior. Prefer Praxis generators.
- Use \`query_models\` instead of raw SQL when application data is needed. Call \`describe_model\` first, request only necessary logical fields, and keep the result limit small.
- Treat model records as sensitive. Never expose credentials, tokens, password hashes, or unnecessary personal data.
- Do not edit \`.doxa\`, \`dist\`, coverage output, local environment files, or package archives.
- Run \`pnpm test\` before claiming completion.`
}

export function renderGnosisInstructions(): string {
  return `Gnosis is the version-matched architectural authority for this compiled Doxa application.
Call application_info and get_programming_model before structural or architectural work.
Use explain_role and explain_component for role, scope, injection, transaction, lifecycle, and dependency semantics.
Use review_architecture only after stating the business invariant and required atomic, after-commit, or eventual consistency.
Actions and Job attempts are top-level writable boundaries; Queries are read-only. Ordinary services join their caller's execution and transaction.
Nested Action dispatch from Actions, Queries, or Jobs is prohibited. Share reusable behavior through an ordinary service.
Queued Listeners have a fresh execution but no automatic writable transaction; eventual mutation belongs in their later top-level Action or in a Job attempt.
Feature.provides exports ordinary services; Feature.providers selects singleton infrastructure.
Folders communicate canonical organization but have no runtime meaning.
If matching Gnosis guidance is unavailable, stop Doxa-specific structural and architectural changes and report the startup or version failure.`
}

function registerJsonResource(
  server: McpServer,
  name: string,
  uri: string,
  read: () => unknown,
): void {
  server.registerResource(
    name,
    uri,
    { mimeType: 'application/json', description: `Read-only ${name.replaceAll('-', ' ')}.` },
    async () => ({
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(read(), null, 2) }],
    }),
  )
}

async function toolResult(read: () => unknown | Promise<unknown>) {
  try {
    const structuredContent = (await read()) as Record<string, unknown>
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
      structuredContent,
    }
  } catch (error) {
    const failure = safeFailure(error)
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify(failure) }],
    }
  }
}

function safeFailure(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof IntrospectionError)
    return { code: error.code, message: sanitizeInspectionValue(error.message) as string }
  return {
    code: 'gnosis_failure',
    message: 'Gnosis could not complete the request.',
  }
}

function packageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('The installed Gnosis package has no valid version.')
  }
  return packageJson.version
}

function assertMatchingGnosisVersion(manifest: DoxaManifest): void {
  if (manifest.frameworkVersion === GNOSIS_VERSION) return
  throw new IntrospectionError(
    'stale_manifest',
    `Gnosis ${GNOSIS_VERSION} cannot guide Doxa ${manifest.frameworkVersion}. Install the matching @doxajs/gnosis version and rebuild the application before Doxa-specific structural or architectural work.`,
  )
}
