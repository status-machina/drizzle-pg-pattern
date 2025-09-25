import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  or,
  sql,
  SQL,
  TablesRelationalConfig,
} from "drizzle-orm";
import {
  PostgresJsDatabase,
  PostgresJsTransaction,
} from "drizzle-orm/postgres-js";
import {
  DbOrTx,
  GenericEventBase,
  GenericEventsTable,
  GenericProjectionsTable,
  InputOf,
} from "./schemaHelpers";
import {
  isDefined,
  ObjectWithOnlyStringOrNumberValuesOrArrayValues,
  DataForEventTypes,
  StreamOptionsForEvents,
} from "./utils";
import { PgInsertValue, PgUpdateSetSource, PgDialect } from "drizzle-orm/pg-core";
import { monotonicFactory } from "ulidx";


export type QueryOperators<T> = {
  /** Equality */
  eq?: T;
  /** Not equal */
  neq?: T;
  /** In */
  in?: T[];
  /** Not in */
  nin?: T[];
  /** Greater than */
  gt?: T;
  /** Greater than or equal to */
  gte?: T;
  /** Less than */
  lt?: T;
  /** Less than or equal to */
  lte?: T;
};

export type DataFilter<ED extends Record<string, unknown> = Record<string, unknown>> = {
  [K in keyof ED]?: QueryOperators<string | number | boolean>;
};

type PrimitiveValue = string | number | boolean;
type FlexibleDataFilter<ED extends Record<string, unknown>> = {
  [K in keyof ED]?: PrimitiveValue | PrimitiveValue[] | QueryOperators<PrimitiveValue>;
};

function buildOperatorConditions(
  table: GenericEventsTable,
  filter?: DataFilter
): SQL<unknown>[] {
  if (!filter) return [];

  const conditions: SQL<unknown>[] = [];

  for (const [field, operators] of Object.entries(filter)) {
    if (!operators) continue;

    const fieldConditions: SQL<unknown>[] = [];

    for (const [op, rawValue] of Object.entries(operators)) {
      if (rawValue === undefined) continue;

      // Array operators: in, nin
      if (Array.isArray(rawValue)) {
        const values = rawValue as (string | number | boolean)[];
        if (values.length === 0) continue;
        if (op === "in") {
          const inSql = or(
            ...values.map((v) => sql`${table.data}->>${field} = ${v.toString()}`)
          );
          if (inSql) fieldConditions.push(inSql);
          continue;
        }
        if (op === "nin") {
          const notInSql = and(
            ...values.map((v) => sql`${table.data}->>${field} != ${v.toString()}`)
          );
          if (notInSql) fieldConditions.push(notInSql);
          continue;
        }
      }

      // Scalar operators
      const value = rawValue as string | number | boolean;
      const isNumber = typeof value === "number";
      const isBoolean = typeof value === "boolean";

      const columnText = sql`${table.data}->>${field}`;

      switch (op) {
        case "eq":
          fieldConditions.push(
            isBoolean
              ? sql`CAST(${columnText} AS boolean) = ${value}`
              : isNumber
              ? sql`CAST(${columnText} AS numeric) = ${value}`
              : sql`${columnText} = ${value.toString()}`
          );
          break;
        case "neq":
          fieldConditions.push(
            isBoolean
              ? sql`CAST(${columnText} AS boolean) != ${value}`
              : isNumber
              ? sql`CAST(${columnText} AS numeric) != ${value}`
              : sql`${columnText} != ${value.toString()}`
          );
          break;
        case "gt":
          fieldConditions.push(
            isBoolean
              ? sql`CAST(${columnText} AS boolean) > ${value}`
              : isNumber
              ? sql`CAST(${columnText} AS numeric) > ${value}`
              : sql`${columnText} > ${value.toString()}`
          );
          break;
        case "gte":
          fieldConditions.push(
            isBoolean
              ? sql`CAST(${columnText} AS boolean) >= ${value}`
              : isNumber
              ? sql`CAST(${columnText} AS numeric) >= ${value}`
              : sql`${columnText} >= ${value.toString()}`
          );
          break;
        case "lt":
          fieldConditions.push(
            isBoolean
              ? sql`CAST(${columnText} AS boolean) < ${value}`
              : isNumber
              ? sql`CAST(${columnText} AS numeric) < ${value}`
              : sql`${columnText} < ${value.toString()}`
          );
          break;
        case "lte":
          fieldConditions.push(
            isBoolean
              ? sql`CAST(${columnText} AS boolean) <= ${value}`
              : isNumber
              ? sql`CAST(${columnText} AS numeric) <= ${value}`
              : sql`${columnText} <= ${value.toString()}`
          );
          break;
        default:
          // Unknown operator: ignore
          break;
      }
    }

    if (fieldConditions.length > 0) {
      const combined = and(...fieldConditions);
      if (combined) {
        conditions.push(combined);
      }
    }
  }

  return conditions;
}


export type EventClient<
  EventType extends string = any,
  Events extends GenericEventBase<EventType> = any,
  J extends Record<string, unknown> = any,
  K extends TablesRelationalConfig = any,
  Db extends PostgresJsDatabase<any> = any
> = {
  readonly saveEvent: (eventInput: InputOf<Events>, tx?: PostgresJsTransaction<J, K>) => Promise<Events & {
    type: EventType;
  }>;
  readonly saveEvents: <T extends InputOf<Events>>(eventInputs: T[], tx?: DbOrTx<Db>) => Promise<(Events & {
    type: EventType;
  })[]>;
  readonly getLatestEvent: (eventType: EventType, options?: EventQueryOptions<EventType, Events>) => Promise<Events & {
    type: EventType;
  }>;
  readonly getEventStream: <T extends EventType>(eventTypes: T[], options?: EventQueryOptions<T, Events & {
    type: T;
  }>) => Promise<(Events & {
    type: T;
  })[]>;
  readonly getEventStreams: <T extends EventType>(streams: { eventTypes: T[], options?: EventQueryOptions<T, Events & { type: T }> }[]) => Promise<(Events & { type: T })[]>;
  readonly getLatestEventFromStreams: <T extends EventType>(streams: { eventTypes: T[], options?: EventQueryOptions<T, Events & { type: T }> }[]) => Promise<(Events & { type: T }) | undefined>;
  readonly saveProjection: (params: {
    type: string;
    id: string;
    data: Record<string, unknown>;
    latestEventId: string;
    forceUpdate?: boolean;
  } & PgInsertValue<GenericProjectionsTable> & PgUpdateSetSource<GenericProjectionsTable>) => Promise<{
    id: string;
    data: unknown;
    type: string;
    latestEventId: string;
    status: "created" | "updated" | "skipped";
  }>;
  readonly forceUpdateProjection: (params: Parameters<EventClient['saveProjection']>[0]) => Promise<{
    id: string;
    data: unknown;
    type: string;
    latestEventId: string;
    status: "created" | "updated" | "skipped";
  }>;
  readonly conditionalUpdateProjection: (params: Parameters<EventClient['saveProjection']>[0]) => Promise<{
    id: string;
    data: unknown;
    type: string;
    latestEventId: string;
    status: "created" | "updated" | "skipped";
  }>;
  readonly getProjection: <T>(params: {
    type: string;
    id: string;
  }) => Promise<{
    data: T;
    latestEventId: string;
  } | undefined>;
  readonly queryProjections: <T extends {asJson: () => Promise<Record<string, unknown>>}>(params: {
    type: string;
    data?: Partial<Awaited<ReturnType<T['asJson']>>>;
  }) => Promise<{
    data: Awaited<ReturnType<T['asJson']>>;
    latestEventId: string;
  }[]>;
  readonly saveEventWithStreamValidation: (eventInput: InputOf<Events>, latestEventId: string, streams: StreamDefinition<EventType, Events>[]) => Promise<Events & {
    type: EventType;
  }>;
};

/** This is a utility type that helps to get type safety and autocomplete for the data field in the query options. */
type EventQueryOptions<
  T extends string,
  E extends GenericEventBase<T>,
  D extends DbOrTx<PostgresJsDatabase<any>> = DbOrTx<PostgresJsDatabase<any>>
> = {
  /** The id of the event after which to query. */
  after?: string;
  /** The data to filter the events by. If an array is provided, the events will be filtered as if
   * any one of the values in the array matches. Only string and number values are supported.
   */
  data?: Partial<FlexibleDataFilter<DataForEventTypes<E, T> & Record<string, unknown>>>;
  tx?: D;
};

type StreamDefinition<T extends string, E extends GenericEventBase<T>> = {
  types: T[];
  identifier: Partial<
    ObjectWithOnlyStringOrNumberValuesOrArrayValues<E["data"]>
  >;
};

export function createEventClient<
  EventType extends string,
  Events extends GenericEventBase<EventType>,
  J extends Record<string, unknown>,
  K extends TablesRelationalConfig,
  Db extends PostgresJsDatabase<Record<string, any>>
>(
  db: DbOrTx<Db>,
  events: GenericEventsTable,
  projections: GenericProjectionsTable,
  ulidGenerator = monotonicFactory()
) {
  return {
    async saveEvent(
      eventInput: InputOf<Events>,
      tx?: PostgresJsTransaction<J, K>
    ) {
      const dbOrTx = tx ?? db;
      const [savedEvent] = await dbOrTx
        .insert(events)
        .values({...eventInput, id: eventInput.id ?? ulidGenerator()})
        .returning();
      return savedEvent as Events & { type: EventType };
    },

    async saveEvents<T extends InputOf<Events>>(
      eventInputs: T[],
      tx?: DbOrTx<Db>
    ) {
      const dbOrTx = tx ?? db;
      const result = (await dbOrTx
        .insert(events)
        .values(eventInputs.map((event) => ({ ...event, id: event.id ?? ulidGenerator() })))
        .returning()) as (Events & { type: EventType })[];
      return result;
    },

    async getLatestEvent(
      eventType: EventType,
      options?: EventQueryOptions<EventType, Events>
    ) {
      const dbOrTx = options?.tx ?? db;
      const conditions = [eq(events.type, eventType)];

      if (options?.after) {
        conditions.push(gt(events.id, options.after));
      }

      if (options?.data) {
        const entries = Object.entries(options.data);
        const simplePairs: [string, string | number][] = [];
        const operatorFilters: DataFilter = {};

        entries.forEach(([key, value]) => {
          if (value === undefined) return;
          if (Array.isArray(value)) {
            if (value.length > 0) simplePairs.push([key, value as unknown as string | number]);
            return;
          }
          if (typeof value === 'object') {
            (operatorFilters as Record<string, unknown>)[key] = value as unknown;
            return;
          }
          simplePairs.push([key, value as string | number]);
        });

        // simple equality / array-any semantics (existing behavior)
        const dataConditions = entries
          .map(([key, value]): SQL<unknown> | undefined => {
            if (value === undefined) return undefined;
            if (Array.isArray(value)) {
              return value.length > 0
                ? or(...value.map((v) => sql`${events.data}->>${key} = ${v.toString()}`))
                : undefined;
            }
            return isDefined(value)
              ? sql`${events.data}->>${key} = ${value.toString()}`
              : undefined;
          })
          .filter(isDefined);

        const dataSql = dataConditions.length > 0 ? and(...dataConditions) : undefined;
        if (dataSql) conditions.push(dataSql);

        // operator-based semantics when any object values present
        if (Object.keys(operatorFilters).length > 0) {
          const filterConditions = buildOperatorConditions(events, operatorFilters);
          if (filterConditions.length > 0) {
            const filtersSql = and(...filterConditions);
            if (filtersSql) conditions.push(filtersSql);
          }
        }
      }

      const [event] = await dbOrTx
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(desc(events.id))
        .limit(1);

      return event as Events & { type: EventType };
    },

    async getEventStream<T extends EventType>(
      eventTypes: T[],
      options?: EventQueryOptions<T, Events & { type: T }>
    ): Promise<(Events & { type: T })[]> {
      const dbOrTx = options?.tx ?? db;
      const conditions = [inArray(events.type, eventTypes)];

      if (options?.after) {
        conditions.push(gt(events.id, options.after));
      }

      if (options?.data) {
        const entries = Object.entries(options.data);
        const operatorFilters: DataFilter = {};

        const dataConditions = entries
          .map(([key, value]): SQL<unknown> | undefined => {
            if (value === undefined) return undefined;
            if (Array.isArray(value)) {
              return value.length > 0
                ? or(...value.map((v) => sql`${events.data}->>${key} = ${v.toString()}`))
                : undefined;
            }
            if (typeof value === 'object') {
              (operatorFilters as Record<string, unknown>)[key] = value as unknown;
              return undefined; // skip simple equality for operator-based
            }
            return sql`${events.data}->>${key} = ${value.toString()}`;
          })
          .filter(isDefined);

        const dataSql = dataConditions.length > 0 ? and(...dataConditions) : undefined;
        if (dataSql) conditions.push(dataSql);

        if (Object.keys(operatorFilters).length > 0) {
          const filterConditions = buildOperatorConditions(events, operatorFilters);
          if (filterConditions.length > 0) {
            const filtersSql = and(...filterConditions);
            if (filtersSql) conditions.push(filtersSql);
          }
        }
      }

      const result = (await dbOrTx
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.id))) as (Events & { type: T })[];
      return result;
    },

    async getEventStreams<S extends StreamOptionsForEvents<Events, any>[]>(
      streams: S
    ): Promise<(Events & { type: S[number]['eventTypes'][number] })[]> {
      const dbOrTx = (streams[0]?.options as { tx?: DbOrTx<Db> } | undefined)?.tx ?? db;
      const conditions: SQL<unknown>[] = [];

      streams.forEach(({ eventTypes, options }) => {
        const streamConditions: SQL<unknown>[] = [inArray(events.type, eventTypes)];

        if (options?.after) {
          streamConditions.push(gt(events.id, options.after));
        }

        if (options?.data) {
          const entries = Object.entries(options.data);
          const operatorFilters: DataFilter = {};

          const dataConditions = entries
            .map(([key, value]): SQL<unknown> | undefined => {
              if (value === undefined) return undefined;
              if (Array.isArray(value)) {
                return value.length > 0
                  ? or(...value.map((v) => sql`${events.data}->>${key} = ${v.toString()}`))
                  : undefined;
              }
              if (typeof value === 'object') {
                (operatorFilters as Record<string, unknown>)[key] = value as unknown;
                return undefined;
              }
              return sql`${events.data}->>${key} = ${value.toString()}`;
            })
            .filter(isDefined);

          const dataSql = dataConditions.length > 0 ? and(...dataConditions) : undefined;
          if (dataSql) {
            streamConditions.push(dataSql);
          }

          if (Object.keys(operatorFilters).length > 0) {
            const filterConditions = buildOperatorConditions(events, operatorFilters);
            if (filterConditions.length > 0) {
              const filtersSql = and(...filterConditions);
              if (filtersSql) streamConditions.push(filtersSql);
            }
          }
        }

        const streamSql = streamConditions.length > 0 ? and(...streamConditions) : undefined;
        if (streamSql) {
          conditions.push(streamSql);
        }
      });

      if (conditions.length === 0) {
        return [];
      }

      const result = await dbOrTx
        .select()
        .from(events)
        .where(or(...conditions))
        .orderBy(asc(events.id)) as (Events & { type: S[number]['eventTypes'][number] })[];

      return result;
    },

    async getLatestEventFromStreams<S extends StreamOptionsForEvents<Events, any>[]>(
      streams: S
    ): Promise<(Events & { type: S[number]['eventTypes'][number] }) | undefined> {
      const dbOrTx = (streams[0]?.options as { tx?: DbOrTx<Db> } | undefined)?.tx ?? db;
      const conditions: SQL<unknown>[] = [];

      streams.forEach(({ eventTypes, options }) => {
        const streamConditions: SQL<unknown>[] = [inArray(events.type, eventTypes)];

        if (options?.after) {
          streamConditions.push(gt(events.id, options.after));
        }

        if (options?.data) {
          const entries = Object.entries(options.data);
          const operatorFilters: DataFilter = {};

          const dataConditions = entries
            .map(([key, value]): SQL<unknown> | undefined => {
              if (value === undefined) return undefined;
              if (Array.isArray(value)) {
                return value.length > 0
                  ? or(...value.map((v) => sql`${events.data}->>${key} = ${v.toString()}`))
                  : undefined;
              }
              if (typeof value === 'object') {
                (operatorFilters as Record<string, unknown>)[key] = value as unknown;
                return undefined;
              }
              return sql`${events.data}->>${key} = ${value.toString()}`;
            })
            .filter(isDefined);

          const dataSql = dataConditions.length > 0 ? and(...dataConditions) : undefined;
          if (dataSql) streamConditions.push(dataSql);

          if (Object.keys(operatorFilters).length > 0) {
            const filterConditions = buildOperatorConditions(events, operatorFilters);
            if (filterConditions.length > 0) {
              const filtersSql = and(...filterConditions);
              if (filtersSql) streamConditions.push(filtersSql);
            }
          }
        }

        const streamSql = streamConditions.length > 0 ? and(...streamConditions) : undefined;
        if (streamSql) conditions.push(streamSql);
      });

      if (conditions.length === 0) {
        return undefined;
      }

      const [event] = await dbOrTx
        .select()
        .from(events)
        .where(or(...conditions))
        .orderBy(desc(events.id))
        .limit(1);

      return event as (Events & { type: S[number]['eventTypes'][number] }) | undefined;
    },


    /**
     * Save a projection to the database. If the projection already exists,
     * it will be updated as long as the incoming latestEventId
     * is greater than the current latestEventId. If the projection
     * does not exist, it will be created. A projection will be returned
     * regardless of whether it was updated or created, but the
     * `updated` field will be false if the projection already exists and
     * the incoming latestEventId was not greater than the current
     * latestEventId.
     */
    async saveProjection(
      params: {
        type: string;
        id: string;
        data: Record<string, unknown>;
        latestEventId: string;
        forceUpdate?: boolean;
      } & PgInsertValue<GenericProjectionsTable> &
        PgUpdateSetSource<GenericProjectionsTable>
    ) {
      return params.forceUpdate
        ? this.forceUpdateProjection(params)
        : this.conditionalUpdateProjection(params);
    },

    async forceUpdateProjection(params: Parameters<EventClient['saveProjection']>[0]) {
      const [result] = await db
        .insert(projections)
        .values(params)
        .onConflictDoUpdate({
          target: [projections.type, projections.id],
          set: {
            data: sql`${JSON.stringify(params.data)}::jsonb`,
            latestEventId: params.latestEventId,
          },
        })
        .returning({
          status: sql<"created" | "updated" | "skipped">`
            CASE 
              WHEN xmax::text::int = 0 THEN 'created'
              ELSE 'updated'
            END`,
          type: projections.type,
          id: projections.id,
          data: projections.data,
          latestEventId: projections.latestEventId,
        });

      return result;
    },

    async conditionalUpdateProjection(params: Parameters<EventClient['saveProjection']>[0]) {
      const [result] = await db
        .insert(projections)
        .values(params)
        .onConflictDoUpdate({
          target: [projections.type, projections.id],
          set: {
            data: sql`CASE 
              WHEN ${projections.latestEventId} <= ${params.latestEventId} 
              THEN ${JSON.stringify(params.data)}::jsonb 
              ELSE ${projections.data} 
            END`,
            latestEventId: sql`CASE 
              WHEN ${projections.latestEventId} <= ${params.latestEventId} 
              THEN ${params.latestEventId}
              ELSE ${projections.latestEventId}
            END`,
          },
        })
        .returning({
          status: sql<"created" | "updated" | "skipped">`
            CASE 
              WHEN xmax::text::int = 0 THEN 'created'
              WHEN ${projections.latestEventId} <= ${params.latestEventId} THEN 'updated'
              ELSE 'skipped'
            END`,
          type: projections.type,
          id: projections.id,
          data: projections.data,
          latestEventId: projections.latestEventId,
        });

      return result;
    },

    async getProjection<T>(params: { type: string; id: string }): Promise<
      | {
          data: T;
          latestEventId: string;
        }
      | undefined
    > {
      const [projection] = await db
        .select({
          data: projections.data,
          latestEventId: projections.latestEventId,
        })
        .from(projections)
        .where(
          and(eq(projections.type, params.type), eq(projections.id, params.id))
        );
      return projection as { data: T; latestEventId: string } | undefined;
    },

    async queryProjections<T extends {asJson: () => Promise<Record<string, unknown>>}>(params: {
      type: string;
      data?: Partial<Awaited<ReturnType<T['asJson']>>>;
    }): Promise<{data: Awaited<ReturnType<T['asJson']>>, latestEventId: string}[]> {
      const conditions = [eq(projections.type, params.type)];

      if (params.data) {
        const dataConditions = Object.entries(params.data)
          .map(([key, value]): SQL<unknown> | undefined => {
            if (value === undefined) {
              return undefined;
            }
            if (Array.isArray(value)) {
              return value.length > 0
                ? or(
                    ...value.map(
                      (v) => sql`${projections.data}->>${key} = ${v.toString()}`
                    )
                  )
                : undefined;
            }
            return isDefined(value)
              ? sql`${projections.data}->>${key} = ${value.toString()}`
              : undefined;
          })
          .filter(isDefined);

        const dataSql =
          dataConditions.length > 0 ? and(...dataConditions) : undefined;
        if (dataSql) {
          conditions.push(dataSql);
        }
      }

      const foundProjections = await db
        .select({
          data: projections.data,
          latestEventId: projections.latestEventId,
        })
        .from(projections)
        .where(and(...conditions));
      return foundProjections as {data: Awaited<ReturnType<T['asJson']>>, latestEventId: string}[];
    },

    async saveEventWithStreamValidation(
      eventInput: InputOf<Events>,
      latestEventId: string,
      streams: StreamDefinition<EventType, Events>[]
    ): Promise<Events & { type: EventType }> {
      const eventWithId = eventInput.id ? eventInput : { ...eventInput, id: ulidGenerator() };

      // Build each stream check
      const streamChecks = streams.map((stream, i) => {
        const check = sql`NOT EXISTS (
          SELECT 1 FROM ${events}
          WHERE ${inArray(events.type, stream.types)}
          AND ${events.id}::text > ${latestEventId}::text
          AND ${sql.join(
            Object.entries(stream.identifier).map(
              ([key, value]) => sql`${events.data}->>${key} = ${value}`
            ),
            sql` AND `
          )}
        )`;

        return check;
      });

      const query = sql`
        WITH new_event AS (
          INSERT INTO ${events} (id, type, data, created_at, updated_at)
          VALUES (${eventWithId.id}, ${eventWithId.type}, ${JSON.stringify(eventWithId.data)}::jsonb, DEFAULT, DEFAULT)
          RETURNING *
        )
        SELECT * FROM new_event
        WHERE ${sql.join(streamChecks, sql` AND `)}
      `;

      const [savedEvent] = await db.execute<Events>(query);

      if (!savedEvent) {
        throw new Error(
          "Concurrent modification detected - newer events exist in one or more streams"
        );
      }
      return savedEvent as Events & { type: EventType };
    },
  } as const;
}
