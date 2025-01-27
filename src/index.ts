import { type EventClient } from "./eventDbHelpers";
import { type GenericEventBase } from "./schemaHelpers";
import { ProjectionBase } from "./projection";

export {
  createEventsTable,
  createProjectionBaseClasssTable,
  type GenericEventsType,
  type GenericProjectionsType,
  type GenericEventsTable,
  type GenericProjectionsTable,
  type GenericEventBase,
  type GenericEventInput,
  type PgInsertEvent,
  type InputOf,
} from "./schemaHelpers";

export {
  type EventClient,
  createEventClient,
} from "./eventDbHelpers";

export {
  type ObjectWithOnlyStringOrNumberValues,
  type ObjectWithOnlyStringOrNumberValuesOrArrayValues,
  type EventFromType,
} from "./utils";

export { ProjectionBase, type ProjectionBase as ProjectionBaseType } from "./projection";

export const createProjectionBaseClass = <
  EventType extends string,
  Event extends GenericEventBase<EventType>,
  Client extends EventClient<EventType, Event>,
  V extends Record<string, unknown>
>() => ProjectionBase<EventType, Event, Client, V>;
