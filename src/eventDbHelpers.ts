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
} from "./utils";
import { PgInsertValue, PgUpdateSetSource, PgDialect } from "drizzle-orm/pg-core";
import { monotonicFactory } from "ulidx";


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
  readonly getEventStreams: <T extends EventType>(streams: { eventTypes: T[], options?: EventQueryOptions<T, Events & { type: T }> }[]) => Promise<(Events & {
    type: T;
  })[]>;
  readonly saveProjection: (params: {
    type: string;
    id: string;
    data: Record<string, unknown>;
    latestEventId: string;
  } & PgInsertValue<GenericProjectionsTable> & PgUpdateSetSource<GenericProjectionsTable>) => Promise<{
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
  data?: Partial<ObjectWithOnlyStringOrNumberValuesOrArrayValues<E["data"]>>;
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
  projections: GenericProjectionsTable
) {
  const dialect = new PgDialect();

  return {
    async saveEvent(
      eventInput: InputOf<Events>,
      tx?: PostgresJsTransaction<J, K>
    ) {
      const dbOrTx = tx ?? db;
      const [savedEvent] = await dbOrTx
        .insert(events)
        .values(eventInput)
        .returning();
      return savedEvent as Events & { type: EventType };
    },

    async saveEvents<T extends InputOf<Events>>(
      eventInputs: T[],
      tx?: DbOrTx<Db>
    ) {
      const ulid = monotonicFactory();
      const dbOrTx = tx ?? db;
      const result = (await dbOrTx
        .insert(events)
        .values(eventInputs.map((event) => ({ ...event, id: ulid() })))
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
        const dataConditions: SQL<unknown>[] = Object.entries(options.data)
          .map(([key, value]): SQL<unknown> | undefined => {
            if (value === undefined) {
              return undefined;
            }
            if (Array.isArray(value)) {
              return value.length > 0
                ? or(
                    ...value.map(
                      (v) => sql`${events.data}->>'${key}' = ${v.toString()}`
                    )
                  )
                : undefined;
            }
            return isDefined(value)
              ? sql`${events.data}->>'${key}' = ${value.toString()}`
              : undefined;
          })
          .filter(isDefined);

        const dataSql =
          dataConditions.length > 0 ? and(...dataConditions) : undefined;
        if (dataSql) {
          conditions.push(dataSql);
        }
      }

      const [event] = await dbOrTx
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.id))
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
        const dataConditions = Object.entries(options.data)
          .map(([key, value]): SQL<unknown> | undefined => {
            if (value === undefined) {
              return undefined;
            }
            if (Array.isArray(value)) {
              return value.length > 0
                ? or(
                    ...value.map(
                      (v) => sql`${events.data}->>${key} = ${v.toString()}`
                    )
                  )
                : undefined;
            }
            return isDefined(value)
              ? sql`${events.data}->>${key} = ${value.toString()}`
              : undefined;
          })
          .filter(isDefined);

        const dataSql =
          dataConditions.length > 0 ? and(...dataConditions) : undefined;
        if (dataSql) {
          conditions.push(dataSql);
        }
      }

      const result = (await dbOrTx
        .select()
        .from(events)
        .where(and(...conditions))
        .orderBy(asc(events.id))) as (Events & { type: T })[];
      return result;
    },

    async getEventStreams<T extends EventType>(
      streams: { eventTypes: T[], options?: EventQueryOptions<T, Events & { type: T }> }[]
    ): Promise<(Events & { type: T })[]> {
      const dbOrTx = streams[0]?.options?.tx ?? db;

      const results = await Promise.all(
        streams.map(({ eventTypes, options }) =>
          this.getEventStream(eventTypes, { ...options, tx: dbOrTx })
        )
      );

      const allEvents = results.flat();
      const uniqueEvents = Array.from(
        new Map(allEvents.map(event => [event.id, event])).values()
      );

      return uniqueEvents.sort((a, b) => a.id.localeCompare(b.id));
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
      } & PgInsertValue<GenericProjectionsTable> &
        PgUpdateSetSource<GenericProjectionsTable>
    ) {
      const [result] = await db
        .insert(projections)
        .values(params)
        .onConflictDoUpdate({
          target: [projections.type, projections.id],
          where: sql`${projections.latestEventId} <= ${params.latestEventId}`,
          set: {
            data: params.data,
            latestEventId: params.latestEventId,
          },
        })
        .returning({
          status: sql<"created" | "updated" | "skipped">`
            CASE 
              WHEN xmax::text::int = 0 THEN 'created'
              WHEN xmax::text::int > 0 AND ${projections.latestEventId} <= ${params.latestEventId} THEN 'updated'
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

      const ulid = monotonicFactory();
      const eventWithId = eventInput.id ? eventInput : { ...eventInput, id: ulid() };

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
