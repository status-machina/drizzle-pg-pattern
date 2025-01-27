import { SQL, sql } from 'drizzle-orm';
import { 
  text,
  jsonb,
  timestamp,
  primaryKey,
  index,
  pgTable,
  ExtraConfigColumn,
  PgInsertValue,
  uuid,
} from 'drizzle-orm/pg-core';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ulid } from 'ulidx';

export type InputOf<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string, createdAt?: Date, updatedAt?: Date };

export type EventsTableConfig = {
  schema?: string;
  name?: string;
  dataIndexes?: string[];
  additionalIndexes?: {
    name: string;
    columns: [Partial<ExtraConfigColumn> | SQL, ...Partial<ExtraConfigColumn | SQL>[]];
  }[];
};

export type ProjectionsTableConfig = {
  schema?: string;
  name?: string;
  dataIndexes?: string[];
  additionalIndexes?: {
    name: string;
    columns: [Partial<ExtraConfigColumn> | SQL, ...Partial<ExtraConfigColumn | SQL>[]];
  }[];
};

export function createEventsTable(config: EventsTableConfig = {}) {
  const {
    schema,
    name = 'events',
    dataIndexes = [],
    additionalIndexes = []
  } = config;

  return pgTable(
    schema ? `${schema}.${name}` : name,
    {
      id: text('id').primaryKey().$defaultFn(() => ulid()),
      type: text('type').notNull(),
      data: jsonb('data').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    },
    (table) => [
      index(`${name}_type_idx`).on(table.type),
      // Create indexes for each data field
      ...dataIndexes.map(field => 
        index(`${name}_data_${field}_idx`).on(
          sql`(${table.data}->>'${field}')`
        )
      ),
      // Add any additional custom indexes
      ...additionalIndexes.map(additionalIndex => 
        index(additionalIndex.name).on(...additionalIndex.columns)
      )
    ]
  );
}

export function createProjectionBaseClasssTable(config: ProjectionsTableConfig = {}) {
  const {
    schema,
    name = 'projections',
    dataIndexes = [],
    additionalIndexes = []
  } = config;

  return pgTable(
    schema ? `${schema}.${name}` : name,
    {
      type: text('type').notNull(),
      id: text('id').notNull(),
      data: jsonb('data').notNull(),
      latestEventId: text('latest_event_id').notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (table) => [
      primaryKey({ columns: [table.type, table.id] }),
      index(`${name}_type_idx`).on(table.type),
      // Create indexes for each data field
      ...dataIndexes.map(field => 
        index(`${name}_data_${field}_idx`).on(
          sql`(${table.data}->>'${field}')`
        )
      ),
      // Add any additional custom indexes
      ...additionalIndexes.map(additionalIndex => 
        index(additionalIndex.name).on(...additionalIndex.columns)
      )
    ]
  );
}

export type GenericEventsType = (ReturnType<typeof createEventsTable>)['$inferSelect'];
export type GenericProjectionsType = (ReturnType<typeof createProjectionBaseClasssTable>)['$inferSelect'];
export type GenericEventsTable = ReturnType<typeof createEventsTable>;
export type GenericProjectionsTable = ReturnType<typeof createProjectionBaseClasssTable>;

export type GenericEventBase<T> = GenericEventsType & {
  type: T;
};

export type GenericEventInput<K> = (ReturnType<typeof createEventsTable>)['$inferInsert'] & K;

export type PgInsertEvent = PgInsertValue<ReturnType<typeof createEventsTable>>;

export type DbOrTx<T extends PostgresJsDatabase<any>> =
  | T
  | Parameters<Parameters<T['transaction']>[0]>[0];
