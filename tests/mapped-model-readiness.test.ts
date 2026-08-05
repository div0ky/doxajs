import { Duration, Graphite, Instant, LocalDate, type ModelStorage } from '@doxajs/core'
import { describe, expect, it } from 'vitest'

import {
  dehydrateMappedState,
  hydrateMappedState,
  mappedModelProjection,
  mappedModelVersionSource,
  postgresRegclassIdentifier,
  type ModelColumnMetadata,
  validateMappedModelReadiness,
} from '../packages/postgres-drizzle/src/postgres-transaction-manager.js'

type TableStorage = Extract<ModelStorage, { readonly kind: 'table' }>

const mappedStorage: TableStorage = {
  kind: 'table',
  table: 'legacy_contacts',
  primaryKey: 'contact_id',
  columns: {
    id: 'contact_id',
    displayName: 'display_name',
  },
  attributeTypes: {
    id: { kind: 'string', nullable: false, optional: false },
    displayName: { kind: 'string', nullable: false, optional: false },
  },
  timestamps: false,
  managed: false,
  readOnly: false,
  versionSource: { kind: 'xmin' },
}

const idColumn = column('contact_id', 'uuid')
const displayNameColumn = column('display_name', 'text')

describe('mapped-model PostgreSQL readiness contract', () => {
  it('quotes exact mixed-case and schema-qualified regclass identifiers', () => {
    expect(postgresRegclassIdentifier('Contact')).toBe('"Contact"')
    expect(postgresRegclassIdentifier('public.Contact')).toBe('"public"."Contact"')
    expect(postgresRegclassIdentifier('Legacy.User"Group')).toBe('"Legacy"."User""Group"')
  })

  it('uses a non-concurrency version for read-only relations without a version column', () => {
    expect(mappedModelVersionSource(mappedStorage)).toEqual({ kind: 'xmin' })
    expect(
      mappedModelVersionSource({
        ...mappedStorage,
        readOnly: true,
        versionSource: { kind: 'none' },
      }),
    ).toEqual({
      kind: 'none',
    })
    expect(
      mappedModelVersionSource({
        ...mappedStorage,
        readOnly: true,
        versionColumn: 'revision',
        versionSource: { kind: 'column', column: 'revision' },
      }),
    ).toEqual({ kind: 'column', column: 'revision' })
    expect(() =>
      mappedModelVersionSource({
        ...mappedStorage,
        readOnly: true,
      }),
    ).toThrow('version source is inconsistent')
  })

  it('aliases declared columns away from adapter metadata names', () => {
    expect(
      mappedModelProjection({
        ...mappedStorage,
        primaryKey: '__doxa_version',
        columns: {
          id: '__doxa_version',
          displayName: '__doxa_id',
        },
      }),
    ).toEqual([
      {
        attribute: 'id',
        column: '__doxa_version',
        alias: '__doxa_attribute_0',
      },
      {
        attribute: 'displayName',
        column: '__doxa_id',
        alias: '__doxa_attribute_1',
      },
    ])
  })

  it('fails hydration when a required projected attribute is null', () => {
    expect(() =>
      hydrateMappedState(
        {
          __doxa_attribute_0: 'contact-1',
          __doxa_attribute_1: null,
          __doxa_version: 0,
        },
        mappedStorage,
      ),
    ).toThrow('returned NULL for required attribute displayName')
  })

  it('accepts unrelated additional columns and PostgreSQL enum scalars', () => {
    const enumDisplayName = column('display_name', 'contact_name', { typeKind: 'e' })
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [
          idColumn,
          enumDisplayName,
          column('password_hash', 'text', { hasDefault: true }),
          column('vendor_state', 'text', { notNull: false }),
        ],
        ['contact_id'],
      ),
    ).not.toThrow()
  })

  it('persists datetimes canonically and hydrates UTC-aware values', () => {
    const datetimeStorage: TableStorage = {
      ...mappedStorage,
      columns: {
        ...mappedStorage.columns,
        appointmentAt: 'appointment_at',
        occurredAt: 'occurred_at',
        serviceDate: 'service_date',
        elapsed: 'elapsed',
      },
      attributeTypes: {
        ...mappedStorage.attributeTypes,
        appointmentAt: { kind: 'graphite', nullable: false, optional: false },
        occurredAt: { kind: 'instant', nullable: false, optional: false },
        serviceDate: { kind: 'local-date', nullable: false, optional: false },
        elapsed: { kind: 'duration', nullable: false, optional: false },
      },
    }
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        datetimeStorage,
        'r',
        [
          idColumn,
          displayNameColumn,
          column('appointment_at', 'timestamptz'),
          column('occurred_at', 'timestamp'),
          column('service_date', 'date'),
          column('elapsed', 'text'),
        ],
        ['contact_id'],
      ),
    ).not.toThrow()

    const instant = Instant.parse('2026-07-21T17:34:56.789123Z')
    const graphite = Graphite.fromInstant(instant, 'America/Chicago')
    const duration = Duration.parse('PT90M')
    expect(
      dehydrateMappedState(
        {
          id: 'contact-1',
          displayName: 'Ada',
          appointmentAt: graphite,
          occurredAt: instant,
          serviceDate: LocalDate.parse('2026-07-21'),
          elapsed: duration,
        },
        datetimeStorage,
      ),
    ).toEqual(
      new Map([
        ['contact_id', 'contact-1'],
        ['display_name', 'Ada'],
        ['appointment_at', instant.toString()],
        ['occurred_at', instant.toString()],
        ['service_date', '2026-07-21'],
        ['elapsed', duration.toString()],
      ]),
    )

    const hydrated = hydrateMappedState(
      {
        __doxa_attribute_0: 'contact-1',
        __doxa_attribute_1: 'Ada',
        __doxa_attribute_2: '2026-07-21 17:34:56.789123+00',
        __doxa_attribute_3: '2026-07-21 17:34:56.789123',
        __doxa_attribute_4: '2026-07-21',
        __doxa_attribute_5: duration.toString(),
        __doxa_version: 1,
      },
      datetimeStorage,
    ) as Record<string, unknown>
    expect(hydrated.appointmentAt).toBeInstanceOf(Graphite)
    expect((hydrated.appointmentAt as Graphite).timeZone).toBe('UTC')
    expect((hydrated.appointmentAt as Graphite).toInstant().equals(instant)).toBe(true)
    expect((hydrated.occurredAt as Instant).equals(instant)).toBe(true)
    expect(String(hydrated.serviceDate)).toBe('2026-07-21')
    expect(String(hydrated.elapsed)).toBe(duration.toString())
  })

  it('rejects legacy string timestamp mappings and incompatible datetime columns', () => {
    const stringTimestamp: TableStorage = {
      ...mappedStorage,
      columns: { ...mappedStorage.columns, occurredAt: 'occurred_at' },
      attributeTypes: {
        ...mappedStorage.attributeTypes,
        occurredAt: { kind: 'string', nullable: false, optional: false },
      },
    }
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        stringTimestamp,
        'r',
        [idColumn, displayNameColumn, column('occurred_at', 'timestamptz')],
        ['contact_id'],
      ),
    ).toThrow('incompatible with PostgreSQL type timestamptz')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        {
          ...stringTimestamp,
          attributeTypes: {
            ...stringTimestamp.attributeTypes,
            occurredAt: { kind: 'instant', nullable: false, optional: false },
          },
        },
        'r',
        [idColumn, displayNameColumn, column('occurred_at', 'date')],
        ['contact_id'],
      ),
    ).toThrow('incompatible with PostgreSQL type date')
  })

  it('rejects missing relations, mapped columns, incompatible types, and nullability', () => {
    expect(() =>
      validateMappedModelReadiness('model:contacts/contact', mappedStorage, undefined, [], []),
    ).toThrow('does not exist')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn],
        ['contact_id'],
      ),
    ).toThrow('references missing column display_name')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, column('display_name', 'bool')],
        ['contact_id'],
      ),
    ).toThrow('incompatible with PostgreSQL type bool')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, column('display_name', 'text', { notNull: false })],
        ['contact_id'],
      ),
    ).toThrow('incompatible nullability')
  })

  it('rejects invalid keys, generated writable mappings, and impossible inserts', () => {
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, displayNameColumn],
        ['tenant_id', 'contact_id'],
      ),
    ).toThrow('requires single-column primary key contact_id')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, column('display_name', 'text', { generated: true })],
        ['contact_id'],
      ),
    ).toThrow('uses generated column display_name')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'r',
        [idColumn, displayNameColumn, column('required_vendor_value', 'text')],
        ['contact_id'],
      ),
    ).toThrow('undeclared column required_vendor_value is required and has no default')
  })

  it('requires views to be read-only and permits their unrelated required columns', () => {
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        mappedStorage,
        'v',
        [idColumn, displayNameColumn],
        [],
      ),
    ).toThrow('must declare readOnly = true')

    const readOnlyStorage: TableStorage = {
      ...mappedStorage,
      readOnly: true,
      versionSource: { kind: 'none' },
    }
    expect(readOnlyStorage).not.toHaveProperty('versionColumn')
    expect(mappedModelVersionSource(readOnlyStorage)).toEqual({ kind: 'none' })
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        readOnlyStorage,
        'm',
        [
          column('contact_id', 'uuid', { notNull: false }),
          column('display_name', 'text', { generated: true, notNull: false }),
          column('required_vendor_value', 'text'),
        ],
        [],
      ),
    ).not.toThrow()
  })

  it('validates version and timestamp infrastructure behavior', () => {
    const versioned: TableStorage = {
      ...mappedStorage,
      versionColumn: 'lock_version',
      versionSource: { kind: 'column', column: 'lock_version' },
      timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        versioned,
        'r',
        [
          idColumn,
          displayNameColumn,
          column('lock_version', 'text'),
          column('created_at', 'timestamptz'),
          column('updated_at', 'timestamptz'),
        ],
        ['contact_id'],
      ),
    ).toThrow('version column lock_version')
    expect(() =>
      validateMappedModelReadiness(
        'model:contacts/contact',
        versioned,
        'r',
        [
          idColumn,
          displayNameColumn,
          column('lock_version', 'int4'),
          column('created_at', 'timestamptz'),
          column('updated_at', 'text'),
        ],
        ['contact_id'],
      ),
    ).toThrow('timestamp column updated_at')
  })
})

function column(
  name: string,
  type: string,
  overrides: Partial<ModelColumnMetadata> = {},
): ModelColumnMetadata {
  return {
    name,
    type,
    typeKind: 'b',
    notNull: true,
    generated: false,
    identity: false,
    hasDefault: false,
    ...overrides,
  }
}
